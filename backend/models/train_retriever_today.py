"""Train versioned skill-first retriever; select on weak dev, never call it human validation."""
import argparse,csv,hashlib,json,random,time
from pathlib import Path
import numpy as np
import torch
from datasets import Dataset
from sentence_transformers import SentenceTransformer,SentenceTransformerTrainer,SentenceTransformerTrainingArguments
from sentence_transformers.losses import MultipleNegativesRankingLoss
from sentence_transformers.evaluation import InformationRetrievalEvaluator
from sentence_transformers.util import cos_sim
from models.taxonomy import load_cached

ROOT=Path(__file__).resolve().parents[1]
SEED=20260910

def read(path):return [json.loads(x) for x in path.open() if x.strip()]

def evaluator(data,split):
    qs=read(data/f'weak_qrels_{split}.jsonl');js=read(data/f'jobs_{split}.jsonl')
    return InformationRetrievalEvaluator(queries={r['query_id']:r['query'] for r in qs},corpus={j['job_id']:j['model_text'] for j in js},relevant_docs={r['query_id']:set(r['relevant_ids']) for r in qs},name='weak_'+split,ndcg_at_k=[10],mrr_at_k=[10],precision_recall_at_k=[5,10],accuracy_at_k=[1,5,10],map_at_k=[10],score_functions={'cosine':cos_sim},batch_size=24,show_progress_bar=False,write_csv=False)

def evaluate_categories(model,data,split):
    qs=read(data/f'weak_qrels_{split}.jsonl');jobs=read(data/f'jobs_{split}.jsonl')
    q=model.encode([x['query'] for x in qs],batch_size=24,normalize_embeddings=True,show_progress_bar=False)
    j=model.encode([x['model_text'] for x in jobs],batch_size=24,normalize_embeddings=True,show_progress_bar=False)
    order=np.argsort(-(q@j.T),axis=1);counts={};rows=[]
    for r,ranking in zip(qs,order):
        relevant=set(r['relevant_ids']);top=[jobs[i]['job_id'] for i in ranking[:10]]
        gains=[int(x in relevant) for x in top];dcg=sum(v/np.log2(i+2) for i,v in enumerate(gains));ideal=sum(1/np.log2(i+2) for i in range(min(10,len(relevant))))
        row={'query_id':r['query_id'],'category':r['source_resume_category'],'ndcg10':float(dcg/max(ideal,1e-9)),'recall10':sum(gains)/len(relevant),'top10':top}
        rows.append(row);counts.setdefault(row['category'],[]).append(row)
    return {'categories':{c:{'queries':len(v),'ndcg10':float(np.mean([r['ndcg10'] for r in v])),'recall10':float(np.mean([r['recall10'] for r in v]))} for c,v in counts.items()},'runs':rows}

def main():
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,required=True);p.add_argument('--base',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--device',choices=['cpu','mps'],default='cpu');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
    torch.set_num_threads(4);random.seed(SEED);np.random.seed(SEED);torch.manual_seed(SEED)
    train=read(a.data/'pairs_train.jsonl');dev=read(a.data/'pairs_dev.jsonl')
    rows=[{'anchor':r['query'],'positive':r['positive']} for r in train]
    # Four synthetic variants per alias-resolved skill; retained as a separate auxiliary task.
    tax=load_cached();grouped={}
    source=ROOT/'data/corpus/staging/hf-source-audit-2026-09-10/TechWolf--Synthetic-ESCO-skill-sentences/dataset.csv'
    with source.open() as f:
        for r in csv.DictReader(f):
            sid=tax.resolve(r['skill'])
            if sid:grouped.setdefault(sid,[]).append(r)
    auxiliary=[]
    for sid,examples in sorted(grouped.items()):
        rng=random.Random(str(SEED)+sid);rng.shuffle(examples)
        for r in examples[:4]:auxiliary.append({'anchor':r['sentence'],'positive':tax.skills[sid].label})
    rows.extend(auxiliary);random.shuffle(rows)
    (a.output/'auxiliary_training_pairs.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in auxiliary))
    model=SentenceTransformer(a.base,device=a.device,local_files_only=True);model.max_seq_length=256
    initial_hash=hashlib.sha256(next(model.parameters()).detach().cpu().numpy().tobytes()).hexdigest()
    dev_eval=evaluator(a.data,'dev');test_eval=evaluator(a.data,'test')
    baseline_dev=dev_eval(model);print('BASELINE_DEV',json.dumps(baseline_dev),flush=True)
    config=SentenceTransformerTrainingArguments(output_dir=str(a.output/'checkpoints'),num_train_epochs=3,per_device_train_batch_size=16,per_device_eval_batch_size=16,learning_rate=1e-5,warmup_ratio=.1,eval_strategy='epoch',save_strategy='epoch',save_total_limit=1,load_best_model_at_end=True,metric_for_best_model='weak_dev_cosine_ndcg@10',greater_is_better=True,batch_sampler='no_duplicates',report_to=[],use_cpu=a.device=='cpu',seed=SEED,logging_steps=40,disable_tqdm=True)
    loss=MultipleNegativesRankingLoss(model)
    trainer=SentenceTransformerTrainer(model=model,args=config,train_dataset=Dataset.from_list(rows),eval_dataset=Dataset.from_list([{'anchor':r['query'],'positive':r['positive']} for r in dev]),loss=loss,evaluator=dev_eval)
    start=time.time();trainer.train();model.save(str(a.output));trained_dev=dev_eval(model)
    # Selection is frozen from development before examining test results.
    selected=trained_dev['weak_dev_cosine_ndcg@10']>baseline_dev['weak_dev_cosine_ndcg@10']
    test=test_eval(model);details=evaluate_categories(model,a.data,'test')
    baseline=SentenceTransformer(a.base,device=a.device,local_files_only=True);baseline.max_seq_length=256;baseline_test=test_eval(baseline)
    from sklearn.feature_extraction.text import TfidfVectorizer
    # Direct textual TF-IDF baseline on same fixed weak test candidates.
    qs=read(a.data/'weak_qrels_test.jsonl');js=read(a.data/'jobs_test.jsonl');vectorizer=TfidfVectorizer(stop_words='english',ngram_range=(1,2),max_features=30000)
    mat=vectorizer.fit_transform([r['model_text'] for r in read(a.data/'jobs_train.jsonl')]);jm=vectorizer.transform([r['model_text'] for r in js]);qm=vectorizer.transform([r['query'] for r in qs]);ranks=np.argsort(-(qm@jm.T).toarray(),axis=1);nd=[];rec=[]
    for r,rank in zip(qs,ranks):
        rel=set(r['relevant_ids']);g=[int(js[k]['job_id'] in rel) for k in rank[:10]];nd.append(sum(x/np.log2(i+2) for i,x in enumerate(g))/sum(1/np.log2(i+2) for i in range(min(10,len(rel)))));rec.append(sum(g)/len(rel))
    final_hash=hashlib.sha256(next(model.parameters()).detach().cpu().numpy().tobytes()).hexdigest();assert initial_hash!=final_hash
    report={'model':'skills-first candidate-job retriever','base':a.base,'train_resume_job_pairs':len(train),'auxiliary_synthetic_skill_pairs':len(auxiliary),'total_training_rows':len(rows),'epochs':3,'device':a.device,'seed':SEED,'max_seq_length':256,'seconds':time.time()-start,'baseline_dev':baseline_dev,'trained_dev':trained_dev,'selection_based_only_on_dev':'trained' if selected else 'pretrained_baseline','baseline_test':baseline_test,'trained_test':test,'tfidf_test':{'ndcg10':float(np.mean(nd)),'recall10':float(np.mean(rec))},'per_category_weak_test':details['categories'],'weights_changed':True,'initial_tensor_sha256':initial_hash,'final_tensor_sha256':final_hash,'label_warning':'All candidate-job ranking metrics use algorithmic weak labels, NOT human relevance; no hiring accuracy or PH validity claim. Auxiliary ESCO data is synthetic.','history':trainer.state.log_history,'data_files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in a.data.glob('*.jsonl')}}
    (a.output/'training_report.json').write_text(json.dumps(report,indent=2));(a.output/'weak_test_run.json').write_text(json.dumps(details['runs'],indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['history','per_category_weak_test','data_files']}),flush=True)
if __name__=='__main__':main()
