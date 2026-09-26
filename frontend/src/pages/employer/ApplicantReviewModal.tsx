import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faComments, faEyeSlash, faLock } from '@fortawesome/free-solid-svg-icons';
import { Banner, InfoTip, Modal } from '../../components/ui';
import {
  applicantTitle,
  candidateStatusBadgeClass,
  formatDateLabel,
  getMatchBucket,
  jobLocation,
  MATCH_BAND_LABEL,
  matchBandBadgeClass,
  shouldRevealIdentity,
  type CandidateApplication,
  type EmployerJob,
  type ReviewAction,
} from './model';

type ApplicantReviewModalProps = {
  candidate: CandidateApplication;
  job: EmployerJob | null;
  onClose: () => void;
  onAction: (action: ReviewAction, candidateId: string) => void;
  onSendRequest: (candidateId: string) => void;
  onOpenMessages: (candidateId: string) => void;
};

/** The next status moves an employer can make, most likely first. */
function StatusActions({ candidate, onAction, onSendRequest, onOpenMessages }: Omit<ApplicantReviewModalProps, 'job' | 'onClose'>) {
  const { status, id } = candidate;
  // Phones: the main action full width, the rest side by side.
  const row = 'grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*:first-child]:col-span-2 [&>*:last-child:nth-child(even)]:col-span-2';
  if (status === 'Hired' || status === 'Rejected' || status === 'Withdrawn') {
    return (
      <p className="k-secondary flex items-center gap-2">
        <FontAwesomeIcon icon={faLock} aria-hidden="true" />
        {status === 'Withdrawn' ? 'Withdrawn by the candidate. This record is read-only.' : `${status} is final. No further changes.`}
      </p>
    );
  }
  const reject = <button className="k-btn k-btn-danger-outline" type="button" onClick={() => onAction('rejected', id)}>Reject</button>;
  if (status === 'Pending') {
    return (
      <div className={row}>
        <button className="k-btn k-btn-primary" type="button" onClick={() => onAction('interviewing', id)}>Move to Interviewing</button>
        <button className="k-btn k-btn-secondary" type="button" onClick={() => onAction('shortlisted', id)}>Shortlist</button>
        {reject}
      </div>
    );
  }
  if (status === 'Shortlisted') {
    return (
      <div className={row}>
        <button className="k-btn k-btn-primary" type="button" onClick={() => onAction('interviewing', id)}>Move to Interviewing</button>
        {reject}
      </div>
    );
  }
  return (
    <div className={row}>
      {candidate.messageRequestState === 'none' ? (
        <button className="k-btn k-btn-primary" type="button" onClick={() => onSendRequest(id)}>
          <FontAwesomeIcon icon={faComments} aria-hidden="true" />Send message request
        </button>
      ) : (
        <button className="k-btn k-btn-secondary" type="button" onClick={() => onOpenMessages(id)}>
          <FontAwesomeIcon icon={faComments} aria-hidden="true" />{candidate.messageRequestState === 'accepted' ? 'Open messages' : 'View request'}
        </button>
      )}
      <button className="k-btn k-btn-secondary" type="button" onClick={() => onAction('hired', id)}>Mark as hired</button>
      {reject}
    </div>
  );
}

export function ApplicantReviewModal({ candidate, job, onClose, onAction, onSendRequest, onOpenMessages }: ApplicantReviewModalProps) {
  const bucket = getMatchBucket(candidate.matchPercent, candidate.hasMatchScore);
  const revealed = shouldRevealIdentity(candidate.status);
  const total = candidate.matchedSkills.length + candidate.missingSkills.length;
  const facts = [
    { label: 'Candidate ID', value: candidate.publicId || 'Not available' },
    { label: 'Applied', value: formatDateLabel(candidate.appliedDate) },
    { label: 'Job', value: job ? [job.title, jobLocation(job)].filter(Boolean).join(' · ') : candidate.role },
    ...(revealed ? [{ label: 'Location', value: candidate.location }] : []),
  ].filter((fact) => fact.value);
  const analysis = [
    { label: 'Strength', text: candidate.strengthNote },
    { label: 'Gap', text: candidate.gapNote },
    { label: 'Recommendation', text: candidate.recommendation },
  ].filter((item) => item.text?.trim());

  return (
    <Modal
      title={applicantTitle(candidate)}
      subtitle={<span className="k-dot-sep">{revealed && candidate.publicId && <span>{candidate.publicId}</span>}<span>{candidate.role}</span></span>}
      onClose={onClose}
      size="lg"
      fullOnMobile
      closeStyle="back"
      closeLabel="Close applicant review"
      footer={(
        <div className="w-full">
          <StatusActions candidate={candidate} onAction={onAction} onSendRequest={onSendRequest} onOpenMessages={onOpenMessages} />
          <p className="k-meta mt-2">Kareerly supports your decision; the hiring call is yours.</p>
        </div>
      )}
    >
      {candidate.status === 'Withdrawn' && <Banner tone="warn" className="mb-4">The candidate withdrew this application. It can't be moved or messaged.</Banner>}

      <div className="flex flex-wrap items-center gap-2">
        {candidate.hasMatchScore && <span className="k-score k-score-lg">{candidate.matchPercent}%</span>}
        <span className={matchBandBadgeClass(bucket)}>{MATCH_BAND_LABEL[bucket]}</span>
        <span className={candidateStatusBadgeClass(candidate.status)}>{candidate.status}</span>
        <InfoTip label="About match bands">Top is 90% or more, Good is 75–89%, Partial is below 75%. Bands are a review aid, not a decision.</InfoTip>
      </div>

      {!revealed && (
        <p className="k-secondary mt-3 flex items-start gap-2">
          <FontAwesomeIcon icon={faEyeSlash} className="mt-1 shrink-0" aria-hidden="true" />
          Name, age, gender and contact details stay hidden until you move this applicant to Interviewing.
        </p>
      )}

      {total > 0 && (
        <section className="k-detail-section" aria-label="Skill fit">
          <h3 className="k-label mb-2">
            <FontAwesomeIcon icon={faCheck} className="mr-1.5 text-green" aria-hidden="true" />
            {candidate.matchedSkills.length} of {total} required skills
          </h3>
          {candidate.matchedSkills.length > 0 && (
            <div className="k-chip-row gap-1.5">{candidate.matchedSkills.map((skill) => <span key={`have-${skill}`} className="k-skill k-skill-have">{skill}</span>)}</div>
          )}
          {candidate.missingSkills.length > 0 && (
            <>
              <p className="k-meta mb-1.5 mt-3">Missing</p>
              <div className="k-chip-row gap-1.5">{candidate.missingSkills.map((skill) => <span key={`miss-${skill}`} className="k-skill k-skill-missing">{skill}</span>)}</div>
            </>
          )}
        </section>
      )}

      {(analysis.length > 0 || candidate.matchSummary) && (
        <section className="k-detail-section" aria-label="Match analysis">
          <h3 className="k-label mb-2">Match analysis</h3>
          {candidate.matchSummary && <p className="k-body">{candidate.matchSummary}</p>}
          {analysis.length > 0 && (
            <dl className="mt-3 space-y-3">
              {analysis.map((item) => (
                <div key={item.label}>
                  <dt className="k-meta">{item.label}</dt>
                  <dd className="k-body">{item.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      <section className="k-detail-section" aria-label="Details">
        <h3 className="k-label mb-2">Details</h3>
        <dl className="k-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Modal>
  );
}
