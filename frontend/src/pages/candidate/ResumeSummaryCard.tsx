import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { SkeletonRows } from '../../components/ui';
import type { ResumeFeedbackReason, ResumeSummary } from '../../types';

export type ResumeSummaryVote = { rating: 'yes' | 'not_quite'; reasons: ResumeFeedbackReason[]; comment: string };

const RESUME_FEEDBACK_REASONS: Array<{ value: ResumeFeedbackReason; label: string }> = [
  { value: 'missing_skills', label: 'Missing skills' },
  { value: 'wrong_experience_level', label: 'Wrong experience level' },
  { value: 'wrong_roles', label: 'Wrong roles' },
  { value: 'not_like_me', label: 'Does not sound like me' },
  { value: 'something_else', label: 'Something else' },
];
const COMMENT_LIMIT = 500;

type ResumeSummaryCardProps = {
  summary: ResumeSummary | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The saved answer for this resume version, if any. */
  vote: ResumeSummaryVote | null;
  saving: boolean;
  onVote: (vote: ResumeSummaryVote) => Promise<boolean>;
  onFixSkills: () => void;
};

export function ResumeSummaryCard({ summary, status, vote, saving, onVote, onFixSkills }: ResumeSummaryCardProps) {
  // 'ask' until answered; 'reasons' after "Not quite"; the thank-you shows once a vote is saved.
  const [step, setStep] = useState<'ask' | 'reasons' | null>(null);
  const [reasons, setReasons] = useState<ResumeFeedbackReason[]>(vote?.reasons || []);
  const [comment, setComment] = useState(vote?.comment || '');
  const current = step ?? (vote ? null : 'ask');

  if (status === 'loading' && !summary) {
    return (
      <section className="k-card" aria-label="Your resume at a glance">
        <SkeletonRows count={2} label="Loading your resume summary" />
      </section>
    );
  }
  if (!summary) return null;

  const submit = async (next: ResumeSummaryVote) => {
    if (await onVote(next)) setStep(null);
  };
  const toggleReason = (reason: ResumeFeedbackReason) => setReasons((list) => (
    list.includes(reason) ? list.filter((item) => item !== reason) : [...list, reason]));

  return (
    <section className="k-card k-resume-card" aria-labelledby="resume-glance">
      <h2 id="resume-glance" className="k-section-title">Your resume at a glance</h2>
      <p className="k-secondary mt-2">{summary.summary}</p>
      <dl className="k-glance mt-4">
        {summary.top_skills.length > 0 && (
          <div>
            <dt className="k-meta">Top skills</dt>
            <dd className="k-chip-row mt-1 gap-1.5">
              {summary.top_skills.map((skill) => <span key={skill} className="k-skill">{skill}</span>)}
            </dd>
          </div>
        )}
        <div>
          <dt className="k-meta">Experience level</dt>
          <dd className="k-label mt-0.5">
            {summary.experience_level.label}
            {summary.experience_level.value !== 'unset' && <span className="k-meta font-normal"> (your Step 3 answer)</span>}
          </dd>
        </div>
        {summary.best_fit_roles.length > 0 && (
          <div>
            <dt className="k-meta">{summary.roles_basis === 'fit_now' ? 'Best-fit roles' : 'Closest roles'}</dt>
            <dd className="k-label mt-0.5">{summary.best_fit_roles.join(', ')}</dd>
          </div>
        )}
      </dl>

      <div className="k-divider my-4" />
      {current === null && vote ? (
        <p className="k-secondary flex flex-wrap items-center gap-x-2 gap-y-1" role="status">
          <FontAwesomeIcon icon={faCircleCheck} className="text-green" aria-hidden="true" />
          Thanks for your feedback.
          <button
            className="k-link k-tap"
            type="button"
            onClick={() => {
              setReasons(vote.reasons);
              setComment(vote.comment);
              setStep('ask');
            }}
          >
            Change answer
          </button>
        </p>
      ) : current === 'ask' ? (
        <fieldset>
          <legend className="k-label">Does this sound like you?</legend>
          <div className="k-button-row mt-2">
            <button className="k-btn k-btn-secondary" type="button" disabled={saving} onClick={() => void submit({ rating: 'yes', reasons: [], comment: '' })}>Yes</button>
            <button className="k-btn k-btn-secondary" type="button" disabled={saving} onClick={() => setStep('reasons')}>Not quite</button>
          </div>
        </fieldset>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit({ rating: 'not_quite', reasons, comment: comment.trim() });
          }}
        >
          <fieldset>
            <legend className="k-label">What's off? Pick any that apply.</legend>
            <div className="k-chip-row mt-2" role="group" aria-label="Reasons">
              {RESUME_FEEDBACK_REASONS.map((reason) => (
                <button key={reason.value} className="k-chip" type="button" aria-pressed={reasons.includes(reason.value)} onClick={() => toggleReason(reason.value)}>
                  {reason.label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="k-field mt-3 block">
            <span className="k-label">Anything else? (optional)</span>
            <textarea
              className="k-textarea mt-1.5"
              rows={3}
              maxLength={COMMENT_LIMIT}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              aria-describedby="resume-feedback-note"
            />
            <span id="resume-feedback-note" className="k-meta mt-1 block">Kept with your account to improve these summaries. Don't include contact details.</span>
          </label>
          <div className="k-button-row mt-3">
            <button className="k-btn k-btn-primary" type="submit" disabled={saving}>Send feedback</button>
            <button className="k-btn k-btn-ghost" type="button" disabled={saving} onClick={() => setStep(vote ? null : 'ask')}>Cancel</button>
            <button className="k-link k-tap" type="button" onClick={onFixSkills}>Fix my skills instead</button>
          </div>
        </form>
      )}
    </section>
  );
}
