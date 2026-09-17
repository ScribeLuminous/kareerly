import json, urllib.request, urllib.parse, hashlib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
parser=argparse.ArgumentParser(description='Download public Hugging Face resume CSV and latest job snapshot; no training.')
parser.add_argument('--output', type=Path, required=True)
root=parser.parse_args().output
root.mkdir(parents=True, exist_ok=False)
ids=['opensporks/resumes','edwarddgao/open-apply-jobs']
manifest=[]
for name in ids:
 meta=json.load(urllib.request.urlopen('https://huggingface.co/api/datasets/'+name,timeout=45))
 dest=root/name.replace('/','--');dest.mkdir(exist_ok=True)
 (dest/'metadata.json').write_text(json.dumps(meta,indent=2))
 revision=meta['sha']
 files=[x['rfilename'] for x in meta['siblings']]
 if 'open-apply' in name:
  dates=sorted({x.split('/')[1] for x in files if x.startswith('data/date=')})
  selected=['README.md']+[x for x in files if x.startswith('data/'+dates[-1]+'/') and x.endswith('.parquet')]
 else:selected=['README.md','Resume/Resume.csv']
 def fetch(file):
  url='https://huggingface.co/datasets/'+name+'/resolve/'+revision+'/'+urllib.parse.quote(file,safe='/=')
  out=dest/file;out.parent.mkdir(parents=True,exist_ok=True)
  if not out.exists():
   with urllib.request.urlopen(url,timeout=60) as response, out.with_suffix(out.suffix+'.partial').open('wb') as handle:
    total=0
    while True:
     chunk=response.read(1024*1024)
     if not chunk:break
     total+=len(chunk)
     if total>600*1024*1024:raise RuntimeError('file exceeds 600 MB bounded download')
     handle.write(chunk)
   out.with_suffix(out.suffix+'.partial').rename(out)
  digest=hashlib.sha256(out.read_bytes()).hexdigest()
  print(json.dumps({'file':file,'bytes':out.stat().st_size}),flush=True)
  return {'file':str(out.relative_to(root)),'url':url,'sha256':digest,'bytes':out.stat().st_size}
 downloaded=list(ThreadPoolExecutor(3).map(fetch,selected))
 manifest.append({'dataset':name,'revision':revision,'card_license':meta.get('cardData',{}).get('license'),'files':downloaded,'status':'staging_only; no match labels; no training split'})
 (root/'manifest.json').write_text(json.dumps(manifest,indent=2))
