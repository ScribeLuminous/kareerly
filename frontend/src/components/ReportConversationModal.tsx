import { useState } from 'react';
import { FormField, Modal } from './ui';
import { MESSAGE_REPORT_REASONS, type MessageReportReason } from '../lib/api';

/** Report a message thread to the Kareerly team; used by candidates and employers. */
export function ReportConversationModal({
  name,
  alreadyBlocked,
  onCancel,
  onSubmit,
}: {
  /** Who is being reported, as the reporter sees them (a company or a candidate ID). */
  name: string;
  alreadyBlocked: boolean;
  onCancel: () => void;
  onSubmit: (reason: MessageReportReason, details: string, alsoBlock: boolean) => Promise<void>;
}) {
  const [reason, setReason] = useState<MessageReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(!alreadyBlocked);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal
      title={`Report ${name}`}
      subtitle={`The Kareerly team reviews reports. ${name} isn't told who reported them.`}
      onClose={onCancel}
      footer={(
        <>
          <button className="k-btn k-btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          <button
            className="k-btn k-btn-danger"
            type="button"
            disabled={!reason || submitting}
            onClick={() => {
              if (!reason) return;
              setSubmitting(true);
              void onSubmit(reason, details.trim(), alsoBlock && !alreadyBlocked).finally(() => setSubmitting(false));
            }}
          >
            {submitting ? 'Sending…' : 'Send report'}
          </button>
        </>
      )}
    >
      <FormField label="Reason">
        <select className="k-select" value={reason} onChange={(event) => setReason(event.target.value as MessageReportReason)} data-autofocus>
          <option value="" disabled>Choose a reason</option>
          {MESSAGE_REPORT_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </FormField>
      <FormField label="Details (optional)">
        <textarea className="k-textarea min-h-[88px]" maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="What happened?" />
      </FormField>
      {!alreadyBlocked && (
        <label className="mt-4 flex min-h-[44px] items-center gap-3">
          <input className="h-5 w-5 accent-rust" type="checkbox" checked={alsoBlock} onChange={(event) => setAlsoBlock(event.target.checked)} />
          <span className="k-secondary">Also block {name}</span>
        </label>
      )}
    </Modal>
  );
}
