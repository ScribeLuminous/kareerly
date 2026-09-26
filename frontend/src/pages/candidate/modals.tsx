import type { EvidenceUploadRecord, EvidenceType } from '../../lib/evidence';
import { useState } from 'react';
import { faArrowLeft, faCircleCheck, faForward, faFileLines, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { formatFileSize } from '../../lib/fileUtils';
import type { MessageReportReason } from '../../lib/api';
import { RESUME_FILE_ACCEPT } from '../../lib/resumeFreshness';
import { UIIcon } from './icons';
import { MESSAGE_REPORT_REASONS, type EvidencePrefill } from './model';
import { FormField } from './common';

export function ResumeUpdateModal({
  step,
  postRefreshTarget,
  dragOver,
  file,
  readingWarnings,
  reviewSkills,
  skillInput,
  loading,
  actionError,
  onClose,
  onDragOver,
  onPickFile,
  onProcess,
  onBack,
  onReviewPreferencesPath,
  onSkip,
  onConfirm,
  onSkillInput,
  onAddSkill,
  onRemoveSkill,
}: {
  step: 'upload' | 'decision' | 'review';
  postRefreshTarget: 'dashboard' | 'preferences';
  dragOver: boolean;
  file: File | null;
  readingWarnings: string[];
  reviewSkills: string[];
  skillInput: string;
  loading: boolean;
  actionError: string;
  onClose: () => void;
  onDragOver: (value: boolean) => void;
  onPickFile: (file: File | null) => void;
  onProcess: () => void;
  onBack: () => void;
  onReviewPreferencesPath: () => void;
  onSkip: () => void;
  onConfirm: () => void | Promise<void>;
  onSkillInput: (value: string) => void;
  onAddSkill: () => void;
  onRemoveSkill: (skill: string) => void;
}) {
  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div>
            <div className="cand-modal-title">Update Resume</div>
            <div className="cand-modal-subtitle">Updating resume refreshes skills, matches, gaps, recommendations, and progress.</div>
          </div>
          <button className="cand-modal-close" type="button" onClick={onClose} aria-label="Close update resume">
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
          </button>
        </div>

        {actionError && <div className="cand-resume-action-error" role="alert">{actionError}</div>}

        {step === 'upload' && (
          <div>
            <label
              className={`cand-upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                onDragOver(true);
              }}
              onDragLeave={() => onDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                onDragOver(false);
                onPickFile(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              <input
                type="file"
                accept={RESUME_FILE_ACCEPT}
                className="hidden"
                onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
              />
              <UIIcon name="upload" className="cand-upload-icon" />
              <div className="mt-2 text-sm font-bold text-dark">Drag and drop your resume here</div>
              <div className="text-xs text-soft-text">PDF, DOCX or DOC · max 5MB</div>
            </label>

            {file && (
              <div className="cand-upload-file">
                <span className="text-2xl flex-shrink-0">
                  <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Long unbroken file names must wrap inside the modal instead of overflowing it. */}
                  <div className="text-sm font-bold [overflow-wrap:anywhere]">{file.name}</div>
                  <div className="text-xs mt-0.5">{formatFileSize(file.size)} · Ready for analysis</div>
                </div>
                <button
                  className="text-soft-text hover:text-red transition-colors text-xl px-1 flex-shrink-0"
                  type="button"
                  onClick={() => onPickFile(null)}
                  title="Remove"
                  aria-label="Remove resume"
                >
                  <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
                </button>
              </div>
            )}

            <div className="cand-notice warn mt-4">
              <span>Skill extraction works best on text-based PDF or Word files. Scanned resumes are read with text recognition (OCR), so check the extracted skills.</span>
            </div>

            <div className="cand-modal-actions">
              <button className="cand-btn-primary" type="button" disabled={loading} onClick={onProcess}>
                {loading ? 'Processing...' : 'Analyze Resume'}
              </button>
              <button className="cand-btn-secondary" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'decision' && (
          <div>
            {readingWarnings.map((warning) => (
              <div key={warning} className="cand-notice warn mb-3" role="status"><span>{warning}</span></div>
            ))}
            <div className="cand-notice info mb-3">
              <span>Review your skills and preferences, or apply the resume to your dashboard now.</span>
            </div>
            <div className="cand-modal-actions cand-resume-decision-actions">
              <button className="cand-btn-primary" type="button" disabled={loading} onClick={onReviewPreferencesPath}>
                <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
                <span>{loading ? 'Saving...' : 'Skills & Preferences'}</span>
              </button>
              <button className="cand-btn-secondary" type="button" disabled={loading} onClick={onSkip}>
                <FontAwesomeIcon icon={faForward} aria-hidden="true" />
                <span>{loading ? 'Applying...' : 'Skip & Apply'}</span>
              </button>
              <button className="cand-btn-secondary cand-resume-back-btn" type="button" disabled={loading} onClick={onBack} aria-label="Back to upload" title="Back to upload">
                <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div>
            <div className="cand-notice info mb-3">
              <span>Resume uploaded. Review and confirm detected skills before refreshing dashboard recommendations.</span>
            </div>
            <div className="text-sm font-bold text-dark">Detected Skills</div>
            <div className="text-xs text-soft-text">Click a skill to remove it from confirmation.</div>
            <div className="cand-skill-chip-grid">
              {reviewSkills.map((skill) => (
                <button key={skill} className="cand-skill-chip selected" type="button" onClick={() => onRemoveSkill(skill)}>
                  {skill} x
                </button>
              ))}
            </div>
            <div className="cand-skill-add-row">
              <input
                value={skillInput}
                onChange={(event) => onSkillInput(event.target.value)}
                placeholder="Add a missing skill..."
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onAddSkill();
                  }
                }}
              />
              <button className="cand-btn-secondary" type="button" onClick={onAddSkill}>
                Add Skill
              </button>
            </div>
            <div className="cand-notice info mt-3">
              <span>Confirming these skills refreshes job matches, skill gaps, upskilling recommendations, and Skill Development Progress.</span>
            </div>
            {postRefreshTarget === 'preferences' && (
              <div className="cand-notice info mt-3">
                <span>After confirmation, we will open Preferences so you can review and adjust your settings.</span>
              </div>
            )}
            <div className="cand-modal-actions">
              <button className="cand-btn-primary" type="button" disabled={loading} onClick={onConfirm}>
                {loading ? 'Refreshing...' : postRefreshTarget === 'preferences' ? 'Confirm and Open Preferences' : 'Confirm Skills and Refresh'}
              </button>
              <button className="cand-btn-secondary cand-modal-back" type="button" onClick={() => onBack()}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function EvidenceFormModal({
  loading,
  record,
  prefill,
  onClose,
  onSave,
}: {
  loading: boolean;
  record: EvidenceUploadRecord | null;
  prefill?: EvidencePrefill;
  onClose: () => void;
  onSave: (draft: {
    id?: string;
    title: string;
    evidenceType: EvidenceType;
    relatedSkill: string;
    category: string;
    notes?: string;
    file: File | null;
  }) => void;
}) {
  const [title, setTitle] = useState(record?.title || prefill?.title || '');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>(record?.evidenceType || prefill?.evidenceType || 'Certificate');
  const [relatedSkill, setRelatedSkill] = useState(record?.relatedSkill || prefill?.relatedSkill || '');
  // Derived from the related skill when saving; never asked of the candidate.
  const category = record?.category || prefill?.category || '';
  const [notes, setNotes] = useState(record?.notes || '');
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box lg" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div>
            <div className="cand-modal-title">{record ? 'Replace Evidence' : prefill ? 'Upload Proof of Completion' : 'Upload Evidence'}</div>
            <div className="cand-modal-subtitle">{prefill
              ? 'Add your certificate or completion proof to strengthen your profile. You can skip this and add it later.'
              : 'Pending verification is retained for new or replaced uploads.'}</div>
          </div>
          <button className="cand-modal-close" type="button" onClick={onClose}>
            x
          </button>
        </div>

        <div className="cand-form-grid">
          <FormField label="Evidence Title">
            <input className="cand-form-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Enter evidence title" />
          </FormField>
          <FormField label="Evidence Type">
            <select className="cand-form-select" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value as EvidenceType)}>
              {['Certificate', 'Course Completion', 'Portfolio', 'Project', 'Training', 'Other'].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Related Skill">
            <input className="cand-form-input" value={relatedSkill} onChange={(event) => setRelatedSkill(event.target.value)} placeholder="Enter related skill" />
          </FormField>
        </div>

        <FormField label="PDF Upload">
          <label className="cand-evidence-upload">
            <UIIcon name="upload" className="cand-upload-inline-icon" />
            <span>{file?.name || record?.fileName || 'Choose PDF evidence file'}</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
        </FormField>

        <FormField label="Optional Notes">
          <textarea className="cand-form-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add context for verification or skill relevance" />
        </FormField>

        <div className="cand-notice info">
          <span>PDF only. Uploaded evidence remains pending verification until independently reviewed.</span>
        </div>

        <div className="cand-modal-actions">
          <button
            className="cand-btn-primary"
            type="button"
            disabled={loading || !title.trim() || !relatedSkill.trim()}
            onClick={() => onSave({
              id: record?.id,
              title,
              evidenceType,
              relatedSkill,
              category,
              notes,
              file,
            })}
          >
            {loading ? 'Saving...' : record ? 'Replace Evidence' : 'Upload Evidence'}
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onClose}>
            {prefill ? 'Skip for now' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ApplicationSubmittedModal({
  onClose,
  onOpenApplications,
  onContinue,
}: {
  onClose: () => void;
  onOpenApplications: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="cand-modal-overlay" onClick={onClose}>
      <div className="cand-modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div>
            <div className="cand-modal-title">Application Submitted</div>
            <div className="cand-modal-subtitle">Your application has been sent successfully.</div>
          </div>
          <button className="cand-modal-close" type="button" onClick={onClose}>
            x
          </button>
        </div>
        <div className="cand-notice info">
          <span>You can track its progress from the Applications page.</span>
        </div>
        <div className="cand-modal-actions">
          <button className="cand-btn-primary" type="button" onClick={onOpenApplications}>
            Go to Applications
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onContinue}>
            Continue Browsing Jobs
          </button>
        </div>
      </div>
    </div>
  );
}


export function ReportConversationModal({
  company,
  alreadyBlocked,
  onCancel,
  onSubmit,
}: {
  company: string;
  alreadyBlocked: boolean;
  onCancel: () => void;
  onSubmit: (reason: MessageReportReason, details: string, alsoBlock: boolean) => Promise<void>;
}) {
  const [reason, setReason] = useState<MessageReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(!alreadyBlocked);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="cand-modal-overlay" onClick={onCancel}>
      <div className="cand-modal-box" role="dialog" aria-modal="true" aria-labelledby="report-conversation-title" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div>
            <div id="report-conversation-title" className="cand-modal-title">Report {company}</div>
            <div className="cand-modal-subtitle">Reports are reviewed by the Kareerly team. {company} is not told who reported them.</div>
          </div>
          <button className="cand-modal-close" type="button" onClick={onCancel} aria-label="Close">
            x
          </button>
        </div>
        <FormField label="Reason">
          <select className="cand-form-select" value={reason} onChange={(event) => setReason(event.target.value as MessageReportReason)}>
            <option value="" disabled>Choose a reason</option>
            {MESSAGE_REPORT_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        <FormField label="Details (optional)">
          <textarea className="cand-form-input" rows={3} maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="What happened?" />
        </FormField>
        {!alreadyBlocked && (
          <label className="flex items-center gap-2 text-sm text-mid">
            <input type="checkbox" checked={alsoBlock} onChange={(event) => setAlsoBlock(event.target.checked)} />
            Also block {company}
          </label>
        )}
        <div className="cand-modal-actions">
          <button
            className="cand-btn-danger"
            type="button"
            disabled={!reason || submitting}
            onClick={() => {
              if (!reason) return;
              setSubmitting(true);
              void onSubmit(reason, details.trim(), alsoBlock && !alreadyBlocked).finally(() => setSubmitting(false));
            }}
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  description,
  footnote,
  danger,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  footnote?: string;
  danger?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="cand-modal-overlay" onClick={onCancel}>
      <div className="cand-modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="cand-modal-header">
          <div className={`cand-modal-title ${danger ? 'text-red' : ''}`}>{title}</div>
          <button className="cand-modal-close" type="button" onClick={onCancel}>
            x
          </button>
        </div>
        <div className={`cand-notice ${danger ? 'error' : 'info'}`}>
          <span>{description}</span>
        </div>
        {footnote && <p className="text-sm text-soft-text">{footnote}</p>}
        <div className="cand-modal-actions">
          <button className={danger ? 'cand-btn-danger' : 'cand-btn-primary'} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="cand-btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
