"""Auditable local exploratory experiment. Never promotes a production model."""
import argparse
import collections
import csv
import hashlib
import json
import math
import random
import re
import time
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import SentenceTransformer, CrossEncoder
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'backend/data/corpus/training/skills-first-2026-09-10-v2'
OUT = ROOT / 'outputs/evaluation-upgrades-2026-09-13'
CURRENT = ROOT / 'backend/trained_models/kareerly-retriever-skills-first-2026-09-10-gpu'
BASE = Path.home() / '.cache/huggingface/hub/models--sentence-transformers--all-MiniLM-L6-v2/snapshots/1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
E5 = ROOT / 'backend/trained_models/research-bases/e5-small-v2'
CROSS = Path.home() / '.cache/huggingface/hub/models--cross-encoder--ms-marco-MiniLM-L-6-v2/snapshots/c5ee24cb16019beea0893ab7796b1df96625c6b8'
SEED = 20260913


def read(path):
    with Path(path).open() as handle:
        return [json.loads(x) for x in handle if x.strip()]


def save(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False))


def jsonl(path, rows):
    Path(path).write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))


def audit():
    ri, ji = read(DATA/'resume_inventory.jsonl'), read(DATA/'job_inventory.jsonl')
    checks = {}
    for records, field in [(ri, 'resume_id'), (ri, 'original_text_sha256'), (ji, 'job_id'), (ji, 'duplicate_group')]:
        memberships = collections.defaultdict(set)
        for row in records:
            memberships[row[field]].add(row['split'])
        checks[field + '_cross_split_collisions'] = sum(len(v) > 1 for v in memberships.values())
        assert checks[field + '_cross_split_collisions'] == 0, field
    for split in ['train', 'dev', 'test']:
        qs, js, ps = read(DATA/f'weak_qrels_{split}.jsonl'), read(DATA/f'jobs_{split}.jsonl'), read(DATA/f'pairs_{split}.jsonl')
        ids = {j['job_id'] for j in js}
        assert len(ids) == len(js)
        assert len({q['query_id'] for q in qs}) == len(qs)
        assert all(set(q['relevant_ids']) <= ids and q['relevant_ids'] for q in qs)
        relevant = {q['query_id']: set(q['relevant_ids']) for q in qs}
        assert all(p['positive_id'] in relevant[p['query_id']] and not set(p['negative_ids']) & relevant[p['query_id']] for p in ps)
        checks[split] = {'queries': len(qs), 'jobs': len(js), 'pairs': len(ps)}
    checks['sha256'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(DATA.glob('*.jsonl'))}
    checks['protocol_sha256'] = hashlib.sha256((OUT/'PROTOCOL.md').read_bytes()).hexdigest()
    checks['old_test_is_exploratory'] = True
    save(OUT/'audit.json', checks)
    return checks


def metrics(scores, qs, js, k=10):
    order = np.argsort(-scores, axis=1, kind='stable')
    rows = []
    for q, rank in zip(qs, order):
        relevant = set(q['relevant_ids'])
        top = [js[int(i)]['job_id'] for i in rank[:k]]
        gains = [int(j in relevant) for j in top]
        ideal = sum(1/math.log2(i+2) for i in range(min(k, len(relevant))))
        rows.append({'query_id': q['query_id'], 'category': q['source_resume_category'],
                     'ndcg10': sum(g/math.log2(i+2) for i, g in enumerate(gains))/ideal,
                     'recall10': sum(gains)/len(relevant), 'precision10': sum(gains)/min(k, len(js)),
                     'mrr10': next((1/(i+1) for i, g in enumerate(gains) if g), 0), 'top10': top})
    keys = ['ndcg10', 'recall10', 'precision10', 'mrr10']
    return {'aggregate': {key: float(np.mean([r[key] for r in rows])) for key in keys},
            'categories': {c: {'queries': sum(r['category'] == c for r in rows), **{key: float(np.mean([r[key] for r in rows if r['category'] == c])) for key in keys}} for c in sorted({r['category'] for r in rows})},
            'queries': rows}


def paired_interval(left, right):
    assert [r['query_id'] for r in left] == [r['query_id'] for r in right]
    d = np.array([a['ndcg10']-b['ndcg10'] for a, b in zip(left, right)])
    rng = np.random.default_rng(SEED)
    means = d[rng.integers(0, len(d), size=(5000, len(d)))].mean(axis=1)
    return {'delta_ndcg10': float(d.mean()), 'ci95': np.quantile(means, [.025, .975]).tolist(), 'resamples': 5000}


def sync(device):
    if device == 'mps':
        torch.mps.synchronize()


def encoder(path, device):
    model = SentenceTransformer(str(path), device=device, local_files_only=True)
    model.max_seq_length = 256
    return model


def dense(model, qs, js, device, e5=False):
    qt = [('query: ' if e5 else '') + q['query'] for q in qs]
    jt = [('passage: ' if e5 else '') + j['model_text'] for j in js]
    model.encode(qt[:1], normalize_embeddings=True, show_progress_bar=False)
    sync(device)
    t = time.perf_counter()
    jv = model.encode(jt, batch_size=24, normalize_embeddings=True, show_progress_bar=False)
    sync(device)
    indexed = time.perf_counter()-t
    t = time.perf_counter()
    qv = model.encode(qt, batch_size=24, normalize_embeddings=True, show_progress_bar=False)
    sync(device)
    query_time = time.perf_counter()-t
    t = time.perf_counter()
    result = qv @ jv.T
    return result, {'index_seconds': indexed, 'batch_query_seconds': query_time,
                    'batch_amortized_query_ms': query_time/len(qs)*1000,
                    'similarity_seconds': time.perf_counter()-t, 'batch_size': 24,
                    'note': 'Warm batched local throughput, not end-to-end production request latency.'}


def idf_weights():
    train = [j for j in read(DATA/'job_inventory.jsonl') if j['split'] == 'train']
    freq = collections.Counter(s for j in train for s in j['skills'])
    return collections.defaultdict(lambda: math.log(1+len(train))+1,
                                   {s: math.log((1+len(train))/(1+n))+1 for s, n in freq.items()})


def skill_scores(qs, js):
    rs = {r['resume_id']: set(r['skills']) for r in read(DATA/'resume_inventory.jsonl')}
    idf = idf_weights()
    def score(a, b):
        return sum(idf[s]**2 for s in a & b) / max(math.sqrt(sum(idf[s]**2 for s in a)*sum(idf[s]**2 for s in b)), 1e-9)
    return np.array([[score(rs[q['query_id']], set(j['skills'])) for j in js] for q in qs])


def lexical(qs, js):
    train = [j['model_text'] for j in read(DATA/'jobs_train.jsonl')]
    vec = TfidfVectorizer(stop_words='english', ngram_range=(1, 2), max_features=30000).fit(train)
    tfidf = (vec.transform([q['query'] for q in qs]) @ vec.transform([j['model_text'] for j in js]).T).toarray()
    tokenize = lambda t: re.findall(r'\b\w+\b', t.lower())
    toks = [tokenize(t) for t in train]
    df = collections.Counter(t for doc in toks for t in set(doc))
    avg = np.mean([len(t) for t in toks])
    docs = [collections.Counter(tokenize(j['model_text'])) for j in js]
    bm = np.zeros((len(qs), len(js)))
    for i, q in enumerate(qs):
        for term in set(tokenize(q['query'])) & set(df):
            weight = math.log(1+(len(toks)-df[term]+.5)/(df[term]+.5))
            for j, doc in enumerate(docs):
                f = doc[term]
                bm[i, j] += weight*f*2.5/(f+1.5*(.25+.75*sum(doc.values())/avg))
    return {'tfidf': tfidf, 'bm25': bm, 'taxonomy_cosine': skill_scores(qs, js)}


def mine(device):
    ps, js = read(DATA/'pairs_train.jsonl'), read(DATA/'jobs_train.jsonl')
    qs = read(DATA/'weak_qrels_train.jsonl')
    assert [p['query_id'] for p in ps] == [q['query_id'] for q in qs]
    scores, timing = dense(encoder(CURRENT, device), qs, js, device)
    skills = skill_scores(qs, js)
    rs = {r['resume_id']: set(r['skills']) for r in read(DATA/'resume_inventory.jsonl')}
    rows = []
    for i, (p, q) in enumerate(zip(ps, qs)):
        eligible = [n for n, j in enumerate(js) if skills[i, n] < .20 and len(rs[q['query_id']] & set(j['skills'])) <= 1 and j['job_id'] not in q['relevant_ids']]
        assert eligible
        hard = max(eligible, key=lambda n: scores[i, n])
        rnd = random.Random(str(SEED)+q['query_id']).choice(eligible)
        rows.append({**p, 'hard_negative': js[hard]['model_text'], 'hard_negative_id': js[hard]['job_id'],
                     'random_negative': js[rnd]['model_text'], 'random_negative_id': js[rnd]['job_id'],
                     'hard_negative_cosine': float(scores[i, hard]), 'random_negative_cosine': float(scores[i, rnd]),
                     'eligible_negatives': len(eligible), 'negative_label_type': 'weak_low_overlap_not_human'})
    jsonl(OUT/'mined_train.jsonl', rows)
    save(OUT/'mining_summary.json', {'pairs': len(rows), 'timing': timing, 'train_only': True,
                                   'hard_mean_cosine': float(np.mean([r['hard_negative_cosine'] for r in rows])),
                                   'random_mean_cosine': float(np.mean([r['random_negative_cosine'] for r in rows]))})


def train(name, device):
    from transformers import get_linear_schedule_with_warmup
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    random.seed(SEED)
    e5 = name == 'e5_hard'
    base = E5 if e5 else CURRENT
    target = ROOT/'backend/trained_models'/('upgrade-2026-09-13-'+name)
    target.mkdir(exist_ok=False)
    model = encoder(base, device)
    rows = read(OUT/'mined_train.jsonl')
    qs, js = read(DATA/'weak_qrels_dev.jsonl'), read(DATA/'jobs_dev.jsonl')
    initial, _ = dense(model, qs, js, device, e5)
    best = metrics(initial, qs, js)['aggregate']['ndcg10']
    model.save(str(target))
    hist = [{'epoch': 0, 'dev_ndcg10': best}]
    opt = torch.optim.AdamW(model.parameters(), lr=1e-5, weight_decay=.01)
    steps = 3*math.ceil(len(rows)/16)
    scheduler = get_linear_schedule_with_warmup(opt, math.ceil(.1*steps), steps)
    start = time.perf_counter()
    best_epoch = 0
    for epoch in range(1, 4):
        model.train()
        order = list(range(len(rows)))
        random.Random(SEED+epoch).shuffle(order)
        losses = []
        for offset in range(0, len(order), 16):
            batch = [rows[i] for i in order[offset:offset+16]]
            texts = [[('query: ' if e5 else '')+r['query'] for r in batch],
                     [('passage: ' if e5 else '')+r['positive'] for r in batch],
                     [('passage: ' if e5 else '')+r['random_negative' if name == 'minilm_random' else 'hard_negative'] for r in batch]]
            opt.zero_grad()
            embeddings = []
            for group in texts:
                inputs = {k: v.to(device) for k, v in model.tokenize(group).items()}
                embeddings.append(torch.nn.functional.normalize(model(inputs)['sentence_embedding'], dim=-1))
            a, p, n = embeddings
            logits = torch.stack([(a*p).sum(-1), (a*n).sum(-1)], dim=1)*20
            loss = torch.nn.functional.cross_entropy(logits, torch.zeros(len(batch), device=device, dtype=torch.long))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            scheduler.step()
            losses.append(loss.item())
            if offset % 320 == 0:
                print(name, 'epoch', epoch, 'rows', offset, 'loss', loss.item(), flush=True)
        model.eval()
        scores, _ = dense(model, qs, js, device, e5)
        result = metrics(scores, qs, js)['aggregate']
        hist.append({'epoch': epoch, 'loss': float(np.mean(losses)), **{'dev_'+k: v for k, v in result.items()}})
        if result['ndcg10'] > best:
            best, best_epoch = result['ndcg10'], epoch
            model.save(str(target))
        save(target/'upgrade_training_report.json', {'name': name, 'initialization': str(base), 'best_epoch': best_epoch,
             'best_dev_ndcg10': best, 'history': hist, 'training_seconds': time.perf_counter()-start,
             'training_rows': len(rows), 'epochs_completed': epoch, 'seed': SEED, 'lr': 1e-5, 'batch': 16,
             'max_tokens': 256, 'loss': 'explicit_positive_negative_cosine_softmax_temperature_0.05',
             'data_sha256': hashlib.sha256((OUT/'mined_train.jsonl').read_bytes()).hexdigest(),
             'label_type': 'weak_skill_overlap', 'test_used_for_selection': False})
        print(name, hist[-1], flush=True)


def evaluate(device):
    paths = {'pretrained_minilm': BASE, 'current_minilm': CURRENT, 'pretrained_e5': E5}
    paths.update({n: ROOT/'backend/trained_models'/('upgrade-2026-09-13-'+n) for n in ['minilm_random', 'minilm_hard', 'e5_hard']})
    results = {}
    # Development evaluated and winner persisted before any test scores computed.
    for split in ['dev', 'test']:
        qs, js = read(DATA/f'weak_qrels_{split}.jsonl'), read(DATA/f'jobs_{split}.jsonl')
        all_scores = lexical(qs, js)
        timings = {}
        for name, path in paths.items():
            if not (path/'config.json').exists():
                continue
            model = encoder(path, device)
            all_scores[name], timings[name] = dense(model, qs, js, device, 'e5' in name)
            del model
        original = all_scores['current_minilm']
        shortlist = np.argsort(-original, axis=1, kind='stable')[:, :20]
        pairs = [[qs[i]['query'], js[int(j)]['model_text']] for i, row in enumerate(shortlist) for j in row]
        cross = CrossEncoder(str(CROSS), device=device, max_length=512, local_files_only=True)
        cross.predict(pairs[:1], show_progress_bar=False)
        sync(device)
        t = time.perf_counter()
        values = cross.predict(pairs, batch_size=24, show_progress_bar=False).reshape(len(qs), -1)
        sync(device)
        seconds = time.perf_counter()-t
        # Reranked shortlist always precedes the unchanged tail; no mixed score scales.
        reranked = np.empty_like(original)
        for i in range(len(qs)):
            lead = shortlist[i][np.argsort(-values[i], kind='stable')].tolist()
            tail = [int(j) for j in np.argsort(-original[i], kind='stable') if j not in set(lead)]
            reranked[i, lead+tail] = -np.arange(len(js))
        all_scores['current_plus_crossencoder'] = reranked
        timings['current_plus_crossencoder'] = {'rerank_seconds': seconds, 'batch_amortized_rerank_ms': 1000*seconds/len(qs),
                                               'shortlist': 20, 'base_retrieval_timing': timings['current_minilm']}
        del cross
        results[split] = {name: {**metrics(scores, qs, js), 'timing': timings.get(name)} for name, scores in all_scores.items()}
        for name, scores in all_scores.items():
            np.save(OUT/(split+'_'+name+'_scores.npy'), scores)
        if split == 'dev':
            # Rule baseline is diagnostic only; do not select label generator as a neural upgrade.
            eligible = [n for n in paths if n in results[split]] + ['current_plus_crossencoder']
            winner = max(eligible, key=lambda n: results[split][n]['aggregate']['ndcg10'])
            save(OUT/'selection_frozen_before_test.json', {'selected': winner, 'criterion': 'weak_dev_ndcg10',
                 'scores': {n: results[split][n]['aggregate']['ndcg10'] for n in eligible}, 'production_adoption': False})
        else:
            for name in results[split]:
                results[split][name]['paired_vs_current'] = paired_interval(results[split][name]['queries'], results[split]['current_minilm']['queries'])
        save(OUT/'results.json', results)
        print(split, {n: r['aggregate'] for n, r in results[split].items()}, flush=True)
    lines = ['# Exploratory results — 13 September 2026', '',
             'All relevance labels are automatic skill-overlap labels. The old test was previously examined.',
             'No human suitability claim or production model replacement follows from these results.', '',
             '| Method | Dev NDCG@10 | Test NDCG@10 | Test Recall@10 | Test Precision@10 | Delta vs current [95% CI] |',
             '|---|---:|---:|---:|---:|---|']
    for name, r in results['test'].items():
        a, d = r['aggregate'], r['paired_vs_current']
        lines.append(f"| {name} | {results['dev'][name]['aggregate']['ndcg10']:.4f} | {a['ndcg10']:.4f} | {a['recall10']:.4f} | {a['precision10']:.4f} | {d['delta_ndcg10']:+.4f} [{d['ci95'][0]:+.4f}, {d['ci95'][1]:+.4f}] |")
    (OUT/'RESULTS.md').write_text('\n'.join(lines)+'\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['audit', 'mine', 'train', 'evaluate'])
    parser.add_argument('--name', choices=['minilm_random', 'minilm_hard', 'e5_hard'])
    parser.add_argument('--device', default='mps', choices=['cpu', 'mps'])
    args = parser.parse_args()
    torch.set_num_threads(4)
    OUT.mkdir(exist_ok=True)
    if args.action == 'audit':
        print(audit())
    elif args.action == 'mine':
        mine(args.device)
    elif args.action == 'train':
        assert args.name
        train(args.name, args.device)
    else:
        evaluate(args.device)


if __name__ == '__main__':
    main()
