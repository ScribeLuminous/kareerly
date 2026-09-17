"""Freeze full job rankings for a blank review pilot without reading judgments."""
import hashlib
import json
import numpy as np
import torch
from sentence_transformers import CrossEncoder
from models.upgrade_experiment import ROOT, OUT, DATA, CURRENT, BASE, E5, CROSS, read, save, encoder, dense, lexical
from models.skill_input import build_input, training_idf
from models.taxonomy import load_cached


def main():
    torch.set_num_threads(4)
    destination = OUT/'independent-review'
    profiles = json.loads((destination/'private_profile_mapping.json').read_text())
    inventory = {r['resume_id']: r for r in read(DATA/'resume_inventory.jsonl')}
    tax = load_cached()
    idf = training_idf(read(DATA/'job_inventory.jsonl'), tax.skills)
    jobs = [j for j in read(DATA/'jobs_test.jsonl') if j['geography'] == 'PH-tagged']
    paths = {'current_minilm': CURRENT, 'pretrained_minilm': BASE, 'pretrained_e5': E5}
    paths.update({n: ROOT/'backend/trained_models'/('upgrade-2026-09-13-'+n) for n in ['minilm_random', 'minilm_hard', 'e5_hard']})
    fingerprints = {n: hashlib.sha256((p/'model.safetensors').read_bytes()).hexdigest() for n, p in paths.items()}
    fingerprints['current_plus_crossencoder'] = hashlib.sha256((CROSS/'model.safetensors').read_bytes()).hexdigest()
    for partition in ['development', 'final']:
        target = destination/(partition+'-rankings.json')
        if target.exists():
            raise ValueError('Refusing to overwrite frozen rankings')
        selected = [p for p in profiles if p['partition'] == partition]
        queries = [{'query_id': p['profile_id'], 'query': build_input(p['text'], inventory[p['profile_id']]['skills'], tax, idf)} for p in selected]
        scores = lexical(queries, jobs)
        for name, path in paths.items():
            model = encoder(path, 'mps')
            scores[name], _ = dense(model, queries, jobs, 'mps', 'e5' in name)
            del model
        ranks = {n: {q['query_id']: [jobs[int(j)]['job_id'] for j in order] for q, order in zip(queries, np.argsort(-s, axis=1, kind='stable'))} for n, s in scores.items()}
        shortlist = np.argsort(-scores['current_minilm'], axis=1, kind='stable')[:, :20]
        cross = CrossEncoder(str(CROSS), device='mps', max_length=512, local_files_only=True)
        values = cross.predict([[q['query'], jobs[int(j)]['model_text']] for q, row in zip(queries, shortlist) for j in row], batch_size=24, show_progress_bar=False).reshape(len(queries), -1)
        ranks['current_plus_crossencoder'] = {}
        for i, q in enumerate(queries):
            lead = [jobs[int(shortlist[i, j])]['job_id'] for j in np.argsort(-values[i], kind='stable')]
            tail = [j for j in ranks['current_minilm'][q['query_id']] if j not in set(lead)]
            ranks['current_plus_crossencoder'][q['query_id']] = lead+tail
        del cross
        save(target, {'partition': partition, 'models': ranks, 'model_weight_sha256': fingerprints,
                      'profile_selection_sha256': hashlib.sha256((destination/'private_profile_mapping.json').read_bytes()).hexdigest(),
                      'human_judgments_read': False, 'max_tokens_per_encoder_input': 256})
        print(partition, 'rankings frozen for', len(queries), 'profiles', flush=True)


if __name__ == '__main__':
    main()
