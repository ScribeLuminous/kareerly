"""Inference for the dated joint BIO skill tagger, returning source text offsets."""
import argparse,json,re
from pathlib import Path
import torch
from transformers import AutoTokenizer,AutoModelForTokenClassification
from models.train_skill_tagger import spans,TAGS

ROOT=Path(__file__).resolve().parents[1]

def predict(text,model_path):
    tokenizer=AutoTokenizer.from_pretrained(str(model_path),local_files_only=True)
    model=AutoModelForTokenClassification.from_pretrained(str(model_path),local_files_only=True).eval()
    words=list(re.finditer(r'\S+',text))
    if not words:return {'spans':[],'truncated':False}
    encoded=tokenizer([w.group() for w in words],is_split_into_words=True,truncation=True,max_length=256,return_tensors='pt')
    word_ids=encoded.word_ids()
    with torch.no_grad():pred=model(**encoded).logits[0].argmax(-1).tolist()
    labels=[];indices=[];last=None
    for wid,tag in zip(word_ids,pred):
        if wid is not None and wid!=last:labels.append(tag);indices.append(wid)
        last=wid
    result=[]
    for kind in ['skill','knowledge']:
        tags=[TAGS[t//3] if kind=='skill' else TAGS[t%3] for t in labels]
        for start,end in sorted(spans(tags)):
            a=words[indices[start]].start();b=words[indices[end-1]].end()
            result.append({'kind':kind,'text':text[a:b],'start':a,'end':b})
    return {'spans':result,'truncated':bool(indices and indices[-1]<len(words)-1),'scope':'experimental predicted spans, not confirmed candidate skills'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--text',required=True);p.add_argument('--model',type=Path,default=ROOT/'trained_models/kareerly-skill-tagger-2026-09-10-v2');a=p.parse_args();print(json.dumps(predict(a.text,a.model),indent=2))
if __name__=='__main__':main()
