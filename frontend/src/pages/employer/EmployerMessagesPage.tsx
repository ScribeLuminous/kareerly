import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faBan, faComments, faEllipsisVertical, faFlag, faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { EmptyState, InfoTip, Menu, PageHeader, SearchField } from '../../components/ui';
import { applicantTitle, candidateDisplayName, type CandidateApplication } from './model';

type EmployerMessagesPageProps = {
  threads: CandidateApplication[];
  selected: CandidateApplication | null;
  draftRequestId: string;
  companyName: string;
  draft: string;
  canSend: boolean;
  isDesktop: boolean;
  onSelect: (candidateId: string) => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onBlock: (candidate: CandidateApplication) => void;
  onReport: (candidate: CandidateApplication) => void;
  onOpenCandidates: () => void;
};

function threadState(candidate: CandidateApplication, draftRequestId: string): { label: string; badge: string } {
  if (candidate.id === draftRequestId && candidate.messageRequestState === 'none') return { label: 'Draft', badge: 'k-badge k-badge-outline' };
  if (candidate.messageRequestState === 'accepted') return { label: 'Accepted', badge: 'k-badge k-badge-success' };
  return { label: 'Awaiting reply', badge: 'k-badge k-badge-high' };
}

export function EmployerMessagesPage({
  threads,
  selected,
  draftRequestId,
  companyName,
  draft,
  canSend,
  isDesktop,
  onSelect,
  onDraftChange,
  onSend,
  onBlock,
  onReport,
  onOpenCandidates,
}: EmployerMessagesPageProps) {
  const [threadOpen, setThreadOpen] = useState(Boolean(draftRequestId));
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((candidate) => [candidate.publicId, candidateDisplayName(candidate), candidate.role, candidate.status].join(' ').toLowerCase().includes(query));
  }, [search, threads]);
  const showList = isDesktop || !threadOpen;
  const showThread = Boolean(selected) && (isDesktop || threadOpen);
  const isDraft = Boolean(selected && selected.id === draftRequestId && selected.messageRequestState === 'none');
  const name = selected ? applicantTitle(selected) : '';

  return (
    <div className="k-page">
      <PageHeader title="Messages">
        <p className="k-secondary mt-1 flex items-center gap-1">
          Interviewing candidates only.
          <InfoTip label="How messaging works" align="left">
            Move an applicant to Interviewing, then send a message request. The thread opens once they accept. Pending, Shortlisted, Rejected and Withdrawn applicants can't be messaged.
          </InfoTip>
        </p>
      </PageHeader>

      {threads.length === 0 ? (
        <EmptyState
          icon={faComments}
          title="No conversations yet"
          text="Open an applicant in Interviewing and send a message request to start one."
          actions={<button className="k-btn k-btn-secondary" type="button" onClick={onOpenCandidates}>Review candidates</button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          {showList && (
            <div className="min-w-0 self-start">
              {threads.length > 5 && (
                <div className="mb-3"><SearchField value={search} onChange={setSearch} label="Search conversations" placeholder="Search ID or role" /></div>
              )}
              {visible.length === 0 ? (
                <p className="k-secondary">No conversations match.</p>
              ) : (
                <ul className="k-list" aria-label="Conversations">
                  {visible.map((candidate) => {
                    const state = threadState(candidate, draftRequestId);
                    return (
                      <li key={candidate.id}>
                        <button
                          className="k-row"
                          type="button"
                          aria-current={isDesktop && selected?.id === candidate.id ? 'true' : undefined}
                          onClick={() => { onSelect(candidate.id); setThreadOpen(true); }}
                        >
                          <span className="k-row-main">
                            <span className="k-label block truncate">{applicantTitle(candidate)}</span>
                            <span className="k-meta mt-0.5 block truncate">{candidate.role} · {candidate.status}</span>
                          </span>
                          <span className={state.badge}>{state.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {showThread && selected && (
            <section className="k-card flex min-h-[420px] flex-col p-0" aria-label={`Conversation with ${name}`}>
              <header className="flex items-center gap-1 border-b border-bdr py-2 pl-2 pr-1 lg:pl-5">
                {!isDesktop && (
                  <button className="k-icon-btn" type="button" onClick={() => setThreadOpen(false)} aria-label="Back to conversations">
                    <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
                  </button>
                )}
                <div className="min-w-0 flex-1 py-1">
                  <h2 className="k-item-title truncate">{name}</h2>
                  <p className="k-meta k-dot-sep truncate">{selected.publicId && selected.publicId !== name && <span>{selected.publicId}</span>}<span>{selected.role}</span></p>
                </div>
                <Menu
                  label={`Conversation options for ${name}`}
                  trigger={<FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />}
                  items={[
                    { label: 'Report', icon: faFlag, onSelect: () => onReport(selected) },
                    { label: 'Block', icon: faBan, danger: true, onSelect: () => onBlock(selected) },
                  ]}
                />
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto p-4 lg:p-5" aria-live="polite">
                {isDraft && (
                  <div className="rounded-[10px] bg-cream p-3">
                    <p className="k-label">Write your message request</p>
                    <p className="k-secondary mt-0.5">It's sent when you press Send. The candidate can accept or decline.</p>
                  </div>
                )}
                {selected.messageRequestState === 'pending' && (
                  <div className="rounded-[10px] bg-cream p-3">
                    <p className="k-label">Request sent</p>
                    <p className="k-secondary mt-0.5">You can reply once {name} accepts.</p>
                  </div>
                )}
                {selected.messages.map((entry, index) => (
                  <div
                    key={`${selected.id}-${index}`}
                    className={`max-w-[85%] rounded-[12px] px-3 py-2 ${entry.from === 'employer' ? 'ml-auto bg-forest text-white' : 'bg-bg text-dark'}`}
                  >
                    <p className="text-[12px] font-semibold opacity-80">{entry.from === 'employer' ? `${companyName} (you)` : name}</p>
                    <p className="whitespace-pre-wrap text-[15px] leading-[22px] [overflow-wrap:anywhere]">{entry.text}</p>
                    <p className="mt-1 text-[12px] opacity-80">{entry.time}</p>
                  </div>
                ))}
              </div>

              <form
                className="flex items-end gap-2 border-t border-bdr p-3 lg:px-5"
                onSubmit={(event) => { event.preventDefault(); if (canSend && draft.trim()) onSend(); }}
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{isDraft ? `Message request to ${name}` : `Message ${name}`}</span>
                  <textarea
                    className="k-textarea min-h-[44px]"
                    rows={isDraft ? 3 : 1}
                    placeholder={canSend ? (isDraft ? 'Write your message request…' : 'Write a message…') : 'Waiting for the candidate to accept.'}
                    value={draft}
                    disabled={!canSend}
                    onChange={(event) => onDraftChange(event.target.value)}
                  />
                </label>
                <button className="k-btn k-btn-primary w-11 px-0" type="submit" disabled={!canSend || !draft.trim()} aria-label={isDraft ? 'Send message request' : 'Send message'}>
                  <FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" />
                </button>
              </form>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
