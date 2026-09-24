# Why Fit-Now disappeared: matching diagnosis (2026-09-24)

Branch `krly/model-improvement`. All numbers below come from
`backend/scripts/diagnose_match_distribution.py` (33 mock Philippine resumes ×
184 catalogue jobs = 6,072 pairs). Reproduce them with:

```bash
backend/.venv/bin/python -m backend.scripts.diagnose_match_distribution \
    --output /tmp/kareerly-diag --must-have-mode all-required
```

## Labels used for diagnosis

`backend/evaluation/match_diagnostic_labels.csv` gives each resume its stated
target role and a title pattern. A pair is **strong** when the job title belongs
to that role family, **moderate** when it is another job in the same career
area, and **weak** otherwise (179 / 1,057 / 4,836 pairs). The labels use job
metadata only, never the model or skill coverage, so they can judge both.
They are weak labels, not human relevance judgements. Odd resume pages are the
development (calibration) split and even pages the held-out check split.

## Root cause

The problem was a combination of faults. The **dominant** one sat in the input
to the model, not in the model weights or the threshold.

1. **Skill extraction polluted every candidate profile (dominant).**
   `SkillExtractor` split the `;`-separated reference lists on commas as well.
   `related_skills` carries group labels such as "Education, Training, and
   Community Services", so the single word **"education"** became an alias for
   about 45 teaching and social-work skills. Every resume has an EDUCATION
   heading, so every candidate "had" skills such as Classroom Management,
   Library Assistance and "Perform street interventions in social work". The
   same happened with "healthcare", "construction" and other group words.
   Those names were appended to the model input's `[SKILLS]` section. Because
   the fine-tuned model was trained to match skill lists, it pulled every
   resume towards the education and training jobs. "Training and Instruction
   Coordinator" was in the top 10 for 30 of 33 resumes; for the software
   developer resume, the top job was Library Support Assistant. The test that
   covered this (`test_category_words_do_not_become_skills`) was already
   failing on `main`.
2. **The must-have rule silently required 100% coverage.** Supabase jobs and
   pasted external jobs copy one ID list into both `required_skill_ids` and
   `must_have_skill_ids`. The Fit-Now gate rejected any missing must-have, so
   in production the effective rule was "hold every required skill", not the
   documented 50%. This blocked 140 of 179 strong pairs on its own.
3. **Legacy job skill IDs could never be matched.** 36 of the 40 reviewed
   Supabase jobs still contain IDs such as `SK_EXCEL`, `SK_POWER_BI` and
   `SK_REPORTING`. These have no taxonomy row. Combined with (2), those jobs
   could never be Fit-Now.
4. **Every failure became Aspiration.** There was no lower category, so
   unrelated jobs were labelled Aspiration, and the Aspiration label carried no
   information.

The 0.45 Fit-Now threshold was **not** the cause. Once the inputs were clean,
the calibration below shows it is already near the optimum.

## Stage-by-stage evidence

A = original `main`; B = A plus only the extraction fix; C = this branch.
The "all-required" mode reproduces the Supabase and pasted-job mapping.

### 1. Model: fine-tuned cosine by group (median, p10–p90)

| | strong | moderate | weak | AUC strong/moderate | AUC strong/weak |
|---|---|---|---|---|---|
| A (polluted input) | 0.271 (0.09–0.49) | 0.136 (0.01–0.38) | 0.102 (0.00–0.26) | 0.730 | 0.814 |
| B, C (clean input) | 0.520 (0.22–0.73) | 0.169 (0.02–0.45) | 0.070 (−0.04–0.21) | 0.859 | 0.968 |

Fine-tuning did not compress the similarity scale. With clean input, strong
matches sit around 0.5–0.7 and unrelated jobs around 0.1, and the groups
separate well. The low, overlapping scores on `main` came from the input.

### 2. Retrieval quality (per resume, all 184 jobs ranked; relevant = strong, NDCG graded 2/1/0)

| Ranking signal | P@10 | R@10 | NDCG@10 | MRR@10 |
|---|---|---|---|---|
| A: fine-tuned cosine (production on `main`) | 0.146 | 0.297 | 0.364 | 0.271 |
| B: fine-tuned cosine, clean input | 0.400 | 0.798 | 0.856 | 0.865 |
| C: composite match score | 0.412 | 0.826 | 0.885 | 0.924 |
| TF-IDF on the same model inputs | 0.436 | 0.870 | 0.889 | 0.950 |

### 3. Composite score and categories

The composite score preserves and slightly improves the model's separation.
Strong vs weak AUC goes from 0.968 to 0.976 and strong vs moderate from 0.859
to 0.871. Final-score medians are 0.596 for strong, 0.086 for moderate and
0.033 for weak pairs.

Category counts by label:

| | strong: Fit / Asp / Low | moderate: Fit / Asp / Low | weak: Fit / Asp / Low |
|---|---|---|---|
| A, all-required | 7 / 172 / – | 11 / 1,046 / – | 37 / 4,799 / – |
| C, both modes | 98 / 53 / 28 | 72 / 248 / 737 | 1 / 138 / 4,697 |

What users see (top 10 of each list, 33 resumes, all-required mode):

- **Before (A):** 55 Fit-Now cards, 67% of them unrelated jobs; 330 Aspiration
  cards, 54% unrelated.
- **After (C):** 168 Fit-Now cards, 0.6% unrelated; 307 Aspiration cards,
  23% unrelated.

Two resumes (IT Support Specialist and Multimedia Producer) still have no
Fit-Now job, which is a valid outcome.

## Answers to the three required questions

- **Does the model separate strong, moderate and weak matches?** Yes, once its
  input is clean (strong vs weak AUC 0.968). On `main` it did not (0.814), but
  the cause was the extracted skill list, not the weights.
- **Does the scoring pipeline preserve that separation?** On `main` it did not.
  The must-have rule and legacy IDs removed almost all strong pairs, and every
  failure collapsed into Aspiration. The new composite score preserves the
  separation (AUC 0.976), and the categories now follow it.
- **Is the Fit-Now gate calibrated to this distribution?** Yes. See below; the
  cosine floor was kept at 0.45.

## Model findings

- Production uses the checkpoint `backend/trained_models/kareerly-bi-encoder`
  (`kareerly-skills-first-minilm-2026-09-10`). It is **fine-tuned** from
  `sentence-transformers/all-MiniLM-L6-v2`, with MultipleNegativesRankingLoss,
  3 epochs, batch size 16, learning rate 1e-5 and warmup ratio 0.1, and was
  selected on weak-dev NDCG@10 (`models/train_retriever_today.py`).
- Embeddings are L2-normalised, and score_jobs normalises again (a no-op for
  unit vectors). Cosine is clipped to [0, 1] once. No score is normalised twice
  or rescaled against the catalogue.
- **Pretrained baseline not evaluated here.** This environment cannot reach
  Hugging Face, and the training data and training report are not in the
  repository. Run the diagnostic with
  `--baseline-model sentence-transformers/all-MiniLM-L6-v2` on a machine with
  access to fill that row in.
- **On these labels the fine-tuned model does not beat TF-IDF** (NDCG@10 0.856
  vs 0.889). The labels come from job titles, and resumes state their target
  title, which favours lexical matching. Even so, this data gives no evidence
  that fine-tuning improved role-level retrieval, and the thesis should not
  claim it does. No retraining was done because the model separated the groups
  adequately once the inputs were fixed.
- Training review:
  - The data splits are resume-level with deduplicated job groups, and
    checkpoint selection uses dev only. No test leakage appears in the code.
  - Positives are weak IDF-weighted skill-overlap labels (skill cosine ≥ 0.45
    and ≥ 2 shared skills), and the evaluation uses the same labels. This is
    circular: it rewards skill-list matching and says nothing about role
    relevance.
  - The two prepared hard negatives per pair are never used; only anchor and
    positive reach the loss, so only in-batch negatives apply.
  - The synthetic ESCO sentence-to-skill pairs share batches with the
    resume-to-job pairs, which gives easy cross-task negatives.
  - These choices make the model depend heavily on the `[SKILLS]` section,
    which is why the extraction bug did so much damage.

## Threshold justification

| Threshold | Before | After | Evidence (dev split; check split in brackets) |
|---|---|---|---|
| Fit-Now minimum cosine | 0.45 | **0.45 (unchanged)** | F1 for strong pairs is 0.588 at 0.45 vs 0.612 at the best value, 0.40 (check: 0.528 vs 0.529). No weak pair passes at 0.45. The difference is within noise, so the value stays. |
| Fit-Now minimum required coverage | 0.50 (effectively 1.00 for Supabase/pasted jobs) | **0.50** | This is a product definition ("at least half of the required skills"). Sweeping 0.34–0.60 changes dev F1 by less than 0.02. The effective 1.00 came from the must-have bug, not from any decision. |
| Must-have rule | any listed must-have missing blocks Fit-Now | only must-haves singled out from the required list block Fit-Now, with a 0.10 score penalty each (maximum 0.20) | A must-have list identical to the required list carries no extra designation. |
| Aspiration minimum cosine | none (every failure became Aspiration) | **0.20** | Dev F1 optimum for related vs unrelated pairs (0.732; 0.25 scores 0.707). It ties for best on the check split (0.762). 3% of unrelated pairs pass. |
| Aspiration minimum held skills | none | **1** | Without a single shared skill there is no identifiable path to readiness. |

## New matching logic

```
semantic   = clip(cosine, 0, 1)
required   = matched required skills / required skills   (canonical, deduplicated)
preferred  = matched preferred skills / preferred skills (excluding skills already required)
score      = (0.45·semantic + 0.45·required + 0.10·preferred) / (weights of the components present)
             − 0.10 per missing critical skill (maximum 0.20)

Fit-Now    : required skills listed AND required ≥ 0.50 AND semantic ≥ 0.45 AND no critical skill missing
Aspiration : not Fit-Now AND semantic ≥ 0.20 AND ≥ 1 skill held (or the job lists no skills)
Low Match  : otherwise; scored, but excluded from the recommendation lists
```

Lists are ranked by the composite score, then cosine, coverage, preference
alignment and learning readiness as tie-breakers.

Previous logic, for comparison:

```
Fit-Now : required skills listed AND cosine ≥ 0.45 AND coverage ≥ 0.50 AND no must-have missing
else    : Aspiration
ranking and match_percentage: cosine only
```

## Cached and stored embeddings

- No embeddings are persisted, either in Supabase or on disk.
- Job vectors are cached in process memory only, keyed by the model version,
  the checkpoint path and the exact job input text. An edited job, a new job or
  a different checkpoint therefore never reuses old vectors.
- Candidate vectors are computed per request, so a changed profile or resume is
  always re-encoded.
- Stale embeddings are not a factor.
- Saved dashboard reports keep the categories computed when they were saved.
  They update when the candidate reruns matching.

## Frontend

`SnapshotStep.tsx` used to relabel backend Aspiration results under 60% (and
any 0% result) as "Partial Match", which was a second category rule in the UI.
It now shows the backend's `match_category`/`match_type`, falling back to the
list a result came from for older saved reports.

## Known limitations and follow-ups

- Some reference jobs list implausible required skills. For example, "Software
  Developer" requires Animal Care and Bookkeeping, which lowers coverage for
  genuine candidates. The job data needs review.
- 41 legacy `SK_*` IDs remain in Supabase jobs. They are now matched by name,
  but mapping them to taxonomy IDs would be better.
- Philippine mobile numbers (0917-…) are not redacted from the model input's
  evidence text.
- The labels here are weak metadata labels. The planned human-judged
  development and test collection should replace them before the thresholds
  are frozen for Chapter 4.
