"""Offline preparation of staged HF data; no relevance labels or splits invented."""
import argparse, collections, csv, hashlib, json, re
from pathlib import Path
from html.parser import HTMLParser
import pyarrow.parquet as pq

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'): self.skip+=1
        if tag in ('p','li','br','div','h1','h2','h3'): self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style'): self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip: self.parts.append(data)

def plain(text):
    parser=TextParser();parser.feed(text or '')
    return re.sub(r'[ \t]+',' ',' '.join(parser.parts)).strip()

def digest(text):
    return hashlib.sha256(re.sub(r'\s+',' ',text).strip().lower().encode()).hexdigest()

# Conservative country selection. City-only locations are not silently assumed PH.
PH=re.compile(r'\bphilippines\b|\bphilippine\b|(?:^|[,;| /-])PH(?:$|[,;| /-])',re.I)
EMAIL=re.compile(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b')
URL=re.compile(r'https?://\S+|www\.\S+',re.I)
PHONE=re.compile(r'(?<!\w)(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)')
CATEGORY={
'ACCOUNTANT':'K02','HR':'K02','BUSINESS-DEVELOPMENT':'K03','FINANCE':'K02','BANKING':'K02',
'INFORMATION-TECHNOLOGY':'K01','DESIGNER':'K04','ARTS':'K04','DIGITAL-MEDIA':'K04',
'TEACHER':'K05','HEALTHCARE':'K06','FITNESS':'K13','AGRICULTURE':'K10','BPO':'K03',
'SALES':'K03','ENGINEERING':'K07','CONSTRUCTION':'K07','ADVOCATE':'K11','CHEF':'K08',
'AUTOMOBILE':'K07','PUBLIC-RELATIONS':'K03'}


def prepare(root):
    out=root/'prepared';out.mkdir(exist_ok=False)
    summary={'job_rows_scanned':0,'job_location_ph_candidates':0,'jobs_written':0,
             'job_duplicate_id_or_text':0,'job_short_or_empty':0,'job_jooble_excluded':0,
             'job_sources':collections.Counter(),'job_employers':collections.Counter(),
             'resumes_read':0,'resumes_written':0,'resume_duplicate_text':0,'resume_short_or_empty':0,
             'resume_source_categories':collections.Counter(),'resume_proposed_k13':collections.Counter(),
             'resume_contact_pattern_flags':0,'human_relevance_labels':0,'training_ready':False}
    from pipeline.source_policy import is_jooble_origin
    seen_id=set();seen_text=set()
    with (out/'jobs_ph.jsonl').open('w') as handle:
        for path in sorted((root/'edwarddgao--open-apply-jobs').rglob('*.parquet')):
            source=path.parent.name.split('=',1)[1]
            for batch in pq.ParquetFile(path).iter_batches(batch_size=2048):
                for row in batch.to_pylist():
                    summary['job_rows_scanned']+=1
                    locations=row.get('locations') or []
                    matched=[x for x in locations if PH.search(x)]
                    if not matched: continue
                    summary['job_location_ph_candidates']+=1
                    if is_jooble_origin({'source':source,'source_url':row.get('apply_url'),'payload':{}}):
                        summary['job_jooble_excluded']+=1;continue
                    text=plain(row.get('description_html'))
                    if not row.get('title') or len(text)<200:
                        summary['job_short_or_empty']+=1;continue
                    fingerprint=digest(str(row.get('source_slug'))+' '+str(row.get('title'))+' '+text)
                    if row['id'] in seen_id or fingerprint in seen_text:
                        summary['job_duplicate_id_or_text']+=1;continue
                    seen_id.add(row['id']);seen_text.add(fingerprint)
                    item={'job_id':row['id'],'title':row['title'],'employer_slug':row['source_slug'],
                        'description':text,'locations':locations,'ph_location_evidence':matched,
                        'source':source,'source_url':row.get('apply_url'),'posted_at':row.get('posted_at'),
                        'remote':row.get('remote'),'source_file':str(path.relative_to(root)),
                        'content_sha256':digest(text),'category_status':'human_review_pending',
                        'corpus_role':'PH-tagged ATS staging; not representative national sample',
                        'rights_review':'MIT packaging only; underlying employer content rights retained',
                        'training_ready':False,'split':None}
                    handle.write(json.dumps(item,ensure_ascii=False)+'\n')
                    summary['jobs_written']+=1
                    summary['job_sources'][source]+=1;summary['job_employers'][row['source_slug']]+=1
    seen=set();csv.field_size_limit(10_000_000)
    with (root/'opensporks--resumes'/'Resume'/'Resume.csv').open(newline='') as source, (out/'resumes.jsonl').open('w') as handle:
        for row in csv.DictReader(source):
            summary['resumes_read']+=1
            text=row['Resume_str'].strip(); original_hash=digest(text)
            if len(text)<200: summary['resume_short_or_empty']+=1;continue
            if original_hash in seen: summary['resume_duplicate_text']+=1;continue
            seen.add(original_hash)
            flagged=bool(EMAIL.search(text) or PHONE.search(text) or URL.search(text))
            summary['resume_contact_pattern_flags']+=int(flagged)
            text=EMAIL.sub('[EMAIL]',text);text=PHONE.sub('[PHONE]',text);text=URL.sub('[URL]',text)
            category=row['Category'];proposed=CATEGORY.get(category)
            item={'resume_id':'opensporks-'+row['ID'],'text':text,'source_category':category,
                  'proposed_k13':proposed,'mapping_status':'provisional broad category mapping; review required',
                  'source_dataset':'opensporks/resumes','source_record_id':row['ID'],
                  'original_text_sha256':original_hash,'text_sha256':digest(text),
                  'contact_patterns_detected':flagged,'privacy_status':'basic contact masking only; names/addresses and residual identifiers need review',
                  'geography':'not established as Philippine','data_kind':'published resume examples; authenticity not independently verified',
                  'training_ready':False,'split':None}
            handle.write(json.dumps(item,ensure_ascii=False)+'\n')
            summary['resumes_written']+=1
            summary['resume_source_categories'][category]+=1
            summary['resume_proposed_k13'][proposed or 'REVIEW_REQUIRED']+=1
    for i in range(1,14):summary['resume_proposed_k13'].setdefault(f'K{i:02d}',0)
    (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='job_employers'},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    prepare(parser.parse_args().root)
