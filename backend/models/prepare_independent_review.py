"""Prepare blank exhaustive-per-query PH pilot; never invent human judgments."""
import collections
import hashlib
import json
import random
from pathlib import Path

from models.upgrade_experiment import DATA, OUT, ROOT, SEED, read, save, jsonl
from models.skill_input import EMAIL, PHONE, URL


def mask(text):
    return EMAIL.sub('[EMAIL]', PHONE.sub('[PHONE]', URL.sub('[URL]', text)))


def main():
    destination = OUT/'independent-review'
    destination.mkdir(exist_ok=False)
    previous = {q['query_id'] for q in read(DATA/'weak_qrels_test.jsonl')}
    source = {r['resume_id']: r for r in read(ROOT/'backend/data/corpus/staging/hf-2026-09-10/prepared/resumes.jsonl')}
    pool = [r for r in read(DATA/'resume_inventory.jsonl') if r['split'] == 'test' and r['resume_id'] not in previous and len(r['skills']) >= 2]
    categories = collections.defaultdict(list)
    for r in pool:
        categories[r['source_category']].append(r)
    # Seeded category order and seeded candidate order, no score/label selection.
    rng = random.Random(SEED)
    order = sorted(categories)
    rng.shuffle(order)
    for values in categories.values():
        values.sort(key=lambda r: r['resume_id'])
        rng.shuffle(values)
    chosen = []
    while len(chosen) < 18 and any(categories.values()):
        for c in order:
            if categories[c] and len(chosen) < 18:
                chosen.append(categories[c].pop())
    assert len(chosen) == 18
    # Interleave dev and final rather than assigning categories by an ordered block.
    profiles = [{'profile_id': r['resume_id'], 'partition': 'development' if i % 3 == 0 else 'final',
                 'category': r['source_category'], 'text': mask(source[r['resume_id']]['text'])}
                for i, r in enumerate(chosen)]
    jobs = [{'job_id': j['job_id'], 'title': j['title'], 'description': mask(j['description']),
             'locations': j.get('locations', []), 'source_url': j.get('source_url')}
            for j in read(DATA/'jobs_test.jsonl') if j['geography'] == 'PH-tagged']
    pair_ids = [hashlib.sha256((p['profile_id']+'|'+j['job_id']).encode()).hexdigest()[:20] for p in profiles for j in jobs]
    assert len(pair_ids) == len(set(pair_ids))
    summary = {'eligible_unused_profiles': len(pool), 'selected_profiles': len(profiles), 'jobs_per_profile': len(jobs),
               'development_profiles': sum(p['partition'] == 'development' for p in profiles),
               'final_profiles': sum(p['partition'] == 'final' for p in profiles), 'pairs_per_reviewer': len(pair_ids),
               'reviewers_required': 2, 'selection_seed': SEED, 'judgments_completed': 0,
               'selection': 'category-stratified candidate sampling, all PH held-out jobs per selected candidate',
               'limitations': ['Previously unused query identities share old held-out job corpus.',
                              'Candidates excluded by old weak-label pair selection may differ from prior evaluated candidates.',
                              'Resumes are not established as Philippine participant resumes.',
                              'Basic contact masking does not remove all identifying details; review locally before sharing.',
                              '18-profile pilot cannot establish national or full-category generalization.']}
    save(destination/'manifest.json', summary)
    save(destination/'private_profile_mapping.json', profiles)
    jsonl(destination/'jobs.jsonl', jobs)
    for reviewer in ['A', 'B']:
        for partition in ['development', 'final']:
            pairs = [{'pair_id': hashlib.sha256((p['profile_id']+'|'+j['job_id']).encode()).hexdigest()[:20],
                      'profile_id': p['profile_id'], 'job_id': j['job_id'], 'partition': partition,
                      'reviewer_id': reviewer, 'grade': None, 'evidence': '', 'missing_requirements': '',
                      'uncertain': False, 'eligibility_notes': ''}
                     for p in profiles if p['partition'] == partition for j in jobs]
            random.Random(str(SEED)+reviewer+partition).shuffle(pairs)
            payload = {'reviewer': reviewer, 'partition': partition,
                       'profiles': {p['profile_id']: {'text': p['text']} for p in profiles if p['partition'] == partition},
                       'jobs': {j['job_id']: j for j in jobs}, 'pairs': pairs}
            jsonl(destination/f'reviewer-{reviewer}-{partition}-blank.jsonl', pairs)
            template = (Path(__file__).with_name('review_template.html')).read_text()
            encoded = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
            (destination/f'reviewer-{reviewer}-{partition}.html').write_text(template.replace('__PAYLOAD__', encoded))
    (destination/'README.md').write_text('''# Independent review pilot

Open your assigned reviewer-A or reviewer-B development HTML file locally in a
browser. Each reviewer works independently. Complete development first. Keep the
final files sealed until the model/prompt/settings are frozen using development
judgments only. Do not use final grades to retrain, choose prompts or select models.

Every candidate is paired with all 94 PH-tagged held-out jobs. There are 6
development and 12 final profiles: 564 development + 1,128 final pairs per reviewer.
At one minute per pair this is approximately 28 hours per reviewer; pilot a few
pairs to estimate the actual workload. Do not reduce workload by silently treating
unjudged jobs as irrelevant. A smaller fully judged pilot may be reported as such.

Grades: 0 unsuitable; 1 partial/aspirational fit with substantial gaps; 2 relevant
with limited gaps; 3 strongly relevant with direct evidence for core requirements.
Judge only documented skills, duties, experience and qualifications. Unknown is
not proof of absence: use the uncertainty flag and explain missing evidence.
Keep location/eligibility separate. Do not infer skills from the source category.
The interface conceals model scores, automatic labels and source categories.

Use Save progress regularly to download JSON; Import progress restores it. The
page does not transmit information or use browser storage. Keep files within the
research team. Contact patterns have been masked, but names and other identifying
details may remain. Review privacy and source permissions before distribution.

After two independent submissions, retain both originals, measure ordinal weighted
kappa, and resolve disagreements explicitly into an adjudicated file. Never fill
grades using the model. Report reviewer qualifications, instructions, agreement,
uncertainty and missing judgments. This packet currently contains ZERO judgments.

For ranking evaluation use graded NDCG@10 (gain 2^grade-1); define binary relevance
as grade >=2 for Precision/Recall/MRR@10. Report profiles with no relevant jobs
separately: Recall is undefined when no grade is >=2, and NDCG is undefined
only when all graded gains are zero. Report the denominator for each metric.
The scoring command refuses incomplete or unadjudicated final labels.
''')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
