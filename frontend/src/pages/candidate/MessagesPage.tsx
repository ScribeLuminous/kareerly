import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faBan, faComments, faEllipsisVertical, faFlag, faLock, faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { Banner, EmptyState, Menu } from '../../components/ui';
import type { MessageModerationState } from '../../lib/api';
import { ApplicationsHeader, type ApplicationsTab } from './ApplicationsPage';
import type { DashboardApplication, MessageRequestState } from './model';

type MessagesPageProps = {
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
  onTab: (tab: ApplicationsTab) => void;
  messageCount: number;
  isDesktop: boolean;
  /** Set when a refresh failed; the last loaded messages stay on screen. */
  loadError?: string;
};

const stateBadge: Record<MessageRequestState, string> = {
  Pending: 'k-badge k-badge-high',
  Accepted: 'k-badge k-badge-success',
  Declined: 'k-badge k-badge-outline',
  Ignored: 'k-badge k-badge-outline',
};

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
  onTab,
  messageCount,
  isDesktop,
  loadError,
}: MessagesPageProps) {
  const [threadOpen, setThreadOpen] = useState(false);
  const selected = applications.find((app) => app.jobId === selectedJobId) || null;
  const selectedModeration = selected ? moderation[selected.id] : undefined;
  const state: MessageRequestState = selected ? requestStates[selected.jobId] || 'Pending' : 'Pending';
  const threadReplies = selected ? replies[selected.jobId] || [] : [];
  const showList = isDesktop || !threadOpen;
  const showThread = Boolean(selected) && (isDesktop || threadOpen);

  return (
    <div className="k-page">
      <ApplicationsHeader tab="messages" onTab={onTab} messageCount={messageCount} />
      <div id="applications-panel" role="tabpanel" aria-labelledby="applications-tab-messages">
        {loadError && <Banner tone="error" className="mb-4">{loadError}</Banner>}
        {applications.length === 0 ? (
          <EmptyState icon={faComments} title="No messages yet" text="Employers can message you once your application reaches Interviewing." />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            {showList && (
              <ul className="k-list self-start" aria-label="Conversations">
                {applications.map((app) => {
                  const appState = requestStates[app.jobId] || 'Pending';
                  return (
                    <li key={app.id}>
                      <button
                        className="k-row"
                        type="button"
                        aria-current={isDesktop && selectedJobId === app.jobId ? 'true' : undefined}
                        onClick={() => { onSelect(app.jobId); setThreadOpen(true); }}
                      >
                        <span className="k-row-main">
                          <span className="k-label block truncate">{app.company}</span>
                          <span className="k-meta mt-0.5 block truncate">{app.jobTitle} · {app.status}</span>
                        </span>
                        <span className={stateBadge[appState]}>{appState === 'Pending' ? 'New request' : appState}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {showThread && selected && (
              <section className="k-card flex min-h-[420px] flex-col p-0" aria-label={`Conversation with ${selected.company}`}>
                <header className="flex items-center gap-1 border-b border-bdr py-2 pl-2 pr-1 lg:pl-5">
                  {!isDesktop && (
                    <button className="k-icon-btn" type="button" onClick={() => setThreadOpen(false)} aria-label="Back to conversations">
                      <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1 py-1">
                    <h2 className="k-item-title truncate">{selected.company}</h2>
                    <p className="k-meta truncate">{selected.jobTitle} · {selected.status}</p>
                  </div>
                  <Menu
                    label={`Conversation options for ${selected.company}`}
                    trigger={<FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />}
                    items={[
                      {
                        label: selectedModeration?.reported_by_me ? 'Reported' : 'Report',
                        icon: faFlag,
                        disabled: Boolean(selectedModeration?.reported_by_me),
                        hint: selectedModeration?.reported_by_me ? 'You already reported this conversation.' : undefined,
                        onSelect: () => onReport(selected),
                      },
                      selectedModeration?.blocked_by_me
                        ? { label: 'Unblock', icon: faBan, onSelect: () => onUnblock(selected) }
                        : { label: 'Block', icon: faBan, danger: true, onSelect: () => onBlock(selected) },
                    ]}
                  />
                </header>

                <div className="flex-1 space-y-3 overflow-y-auto p-4 lg:p-5" aria-live="polite">
                  <div className="rounded-[10px] bg-cream p-3">
                    <p className="k-meta mb-1">Message request</p>
                    <p className="k-body">{requestTexts[selected.jobId] || 'The employer’s message will appear here.'}</p>
                  </div>
                  {state === 'Accepted' && threadReplies.map((reply, index) => (
                    <div
                      key={`${selected.jobId}-${index}`}
                      className={`max-w-[85%] rounded-[12px] px-3 py-2 ${reply.from === 'candidate' ? 'ml-auto bg-forest text-white' : 'bg-bg text-dark'}`}
                    >
                      <p className="text-[12px] font-semibold opacity-80">{reply.from === 'employer' ? selected.company : 'You'}</p>
                      <p className="text-[15px] leading-[22px] [overflow-wrap:anywhere]">{reply.text}</p>
                      <p className="mt-1 text-[12px] opacity-80">{reply.time}</p>
                    </div>
                  ))}
                  {selectedModeration?.blocked && (
                    <p className="k-secondary flex items-center gap-2"><FontAwesomeIcon icon={faLock} aria-hidden="true" />
                      {selectedModeration.blocked_by_me ? `You blocked ${selected.company}. Unblock them to message again.` : 'Messaging is unavailable for this conversation.'}
                    </p>
                  )}
                  {state === 'Declined' && <p className="k-secondary">You declined this request.</p>}
                  {state === 'Ignored' && <p className="k-secondary">You ignored this request.</p>}
                </div>

                {state === 'Pending' && !selectedModeration?.blocked ? (
                  <div className="border-t border-bdr p-4 lg:px-5">
                    <p className="k-secondary mb-3">Accept to reply. Your application isn't affected either way.</p>
                    <div className="k-button-row">
                      <button className="k-btn k-btn-primary" type="button" onClick={onAccept}>Accept</button>
                      <button className="k-btn k-btn-secondary" type="button" onClick={onDecline}>Decline</button>
                      <button className="k-btn k-btn-ghost" type="button" onClick={onIgnore}>Ignore</button>
                    </div>
                  </div>
                ) : (
                  <form
                    className="flex items-end gap-2 border-t border-bdr p-3 lg:px-5"
                    onSubmit={(event) => { event.preventDefault(); if (canReply && draft.trim()) onSend(); }}
                  >
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Reply to {selected.company}</span>
                      <textarea
                        className="k-textarea min-h-[44px]"
                        rows={1}
                        placeholder={canReply ? 'Write a reply…' : 'Replies are turned off for this conversation.'}
                        value={draft}
                        disabled={!canReply}
                        onChange={(event) => onDraftChange(event.target.value)}
                      />
                    </label>
                    <button className="k-btn k-btn-primary w-11 px-0" type="submit" disabled={!canReply || !draft.trim()} aria-label="Send message">
                      <FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" />
                    </button>
                  </form>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
