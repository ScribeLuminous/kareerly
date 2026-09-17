"""Compare retrievers with each duplicate-job group counted once."""
import argparse,json
from pathlib import Path
import numpy as np
import torch
from sentence_transformers import SentenceTransformer

ROOT=Path(__file__).resolve().parents[1]

def read(p):return [json.loads(x) for x in p.open() if x.strip()]

def evaluate(model,data,split):
    jobs=read(data/f'jobs_{split}.jsonl');queries=read(data/f'weak_qrels_{split}.jsonl')
    byid={j['job_id']:j for j in jobs};groups={}
    for j in jobs:groups.setdefault(j['duplicate_group'],[]).append(j)
    keys=sorted(groups)
    vectors=model.encode([j['model_text'] for j in jobs],batch_size=24,normalize_embeddings=True,show_progress_bar=False)
    q=model.encode([r['query'] for r in queries],batch_size=24,normalize_embeddings=True,show_progress_bar=False)
    similarities=q@vectors.T
    # MAX score over variants, followed by a single appearance per group.
    indices={k:[i for i,j in enumerate(jobs) if j['duplicate_group']==k] for k in keys}
    grouped=np.stack([similarities[:,indices[k]].max(1) for k in keys],axis=1)
    ranking=np.argsort(-grouped,axis=1);rows=[]
    for query,order in zip(queries,ranking):
        rel={byid[x]['duplicate_group'] for x in query['relevant_ids']};top=[keys[i] for i in order[:10]]
        gains=[int(k in rel) for k in top];dcg=sum(x/np.log2(i+2) for i,x in enumerate(gains));ideal=sum(1/np.log2(i+2) for i in range(min(10,len(rel))))
        rows.append({'ndcg10':float(dcg/ideal),'recall10':sum(gains)/len(rel),'mrr10':next((1/(i+1) for i,x in enumerate(gains) if x),0)})
    return {'queries':len(queries),'job_groups':len(keys),**{key:float(np.mean([r[key] for r in rows])) for key in ['ndcg10','recall10','mrr10']}}

def main():
    p=argparse.ArgumentParser();p.add_argument('--base',required=True);p.add_argument('--model',type=Path,required=True);p.add_argument('--data',type=Path,required=True);a=p.parse_args();torch.set_num_threads(4)
    report={'label_source':'weak taxonomy labels; NOT human ground truth','aggregation':'max score per connected duplicate-job group','models':{}}
    for name,path in [('pretrained',a.base),('trained',str(a.model))]:
        model=SentenceTransformer(path,device='cpu',local_files_only=True);model.max_seq_length=256
        report['models'][name]={s:evaluate(model,a.data,s) for s in ['dev','test']}
    report['development_winner']='trained' if report['models']['trained']['dev']['ndcg10']>report['models']['pretrained']['dev']['ndcg10'] else 'pretrained'
    (a.model/'duplicate_group_evaluation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
