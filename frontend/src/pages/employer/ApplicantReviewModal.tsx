import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faClipboardCheck, faComments, faEyeSlash, faLock } from '@fortawesome/free-solid-svg-icons';
import { Banner, Tabs } from '../../components/ui';
import {
  isEvaluationUnavailable,
  loadApplicationEvaluation,
  loadAuditTrail,
  loadScorecards,
  saveScorecard,
  type AuditEntry,
} from '../../lib/evaluationApi';
import { Modal } from '../../components/ui';
import { AuditTrail, ProfileMatchPanel, ReviewedEvaluationPanel, ScorecardForm } from './EvaluationPanels';
import { nextAction, profileMatch, type ApplicationEvaluation, type RatingDraft, type Rubric, type Scorecard } from './evaluation';
import {
  applicantTitle,
  candidateStatusBadgeClass,
  formatDateLabel,
  jobLocation,
  shouldRevealIdentity,
  type CandidateApplication,
  type EmployerJob,
  type ReviewAction,
} from './model';

type ReviewTab = 'evidence' | 'scorecard' | 'history';

type ApplicantReviewModalProps = {
  candidate: CandidateApplication;
  job: EmployerJob | null;
  /** This job's rubric versions, newest first. */
  rubrics: Rubric[];
  currentUserId: string;
  position: { index: number; total: number } | null;
  evaluationUnavailable: boolean;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  onAction: (action: ReviewAction, candidateId: string) => void;
  onSendRequest: (candidateId: string) => void;
  onOpenMessages: (candidateId: string) => void;
  onEditRubric: (jobId: string) => void;
  onEvaluationChanged: () => void;
  onToast: (message: string, type?: '' | 'success' | 'warn' | 'danger') => void;
};

/** The stage moves open to the reviewer. Scores never move anyone. */
function StatusActions({ candidate, onAction, onSendRequest, onOpenMessages }: Pick<ApplicantReviewModalProps, 'candidate' | 'onAction' | 'onSendRequest' | 'onOpenMessages'>) {
  const { status, id } = candidate;
  const row = 'grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*:last-child:nth-child(odd)]:col-span-2';
  if (status === 'Hired' || status === 'Rejected' || status === 'Withdrawn') {
    return (
      <p className="k-secondary flex items-center gap-2">
        <FontAwesomeIcon icon={faLock} aria-hidden="true" />
        {status === 'Withdrawn' ? 'Withdrawn by the candidate. This record is read-only.' : `${status} is final. No further changes.`}
      </p>
    );
  }
  const reject = <button className="k-btn k-btn-danger-outline" type="button" onClick={() => onAction('rejected', id)}>Decline</button>;
  if (status === 'Pending') {
    return (
      <div className={row}>
        <button className="k-btn k-btn-secondary" type="button" onClick={() => onAction('shortlisted', id)}>Shortlist</button>
        <button className="k-btn k-btn-secondary" type="button" onClick={() => onAction('interviewing', id)}>Move to Interviewing</button>
        {reject}
      </div>
    );
  }
  if (status === 'Shortlisted') {
    return (
      <div className={row}>
        <button className="k-btn k-btn-secondary" type="button" onClick={() => onAction('interviewing', id)}>Move to Interviewing</button>
        {reject}
      </div>
    );
  }
  return (
    <div className={row}>
      {candidate.messageRequestState === 'none' ? (
        <button className="k-btn k-btn-secondary" type="button" onClick={() => onSendRequest(id)}>
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

export function ApplicantReviewModal({
  candidate,
  job,
  rubrics,
  currentUserId,
  position,
  evaluationUnavailable,
  onPrevious,
  onNext,
  onClose,
  onAction,
  onSendRequest,
  onOpenMessages,
  onEditRubric,
  onEvaluationChanged,
  onToast,
}: ApplicantReviewModalProps) {
  const [tab, setTab] = useState<ReviewTab>('evidence');
  // Loaded data is tagged with the applicant it belongs to, so stepping to
  // another applicant never shows the previous one's scorecards.
  const [data, setData] = useState<{ forId: string; status: 'ready' | 'error'; evaluation: ApplicationEvaluation | null; scorecards: Scorecard[]; audit: AuditEntry[] } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const currentRubric = rubrics[0] || null;
  const revealed = shouldRevealIdentity(candidate.status);
  const profile = profileMatch(candidate, job);
  const closed = ['Hired', 'Rejected', 'Withdrawn'].includes(candidate.status);

  useEffect(() => {
    if (evaluationUnavailable) return;
    let isMounted = true;
    Promise.all([loadApplicationEvaluation(candidate.id), loadScorecards(candidate.id), loadAuditTrail(candidate.id)])
      .then(([evaluation, scorecards, audit]) => {
        if (isMounted) setData({ forId: candidate.id, status: 'ready', evaluation, scorecards, audit });
      })
      .catch((error) => {
        console.warn('Unable to load the evaluation:', error);
        if (isMounted) setData({ forId: candidate.id, status: isEvaluationUnavailable(error) ? 'ready' : 'error', evaluation: null, scorecards: [], audit: [] });
      });
    return () => { isMounted = false; };
  }, [candidate.id, candidate.status, evaluationUnavailable, reloadKey]);

  const current = data?.forId === candidate.id ? data : null;
  const loadStatus: 'loading' | 'ready' | 'error' = evaluationUnavailable ? 'ready' : current ? current.status : 'loading';
  const evaluation = current?.evaluation || null;
  const scorecards = current?.scorecards || [];
  const audit = current?.audit || [];
  const versions = evaluation?.versions || [];
  const currentResult = versions.find((version) => version.rubricId === currentRubric?.id) || null;
  const shownResult = currentResult || versions[0] || null;
  const olderVersions = versions.filter((version) => version !== shownResult);
  const myCurrentCard = currentRubric ? scorecards.find((card) => card.rubricId === currentRubric.id && card.reviewerUserId === currentUserId) || null : null;
  const myOlderCards = scorecards.filter((card) => card.reviewerUserId === currentUserId && card.rubricId !== currentRubric?.id);
  const action = nextAction(candidate.status, candidate.messageRequestState, currentResult, Boolean(currentRubric), myCurrentCard?.status === 'submitted');

  const save = async (ratings: Record<string, RatingDraft>, summary: string, submit: boolean) => {
    if (!currentRubric) return;
    setSaving(true);
    try {
      await saveScorecard({ applicationId: candidate.id, rubricId: currentRubric.id, ratings, summary, submit });
      onToast(submit ? 'Scorecard submitted.' : 'Draft saved.', 'success');
      setReloadKey((value) => value + 1);
      onEvaluationChanged();
      if (submit) setTab('evidence');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Unable to save the scorecard.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const facts = [
    { label: 'Candidate ID', value: candidate.publicId || 'Not available' },
    { label: 'Job', value: job ? [job.title, jobLocation(job)].filter(Boolean).join(' · ') : candidate.role },
    { label: 'Applied', value: formatDateLabel(candidate.appliedDate) },
    { label: 'Last activity', value: candidate.lastActivity ? formatDateLabel(candidate.lastActivity.slice(0, 10)) : '' },
    ...(revealed ? [{ label: 'Location', value: candidate.location }] : []),
  ].filter((fact) => fact.value);

  return (
    <Modal
      title={applicantTitle(candidate)}
      subtitle={<span className="k-dot-sep">{revealed && candidate.publicId && <span>{candidate.publicId}</span>}<span>{candidate.role}</span></span>}
      onClose={onClose}
      size="lg"
      fullOnMobile
      closeStyle="back"
      closeLabel="Back to applicants"
      headerActions={position && position.total > 1 ? (
        <div className="flex items-center gap-1" role="group" aria-label="Move between applicants">
          <button className="k-icon-btn" type="button" onClick={onPrevious || undefined} disabled={!onPrevious} aria-label="Previous applicant">
            <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
          </button>
          <span className="k-meta k-num whitespace-nowrap" aria-live="polite">{position.index + 1} of {position.total}</span>
          <button className="k-icon-btn" type="button" onClick={onNext || undefined} disabled={!onNext} aria-label="Next applicant">
            <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
          </button>
        </div>
      ) : undefined}
      footer={(
        <div className="w-full">
          <p className="k-label mb-2">Decision</p>
          <StatusActions candidate={candidate} onAction={onAction} onSendRequest={onSendRequest} onOpenMessages={onOpenMessages} />
          <p className="k-meta mt-2">Scores and matches don't move anyone. The team decides, from the evidence.</p>
        </div>
      )}
    >
      {candidate.status === 'Withdrawn' && <Banner tone="warn" className="mb-4">The candidate withdrew this application. It can't be moved or messaged.</Banner>}

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[12px] bg-bg p-3">
        <div>
          <p className="k-meta">Stage</p>
          <span className={candidateStatusBadgeClass(candidate.status)}>{candidate.status}</span>
        </div>
        <div className="min-w-[12rem] flex-1">
          <p className="k-meta">Next step</p>
          <p className="k-label">{action.label}</p>
          <p className="k-secondary">{action.detail}</p>
        </div>
        {!closed && !evaluationUnavailable && (
          currentRubric ? (
            <button className="k-btn k-btn-primary k-btn-sm w-full sm:w-auto" type="button" onClick={() => setTab('scorecard')}>
              <FontAwesomeIcon icon={faClipboardCheck} aria-hidden="true" />{myCurrentCard ? 'Your scorecard' : 'Start scorecard'}
            </button>
          ) : job && (
            <button className="k-btn k-btn-secondary k-btn-sm w-full sm:w-auto" type="button" onClick={() => onEditRubric(job.id)}>Set up rubric</button>
          )
        )}
      </div>

      {!revealed && (
        <p className="k-secondary mt-3 flex items-start gap-2">
          <FontAwesomeIcon icon={faEyeSlash} className="mt-1 shrink-0" aria-hidden="true" />
          Name, age, gender and contact details stay hidden until you move this applicant to Interviewing.
        </p>
      )}

      <div className="mt-4">
        <Tabs<ReviewTab>
          label="Applicant review"
          idPrefix="review"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'evidence', label: 'Evidence' },
            { id: 'scorecard', label: 'Your scorecard' },
            { id: 'history', label: 'History', count: audit.length || undefined },
          ]}
        />
      </div>

      <div id="review-panel" role="tabpanel" aria-labelledby={`review-tab-${tab}`} className="pt-2">
        {tab === 'evidence' && (
          <>
            <ProfileMatchPanel match={profile} applyTimeRankingScore={candidate.applyTimeRankingScore} />
            {evaluationUnavailable ? (
              <section className="k-detail-section"><p className="k-secondary">Reviewed evaluation isn't available on this database yet.</p></section>
            ) : loadStatus === 'loading' ? (
              <section className="k-detail-section"><p className="k-secondary">Loading reviewed evaluation…</p></section>
            ) : loadStatus === 'error' ? (
              <section className="k-detail-section"><p className="k-secondary">The reviewed evaluation couldn't load. Try again shortly.</p></section>
            ) : (
              <ReviewedEvaluationPanel
                result={shownResult}
                olderVersions={olderVersions}
                hasRubric={Boolean(currentRubric)}
                isCurrentVersion={!shownResult || shownResult.rubricId === currentRubric?.id}
              />
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
          </>
        )}

        {tab === 'scorecard' && (
          evaluationUnavailable ? (
            <p className="k-secondary">Scorecards aren't available on this database yet.</p>
          ) : !currentRubric ? (
            <div className="space-y-3">
              <p className="k-secondary">This job has no rubric yet. Set the criteria first so every reviewer rates the same things.</p>
              {job && <button className="k-btn k-btn-primary" type="button" onClick={() => onEditRubric(job.id)}>Set up rubric</button>}
            </div>
          ) : loadStatus === 'loading' ? (
            <p className="k-secondary">Loading your scorecard…</p>
          ) : (
            <>
              {myOlderCards.length > 0 && (
                <Banner tone="info" className="mb-3">
                  You also scored this applicant on rubric version{myOlderCards.length > 1 ? 's' : ''} {myOlderCards.map((card) => rubrics.find((rubric) => rubric.id === card.rubricId)?.version || '?').join(', ')}. Those stay as they were; this scorecard uses version {currentRubric.version}.
                </Banner>
              )}
              <ScorecardForm key={`${currentRubric.id}-${myCurrentCard?.id || 'new'}-${myCurrentCard?.updatedAt || ''}`} rubric={currentRubric} existing={myCurrentCard} saving={saving} disabled={closed && !myCurrentCard} onSave={(ratings, summary, submit) => void save(ratings, summary, submit)} />
            </>
          )
        )}

        {tab === 'history' && <AuditTrail entries={audit} status={evaluationUnavailable ? 'ready' : loadStatus} currentUserId={currentUserId} />}
      </div>
    </Modal>
  );
}
