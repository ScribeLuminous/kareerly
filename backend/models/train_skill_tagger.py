"""Train a joint skill/knowledge BIO token model; preserve publisher splits."""
import argparse, hashlib, json, random, time
from pathlib import Path
import numpy as np
import torch
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForTokenClassification, DataCollatorForTokenClassification, Trainer, TrainingArguments, set_seed

TAGS=['O','B','I']
LABELS=[f'{s}|{k}' for s in TAGS for k in TAGS]

def spans(tags):
    found=set(); start=None
    for i,tag in enumerate(list(tags)+['O']):
        if tag!='I' and start is not None:
            found.add((start,i));start=None
        if tag=='B' or (tag=='I' and start is None):start=i
    return found

def metrics(pred):
    logits,labels=pred; ids=np.argmax(logits,axis=-1);result={}
    for task in ['skill','knowledge']:
        tp=fp=fn=0
        for a,b in zip(ids,labels):
            mask=b!=-100;a=a[mask];b=b[mask]
            ai=a//3 if task=='skill' else a%3;bi=b//3 if task=='skill' else b%3
            ps=spans([TAGS[int(x)] for x in ai]);gs=spans([TAGS[int(x)] for x in bi])
            tp+=len(ps&gs);fp+=len(ps-gs);fn+=len(gs-ps)
        p=tp/max(1,tp+fp);r=tp/max(1,tp+fn)
        result.update({task+'_precision':p,task+'_recall':r,task+'_f1':2*p*r/max(1e-12,p+r)})
    result['mean_f1']=(result['skill_f1']+result['knowledge_f1'])/2
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--data',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--base',required=True);parser.add_argument('--epochs',type=int,default=3);parser.add_argument('--device',choices=['cpu','mps'],default='cpu');parser.add_argument('--resume',action='store_true')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=args.resume)
    torch.set_num_threads(4);set_seed(20260910)
    tokenizer=AutoTokenizer.from_pretrained(args.base,local_files_only=True)
    stats={};datasets={}
    for split in ['train','dev','test']:
        path=args.data/f'{split}.json'
        try:rows=json.loads(path.read_text())
        except json.JSONDecodeError:rows=[json.loads(x) for x in path.open() if x.strip()]
        records=[];truncated=0
        for row in rows:
            encoded=tokenizer(row['tokens'],is_split_into_words=True,truncation=True,max_length=256)
            word_ids=encoded.word_ids();last=None;labels=[]
            for word in word_ids:
                labels.append(-100 if word is None or word==last else TAGS.index(row['tags_skill'][word])*3+TAGS.index(row['tags_knowledge'][word]));last=word
            truncated+=int(max([x for x in word_ids if x is not None],default=-1)<len(row['tokens'])-1)
            encoded['labels']=labels;records.append(dict(encoded))
        datasets[split]=Dataset.from_list(records);stats[split]={'sentences':len(rows),'truncated_sentences':truncated,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    model=AutoModelForTokenClassification.from_pretrained(args.base,num_labels=9,id2label=dict(enumerate(LABELS)),label2id={x:i for i,x in enumerate(LABELS)},local_files_only=True)
    config=TrainingArguments(output_dir=str(args.output/'checkpoints'),num_train_epochs=args.epochs,per_device_train_batch_size=24,per_device_eval_batch_size=32,learning_rate=3e-5,warmup_ratio=.1,weight_decay=.01,eval_strategy='epoch',save_strategy='epoch',save_total_limit=1,load_best_model_at_end=True,metric_for_best_model='mean_f1',greater_is_better=True,report_to=[],use_cpu=args.device=='cpu',seed=20260910,logging_steps=50,disable_tqdm=True)
    trainer=Trainer(model=model,args=config,train_dataset=datasets['train'],eval_dataset=datasets['dev'],data_collator=DataCollatorForTokenClassification(tokenizer),compute_metrics=metrics)
    start=time.time();trainer.train(resume_from_checkpoint=True if args.resume else None);trainer.save_model(str(args.output));tokenizer.save_pretrained(str(args.output))
    test=trainer.evaluate(datasets['test'],metric_key_prefix='test')
    report={'artifact':'joint skill/knowledge tagger','label_encoding':LABELS,'base':args.base,'seed':20260910,'data':stats,'epochs':args.epochs,'device':args.device,'resumed':args.resume,'test':test,'seconds':time.time()-start,'history':trainer.state.log_history,'scope':'SkillSpan skill/knowledge spans; not job-fit performance; no PH validation'}
    (args.output/'training_report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report['test']),flush=True)
if __name__=='__main__':main()
