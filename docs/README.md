# Kareerly technical documentation

Start with the [main README](../README.md) for the system overview, setup and
testing. The documents below give the details behind each part of the system.

## System architecture and matching

| Document | Contents |
|---|---|
| [`../backend/README.md`](../backend/README.md) | Backend setup, resume reading, **production matching algorithm**, TF-IDF baseline, Cloud Run deployment and troubleshooting |
| [`matching-diagnosis.md`](matching-diagnosis.md) | Score-distribution diagnosis and how the Fit-Now / Aspiration thresholds were calibrated |
| [`skill-match-accuracy.md`](skill-match-accuracy.md) | Review of skill-match accuracy and the fixes made |
| [`feedback-learning.md`](feedback-learning.md) | Good/Bad rating re-ranking and skill discovery: what runs automatically, review and rollback |

## Skills, gaps and learning

| Document | Contents |
|---|---|
| [`esco-skill-implementation.md`](esco-skill-implementation.md) | ESCO v1.2.1 skill taxonomy, aliases and evidence relations |
| [`skill-gaps-by-skill.md`](skill-gaps-by-skill.md) | Skill-gap grouping, tiers and display limits |
| [`learning-recommendations.md`](learning-recommendations.md) | Learning recommendation rules and audit |
| [`learning-paths.md`](learning-paths.md) | Learning catalogue contract between backend and frontend |
| [`skills-learning-ux.md`](skills-learning-ux.md) | Skills and Learning pages: self-reported skills and optional proof |

## Data and integrations

| Document | Contents |
|---|---|
| [`job-data-anomalies.md`](job-data-anomalies.md) | Manual review of the reference job catalogue |
| [`job-listings-api.md`](job-listings-api.md) | Assessment of Philippine job-listing APIs |
| [`psoc-api-integration.md`](psoc-api-integration.md) | PSA PSOC 2012 occupation reference and ISCO/ESCO crosswalk |
| [`../backend/pipeline/README.md`](../backend/pipeline/README.md) | Research job-corpus pipeline and source policy |
| [`../backend/evaluation/README.md`](../backend/evaluation/README.md) | Evaluation assets |

## Database, employers and security

| Document | Contents |
|---|---|
| [`../supabase/migrations/README.md`](../supabase/migrations/README.md) | What each database migration does and where its checks are |
| [`employer-evaluation.md`](employer-evaluation.md) | Employer profile match, rubrics, scorecards and audit log |
| [`security.md`](security.md) | Security advisor findings and remaining manual settings |

## Test data

| Document | Contents |
|---|---|
| [`../test-data/synthetic-resumes-180/README.md`](../test-data/synthetic-resumes-180/README.md) | 180 fictional resumes used for system tests |
| [`../test-data/resume-extraction/README.md`](../test-data/resume-extraction/README.md) | Resume extraction QA: samples, ground truth and reports |

## Archive

| Document | Contents |
|---|---|
| [`archive/MANUSCRIPT_CRITICAL_REVISIONS.md`](archive/MANUSCRIPT_CRITICAL_REVISIONS.md) | Earlier manuscript revision notes. **Superseded**: they describe a Cross-Encoder design that is not the submitted system |

Dated documents (for example "2026-09-24") record the state of the system on
that date. Where they differ from the code, the code and the main README are
current.
