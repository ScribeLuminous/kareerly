import type { CandidateAssessment } from '../../lib/assessmentApi';
import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faCircleQuestion, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { Banner, InfoTip } from '../../components/ui';
import type { AuditEntry } from '../../lib/evaluationApi';
import {
  disagreements,
  RATING_SCALE,
  unassessedRequired,
  weightShares,
  weightedRating,
  type EvaluationResult,
  type ProfileMatch,
  type RatingDraft,
  type Rubric,
  type Scorecard,
} from './evaluation';
import { formatDateLabel } from './model';

export function CoverageMeter({ percent, label }: { percent: number; label: string }) {
  return (
    <div>
      <div className="k-meta mb-1 flex justify-between"><span>{label}</span><span className="k-num">{percent}%</span></div>
      <div className="k-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
        <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
    </div>
  );
}

export function ProfileMatchPanel({ match }: { match: ProfileMatch; applyTimeRankingScore?: number | null }) {
  return (
    <section className="k-detail-section" aria-labelledby="profile-match-heading">
      <h3 id="profile-match-heading" className="k-label mb-1 flex items-center gap-1">
        Match at application
        <InfoTip label="How the match is worked out">
          This is the candidate's own fit score for the job, saved when they applied, so you see the same number they saw. It combines how closely their resume reads like the job with the required skills found. It is not a hiring probability or a prediction of job performance.
        </InfoTip>
      </h3>
      {match.percent === null ? (
        <p className="k-secondary">No fit score was saved with this application.</p>
      ) : (
        <p className="k-body"><strong>{match.percent}%</strong> fit when they applied.</p>
      )}
      {!match.hasEvidence ? (
        <p className="k-secondary mt-2">{match.required.length === 0 ? 'This job lists no required skills, so there is nothing to compare.' : 'The application recorded no skill evidence.'}</p>
      ) : (
        <>
          <p className="k-meta mt-3">Required skills</p>
          <ul className="mt-1 space-y-1" aria-label="Required skills">
            {match.required.map((skill) => {
              const found = match.found.includes(skill);
              return (
                <li key={skill} className="flex items-center gap-2 text-[14px]">
                  <FontAwesomeIcon icon={found ? faCheck : faCircleQuestion} className={found ? 'text-green' : 'text-soft-text'} aria-hidden="true" />
                  <span>{skill}</span>
                  <span className="k-meta">{found ? 'Found in application' : 'Not found in application'}</span>
                </li>
              );
            })}
          </ul>
          {match.notFound.length > 0 && <p className="k-meta mt-2">"Not found" means the resume didn't show it, not that the candidate lacks it. Ask about it in the interview.</p>}
        </>
      )}
    </section>
  );
}

function ratingLabel(mean: number | null): string {
  if (mean === null) return 'Not assessed';
  const nearest = RATING_SCALE.reduce((best, option) => (Math.abs(option.value - mean) < Math.abs(best.value - mean) ? option : best));
  return `${mean.toFixed(1)} · ${nearest.label}`;
}

export function ReviewedEvaluationPanel({ result, olderVersions, hasRubric, isCurrentVersion }: { result: EvaluationResult | null; olderVersions: EvaluationResult[]; hasRubric: boolean; isCurrentVersion: boolean }) {
  const missing = unassessedRequired(result);
  const split = disagreements(result);
  const shares = result ? weightShares(result.criteria) : [];
  return (
    <section className="k-detail-section" aria-labelledby="reviewed-evaluation-heading">
      <h3 id="reviewed-evaluation-heading" className="k-label mb-1 flex items-center gap-1">
        Reviewed evaluation
        <InfoTip label="How reviewed evaluation is worked out">
          From submitted team scorecards only. Ratings are averaged across reviewers and weighted by the rubric. Not assessed criteria are excluded from the weighted average, never counted as zero. The assessed count and coverage show how much evidence the score represents.
        </InfoTip>
      </h3>
      {!hasRubric ? (
        <p className="k-secondary">No rubric for this job yet.</p>
      ) : !result || result.submittedScorecards === 0 ? (
        <p className="k-secondary">No submitted scorecards yet.</p>
      ) : (
        <>
          {!isCurrentVersion && <Banner tone="info" className="mb-3">These scorecards use rubric version {result.rubricVersion}. The job's rubric has changed since; results stay on the version they were scored with.</Banner>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[10px] bg-bg px-3 py-2">
              <p className="k-meta">Weighted Score (rubric v{result.rubricVersion})</p>
              <p className="k-num text-[22px] font-bold leading-8 text-dark">{result.assessedCount === 0 ? 'Not assessed' : `${weightedRating(result.criteria)?.toFixed(1)} / 4.0`}</p>
              <p className="k-meta">{result.assessedCount} of {result.criteriaCount} criteria assessed · {result.submittedScorecards} scorecard{result.submittedScorecards === 1 ? '' : 's'} submitted</p>
            </div>
            <div className="rounded-[10px] bg-bg px-3 py-2">
              <CoverageMeter percent={result.coveragePercent} label="Evaluation coverage" />
              <p className="k-meta mt-1">{result.requiredAssessed} of {result.requiredCount} required criteria assessed</p>
            </div>
          </div>
          {missing.length > 0 && <Banner tone="warn" className="mt-3">Required criteria without enough evidence: {missing.join(', ')}. They are excluded from the weighted score, not treated as low ratings.</Banner>}
          {split.length > 0 && (
            <p className="k-secondary mt-3 flex items-start gap-2">
              <FontAwesomeIcon icon={faTriangleExclamation} className="mt-1 text-amber" aria-hidden="true" />
              Reviewers differ by two or more points on {split.join(', ')}. Discuss the evidence before deciding.
            </p>
          )}
          <table className="mt-3 w-full text-left text-[14px]">
            <caption className="sr-only">Criterion breakdown</caption>
            <thead>
              <tr className="k-meta">
                <th scope="col" className="py-1 pr-2 font-semibold">Criterion</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Weight</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Average rating</th>
                <th scope="col" className="py-1 font-semibold">Reviewers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {result.criteria.map((criterion, index) => (
                <tr key={criterion.criterionId}>
                  <th scope="row" className="py-2 pr-2 font-medium">
                    {criterion.name}
                    {criterion.isRequired && <span className="k-meta block">Required</span>}
                  </th>
                  <td className="k-num py-2 pr-2">{shares[index]}%</td>
                  <td className={`py-2 pr-2 ${criterion.meanRating === null ? 'italic text-soft-text' : ''}`}>{ratingLabel(criterion.meanRating)}</td>
                  <td className="k-meta py-2">{criterion.ratingCount} rated{criterion.notAssessedCount > 0 ? `, ${criterion.notAssessedCount} not assessed` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {olderVersions.length > 0 && (
        <details className="mt-3">
          <summary className="k-meta cursor-pointer">Earlier rubric versions ({olderVersions.length})</summary>
          <ul className="mt-2 space-y-1">
            {olderVersions.map((version) => (
              <li key={version.rubricId} className="k-secondary">
                Version {version.rubricVersion}: {weightedRating(version.criteria) === null ? 'not assessed' : `${weightedRating(version.criteria)?.toFixed(1)} / 4.0`}, {version.coveragePercent}% covered, {version.submittedScorecards} scorecard{version.submittedScorecards === 1 ? '' : 's'}. Kept as scored.
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

type ScorecardFormProps = {
  rubric: Rubric;
  assessment: CandidateAssessment;
  existing: Scorecard | null;
  saving: boolean;
  disabled: boolean;
  onSave: (ratings: Record<string, RatingDraft>, summary: string, submit: boolean) => void;
};

/** One reviewer's ratings for one applicant on one rubric version. Key it by scorecard so it resets after a save. */
export function ScorecardForm({ rubric, assessment, existing, saving, disabled, onSave }: ScorecardFormProps) {
  const initial = useMemo(() => {
    const ratings: Record<string, RatingDraft> = {};
    rubric.criteria.forEach((criterion) => {
      ratings[criterion.id] = existing?.ratings[criterion.id] || { rating: null, evidence: '' };
    });
    return ratings;
  }, [rubric, existing]);
  const [ratings, setRatings] = useState(initial);
  const [summary, setSummary] = useState(existing?.summaryNotes || '');

  // Only the rating changes here. Per-question notes from older scorecards are not shown; they stay in `evidence` and are saved back unchanged.
  const update = (criterionId: string, patch: Partial<RatingDraft>) => {
    setRatings((current) => ({ ...current, [criterionId]: { ...current[criterionId], ...patch } }));
  };
  const shares = weightShares(rubric.criteria);
  const unrated = rubric.criteria.filter((criterion) => ratings[criterion.id]?.rating === null);
  const requiredUnrated = unrated.filter((criterion) => criterion.isRequired);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(ratings, summary, true);
      }}
    >
      <p className="k-secondary mb-3">
        Rate what you saw in each answer, not a general impression. Leave a criterion <strong>Not assessed</strong> when you have no evidence; that is different from a low rating.
      </p>
      {existing?.status === 'submitted' && <Banner tone="info" className="mb-3">You submitted this scorecard on {formatDateLabel((existing.submittedAt || existing.updatedAt).slice(0, 10))}. Changes are saved to the activity history.</Banner>}
      <ol className="space-y-4">
        {rubric.criteria.map((criterion, index) => {
          const answer = assessment.questions.find((item) => item.sourceCriterionId === criterion.id);
          const value = ratings[criterion.id] || { rating: null, evidence: '' };
          const name = `rating-${criterion.id}`;
          return (
            <li key={criterion.id} className="rounded-[12px] border border-bdr p-3">
              <fieldset disabled={disabled}>
                <legend className="k-label flex flex-wrap items-center gap-2">
                  {criterion.name}
                  {criterion.isRequired ? <span className="k-badge k-badge-info">Required</span> : <span className="k-badge k-badge-outline">Optional</span>}
                  <span className="k-meta">Weight {shares[index]}%</span>
                </legend>
                {criterion.description && <p className="k-secondary mt-1">{criterion.description}</p>}
                <div className="mt-3 space-y-2">
                  <div><p className="k-meta">Assessment Question</p><p className="k-secondary">{answer?.question || criterion.prompts[0] || 'No question recorded'}</p></div>
                  <div><p className="k-meta">Candidate Response</p><p className="k-body whitespace-pre-wrap rounded-[10px] bg-bg p-3">{answer?.response || 'No response provided.'}</p></div>
                </div>
                <p className="k-label mt-3">Your Rating</p>
                <div className="k-rating-group mt-3" role="radiogroup" aria-label={`Rating for ${criterion.name}`}>
                  {RATING_SCALE.map((option) => (
                    <label key={option.value} className="k-rating-option">
                      <input type="radio" name={name} checked={value.rating === option.value} onChange={() => update(criterion.id, { rating: option.value })} />
                      <span className="k-rating-value">{option.value}</span>
                      <span className="k-rating-text">
                        <span className="k-label block">{option.label}</span>
                        <span className="k-meta block">{criterion.anchors[option.value - 1] || ''}</span>
                      </span>
                    </label>
                  ))}
                  <label className="k-rating-option k-rating-na">
                    <input type="radio" name={name} checked={value.rating === null} onChange={() => update(criterion.id, { rating: null })} />
                    <span className="k-rating-value" aria-hidden="true">–</span>
                    <span className="k-rating-text">
                      <span className="k-label block">Not assessed</span>
                      <span className="k-meta block">No evidence yet. Not counted as a low rating.</span>
                    </span>
                  </label>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <label className="k-label mt-4 block" htmlFor="scorecard-summary">Assessment Notes (optional)</label>
      <textarea id="scorecard-summary" className="k-textarea mt-1" rows={3} maxLength={4000} value={summary} placeholder="Anything the team should know about this applicant" onChange={(event) => setSummary(event.target.value)} disabled={disabled} />
      <div className="mt-3 space-y-1" aria-live="polite">
        {requiredUnrated.length > 0 && <p className="k-meta">Required, not assessed yet: {requiredUnrated.map((criterion) => criterion.name).join(', ')}. You can still submit; the team score waits until someone assesses them.</p>}
      </div>
      <div className="k-button-row mt-3">
        <button className="k-btn k-btn-secondary" type="button" disabled={disabled || saving} onClick={() => onSave(ratings, summary, false)}>Save draft</button>
        <button className="k-btn k-btn-primary" type="submit" disabled={disabled || saving}>
          {existing?.status === 'submitted' ? 'Update scorecard' : 'Submit scorecard'}
        </button>
      </div>
    </form>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  stage_changed: 'Stage changed',
  assessment_sent: 'Candidate Assessment sent',
  assessment_submitted: 'Candidate Assessment submitted',
  scorecard_reviewed: 'Scorecard reviewed',
  candidate_moved_to_interviewing: 'Moved to Interviewing',
  candidate_declined: 'Candidate declined',
  scorecard_saved: 'Scorecard saved',
  scorecard_submitted: 'Scorecard submitted',
  rubric_saved: 'Rubric saved',
  rubric_versioned: 'Rubric changed (new version)',
};

export function AuditTrail({ entries, status, currentUserId }: { entries: AuditEntry[]; status: 'loading' | 'ready' | 'error'; currentUserId: string }) {
  if (status === 'loading') return <p className="k-secondary">Loading history…</p>;
  if (status === 'error') return <p className="k-secondary">History couldn't load.</p>;
  if (entries.length === 0) return <p className="k-secondary">No recorded changes yet.</p>;
  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const who = entry.details.actor_is_candidate ? 'Candidate' : !entry.actorUserId ? 'System' : entry.actorUserId === currentUserId ? 'You' : 'Another reviewer';
        const detail = entry.eventType === 'stage_changed'
          ? `${String(entry.details.from || '—')} → ${String(entry.details.to || '—')}${entry.details.rejection_reason && entry.details.to === 'rejected' ? ` · ${String(entry.details.rejection_reason)}` : ''}`
          : entry.details.created ? 'First version' : '';
        return (
          <li key={entry.id} className="border-l-2 border-bdr pl-3">
            <p className="k-label">{AUDIT_LABEL[entry.eventType] || entry.eventType}</p>
            {detail && <p className="k-secondary">{detail}</p>}
            <p className="k-meta">{who} · {new Date(entry.createdAt).toLocaleString()}</p>
          </li>
        );
      })}
    </ol>
  );
}
