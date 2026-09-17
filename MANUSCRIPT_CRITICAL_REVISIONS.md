# Kareerly Critical Manuscript Revisions

This document provides manuscript-ready corrections for Research Questions 3 and 5, a formal specification of the Kareerly matching algorithm, and a ground-truth protocol for ranking evaluation. The recommended algorithm specification is designed to remain faithful to Kareerly's explainable, skills-centered, privacy-conscious goals while making the study reproducible and defensible.

## 1. Recommended Research Question Revisions

### Replacement for Research Question 3

Replace the present causal question with:

> **3. How do candidate users evaluate the clarity, usefulness, actionability, and trustworthiness of Kareerly's job-match explanations, and how accurately can they interpret the matched skills, missing skills, and rationale presented for a recommendation?**

This wording does not claim that the explanation *improves* understanding relative to an unexplained system. It measures both subjective perceptions and actual interpretation. Human-centered XAI evaluation distinguishes the perceived quality of an explanation, its contribution to human-AI interaction, and its contribution to task performance; therefore, perception ratings and objective comprehension tasks should not be treated as the same construct (Kim et al., 2024).

#### Corresponding objective

> **Evaluate the human-centered explainability of Kareerly by measuring candidates' perceived clarity, usefulness, actionability, and trustworthiness of the displayed explanations, together with their accuracy in interpreting matched skills, missing skills, and match rationales.**

### Replacement for Research Question 5

Replace the present bias-reduction question with:

> **5. How effectively do identity masking, skills-first presentation, role-based access control, application ownership rules, and consent-based messaging enforce Kareerly's intended privacy boundaries and support employer review?**

This wording evaluates what the prototype directly implements and can validly test. Identity masking can limit early exposure to direct identifiers, but it does not by itself establish that hiring bias has been reduced. Resumes may contain indirect proxies for protected characteristics, and claims of fairness require an explicitly defined fairness construct, protected attributes, comparison groups, outcomes, and audit method (Kumar et al., 2023; Fabris et al., 2025). The NIST AI Risk Management Framework similarly treats fairness and bias as risks that must be measured and documented rather than inferred from the presence of a mitigation feature (Tabassi, 2023).

#### Corresponding objective

> **Evaluate Kareerly's privacy-conscious employer-review workflow by testing identity masking, cross-tenant and role-based access boundaries, application ownership, candidate withdrawal control, and message consent, and by measuring employers' perceived usefulness of the resulting skills-first presentation.**

## 2. Chapter III Evaluation Sections

### Evaluation of Match Explanations

The following subsection may be inserted under Data Collection Instrument or as a separate subsection before Statistical Treatment.

> **Evaluation of Match Explanations.** Kareerly's explanations will be evaluated using both an objective comprehension task and a post-task perception questionnaire. Each candidate participant will inspect a predetermined set of Fit-Now and Aspiration-Based recommendations without assistance from the researchers. For each recommendation, the participant will be asked to identify: (1) at least one matched skill, (2) at least one missing skill, (3) the principal reason for the assigned match category, and (4) an appropriate next action, such as applying, updating the profile, or pursuing a recommended learning resource. Each correct response will receive one point, producing a comprehension score from 0 to 4 for each evaluated recommendation.
>
> After completing the task, participants will rate the explanation's clarity, usefulness, actionability, sufficiency, and trustworthiness using the study's five-point response scale. The objective comprehension score and subjective perception ratings will be reported separately because a user may perceive an explanation as clear or trustworthy without interpreting it correctly. This distinction is consistent with human-centered XAI evaluation, which separates explanation quality, human-AI interaction, and task performance (Kim et al., 2024). Results will be summarized using frequencies, percentages, median and interquartile range, and weighted mean where required by the institutional reporting format. Open-ended comments will be grouped into recurring usability themes.

#### Suggested comprehension scoring key

| Item | Correct response criterion | Score |
|---|---|---:|
| Matched skill | Selects a skill shown in the system's matched-skill list | 1 |
| Missing skill | Selects a skill shown in the missing-skill list | 1 |
| Match rationale | Correctly relates Fit-Now to current readiness or Aspiration-Based to partial alignment and development needs | 1 |
| Next action | Selects an action consistent with the displayed evidence and recommendation | 1 |

Do not state that explanations "improved" understanding unless a separate comparison condition is introduced. If the researchers later retain the causal wording, participants must be randomly assigned to an explanation condition and a no-explanation condition, or must complete a counterbalanced within-subject test. The primary outcome would then be comprehension accuracy rather than perception alone.

### Evaluation of Privacy-Conscious Employer Review

> **Evaluation of Privacy-Conscious Employer Review.** The privacy-conscious employer workflow will be evaluated using a technical boundary-test checklist and an employer task-based evaluation. The technical checklist will verify that an employer can access only applicants who submitted an application to a job owned by that employer; direct identity and contact fields remain masked during the configured early-review stage; interview-stage messaging cannot begin without a valid employer request and candidate acceptance; a declined request does not create a bidirectional message thread; and a withdrawn application cannot be reactivated or altered by an employer. Cross-tenant requests, unauthorized role requests, and direct API requests for another employer's applicants must return an access-denied response or an empty authorized result.
>
> Employer participants will then complete a skills-first applicant-review task using masked candidate profiles. Task measures will include successful identification of matched and missing requirements, time to complete the review, review errors, and perceived usefulness and clarity of the masked presentation. The study will report these findings as evidence of privacy-boundary enforcement and employer utility, not as proof that hiring bias was reduced. Current research emphasizes that fairness in algorithmic hiring is multidimensional and cannot be established by a single mitigation technique or perception measure (Kumar et al., 2023; Fabris et al., 2025).

#### Recommended technical test matrix

| Test | Expected result |
|---|---|
| Employer A requests an applicant to Employer B's job | Access denied or no record returned |
| Employer searches the global candidate population | Operation unavailable |
| Employer views a non-applicant | Access denied |
| Early-stage employer review | Name, gender, age, email, phone number, and direct address are absent or masked |
| Employer sends a message before permitted stage | Request rejected |
| Employer sends an interview-stage request | Candidate receives a consent request; no thread is opened yet |
| Candidate declines or ignores the request | No bidirectional thread is created |
| Candidate accepts the request | Thread is created only for the associated application |
| Candidate withdraws | Employer cannot reverse the withdrawal or restore the application |
| Administrator attempts to alter a candidate withdrawal or employer hiring outcome | Operation rejected, except for a separately defined and audited technical-recovery procedure |

#### Strong additional test: counterfactual identity invariance

Create paired synthetic resumes with identical skills, experience, education, and certifications but different names, pronouns, ages, or contact details. Run each pair against the same frozen job set. Because direct identifiers should be removed from the scoring input, the paired profiles should produce identical standardized skills and effectively identical rankings. Report:

- Top-K overlap or Jaccard similarity between paired rankings.
- Maximum absolute score difference for paired profiles.
- Whether the Fit-Now/Aspiration-Based classification changes.

This is an identity-insensitivity or invariance test. It should not be called a complete fairness or discrimination audit because it does not measure real employer decisions or all sensitive-attribute proxies.

## 3. Formal Algorithm Specification

### 3.1 Recommended algorithm identity

Use a versioned name throughout the system and manuscript:

> **Kareerly Hybrid Matching Algorithm, Version 1.0 (KHMA-v1.0)**

Every evaluation output should record:

- Algorithm version.
- Exact Cross-Encoder model identifier and cached revision or snapshot hash.
- Skill-taxonomy version and dataset snapshot date.
- Component weights and classification thresholds.
- Scoring method actually used, such as Cross-Encoder or TF-IDF fallback.
- Timestamp and job-catalog snapshot identifier.

This prevents results from changing without a trace when the model, datasets, or scoring rules are updated.

### 3.2 Model specification

The main semantic scorer should be identified as:

> `cross-encoder/ms-marco-MiniLM-L6-v2`

The current canonical identifier omits the extra hyphen between `L` and `6`. Its maintained model card identifies it as an English text-ranking Cross-Encoder trained on the MS MARCO passage-ranking task, with 22.7 million parameters and an Apache 2.0 license (Sentence Transformers, 2025). Because it was not trained specifically on recruitment data, its suitability for candidate-job ranking must be established using Kareerly's independently labeled evaluation set.

The model receives a candidate profile and a job representation as a paired input and returns a raw ranking logit, denoted by \(z_{c,j}\), for candidate \(c\) and job \(j\). It should be described as a pretrained transformer Cross-Encoder rather than a recruitment-trained model.

### 3.3 Preprocessing and input construction

The recommended deterministic preprocessing pipeline is:

1. Accept readable PDF and DOCX files only.
2. Extract PDF text with `pypdf` and DOCX paragraphs and tables with `python-docx`.
3. Reject extracted text shorter than 50 non-whitespace characters.
4. Apply Unicode NFKC normalization, remove null characters, and collapse repeated whitespace.
5. Preserve the original extracted text for user review, but create a lowercase normalized copy for alias and rule matching.
6. Remove direct identifiers from the semantic-scoring copy, including name, email address, phone number, gender labels, age/date of birth, and full street address.
7. Extract skill aliases and map them to canonical PSOC-ESCO skill identifiers where a valid mapping exists.
8. Allow the candidate to confirm, remove, or add skills. Store unmapped custom skills separately and do not count them as exact standardized matches until they are mapped.
9. Construct the candidate model input in this order: confirmed standardized skills; experience and project evidence; education and certifications; target role and preferences. Put the most decision-relevant fields first so that they survive token truncation.
10. Construct the job model input in this order: job title; must-have and required skills; responsibilities; experience level; preferred skills; work setup; location; and salary information.
11. Set the paired maximum sequence length to 512 subword tokens and use a documented truncation strategy, preferably `longest_first`. The same setting must be used for every experiment.

The model input must exclude fields that the paper states should not influence early matching. A copy of the redacted candidate and job representation used for each evaluation run should be saved for audit and reproducibility.

### 3.4 Component scores

All component scores are bounded to \([0,1]\).

#### Semantic relevance

The present catalog-relative min-max normalization should be replaced because it makes the displayed score depend on which other jobs happen to be in the current catalog. A stronger approach is to fit a logistic calibration function using development-set labels:

\[
S_{c,j} = \frac{1}{1 + e^{-(a z_{c,j}+b)}}
\]

where \(a\) and \(b\) are fitted only on the development set using binary relevance \(rel_{c,j} \geq 2\). These parameters are then frozen before test-set evaluation. If the available development labels are insufficient for calibration, use \(S_{c,j}=\sigma(z_{c,j})\), describe it only as a normalized semantic score, and do not call it a probability.

#### Required-skill coverage

Let \(C_c\) be the candidate's confirmed canonical skill set and \(R_j\) the job's required canonical skill set:

\[
COV_{c,j} =
\begin{cases}
\frac{|C_c \cap R_j|}{|R_j|}, & |R_j|>0 \\
0, & |R_j|=0
\end{cases}
\]

The matched and missing sets are:

\[
Matched_{c,j}=C_c \cap R_j
\]

\[
Missing_{c,j}=R_j-C_c
\]

If an employer identifies a separate must-have skill set \(H_j\), compute:

\[
MHC_{c,j} =
\begin{cases}
\frac{|C_c \cap H_j|}{|H_j|}, & |H_j|>0 \\
1, & |H_j|=0
\end{cases}
\]

The value 1 when no must-have skills are declared means that the must-have gate is not applicable; it does not mean the candidate demonstrated every skill.

#### Preference alignment

Preference alignment is the weighted average of the candidate's active preferences:

\[
PREF_{c,j}=\frac{0.25I_{industry}+0.30I_{role}+0.15I_{level}+0.20I_{setup}+0.10I_{salary}}{\sum_{d \in D_c}w_d}
\]

where \(I_d\in[0,1]\) is the exact or token-overlap match for preference dimension \(d\), and \(D_c\) contains only preferences provided by the candidate. "Any," "not sure," and "flexible" responses are excluded from the denominator.

#### Evidence strength

Instead of treating the mere presence of an education or certification heading as evidence for all matched skills, calculate contextual evidence per matched skill. For a matched skill \(s\):

\[
e(s)=
\begin{cases}
1.00, & s\text{ occurs in work-experience or project evidence} \\
0.75, & s\text{ occurs in certification or training evidence} \\
0.40, & s\text{ occurs only in a skills list} \\
0, & \text{otherwise}
\end{cases}
\]

Then:

\[
EVID_{c,j}=\frac{1}{|Matched_{c,j}|}\sum_{s\in Matched_{c,j}}e(s)
\]

and \(EVID_{c,j}=0\) when no required skill is matched. The explanation may cite the section that produced the strongest evidence, but it should not invent work experience from a skills-list occurrence.

#### Learning-resource availability

Let \(G_{c,j}=Missing_{c,j}\), and let \(A(s)=1\) when at least one verified learning resource is mapped to missing skill \(s\):

\[
LR_{c,j}=
\begin{cases}
\frac{\sum_{s\in G_{c,j}}A(s)}{|G_{c,j}|}, & |G_{c,j}|>0 \\
0, & |G_{c,j}|=0
\end{cases}
\]

This score represents whether the identified gaps can be connected to available learning resources. It is not evidence that the candidate will complete the learning or become competent.

### 3.5 Composite ranking scores

To stay close to the current Kareerly design, use the following as the initial KHMA-v1.0 weights:

\[
FIT_{c,j}=0.55S_{c,j}+0.25COV_{c,j}+0.15EVID_{c,j}+0.05PREF_{c,j}
\]

\[
ASP_{c,j}=0.20S_{c,j}+0.10COV_{c,j}+0.60PREF_{c,j}+0.10LR_{c,j}
\]

The two scores answer different questions and must not be treated as the same probability:

- \(FIT\) ranks roles for which current qualifications and evidence are most aligned.
- \(ASP\) ranks career-direction opportunities that align with stated preferences and have actionable development pathways.

The weights are system-design hyperparameters, not learned facts. They must be listed in a parameter table, checked through an ablation study, and frozen before the final test evaluation. If development-set tuning changes a weight, both the manuscript and implementation must be updated to the final frozen value.

### 3.6 Classification and thresholds

Use three internal outcomes rather than forcing every job into one of two positive recommendation categories.

| Outcome | Recommended initial rule |
|---|---|
| Fit-Now | \(MHC=1.00\), \(COV\geq0.50\), and \(FIT\geq0.60\) |
| Aspiration-Based | Not Fit-Now; \((S\geq0.35\text{ or }COV\geq0.25)\), \(PREF\geq0.40\), \(LR>0\), and \(ASP\geq0.45\) |
| Not Highlighted | Neither rule is satisfied |

These are initial development thresholds. Their purpose is to provide an explicit, reproducible starting point. Use only the development set to check alternative thresholds and select the final values. A suitable selection objective is macro-F1 across expert-assigned Fit-Now, Aspiration-Based, and Not Highlighted labels, subject to the non-negotiable rule that a Fit-Now result cannot omit a declared must-have skill. Freeze the selected thresholds before evaluating the test set.

Do not use an absolute rule such as "no more than eight missing skills" because eight missing skills have different meaning for a job with ten requirements and a job with thirty requirements. The proportional skill-coverage score and must-have gate are more interpretable.

When no job satisfies the Fit-Now rule, return an empty Fit-Now list and display:

> No strong Fit-Now match was identified in the current job set. The following are the closest development opportunities.

The closest opportunities may be ranked separately, but they must not be relabeled as Fit-Now.

### 3.7 Failure and fallback behavior

If the Cross-Encoder cannot be loaded, the production interface may use TF-IDF cosine similarity as a continuity fallback, provided that the response records `tfidf_fallback` as the scoring method. For the thesis experiment, a TF-IDF fallback run must never be mixed into a Cross-Encoder run without disclosure. The failed Cross-Encoder run should be repeated after restoring the pinned model; otherwise, it must be analyzed as a separate baseline configuration.

### 3.8 Pseudocode

```text
Algorithm KHMA-v1.0
Input:
    resume file r
    confirmed candidate preferences p
    frozen job catalog J
    skill taxonomy T
    learning-resource catalog L
Output:
    ranked Fit-Now list F
    ranked Aspiration-Based list A
    matched/missing skills and explanations

1.  text_original <- extract_text(r)
2.  if readable_length(text_original) < 50: reject file
3.  text_normalized <- normalize_unicode_and_whitespace(text_original)
4.  text_scoring <- redact_direct_identifiers(text_normalized)
5.  extracted_skills <- map_skill_aliases(text_scoring, T)
6.  C <- candidate_confirms_or_edits(extracted_skills)
7.  candidate_input <- build_candidate_input(C, evidence_sections, p)
8.  F <- empty list; A <- empty list

9.  for each active job j in frozen catalog J:
10.     job_input <- build_job_input(j)
11.     z <- CrossEncoder(candidate_input, job_input)
12.     S <- calibrated_semantic_score(z)
13.     R <- normalized_required_skills(j, T)
14.     H <- normalized_must_have_skills(j, T)
15.     matched <- C intersection R
16.     missing <- R minus C
17.     COV <- |matched| / |R| if |R| > 0 else 0
18.     MHC <- |C intersection H| / |H| if |H| > 0 else 1
19.     EVID <- contextual_evidence_score(matched, text_scoring)
20.     PREF <- active_preference_alignment(p, j)
21.     LR <- resource_availability(missing, L)
22.     FIT <- .55*S + .25*COV + .15*EVID + .05*PREF
23.     ASP <- .20*S + .10*COV + .60*PREF + .10*LR

24.     if MHC = 1 and COV >= .50 and FIT >= .60:
25.         category <- Fit-Now
26.         add (j, FIT, matched, missing, explanation) to F
27.     else if (S >= .35 or COV >= .25)
             and PREF >= .40 and LR > 0 and ASP >= .45:
28.         category <- Aspiration-Based
29.         add (j, ASP, matched, missing, explanation) to A
30.     else:
31.         category <- Not Highlighted

32. sort F by FIT descending
33. sort A by ASP descending
34. return top-K F, top-K A, algorithm version, model revision,
    weights, thresholds, and scoring method
```

## 4. Ranking Ground-Truth and Evaluation Protocol

### 4.1 Evaluation question

The technical evaluation should answer:

> How effectively does the KHMA-v1.0 hybrid ranker retrieve expert-judged relevant jobs compared with lexical and component-level baselines?

### 4.2 Recommended test collection

A realistic undergraduate-scale design is:

- At least 30 de-identified or synthetic candidate profiles distributed across at least five occupational categories.
- A frozen catalog of at least 100 valid job posts containing explicit required skills and enough information for expert judgment.
- A candidate-level split of 10 development profiles and 20 test profiles. No version of a development candidate may appear in the test set.
- No use of the test labels while choosing score weights, score calibration parameters, thresholds, or preprocessing rules.

Judging every candidate against every job may be unnecessarily expensive. Use a pooled judging approach. For each candidate, create the union of:

- Top 10 jobs from TF-IDF.
- Top 10 jobs from Cross-Encoder semantic scoring.
- Top 10 jobs from Cross-Encoder plus skill coverage.
- Top 10 jobs from the full hybrid model.
- Five randomly selected jobs not already in the pool to provide likely negative examples.

Remove duplicates and randomize the candidate-job pairs before annotation. Pooling results from multiple systems is preferable to judging only the proposed model's results because it reduces evaluation bias toward one retrieval method. Recent TREC ranking evaluations similarly rely on held-out queries, human relevance assessments, graded relevance, and normalized ranking metrics (Craswell et al., 2023).

### 4.3 Relevance-label rubric

Use an ordinal 0-3 relevance scale:

| Label | Name | Operational definition |
|---:|---|---|
| 0 | Not relevant | The occupation or responsibilities are unrelated, or the candidate fails a non-negotiable eligibility or must-have requirement. |
| 1 | Weakly relevant | Some topical or preference similarity exists, but the candidate has major qualification gaps and the role is not a credible immediate or near-term recommendation. |
| 2 | Relevant development opportunity | The role is related to the candidate's background or stated direction, but moderate gaps remain that could reasonably be addressed through experience or learning. This corresponds approximately to an Aspiration-Based opportunity. |
| 3 | Highly relevant current opportunity | Strong role, skill, experience-level, and preference alignment exists; all declared must-have requirements are satisfied and no critical gap prevents a reasonable application. This corresponds approximately to Fit-Now. |

The rubric must be applied by human assessors without showing the system's score, rank, matched-skill list, or category.

### 4.4 Annotators and agreement

Each candidate-job pair should be rated independently by two assessors:

- One assessor with recruitment, career-services, or HR experience.
- One assessor with relevant occupational or domain knowledge.

Before formal annotation, both assessors should label the same pilot set, discuss rubric ambiguities, and revise the annotation guide. Use quadratic-weighted Cohen's kappa because the relevance labels are ordinal. Report the achieved coefficient. If agreement is poor, revise the rubric and repeat the pilot rather than averaging unreliable labels.

For production labels:

- Agreement: use the common label.
- One-level disagreement: use the rounded mean or an agreed predeclared resolution rule.
- Disagreement of two or more levels: send the pair to a third adjudicator.
- Store a short rationale and any failed must-have requirement for auditability.

Recommended annotation file:

```text
candidate_id, job_id, assessor_id, relevance_0_to_3,
failed_must_have, rationale, annotation_timestamp
```

The final adjudicated file should contain:

```text
candidate_id, job_id, final_relevance, label_source,
failed_must_have, adjudication_note
```

### 4.5 Baselines and ablation configurations

Evaluate four frozen configurations:

| ID | Configuration | Purpose |
|---|---|---|
| A | TF-IDF cosine similarity | Lexical baseline |
| B | Cross-Encoder semantic score only | Contribution of semantic pair scoring |
| C | Cross-Encoder plus required-skill coverage | Contribution of transparent skill rules |
| D | Full KHMA-v1.0 | Contribution of evidence, preference, classification, and learning availability |

This ablation design prevents the study from attributing every improvement to the Cross-Encoder when multiple components changed at the same time.

### 4.6 Metrics and relevance interpretation

Use these cutoffs because they correspond to Kareerly's interfaces:

- Precision@3 for the limited guest report.
- Precision@10 and NDCG@10 for the initial registered report.
- Recall@20 and NDCG@20 for the full dashboard.
- MRR@10 for how early the first relevant job appears.

For Precision, Recall, and MRR, treat labels 2 and 3 as relevant. For NDCG, retain the graded 0-3 labels so that a highly relevant current opportunity receives more gain than a weak or developmental match. TREC 2023 used human-assessed graded relevance values from 0 to 3 and NDCG@10 to evaluate ranking quality, providing a recent methodological precedent for this approach (Craswell et al., 2023).

Report metrics per candidate first, then report the mean, median, standard deviation or interquartile range, and 95% bootstrap confidence interval across test candidates. For pairwise configuration comparisons, use a paired test on per-candidate scores, such as a Wilcoxon signed-rank test when the small-sample distribution is not approximately normal, and report an effect size in addition to the p-value.

### 4.7 Manuscript-ready ground-truth subsection

> **Ground-Truth Construction for Job-Ranking Evaluation.** The study will construct an independently judged candidate-job test collection. Candidate profiles will be divided at the candidate level into a development set used for calibration and threshold selection and a held-out test set used only for final evaluation. For each candidate, the researchers will pool the top results produced by the TF-IDF baseline, the Cross-Encoder-only configuration, the Cross-Encoder-plus-skill configuration, and the full hybrid configuration, together with randomly sampled non-retrieved jobs. Duplicate pairs will be removed and the remaining candidate-job pairs will be randomized before annotation.
>
> Each pair will be independently evaluated by two qualified assessors using a four-level relevance rubric: 0 for not relevant, 1 for weakly relevant, 2 for a relevant development opportunity, and 3 for a highly relevant current opportunity. Assessors will review de-identified candidate information and the complete job requirements without seeing the model's score, rank, explanation, or assigned category. Quadratic-weighted Cohen's kappa will be used to report inter-rater agreement. Large disagreements will be resolved by a third assessor, and all final labels will retain a brief written rationale.
>
> The final test labels will be used to compute Precision@3, Precision@10, Recall@20, NDCG@10, NDCG@20, and MRR@10. Labels 2 and 3 will count as relevant for binary metrics, while the full graded labels will be retained for NDCG. The use of held-out candidates, independent human relevance assessments, graded labels, and rank-sensitive measures is consistent with current information-retrieval evaluation practice (Craswell et al., 2023). Model weights, calibration parameters, thresholds, and preprocessing rules will be frozen before the held-out test set is evaluated.

## 5. Implementation Changes Required Before This Specification Is Claimed

The manuscript must describe the deployed and evaluated implementation, not a planned algorithm that is absent from the code. Before adopting the recommended specification, make these corresponding code changes:

1. Change the model identifier to the canonical `cross-encoder/ms-marco-MiniLM-L6-v2` and record the model snapshot or revision.
2. Replace per-catalog min-max normalization with development-set calibration or, at minimum, a pair-independent sigmoid transformation.
3. Remove the rule that promotes the "closest" jobs into Fit-Now when no result passes the Fit-Now criteria.
4. Add a third `not_highlighted` outcome for jobs that satisfy neither positive category.
5. Normalize employer-entered required and must-have skills to the same canonical identifiers used for candidate skills.
6. Replace the generic evidence-heading heuristic with contextual evidence attached to each matched skill, or rename the current value to `profile_evidence_completeness` and document its limitations.
7. Remove direct identifiers from the text passed to the semantic model.
8. Record algorithm version, model revision, weights, thresholds, scoring method, and dataset snapshot in every evaluation output.
9. Prevent administrator tools from overriding candidate withdrawals or substantive employer decisions if candidate autonomy remains a manuscript claim.
10. Add automated tests for every privacy boundary and scoring threshold specified above.

## 6. Recent References for Addition to the Manuscript

Craswell, N., Mitra, B., Yilmaz, E., Rahmani, H. A., Campos, D., Lin, J., Voorhees, E. M., & Soboroff, I. (2023). *Overview of the TREC 2023 Deep Learning Track*. In *The Thirty-Second Text REtrieval Conference (TREC 2023)* (NIST Special Publication 1328). https://trec.nist.gov/pubs/trec32/papers/Overview_deep.pdf

Fabris, A., Baranowska, N., Dennis, M. J., Graus, D., Hacker, P., Saldivar, J., Zuiderveen Borgesius, F., & Biega, A. J. (2025). Fairness and bias in algorithmic hiring: A multidisciplinary survey. *ACM Transactions on Intelligent Systems and Technology, 16*(1), Article 16, 1-54. https://doi.org/10.1145/3696457

Kim, J., Maathuis, H., & Sent, D. (2024). Human-centered evaluation of explainable AI applications: A systematic review. *Frontiers in Artificial Intelligence, 7*, 1456486. https://doi.org/10.3389/frai.2024.1456486

Kumar, D., Grosz, T., Rekabsaz, N., Greif, E., & Schedl, M. (2023). Fairness of recommender systems in the recruitment domain: An analysis from technical and legal perspectives. *Frontiers in Big Data, 6*, 1245198. https://doi.org/10.3389/fdata.2023.1245198

Sentence Transformers. (2025, August 29). *cross-encoder/ms-marco-MiniLM-L6-v2* [Machine learning model]. Hugging Face. https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2

Tabassi, E. (2023). *Artificial Intelligence Risk Management Framework (AI RMF 1.0)* (NIST AI 100-1). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.100-1
