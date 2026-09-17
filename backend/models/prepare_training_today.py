"""Versioned pilot data: skill-evidence weak labels, never human qrels."""
import collections,hashlib,importlib.util,json,math,random,re
from pathlib import Path
import numpy as np
import pyarrow.parquet as pq
from scipy.sparse import csr_matrix
from models.taxonomy import load_cached,normalize

ROOT=Path(__file__).resolve().parents[1]
STAGE=ROOT/'data/corpus/staging/hf-2026-09-10'
OUT=ROOT/'data/corpus/training/skills-first-2026-09-10-v2'
SEED=20260910

def split(key):
    n=int(hashlib.sha256(('20260910|'+key).encode()).hexdigest()[:8],16)%100
    return 'train' if n<70 else 'dev' if n<85 else 'test'

class Extractor:
    def __init__(self,tax):
        self.trie={};self.tax=tax
        for alias,skill in tax.alias_to_skill.items():
            words=normalize(alias).split()
            if len(alias)<3 or not words:continue
            node=self.trie
            for w in words:node=node.setdefault(w,{})
            node['$']=skill
    def __call__(self,text):
        words=normalize(text).split();found=set();i=0
        while i<len(words):
            node=self.trie;j=i;best=None
            while j<len(words) and words[j] in node:
                node=node[words[j]];j+=1
                if '$' in node:best=(node['$'],j)
            if best:found.add(best[0]);i=best[1]
            else:i+=1
        return sorted(found)

def main():
    OUT.mkdir(parents=True,exist_ok=False)
    spec=importlib.util.spec_from_file_location('prep',ROOT/'scripts/prepare_hf_staging.py');prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
    tax=load_cached();extract=Extractor(tax)
    resumes=[json.loads(x) for x in (STAGE/'prepared/resumes.jsonl').open()]
    jobs=[dict(json.loads(x),geography='PH-tagged') for x in (STAGE/'prepared/jobs_ph.jsonl').open()]
    # Reproducible international sample by title-intent strata. These are NOT labels.
    patterns={
    'K01':r'\b(software|developer|data scientist|cybersecurity)\b',
    'K02':r'\b(accountant|bookkeeper|administrative assistant|finance analyst)\b',
    'K03':r'\b(sales representative|customer service|marketing coordinator)\b',
    'K04':r'\b(graphic designer|video editor|content writer)\b',
    'K05':r'\b(teacher|tutor|instructor|social worker)\b',
    'K06':r'\b(nurse|caregiver|pharmacist|medical assistant)\b',
    'K07':r'\b(electrician|welder|civil engineer|plumber|carpenter)\b',
    'K08':r'\b(chef|cook|housekeeper|room attendant|hotel|barista)\b',
    'K09':r'\b(warehouse|delivery driver|production operator|logistics)\b',
    'K10':r'\b(agronomist|farm|agriculture|forestry|fishery|aquaculture)\b',
    'K11':r'\b(security guard|legal assistant|paralegal|firefighter)\b',
    'K12':r'\b(laboratory|research scientist|quality control)\b',
    'K13':r'\b(fitness|personal trainer|sports coach|recreation)\b'}
    patterns={k:re.compile(v,re.I) for k,v in patterns.items()};pools={k:[] for k in patterns};count=collections.Counter();rng=random.Random(SEED)
    for path in sorted((STAGE/'edwarddgao--open-apply-jobs').rglob('*.parquet')):
        for batch in pq.ParquetFile(path).iter_batches(batch_size=2048):
            for row in batch.to_pylist():
                if any(prep.PH.search(x) for x in row.get('locations') or []):continue
                matches=[k for k,p in patterns.items() if p.search(row.get('title') or '')]
                if not matches:continue
                cat=matches[-1];count[cat]+=1
                slot=count[cat]-1 if count[cat]<=100 else rng.randrange(count[cat])
                if slot>=100:continue
                text=prep.plain(row.get('description_html'))
                if len(text)<200:continue
                item={'job_id':row['id'],'title':row['title'],'employer_slug':row['source_slug'],'description':text,'locations':row.get('locations'),'source_url':row.get('apply_url'),'geography':'international','sampling_stratum':cat,'content_sha256':prep.digest(text)}
                if len(pools[cat])<100:pools[cat].append(item)
                else:pools[cat][slot]=item
    jobs.extend(x for p in pools.values() for x in p)
    # Group identical description OR employer/title variants before splitting, via union-find.
    parents=list(range(len(jobs)))
    def find(i):
        while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
        return i
    keys={}
    for i,j in enumerate(jobs):
        for key in ['text:'+prep.digest(j['description']),'role:'+normalize(j['employer_slug']+' '+j['title'])]:
            if key in keys:parents[find(i)]=find(keys[key])
            else:keys[key]=i
    groups=collections.defaultdict(list)
    for i,j in enumerate(jobs):groups[find(i)].append(j['job_id'])
    for i,j in enumerate(jobs):j['split']=split(min(groups[find(i)]));j['duplicate_group']=min(groups[find(i)])
    stats={'label_type':'weak taxonomy-overlap supervision; NOT human suitability','seed':SEED,'international_sampling_counts':{k:len(v) for k,v in pools.items()},'splits':{}}
    for r in resumes:
        r['split']=split(r['original_text_sha256']);r['skills']=extract(r['text'])
    for j in jobs:j['skills']=extract(j['title']+' '+j['description'])
    # IDF learned on training jobs only, not test distribution.
    trainjobs=[j for j in jobs if j['split']=='train'];freq=collections.Counter(s for j in trainjobs for s in j['skills'])
    vocab=sorted(tax.skills);index={s:i for i,s in enumerate(vocab)}
    idf={s:math.log((1+len(trainjobs))/(1+freq[s]))+1 for s in vocab}
    from models.skill_input import build_input
    def representation(text,skills,title=''):
        return build_input(text,skills,tax,idf,title)
    for r in resumes:r['model_text']=representation(r['text'],r['skills'])
    for j in jobs:j['model_text']=representation(j['description'],j['skills'],j['title'])
    for name in ['train','dev','test']:
        rs=[r for r in resumes if r['split']==name and len(r['skills'])>=2]
        js=[j for j in jobs if j['split']==name and len(j['skills'])>=2]
        def matrix(records):
            rr=[];cc=[];vv=[]
            for i,r in enumerate(records):
                for s in r['skills']:rr.append(i);cc.append(index[s]);vv.append(idf[s])
            return csr_matrix((vv,(rr,cc)),shape=(len(records),len(vocab)))
        a=matrix(rs);b=matrix(js);overlap=(a@b.T).toarray()
        an=np.asarray(a.multiply(a).sum(1)).ravel();bn=np.asarray(b.multiply(b).sum(1)).ravel()
        cosine=overlap/np.sqrt(np.maximum(an[:,None]*bn[None,:],1e-9))
        pairs=[];qrels=[];usage=collections.Counter();category=collections.Counter()
        for i,r in enumerate(rs):
            choices=[];rset=set(r['skills'])
            for k in np.argsort(-cosine[i]):
                j=js[k];shared=rset&set(j['skills']);coverage=sum(idf[s] for s in shared)/sum(idf[s] for s in j['skills'])
                if cosine[i,k]>=.45 and len(shared)>=2 and coverage>=.45:choices.append((k,shared,float(cosine[i,k]),coverage))
            if not choices:continue
            # Negatives must have low overlap. Ambiguous jobs are unjudged, not presumed irrelevant.
            negative_indices=[int(k) for k in np.argsort(-cosine[i]) if cosine[i,k]<.20 and len(rset&set(js[k]['skills']))<=1]
            if len(negative_indices)<2:continue
            chosen=next((x for x in choices if usage[js[x[0]]['job_id']]<12),None)
            if chosen is None:continue
            k,shared,sim,cov=chosen;j=js[k];usage[j['job_id']]+=1
            rng.shuffle(negative_indices);negs=negative_indices[:2]
            pairs.append({'query_id':r['resume_id'],'positive_id':j['job_id'],'negative_ids':[js[n]['job_id'] for n in negs], 'query':r['model_text'],'positive':j['model_text'],'negatives':[js[n]['model_text'] for n in negs],'label_source':'weak_taxonomy_overlap_v1','shared_skill_ids':sorted(shared),'weak_cosine':sim,'weak_job_skill_coverage':cov,'split':name,'human_validated':False})
            qrels.append({'query_id':r['resume_id'],'query':r['model_text'],'relevant_ids':[js[x[0]]['job_id'] for x in choices],'label_source':'weak_taxonomy_overlap_v1','source_resume_category':r['source_category']})
            category[r['source_category']]+=1
        for file,records in [(f'pairs_{name}.jsonl',pairs),(f'weak_qrels_{name}.jsonl',qrels),(f'jobs_{name}.jsonl',js)]:
            (OUT/file).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records))
        stats['splits'][name]={'pairs':len(pairs),'candidate_pool':len(rs),'job_pool':len(js),'resume_categories':dict(category),'geography':dict(collections.Counter(j['geography'] for j in js))}
    (OUT/'resume_inventory.jsonl').write_text(''.join(json.dumps({k:r[k] for k in ['resume_id','split','original_text_sha256','skills','source_category']})+'\n' for r in resumes))
    (OUT/'job_inventory.jsonl').write_text(''.join(json.dumps({k:j[k] for k in ['job_id','split','duplicate_group','source_url','geography','skills']})+'\n' for j in jobs))
    (OUT/'preparation_report.json').write_text(json.dumps(stats,indent=2));print(json.dumps(stats,indent=2),flush=True)
if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=OUT)
    OUT=parser.parse_args().output
    main()
