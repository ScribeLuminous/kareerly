"""Validate real reviewer exports, adjudicate explicitly, then evaluate rankings."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from sklearn.metrics import cohen_kappa_score

from models.upgrade_experiment import OUT, read, save

REVIEW = OUT/'independent-review'


def validated_export(path, reviewer, partition):
    data = json.loads(Path(path).read_text())
    if data.get('reviewer') != reviewer or data.get('partition') != partition:
        raise ValueError('Wrong reviewer or partition')
    expected = {r['pair_id']: r for r in read(REVIEW/f'reviewer-{reviewer}-{partition}-blank.jsonl')}
    rows = data['pairs']
    if len(rows) != len(expected) or {r['pair_id'] for r in rows} != set(expected):
        raise ValueError('Missing, duplicated or unexpected pair IDs')
    for r in rows:
        original = expected[r['pair_id']]
        if any(r.get(k) != original[k] for k in ['profile_id', 'job_id', 'partition', 'reviewer_id']):
            raise ValueError('Pair identity changed')
        if type(r.get('grade')) is not int or r['grade'] not in range(4):
            raise ValueError('All pairs must have real 0–3 reviewer grades')
        if not str(r.get('evidence', '')).strip():
            raise ValueError('Each judgment requires evidence')
    return {r['pair_id']: r for r in rows}


def prepare_adjudication(a, b, partition, output):
    left = validated_export(a, 'A', partition)
    right = validated_export(b, 'B', partition)
    rows = []
    for key in sorted(left):
        x, y = left[key], right[key]
        agreed = x['grade'] == y['grade'] and not x.get('uncertain') and not y.get('uncertain')
        rows.append({'pair_id': key, 'profile_id': x['profile_id'], 'job_id': x['job_id'],
                     'reviewer_a': x, 'reviewer_b': y, 'grade': x['grade'] if agreed else None,
                     'requires_adjudication': not agreed, 'adjudicator': '', 'adjudication_evidence': ''})
    ga, gb = [left[k]['grade'] for k in sorted(left)], [right[k]['grade'] for k in sorted(left)]
    kappa = cohen_kappa_score(ga, gb, labels=[0, 1, 2, 3], weights='quadratic')
    result = {'partition': partition, 'reviewer_exports_sha256': {r: hashlib.sha256(Path(p).read_bytes()).hexdigest() for r, p in [('A', a), ('B', b)]},
              'agreement': {'exact': float(np.mean(np.array(ga) == gb)), 'quadratic_weighted_kappa': float(kappa) if np.isfinite(kappa) else None},
              'pairs': rows}
    if Path(output).exists():
        raise ValueError('Refusing to overwrite adjudication')
    save(output, result)


def graded_metrics(rankings, rows):
    lookup = {}
    for row in rows:
        lookup.setdefault(row['profile_id'], {})[row['job_id']] = row['grade']
    output = []
    for profile, grades in lookup.items():
        order = rankings[profile]
        if len(order) != len(grades) or len(set(order)) != len(order) or set(order) != set(grades):
            raise ValueError('Rankings must contain each judged job exactly once')
        gain = lambda g: 2**g-1
        ideal = sum(gain(g)/math.log2(i+2) for i, g in enumerate(sorted(grades.values(), reverse=True)[:10]))
        top = [grades[j] for j in order[:10]]
        relevant = sum(g >= 2 for g in grades.values())
        output.append({'profile_id': profile,
                       'ndcg10': sum(gain(g)/math.log2(i+2) for i, g in enumerate(top))/ideal if ideal else None,
                       'recall10': sum(g >= 2 for g in top)/relevant if relevant else None,
                       'precision10': sum(g >= 2 for g in top)/min(10, len(order)),
                       'mrr10': next((1/(i+1) for i, g in enumerate(top) if g >= 2), 0),
                       'no_binary_relevant_jobs': relevant == 0, 'all_grades_zero': ideal == 0})
    keys = ['ndcg10', 'recall10', 'precision10', 'mrr10']
    aggregate = {}
    for key in keys:
        values = [r[key] for r in output if r[key] is not None]
        aggregate[key] = float(np.mean(values)) if values else None
        aggregate[key+'_defined_profiles'] = len(values)
    return {'aggregate': aggregate, 'profiles': output}


def score(adjudicated, rankings_path, output):
    if Path(output).exists():
        raise ValueError('Refusing to overwrite a human evaluation report')
    data = json.loads(Path(adjudicated).read_text())
    partition = data['partition']
    expected = {r['pair_id']: r for r in read(REVIEW/f'reviewer-A-{partition}-blank.jsonl')}
    rows = data['pairs']
    if len(rows) != len(expected) or {r['pair_id'] for r in rows} != set(expected):
        raise ValueError('Incomplete adjudicated pool')
    for r in rows:
        if any(r.get(k) != expected[r['pair_id']][k] for k in ['profile_id', 'job_id']):
            raise ValueError('Adjudicated pair identity changed')
        if type(r.get('grade')) is not int or r['grade'] not in range(4):
            raise ValueError('Blank or invalid grades; independent review is not complete')
        if r.get('requires_adjudication') and not (r.get('adjudicator', '').strip() and r.get('adjudication_evidence', '').strip()):
            raise ValueError('Reviewer disagreement or uncertainty needs documented adjudication')
        if not r.get('requires_adjudication'):
            a, b = r.get('reviewer_a', {}), r.get('reviewer_b', {})
            if a.get('grade') != r['grade'] or b.get('grade') != r['grade'] or a.get('uncertain') or b.get('uncertain'):
                raise ValueError('Consensus grade does not match both independent reviewers')
    rankings = json.loads(Path(rankings_path).read_text())
    if rankings['partition'] != partition:
        raise ValueError('Rankings partition does not match judgments')
    if partition == 'final' and not (REVIEW/'human_development_selection.json').exists():
        raise ValueError('Freeze a model using human development scores before scoring final judgments')
    results = {name: graded_metrics(run, rows) for name, run in rankings['models'].items()}
    categories = {p['profile_id']: p['category'] for p in json.loads((REVIEW/'private_profile_mapping.json').read_text())}
    for result in results.values():
        result['categories'] = {}
        for category in sorted({categories[r['profile_id']] for r in result['profiles']}):
            subset = [r for r in result['profiles'] if categories[r['profile_id']] == category]
            values = [r['ndcg10'] for r in subset if r['ndcg10'] is not None]
            result['categories'][category] = {'profiles': len(subset), 'ndcg10': float(np.mean(values)) if values else None,
                                               'warning': 'Very small pilot subgroup; not a reliable category-level estimate.'}
    record = {'partition': partition, 'results': results, 'agreement': data['agreement'],
              'judgments_sha256': hashlib.sha256(Path(adjudicated).read_bytes()).hexdigest(),
              'rankings_sha256': hashlib.sha256(Path(rankings_path).read_bytes()).hexdigest()}
    if partition == 'development':
        candidates = {n: r for n, r in results.items() if r['aggregate']['ndcg10'] is not None}
        if not candidates:
            raise ValueError('No profiles with nonzero graded relevance; cannot select a model')
        selected = max(candidates, key=lambda n: candidates[n]['aggregate']['ndcg10'])
        target = REVIEW/'human_development_selection.json'
        if target.exists():
            raise ValueError('Human development selection already frozen; do not overwrite')
        save(target, {'selected': selected, 'criterion': 'human_graded_ndcg10',
                      'development_judgments_sha256': record['judgments_sha256'],
                      'rankings_sha256': record['rankings_sha256'],
                      'model_weight_sha256': rankings.get('model_weight_sha256'), 'production_adoption': False})
    else:
        selection = json.loads((REVIEW/'human_development_selection.json').read_text())
        if selection.get('model_weight_sha256') != rankings.get('model_weight_sha256'):
            raise ValueError('Model weights changed after human development selection')
        winner = selection['selected']
        if winner not in results or 'current_minilm' not in results:
            raise ValueError('Missing selected model or current baseline')
        left, right = results[winner]['profiles'], results['current_minilm']['profiles']
        assert [r['profile_id'] for r in left] == [r['profile_id'] for r in right]
        delta = np.array([a['ndcg10']-b['ndcg10'] for a, b in zip(left, right) if a['ndcg10'] is not None and b['ndcg10'] is not None])
        if len(delta):
            rng = np.random.default_rng(20260913)
            draws = delta[rng.integers(0, len(delta), size=(5000, len(delta)))].mean(axis=1)
            interval = np.quantile(draws, [.025, .975]).tolist()
            record['selected_vs_current'] = {'selected': winner, 'delta_ndcg10': float(delta.mean()), 'ci95': interval,
                'quality_gate_passes': bool(interval[0] > 0 and delta.mean() >= .02),
                'adoption_requires_remaining_latency_and_category_review': True}
        record['production_adoption'] = False
    if Path(output).exists():
        raise ValueError('Refusing to overwrite a human evaluation report')
    save(output, record)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='action', required=True)
    merge = sub.add_parser('adjudicate')
    merge.add_argument('--reviewer-a', required=True)
    merge.add_argument('--reviewer-b', required=True)
    merge.add_argument('--partition', required=True, choices=['development', 'final'])
    merge.add_argument('--output', required=True)
    evaluate = sub.add_parser('score')
    evaluate.add_argument('--adjudicated', required=True)
    evaluate.add_argument('--rankings', required=True)
    evaluate.add_argument('--output', required=True)
    a = p.parse_args()
    if a.action == 'adjudicate':
        prepare_adjudication(a.reviewer_a, a.reviewer_b, a.partition, a.output)
    else:
        score(a.adjudicated, a.rankings, a.output)


if __name__ == '__main__':
    main()
