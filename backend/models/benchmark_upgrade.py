"""Warm, single-query inference timing against the fixed development job pool."""
import hashlib
import platform
import time
import numpy as np
import torch
import sentence_transformers
from sentence_transformers import CrossEncoder
from models.upgrade_experiment import ROOT, OUT, DATA, CURRENT, E5, CROSS, read, save, encoder, sync


def main():
    torch.set_num_threads(4)
    qs = read(DATA/'weak_qrels_dev.jsonl')[:30]
    jobs = read(DATA/'jobs_dev.jsonl')
    paths = {'current_minilm': CURRENT, 'pretrained_e5': E5}
    paths.update({n: ROOT/'backend/trained_models'/('upgrade-2026-09-13-'+n) for n in ['minilm_random', 'minilm_hard', 'e5_hard']})
    result = {}
    for name, path in paths.items():
        model = encoder(path, 'mps')
        qprefix, jprefix = ('query: ', 'passage: ') if 'e5' in name else ('', '')
        job_vectors = model.encode([jprefix+j['model_text'] for j in jobs], normalize_embeddings=True, show_progress_bar=False)
        for q in qs:
            model.encode([qprefix+q['query']], normalize_embeddings=True, show_progress_bar=False)
        times = []
        for q in qs*3:
            sync('mps')
            start = time.perf_counter()
            v = model.encode([qprefix+q['query']], normalize_embeddings=True, show_progress_bar=False)
            sync('mps')
            np.argsort(-(v @ job_vectors.T)[0])[:20]
            times.append(1000*(time.perf_counter()-start))
        result[name] = {'p50_ms': float(np.median(times)), 'p95_ms': float(np.quantile(times, .95)),
                        'samples_ms': times, 'parameters': sum(p.numel() for p in model.parameters()),
                        'weights_bytes': (path/'model.safetensors').stat().st_size,
                        'weights_sha256': hashlib.sha256((path/'model.safetensors').read_bytes()).hexdigest()}
        del model
    model = encoder(CURRENT, 'mps')
    cross = CrossEncoder(str(CROSS), device='mps', max_length=512, local_files_only=True)
    jv = model.encode([j['model_text'] for j in jobs], normalize_embeddings=True, show_progress_bar=False)
    for q in qs:
        v = model.encode([q['query']], normalize_embeddings=True, show_progress_bar=False)
        top = np.argsort(-(v @ jv.T)[0])[:20]
        cross.predict([[q['query'], jobs[int(i)]['model_text']] for i in top], batch_size=20, show_progress_bar=False)
    times = []
    for q in qs*3:
        sync('mps')
        start = time.perf_counter()
        v = model.encode([q['query']], normalize_embeddings=True, show_progress_bar=False)
        sync('mps')
        top = np.argsort(-(v @ jv.T)[0])[:20]
        values = cross.predict([[q['query'], jobs[int(i)]['model_text']] for i in top], batch_size=20, show_progress_bar=False)
        sync('mps')
        np.argsort(-values)
        times.append(1000*(time.perf_counter()-start))
    result['current_plus_crossencoder'] = {'p50_ms': float(np.median(times)), 'p95_ms': float(np.quantile(times, .95)), 'samples_ms': times,
                                           'weights_bytes': (CURRENT/'model.safetensors').stat().st_size+(CROSS/'model.safetensors').stat().st_size}
    save(OUT/'latency.json', {'scope': 'Warm local single-query encode+rank, cached 210 development jobs, first 30 development queries, one full 30-query warmup and three measured passes (90 samples); excludes loading, extraction, database and network; not production SLA.',
                            'device': 'mps', 'torch': torch.__version__, 'sentence_transformers': sentence_transformers.__version__,
                            'python': platform.python_version(), 'models': result})
    print({n: {k: v for k, v in r.items() if k in ['p50_ms', 'p95_ms', 'parameters']} for n, r in result.items()}, flush=True)


if __name__ == '__main__':
    main()
