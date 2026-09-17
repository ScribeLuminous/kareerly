"""Run the dated trained retriever against its frozen prepared job catalogue.

This CLI exposes the research artifact without replacing the deployed matcher.
"""
import argparse,json
from pathlib import Path
import numpy as np
from sentence_transformers import SentenceTransformer

ROOT=Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--resume-id');p.add_argument('--text-file',type=Path);p.add_argument('--split',choices=['train','dev','test'],default='test');p.add_argument('--top-k',type=int,default=5);p.add_argument('--ph-only',action='store_true');p.add_argument('--output',type=Path);a=p.parse_args()
    data=ROOT/'data/corpus/training/skills-first-2026-09-10-v2';model_path=ROOT/'trained_models/kareerly-retriever-skills-first-2026-09-10-gpu'
    read=lambda path:[json.loads(x) for x in path.open() if x.strip()]
    if a.text_file:
        # Same preprocessing and lexical skill vocabulary used for dataset preparation.
        from models.prepare_training_today import Extractor
        from models.taxonomy import load_cached
        tax=load_cached();text=a.text_file.read_text();skills=Extractor(tax)(text)
        from models.skill_input import training_idf,build_input
        idf=training_idf(read(data/'job_inventory.jsonl'),tax.skills)
        query=build_input(text,skills,tax,idf)
        query_id='local-text'
    else:
        qs=read(data/f'weak_qrels_{a.split}.jsonl')
        r=next((r for r in qs if r['query_id']==a.resume_id),None) if a.resume_id else qs[0]
        if r is None:raise ValueError('resume-id is not in the selected query split')
        query=r['query'];query_id=r['query_id']
    jobs=read(data/f'jobs_{a.split}.jsonl')
    if a.ph_only:jobs=[j for j in jobs if j['geography']=='PH-tagged']
    if not jobs:raise ValueError('No jobs match the requested filter')
    model=SentenceTransformer(str(model_path),device='cpu',local_files_only=True)
    vectors=model.encode([query]+[j['model_text'] for j in jobs],batch_size=24,normalize_embeddings=True,show_progress_bar=False)
    scores=vectors[1:]@vectors[0];ranking=np.argsort(-scores)[:max(1,a.top_k)]
    result={'model':str(model_path),'query_id':query_id,'scope':'experimental learned similarity; not hiring probability','ph_only':a.ph_only,'matches':[{'job_id':jobs[i]['job_id'],'title':jobs[i]['title'],'source_url':jobs[i]['source_url'],'geography':jobs[i]['geography'],'cosine_similarity':float(scores[i])} for i in ranking]}
    if a.output:a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
