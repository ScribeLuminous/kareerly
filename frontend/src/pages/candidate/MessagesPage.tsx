import type { MessageModerationState } from '../../lib/api';
import { stateToClass, type DashboardApplication, type MessageRequestState } from './model';
import { UIIcon } from './icons';

export function MessagesPage({
  applications,
  selectedJobId,
  requestStates,
  requestTexts,
  replies,
  draft,
  onSelect,
  onAccept,
  onDecline,
  onIgnore,
  onDraftChange,
  onSend,
  canReply,
  moderation,
  onReport,
  onBlock,
  onUnblock,
}: {
  applications: DashboardApplication[];
  selectedJobId: string;
  requestStates: Record<string, MessageRequestState>;
  requestTexts: Record<string, string>;
  replies: Record<string, Array<{ from: 'employer' | 'candidate'; text: string; time: string }>>;
  draft: string;
  onSelect: (jobId: string) => void;
  onAccept: () => void;
  onDecline: () => void;
  onIgnore: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  canReply: boolean;
  moderation: Record<string, MessageModerationState>;
  onReport: (app: DashboardApplication) => void;
  onBlock: (app: DashboardApplication) => void;
  onUnblock: (app: DashboardApplication) => void;
}) {
  const selected = applications.find((app) => app.jobId === selectedJobId) || null;
  const selectedModeration = selected ? moderation[selected.id] : undefined;
  const state = selected ? requestStates[selected.jobId] || 'Pending' : 'Pending';
  const threadReplies = selected ? replies[selected.jobId] || [] : [];

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Messages</h1>
        <p className="cand-page-subtitle">Interview-stage message requests from employers</p>
      </div>

      <div className="cand-notice info">
        <span>
          In-app messaging becomes available only when an employer moves an applicant to Interviewing or Hired stage. Employer initiates the first request. Candidate may accept, decline, or ignore, and can reply only after accepting.
        </span>
      </div>

      <div className="cand-msg-layout">
        <div className="cand-msg-list">
          <div className="cand-two-panel-left-hd">Conversations</div>
          {applications.length > 0 ? (
            applications.map((app) => (
              <button key={app.id} className={`cand-msg-item ${selectedJobId === app.jobId ? 'active' : ''}`} type="button" onClick={() => onSelect(app.jobId)}>
                <div className="text-sm font-bold text-dark">{app.company}</div>
                <div className="text-xs text-soft-text">{app.jobTitle} · {app.status}</div>
                <span className={`cand-msg-badge ${stateToClass(requestStates[app.jobId] || 'Pending')}`}>{requestStates[app.jobId] || 'Pending'}</span>
              </button>
            ))
          ) : (
            <div className="p-4 text-sm text-soft-text">No eligible Interviewing/Hired applications yet.</div>
          )}
        </div>

        <div className="cand-msg-panel">
          {selected ? (
            <>
              <div className="cand-msg-thread-header">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-dark">{selected.company}</h4>
                  <p className="text-xs text-soft-text">{selected.jobTitle} · {selected.status} stage</p>
                </div>
                <div className="cand-msg-thread-actions">
                  <button
                    className="cand-msg-action"
                    type="button"
                    onClick={() => onReport(selected)}
                    disabled={selectedModeration?.reported_by_me}
                    title={selectedModeration?.reported_by_me ? 'You already reported this conversation' : `Report ${selected.company}`}
                    aria-label={`Report ${selected.company}`}
                  >
                    <UIIcon name="flag" /><span>{selectedModeration?.reported_by_me ? 'Reported' : 'Report'}</span>
                  </button>
                  {selectedModeration?.blocked_by_me ? (
                    <button className="cand-msg-action" type="button" onClick={() => onUnblock(selected)} aria-label={`Unblock ${selected.company}`} title={`Unblock ${selected.company}`}>
                      <UIIcon name="ban" /><span>Unblock</span>
                    </button>
                  ) : (
                    <button className="cand-msg-action danger" type="button" onClick={() => onBlock(selected)} aria-label={`Block ${selected.company}`} title={`Block ${selected.company}`}>
                      <UIIcon name="ban" /><span>Block</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="cand-msg-body">
                <div className="cand-msg-request">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.5px] text-rust">Employer Message Request</div>
                  <div className="text-sm text-mid">{requestTexts[selected.jobId] || 'Message request content will appear here.'}</div>
                </div>

                {state === 'Pending' && (
                  <>
                    <div className="cand-msg-lock">You can only reply after accepting this message request.</div>
                    <div className="flex flex-wrap gap-2">
                      <button className="cand-btn-primary" type="button" onClick={onAccept}>
                        Accept
                      </button>
                      <button className="cand-btn-secondary" type="button" onClick={onDecline}>
                        Decline
                      </button>
                      <button className="cand-btn-secondary" type="button" onClick={onIgnore}>
                        Ignore
                      </button>
                    </div>
                  </>
                )}

                {selectedModeration?.blocked && (
                  <div className="cand-msg-lock">
                    {selectedModeration.blocked_by_me
                      ? `You blocked ${selected.company}. Messaging is disabled until you unblock them.`
                      : 'Messaging is unavailable for this conversation.'}
                  </div>
                )}
                {state === 'Declined' && <div className="cand-msg-lock">Request declined. Reply is disabled.</div>}
                {state === 'Ignored' && <div className="cand-msg-lock">Request ignored. Reply is disabled.</div>}
                {state === 'Accepted' && (
                  <>
                    <div className="text-sm font-semibold text-green">Request accepted. You can now reply.</div>
                    {threadReplies.map((reply, index) => (
                      <div key={`${selected.jobId}-${index}`} className={reply.from === 'employer' ? 'msg-bubble-employer' : 'msg-bubble-candidate'}>
                        <div className="msg-bubble-sender">{reply.from === 'employer' ? 'Employer' : 'You'}</div>
                        <div>{reply.text}</div>
                        <div className="msg-bubble-time">{reply.time}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="cand-msg-composer">
                <textarea
                  className="cand-msg-input"
                  placeholder={canReply ? 'Type your reply...' : selectedModeration?.blocked ? 'Messaging is blocked for this conversation.' : 'Reply is disabled until request is accepted.'}
                  value={draft}
                  disabled={!canReply}
                  onChange={(event) => onDraftChange(event.target.value)}
                />
                <button className="cand-msg-send" type="button" disabled={!canReply} onClick={onSend} aria-label="Send message" title="Send message">
                  <UIIcon name="paper-plane" />
                </button>
              </div>
            </>
          ) : (
            <div className="cand-empty m-4">No message threads available.</div>
          )}
        </div>
      </div>
    </div>
  );
}

