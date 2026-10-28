import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faClipboardCheck, faComments, faEyeSlash, faLock } from '@fortawesome/free-solid-svg-icons';
import { Banner, ConfirmDialog, Tabs } from '../../components/ui';
import {
  isEvaluationUnavailable,
  loadApplicationEvaluation,
  loadAuditTrail,
  loadScorecards,
  saveScorecard,
  type AuditEntry,
} from '../../lib/evaluationApi';
import { Modal } from '../../components/ui';
import { logAssessmentLinkOpened, assessmentDueDateProblem, assessmentDueState, assessmentStatusLabel, defaultAssessmentDueDate, dueDateToTimestamp, dueDayOf, extendAssessmentDeadline, formatAssessmentDue, loadAssessments, sendAssessment, type CandidateAssessment } from '../../lib/assessmentApi';
import { AssessmentDeadlineField } from './AssessmentDeadlineField';
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
function StatusActions({ candidate, assessment, onAction, onSendRequest, onOpenMessages }: Pick<ApplicantReviewModalProps, 'candidate' | 'onAction' | 'onSendRequest' | 'onOpenMessages'> & { assessment: CandidateAssessment | null }) {
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
        <button className="k-btn k-btn-secondary" type="button" onClick={() => onAction('shortlisted', id)}>Shortlist and send assessment</button>
      </div>
    );
  }
  if (status === 'Shortlisted') {
    // Declining for no response is only open once the deadline has passed with nothing submitted.
    if (assessment?.status === 'pending' && assessment.dueAt) {
      const due = formatAssessmentDue(assessment.dueAt);
      return assessmentDueState(assessment) === 'overdue' ? (
        <div className="space-y-2">
          <p className="k-secondary">The deadline passed on {due} with no submission. Extend it below to give more time, or decline.</p>
          <div className={row}>{reject}</div>
        </div>
      ) : (
        <p className="k-secondary">The candidate has until {due} (Philippine time) to respond. You can decline for not responding after that, or extend the deadline below.</p>
      );
    }
    if (assessment?.status !== 'reviewed') return <p className="k-secondary">Review the submitted Candidate Assessment and scorecard before choosing a decision.</p>;
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
  const [assessment, setAssessment] = useState<CandidateAssessment | null>(null);
  const [sending, setSending] = useState(false);
  // Deadline for the assessment about to be sent (7 day default), and for an extension.
  const [sendDueDate, setSendDueDate] = useState(() => defaultAssessmentDueDate());
  const [extendDate, setExtendDate] = useState('');
  const [extending, setExtending] = useState(false);
  // Sending an assessment, changing its deadline and submitting a scorecard can't be taken back, so each is confirmed.
  const [confirming, setConfirming] = useState<'send' | 'extend' | 'scorecard' | null>(null);
  const [pendingScorecard, setPendingScorecard] = useState<{ ratings: Record<string, RatingDraft>; summary: string } | null>(null);
  const [assessmentVersion, setAssessmentVersion] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = () => void loadAssessments([candidate.id]).then((rows) => { if (mounted) setAssessment(rows.get(candidate.id) || null); }).catch(() => { if (mounted) setAssessment(null); });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [candidate.id, assessmentVersion]);
  const extend = async () => {
    if (!assessment) return;
    setExtending(true);
    try {
      await extendAssessmentDeadline(assessment.id, dueDateToTimestamp(extendDate));
      onToast('Deadline extended. The candidate has been notified.', 'success');
      setExtendDate('');
      setAssessmentVersion((value) => value + 1);
      onEvaluationChanged();
    } catch (error) { onToast(error instanceof Error ? error.message : 'Unable to extend the deadline.', 'danger'); }
    finally { setExtending(false); }
  };
  const send = async () => {
    const problem = assessmentDueDateProblem(sendDueDate);
    if (problem) { onToast(problem, 'warn'); return; }
    setSending(true);
    try {
      await sendAssessment(candidate.id, dueDateToTimestamp(sendDueDate));
      onToast('Candidate Assessment sent.', 'success');
      setAssessmentVersion((value) => value + 1);
      onEvaluationChanged();
    } catch (error) { onToast(error instanceof Error ? error.message : 'Unable to send assessment.', 'danger'); }
    finally { setSending(false); }
  };

  const currentRubric = rubrics[0] || null;
  const reviewRubric = assessment ? rubrics.find((item) => item.id === assessment.rubricId) || null : null;
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
  const currentResult = versions.find((version) => version.rubricId === reviewRubric?.id) || null;
  const shownResult = currentResult || versions[0] || null;
  const olderVersions = versions.filter((version) => version !== shownResult);
  const myCurrentCard = reviewRubric ? scorecards.find((card) => card.rubricId === reviewRubric.id && card.reviewerUserId === currentUserId) || null : null;
  const myOlderCards = scorecards.filter((card) => card.reviewerUserId === currentUserId && card.rubricId !== reviewRubric?.id);
  const action = candidate.status === 'Shortlisted' && assessment?.status === 'pending'
    ? { label: 'Awaiting candidate response', detail: 'The candidate can save a draft and submit when ready.' }
    : (candidate.status === 'Shortlisted' || candidate.status === 'Interviewing') && !assessment && !evaluationUnavailable
      ? { label: currentRubric ? 'Send Assessment' : 'Configure Assessment', detail: currentRubric ? "The candidate hasn't received the assessment yet." : 'Set up the questions for this job first.' }
      : candidate.status === 'Pending'
        ? { label: 'Shortlist to send the assessment', detail: 'Shortlisting sends the Candidate Assessment to the applicant.' }
      : nextAction(candidate.status, candidate.messageRequestState, currentResult, Boolean(reviewRubric), myCurrentCard?.status === 'submitted');

  // Links opened so far, from the activity history plus any opened since it loaded.
  const [openedNow, setOpenedNow] = useState<Set<string>>(new Set());
  const openedLinks = new Set([
    ...audit.filter((entry) => entry.eventType === 'assessment_link_opened').map((entry) => String(entry.details.url || '')),
    ...openedNow,
  ]);
  const openLink = (url: string) => {
    if (!assessment) return;
    setOpenedNow((current) => new Set(current).add(url));
    void logAssessmentLinkOpened(assessment.id, url)
      .then(() => setReloadKey((value) => value + 1))
      .catch((error) => console.warn('Unable to record the opened link:', error));
  };

  const save = async (ratings: Record<string, RatingDraft>, summary: string, submit: boolean) => {
    if (!reviewRubric || !assessment || !['submitted', 'reviewed'].includes(assessment.status)) return;
    setSaving(true);
    try {
      await saveScorecard({ applicationId: candidate.id, rubricId: reviewRubric.id, ratings, summary, submit });
      onToast(submit ? 'Scorecard submitted.' : 'Draft saved.', 'success');
      setReloadKey((value) => value + 1);
      onEvaluationChanged();
      if (submit) { setTab('evidence'); setAssessmentVersion((value) => value + 1); }
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
          <StatusActions candidate={candidate} assessment={assessment} onAction={onAction} onSendRequest={onSendRequest} onOpenMessages={onOpenMessages} />
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
        {!closed && !evaluationUnavailable && assessment && ['submitted', 'reviewed'].includes(assessment.status) && (
          reviewRubric ? (
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

      <section className="k-detail-section mt-4" aria-labelledby="candidate-assessment-heading">
        <h3 id="candidate-assessment-heading" className="k-label">Candidate Assessment</h3>
        <p className="k-secondary mt-1">{assessment ? assessmentStatusLabel(assessment) : currentRubric ? 'Not sent' : 'No assessment has been configured for this job.'}</p>
        {!assessment && (candidate.status === 'Shortlisted' || candidate.status === 'Interviewing') && (currentRubric ?
          <div className="mt-2 max-w-xs">
            <AssessmentDeadlineField value={sendDueDate} onChange={setSendDueDate} />
            <button className="k-btn k-btn-primary k-btn-sm mt-2" type="button" disabled={sending || Boolean(assessmentDueDateProblem(sendDueDate))} onClick={() => setConfirming('send')}>Send Assessment</button>
          </div> :
          <button className="k-btn k-btn-secondary k-btn-sm mt-2" type="button" onClick={() => job && onEditRubric(job.id)}>Configure Assessment</button>)}
        {assessment?.status === 'pending' && !closed && (
          <div className="mt-2 max-w-xs">
            <AssessmentDeadlineField label="Extend deadline to" value={extendDate} onChange={setExtendDate} />
            <button
              className="k-btn k-btn-secondary k-btn-sm mt-2"
              type="button"
              disabled={extending || !extendDate || Boolean(assessmentDueDateProblem(extendDate)) || (assessment.dueAt !== null && extendDate <= dueDayOf(assessment.dueAt))}
              onClick={() => setConfirming('extend')}
            >Extend deadline</button>
          </div>
        )}
        {assessment?.status === 'submitted' && <button className="k-btn k-btn-secondary k-btn-sm mt-2" type="button" onClick={() => setTab('scorecard')}>Review Assessment</button>}
        {assessment?.status === 'reviewed' && <button className="k-btn k-btn-secondary k-btn-sm mt-2" type="button" onClick={() => setTab('scorecard')}>View Scorecard</button>}
      </section>

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
                hasRubric={Boolean(reviewRubric)}
                isCurrentVersion={!shownResult || shownResult.rubricId === reviewRubric?.id}
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
          ) : !assessment || assessment.status === 'pending' ? (
            <p className="k-secondary">The candidate must submit their assessment before the scorecard can be reviewed.</p>
          ) : !reviewRubric ? (
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
                  You also scored this applicant on rubric version{myOlderCards.length > 1 ? 's' : ''} {myOlderCards.map((card) => rubrics.find((rubric) => rubric.id === card.rubricId)?.version || '?').join(', ')}. Those stay as they were; this scorecard uses version {reviewRubric.version}.
                </Banner>
              )}
              <ScorecardForm key={`${reviewRubric.id}-${myCurrentCard?.id || 'new'}-${myCurrentCard?.updatedAt || ''}`} rubric={reviewRubric} assessment={assessment} existing={myCurrentCard} saving={saving} disabled={closed && !myCurrentCard} openedLinks={openedLinks} onLinkOpened={openLink} onSave={(ratings, summary, submit) => {
                // The first submission marks the assessment reviewed and opens the decision, so it is confirmed; later edits are not.
                if (submit && myCurrentCard?.status !== 'submitted') { setPendingScorecard({ ratings, summary }); setConfirming('scorecard'); return; }
                void save(ratings, summary, submit);
              }} />
            </>
          )
        )}

        {tab === 'history' && <AuditTrail entries={audit} status={evaluationUnavailable ? 'ready' : loadStatus} currentUserId={currentUserId} />}
      </div>
      {confirming === 'send' && (
        <ConfirmDialog
          title="Send the Candidate Assessment?"
          message={`${applicantTitle(candidate)} will be notified and has until ${sendDueDate} (end of day, Philippine time) to answer. You can't unsend it.`}
          confirmLabel="Send assessment"
          busy={sending}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => { setConfirming(null); await send(); }}
        />
      )}
      {confirming === 'extend' && (
        <ConfirmDialog
          title="Extend the deadline?"
          message={`The candidate will be notified that they now have until ${extendDate} (end of day, Philippine time). A deadline can only be moved later, so you can't shorten it afterwards.`}
          confirmLabel="Extend deadline"
          busy={extending}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => { setConfirming(null); await extend(); }}
        />
      )}
      {confirming === 'scorecard' && pendingScorecard && (
        <ConfirmDialog
          title="Submit your scorecard?"
          message={`Submitting marks the assessment as reviewed and opens the decision on this applicant. You can still update your scorecard later; changes are kept in the activity history.`}
          confirmLabel="Submit scorecard"
          busy={saving}
          onCancel={() => { setConfirming(null); setPendingScorecard(null); }}
          onConfirm={async () => {
            const card = pendingScorecard;
            setConfirming(null);
            setPendingScorecard(null);
            await save(card.ratings, card.summary, true);
          }}
        />
      )}
    </Modal>
  );
}
