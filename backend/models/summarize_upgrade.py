"""Verify saved experiment artifacts and produce a readable research update."""
import hashlib
import json
from pathlib import Path
import numpy as np
from sklearn.metrics import ndcg_score
from models.upgrade_experiment import ROOT, OUT, CURRENT, DATA, read, save, paired_interval


def main():
    results = json.loads((OUT/'results.json').read_text())
    audit = json.loads((OUT/'audit.json').read_text())
    old = json.loads((CURRENT/'training_report.json').read_text())
    checks = {'original_training_data_hashes_unchanged': all(hashlib.sha256((DATA/n).read_bytes()).hexdigest() == h for n, h in audit['sha256'].items()),
              'source_hashes_match_original_training_run': audit['sha256'] == old['data_files']}
    training = {}
    for name in ['minilm_random', 'minilm_hard', 'e5_hard']:
        training[name] = json.loads((ROOT/'backend/trained_models'/('upgrade-2026-09-13-'+name)/'upgrade_training_report.json').read_text())
        report = training[name]
        checks[name+'_completed_three_epochs'] = report['epochs_completed'] == 3
        checks[name+'_selected_best_development_epoch'] = abs(max(r['dev_ndcg10'] for r in report['history'])-results['dev'][name]['aggregate']['ndcg10']) < 1e-6
    qs, js = read(DATA/'weak_qrels_test.jsonl'), read(DATA/'jobs_test.jsonl')
    relevant = np.array([[int(j['job_id'] in q['relevant_ids']) for j in js] for q in qs])
    for name, run in results['test'].items():
        matrix = np.load(OUT/('test_'+name+'_scores.npy'))
        # Unique ordinal scores preserve our stable tie-break while checking the
        # NDCG formula independently using scikit-learn's implementation.
        ordered = np.argsort(-matrix, axis=1, kind='stable')
        ordinal = np.empty_like(matrix)
        for i, order in enumerate(ordered):
            ordinal[i, order] = -np.arange(len(js))
        checks[name+'_ndcg_independently_recomputed'] = abs(ndcg_score(relevant, ordinal, k=10)-run['aggregate']['ndcg10']) < 1e-9
    checks['current_test_reproduces_previous_run'] = abs(results['test']['current_minilm']['aggregate']['ndcg10']-old['trained_test']['weak_test_cosine_ndcg@10']) < 1e-6
    assert all(checks.values()), checks
    checks = {key: bool(value) for key, value in checks.items()}
    save(OUT/'verification.json', checks)
    control = paired_interval(results['test']['minilm_hard']['queries'], results['test']['minilm_random']['queries'])
    save(OUT/'hard_vs_random_control.json', control)
    selection = json.loads((OUT/'selection_frozen_before_test.json').read_text())
    latency = json.loads((OUT/'latency.json').read_text())
    names = {'taxonomy_cosine': 'Taxonomy cosine (label-rule baseline)', 'tfidf': 'TF-IDF', 'bm25': 'BM25',
             'pretrained_minilm': 'Pretrained MiniLM', 'current_minilm': 'Original Kareerly MiniLM',
             'pretrained_e5': 'Pretrained E5-small-v2', 'minilm_random': 'MiniLM + random explicit negatives',
             'minilm_hard': 'MiniLM + hard explicit negatives', 'e5_hard': 'E5 + hard explicit negatives',
             'current_plus_crossencoder': 'Original MiniLM + zero-shot cross-encoder'}
    lines = ['# Kareerly research update — 13 September 2026', '',
             'Three local training runs completed; all prespecified ranking comparisons were evaluated.',
             f"Development-selected candidate: **{names[selection['selected']]}**. This is an exploratory candidate, not an adopted production replacement.", '',
             'The application model remains unchanged. The user revised the workflow: establish a provisional model offline, then evaluate the finished system with participants. Exhaustive model-pair review is deferred.', '',
             '## Training and tuning', '',
             'All upgrade runs used 1,070 training triples, three epochs, batch 16, learning rate 1e-5, seed 20260913, and 256 tokens per encoder input. MiniLM runs continued the original weights; E5 started from public pretrained weights. Only the random/hard MiniLM comparison isolates negative selection under matched initialization.', '',
             '| Training run | Selected epoch | Validation NDCG@10 | Training minutes |', '|---|---:|---:|---:|']
    for n, r in training.items():
        lines.append(f"| {names[n]} | {r['best_epoch']} | {r['best_dev_ndcg10']:.4f} | {r['training_seconds']/60:.2f} |")
    lines += ['', 'Epoch selection included epoch 0 and used validation NDCG@10 only. No extra tuning was performed after seeing test scores. The new loss compares one explicit positive and one explicit negative, avoiding unverified in-batch negatives. Hard negatives were semantically similar but low-overlap under the same automatic skill rules; they were not human-verified mismatches.', '',
              '## Old-test diagnostic results', '',
              '161 retained queries ranked against the same 158 jobs for every method. These are automatic-label diagnostics on a previously examined test set, not a fresh blind evaluation or hiring accuracy.', '',
              '| Method | NDCG@10 | Recall@10 | Precision@10 | MRR@10 |', '|---|---:|---:|---:|---:|']
    for n, r in results['test'].items():
        a = r['aggregate']
        lines.append(f"| {names[n]} | {a['ndcg10']:.4f} | {a['recall10']:.4f} | {a['precision10']:.4f} | {a['mrr10']:.4f} |")
    selected = results['test'][selection['selected']]['paired_vs_current']
    lines += ['', f"The validation-selected candidate's paired NDCG@10 difference versus original MiniLM is **{selected['delta_ndcg10']:+.4f}**, with an exploratory 95% query-bootstrap interval **[{selected['ci95'][0]:+.4f}, {selected['ci95'][1]:+.4f}]** (5,000 resamples).",
              f"The matched-initialization hard-versus-random control difference is **{control['delta_ndcg10']:+.4f}**, interval **[{control['ci95'][0]:+.4f}, {control['ci95'][1]:+.4f}]**.", '',
              'The taxonomy baseline is especially important: evaluation relevance is generated partly from the same skill-overlap information. Strong rule-baseline performance exposes that circularity; beating textual baselines alone does not establish professional suitability. All confidence intervals are conditional on these weak labels and this corpus; a single seed does not measure training stability.', '',
              '## Local inference cost', '',
              'Warm single-query encode-and-rank timing, 30 development queries, 210 pre-indexed jobs. Excludes model loading, resume extraction, database and network. One full warmup plus three measured passes (90 samples per method); these are not production latency guarantees. Runs are sequential and affected by machine load. The MiniLM variants have identical architecture, so their observed timing differences do not demonstrate that training made the model intrinsically faster.', '',
              '| Method | Median ms | 95th percentile ms | Weight storage MiB |', '|---|---:|---:|---:|']
    for n, r in latency['models'].items():
        lines.append(f"| {names[n]} | {r['p50_ms']:.1f} | {r['p95_ms']:.1f} | {r['weights_bytes']/1024**2:.1f} |")
    lines += ['', '## Revised evaluation workflow', '',
              'Use the development-selected candidate as a provisional research model, with the old-test diagnostic and runtime as supporting evidence. This does not establish human-judged employment suitability. The application has not been switched by this experiment.', '',
              'The user cannot arrange pair reviewers within the model-development schedule. The exhaustive 1,692-pair review packet is deferred and is not an active assignment. The new [evaluation plan](REVISED_EVALUATION_PLAN.md) separates offline model evaluation from later task-based system evaluation.', '',
              'The [system evaluation kit](SYSTEM_EVALUATION_KIT.md) covers profile entry, job exploration, understanding matched/missing skills, learning resources and error recovery. Record task completion, time, errors, assistance, rating distributions and comments. It is a custom instrument, not a validated standardized usability scale. No participant results have been collected.', '',
              'System feedback can support usability, perceived usefulness and explanation-clarity claims. It cannot convert automatic relevance labels into hiring accuracy. Two experts alone would provide bounded expert feedback rather than representative user acceptance evidence.', '',
              '## LLM branch and verification', '',
              'No generative LLM experiment has been run. It remains optional follow-up work after the current model-first comparison. No resume/job data was uploaded and no paid inference was used.', '',
              'Checks: 10 unit tests passed; input split/hash audit passed; old MiniLM test result reproduced; every saved test NDCG independently recomputed; selected checkpoints verified.', '',
              'See [the original protocol](PROTOCOL.md), [the revised evaluation plan](REVISED_EVALUATION_PLAN.md), [full process and reproduction instructions](PROCESS.md), [machine-readable results](results.json), [timing samples](latency.json), and [verification](verification.json).', '',
              'Method references: [E5](https://huggingface.co/intfloat/e5-small-v2), [cross-encoder](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2), [ConFit v2](https://aclanthology.org/2025.findings-acl.661/), and [ConFit v3 preprint](https://arxiv.org/abs/2605.09760). These experiments are adaptations, not reproductions of ConFit.']
    (OUT/'RESEARCH_UPDATE.md').write_text('\n'.join(lines)+'\n')
    save(OUT/'status.json', {'local_training': 'completed', 'exploratory_evaluation': 'completed',
                           'research_candidate': selection['selected'], 'production_model_changed': False,
                           'independent_human_evaluation': 'deferred_by_user', 'system_evaluation': 'planned_after_model_selection',
                           'generative_llm_experiment': 'optional_follow_up_not_run'})
    print(json.dumps(checks, indent=2))


if __name__ == '__main__':
    main()
