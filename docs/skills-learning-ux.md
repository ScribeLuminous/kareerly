# Skills and Learning: self-reported skills, optional proof, and layout

This note records what changed on the candidate **Skills** page (Gaps and
Learning tabs) and the research each decision rests on. Every source is from
2022 or later.

## What changed

1. **"I already have this skill."** Each skill gap has a button to mark the
   skill as one the candidate already has. After a confirmation step, the skill:
   - is added to the candidate's confirmed skill list (the same list edited in
     Preferences, still capped at 20 skills),
   - is removed from Skill Gaps and from Learning, so no course is suggested
     for it, and
   - triggers a fresh match run, so match scores use the new skill.

   The confirmation asks candidates to add a skill only if they could use it at
   work today, and reminds them that employers may check it. The skill is listed
   under **Skills you already have → Added by you**, where it can be undone.
   Removing it in Preferences also brings the gap back. These claims are
   self-reported and are never shown as verified.

2. **Proof is optional.** Marking a course or skill as done opens the proof
   form. The form now says clearly that proof is not required and has a
   **Skip for now** button. Skipping shows the reminder: *employers may still
   check this skill with a short test, a task, or by asking for samples of past
   work, so keep an example ready.* The same reminder appears on the course
   card ("Done without proof · Add proof (optional)") and in the skill detail.

3. **Clearer layout.**
   - The list gives a one-line explanation of what a gap is and a
     "not started · in progress · done" count. Before, "to build" also counted
     in-progress skills.
   - The priority filter only appears when there is more than one priority
     level. Each row shows a Done / In progress badge.
   - The detail panel reads top to bottom: why the skill is needed
     (Required/Nice to have for which jobs), **Already know it?**, then numbered
     steps: **1 Learn it**, **2 Track your progress**, **3 Proof (optional)**.
   - There is now one progress control. Setting a skill to Done marks its
     suggested course as done in Learning, and Not started / In progress clears
     it. Before, the two tabs could disagree (for example, "Taken" in Learning
     but "In progress" in Gaps).
   - On the Learning course card, the duplicate "Taken" badge and button are
     now a single **Mark as done / Done** toggle.

Claimed skills are saved per user in `candidate_claimed_skills`, the same way
course completions (`candidate_course_completions`) and skill progress
(`candidate_skill_progress`) are, so they are the same on every device. They
are always sent to matching as confirmed skills and saved to `user_skills`
(source `confirmed_skill`) whenever matches refresh. Data an earlier version
kept in the browser (`kareerly.claimedSkills.<user>` and the like) is imported
once on the next sign-in and then removed from the browser. If loading or
saving fails, the dashboard shows an error banner with "Try again".

## Research basis (2022–present)

| Decision | Evidence |
|---|---|
| Let candidates correct the recommender ("I already have this skill") instead of being pushed into courses they don't need | Ooge, Dereu & Verbert (2023) found that letting learners steer an e-learning recommender, and showing the effect of their changes, increased trust and perceived understanding. Kareerly shows the effect directly: the gap disappears and matches refresh. |
| Treat claimed skills as self-reported, add a reflective confirmation, and keep them undoable | Coutinho et al. (2024): low performers were the most miscalibrated about their own performance, and also the most confident that their self-estimates were right. A short "could you use it at work today?" check and an easy undo reduce the cost of overclaiming without blocking people who really have the skill. |
| Self-reported skills are still worth adding, but credible proof counts for more | Stephany, Teutloff & Leone (2026), a hiring experiment: self-reported skills gave a significant advantage, and certifications gave a slightly larger one. Carranza et al. (2022): skill information that job seekers could credibly share with firms improved employment and earnings more than information they could not easily share. |
| Proof is optional, but candidates are told employers may test them or ask for work samples | Sackett, Zhang, Berry & Lievens (2022) re-estimated selection validities and found work-sample tests and structured interviews among the stronger predictors, so candidates can expect them. Sigelman, Fuller & Martin (2024) found that many employers dropped degree requirements "in name only", so candidates still need to be ready to show their skills directly. |

### References

- Carranza, E., Garlick, R., Orkin, K., & Rankin, N. (2022). Job search and hiring with limited information about workseekers' skills. *American Economic Review, 112*(11), 3547–3583. https://doi.org/10.1257/aer.20200961
- Coutinho, M. V. C., Thomas, J., Fredricks-Lowman, I., Alkaabi, S., & Couchman, J. J. (2024). Unskilled and unaware: Second-order judgments increase with miscalibration for low performers. *Frontiers in Psychology, 15*, 1252520. https://doi.org/10.3389/fpsyg.2024.1252520
- Ooge, J., Dereu, L., & Verbert, K. (2023). Steering recommendations and visualising its impact: Effects on adolescents' trust in e-learning platforms. In *Proceedings of the 28th International Conference on Intelligent User Interfaces (IUI '23)*. ACM. https://doi.org/10.1145/3581641.3584046
- Sackett, P. R., Zhang, C., Berry, C. M., & Lievens, F. (2022). Revisiting meta-analytic estimates of validity in personnel selection: Addressing systematic overcorrection for restriction of range. *Journal of Applied Psychology, 107*(11), 2040–2068. https://doi.org/10.1037/apl0000994
- Sigelman, M., Fuller, J. B., & Martin, A. (2024). *Skills-based hiring: The long road from pronouncements to practice*. Burning Glass Institute & Harvard Business School Project on Managing the Future of Work.
- Stephany, F., Teutloff, O., & Leone, A. (2026). *AI skills improve job prospects: Causal evidence from a hiring experiment* (arXiv:2601.13286; SSRN 6097566). Preprint, not yet peer reviewed.
