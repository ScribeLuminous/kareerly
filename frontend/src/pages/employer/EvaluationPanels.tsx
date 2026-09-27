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

export function ProfileMatchPanel({ match, applyTimeRankingScore }: { match: ProfileMatch; applyTimeRankingScore: number | null }) {
  return (
    <section className="k-detail-section" aria-labelledby="profile-match-heading">
      <h3 id="profile-match-heading" className="k-label mb-1 flex items-center gap-1">
        Profile match
        <InfoTip label="How profile match is worked out">
          Profile match comes only from the application: the job's required skills that were found in the candidate's resume when they applied, divided by the number of required skills. It says nothing about skills the resume didn't mention, and it is not a prediction of job performance.
        </InfoTip>
      </h3>
      {match.percent === null ? (
        <p className="k-secondary">{match.required.length === 0 ? 'This job lists no required skills, so there is nothing to compare.' : 'The application recorded no skill evidence.'}</p>
      ) : (
        <>
          <p className="k-body">
            <strong>{match.found.length} of {match.required.length}</strong> required skills found in the application ({match.percent}%).
          </p>
          <ul className="mt-2 space-y-1" aria-label="Required skills">
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
      {applyTimeRankingScore !== null && (
        <p className="k-meta mt-2">
          The candidate's own match list ranked this job at {applyTimeRankingScore}% when they applied. That figure mixes resume text similarity with skill coverage and isn't used here.
        </p>
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
          From submitted team scorecards only. Each criterion's ratings (1 to 4) are averaged across reviewers, rescaled to 0–100 and weighted by the rubric. Criteria nobody assessed are left out, not counted as zero. No score is shown until every required criterion has at least one rating. Coverage is the share of rubric weight that has been assessed.
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
              <p className="k-meta">Score (rubric v{result.rubricVersion})</p>
              <p className="k-num text-[22px] font-bold leading-8 text-dark">{result.score === null ? 'Not published' : `${result.score} / 100`}</p>
              <p className="k-meta">{result.submittedScorecards} scorecard{result.submittedScorecards === 1 ? '' : 's'} submitted</p>
            </div>
            <div className="rounded-[10px] bg-bg px-3 py-2">
              <CoverageMeter percent={result.coveragePercent} label="Evaluation coverage" />
              <p className="k-meta mt-1">{result.requiredAssessed} of {result.requiredCount} required criteria assessed</p>
            </div>
          </div>
          {missing.length > 0 && <Banner tone="warn" className="mt-3">Score held back until these required criteria are assessed: {missing.join(', ')}. Missing evidence is not a low rating.</Banner>}
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
                Version {version.rubricVersion}: {version.score === null ? 'no published score' : `${version.score} / 100`}, {version.coveragePercent}% covered, {version.submittedScorecards} scorecard{version.submittedScorecards === 1 ? '' : 's'}. Kept as scored.
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
  existing: Scorecard | null;
  saving: boolean;
  disabled: boolean;
  onSave: (ratings: Record<string, RatingDraft>, summary: string, submit: boolean) => void;
};

/** One reviewer's ratings for one applicant on one rubric version. Key it by scorecard so it resets after a save. */
export function ScorecardForm({ rubric, existing, saving, disabled, onSave }: ScorecardFormProps) {
  const initial = useMemo(() => {
    const ratings: Record<string, RatingDraft> = {};
    rubric.criteria.forEach((criterion) => {
      ratings[criterion.id] = existing?.ratings[criterion.id] || { rating: null, evidence: '' };
    });
    return ratings;
  }, [rubric, existing]);
  const [ratings, setRatings] = useState(initial);
  const [summary, setSummary] = useState(existing?.summaryNotes || '');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const update = (criterionId: string, patch: Partial<RatingDraft>) => {
    setRatings((current) => ({ ...current, [criterionId]: { ...current[criterionId], ...patch } }));
    setTouched((current) => ({ ...current, [criterionId]: true }));
  };
  const shares = weightShares(rubric.criteria);
  const unrated = rubric.criteria.filter((criterion) => ratings[criterion.id]?.rating === null);
  const requiredUnrated = unrated.filter((criterion) => criterion.isRequired);
  const ratedWithoutEvidence = rubric.criteria.filter((criterion) => ratings[criterion.id]?.rating !== null && !ratings[criterion.id]?.evidence.trim());

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(ratings, summary, true);
      }}
    >
      <p className="k-secondary mb-3">
        Rate what you saw, not a general impression. Cite the evidence for each rating: an answer, a work sample, a reference. Leave a criterion <strong>Not assessed</strong> when you have no evidence; that is different from a low rating.
      </p>
      {existing?.status === 'submitted' && <Banner tone="info" className="mb-3">You submitted this scorecard on {formatDateLabel((existing.submittedAt || existing.updatedAt).slice(0, 10))}. Changes are saved to the activity history.</Banner>}
      <ol className="space-y-4">
        {rubric.criteria.map((criterion, index) => {
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
                {criterion.prompts.length > 0 && (
                  <div className="mt-2">
                    <p className="k-meta">Questions to ask</p>
                    <ul className="k-secondary ml-4 list-disc">{criterion.prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}</ul>
                  </div>
                )}
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
                <label className="k-meta mt-3 block" htmlFor={`evidence-${criterion.id}`}>Evidence</label>
                <textarea
                  id={`evidence-${criterion.id}`}
                  className="k-textarea mt-1"
                  rows={2}
                  maxLength={2000}
                  value={value.evidence}
                  placeholder={value.rating === null ? 'Optional: why this was not assessed' : 'What did the candidate say, show or produce?'}
                  onChange={(event) => update(criterion.id, { evidence: event.target.value })}
                  aria-invalid={touched[criterion.id] && value.rating !== null && !value.evidence.trim() ? true : undefined}
                />
              </fieldset>
            </li>
          );
        })}
      </ol>
      <label className="k-label mt-4 block" htmlFor="scorecard-summary">Overall notes</label>
      <textarea id="scorecard-summary" className="k-textarea mt-1" rows={3} maxLength={4000} value={summary} onChange={(event) => setSummary(event.target.value)} disabled={disabled} />
      <div className="mt-3 space-y-1" aria-live="polite">
        {requiredUnrated.length > 0 && <p className="k-meta">Required, not assessed yet: {requiredUnrated.map((criterion) => criterion.name).join(', ')}. You can still submit; the team score waits until someone assesses them.</p>}
        {ratedWithoutEvidence.length > 0 && <p className="k-meta text-amber">Add evidence for: {ratedWithoutEvidence.map((criterion) => criterion.name).join(', ')}.</p>}
      </div>
      <div className="k-button-row mt-3">
        <button className="k-btn k-btn-secondary" type="button" disabled={disabled || saving} onClick={() => onSave(ratings, summary, false)}>Save draft</button>
        <button className="k-btn k-btn-primary" type="submit" disabled={disabled || saving || ratedWithoutEvidence.length > 0}>
          {existing?.status === 'submitted' ? 'Update scorecard' : 'Submit scorecard'}
        </button>
      </div>
    </form>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  stage_changed: 'Stage changed',
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
