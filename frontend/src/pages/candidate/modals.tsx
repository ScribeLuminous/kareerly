import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faCircleInfo, faFileLines, faForward, faSliders, faUpload, faXmark } from '@fortawesome/free-solid-svg-icons';
import { Banner, Modal } from '../../components/ui';
import type { EvidenceUploadRecord, EvidenceType } from '../../lib/evidence';
import { formatFileSize } from '../../lib/fileUtils';
import { RESUME_FILE_ACCEPT } from '../../lib/resumeFreshness';
import { EMPLOYER_CHECK_REMINDER, type EvidencePrefill } from './model';
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
  const title = step === 'upload' ? 'Update resume' : step === 'decision' ? 'Resume read' : 'Check your skills';
  const footer = step === 'upload' ? (
    <>
      <button className="k-btn k-btn-ghost" type="button" onClick={onClose}>Cancel</button>
      <button className="k-btn k-btn-primary" type="button" disabled={loading || !file} onClick={onProcess}>
        {loading ? 'Reading resume…' : 'Analyze resume'}
      </button>
    </>
  ) : step === 'decision' ? (
    <>
      <button className="k-btn k-btn-ghost k-modal-footer-start" type="button" disabled={loading} onClick={onBack} aria-label="Back to upload" title="Back to upload">
        <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
      </button>
      <button className="k-btn k-btn-secondary" type="button" disabled={loading} onClick={onSkip}>
        <FontAwesomeIcon icon={faForward} aria-hidden="true" />
        <span>{loading ? 'Applying…' : 'Skip & Apply'}</span>
      </button>
      <button className="k-btn k-btn-primary" type="button" disabled={loading} onClick={onReviewPreferencesPath}>
        <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
        <span>{loading ? 'Saving…' : 'Skills & Preferences'}</span>
      </button>
    </>
  ) : (
    <>
      <button className="k-btn k-btn-ghost k-modal-footer-start" type="button" onClick={() => onBack()}>Back</button>
      <button className="k-btn k-btn-primary" type="button" disabled={loading} onClick={() => void onConfirm()}>
        {loading ? 'Refreshing…' : postRefreshTarget === 'preferences' ? 'Confirm and open Preferences' : 'Confirm and refresh'}
      </button>
    </>
  );

  return (
    <Modal title={title} onClose={onClose} footer={footer} fullOnMobile={step === 'review'}>
      {actionError && <Banner tone="error">{actionError}</Banner>}
      {step === 'upload' && (
        <div>
          <label
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-[12px] border-2 border-dashed px-4 py-8 text-center transition-colors ${dragOver ? 'border-rust bg-rust-l' : 'border-soft bg-bg hover:border-rust'}`}
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
            <input type="file" accept={RESUME_FILE_ACCEPT} className="sr-only" onChange={(event) => onPickFile(event.target.files?.[0] ?? null)} />
            <FontAwesomeIcon icon={faUpload} className="h-6 w-6 text-rust" aria-hidden="true" />
            <span className="k-label">Choose a file or drop it here</span>
            <span className="k-meta">PDF, DOCX or DOC · up to 5 MB · text-based files read best</span>
          </label>
          {file && (
            <div className="mt-3 flex items-center gap-3 rounded-[10px] bg-green-l px-3 py-2 text-green">
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {/* Long unbroken file names must wrap inside the modal instead of overflowing it. */}
                <div className="k-label text-green [overflow-wrap:anywhere]">{file.name}</div>
                <div className="k-meta text-green">{formatFileSize(file.size)}</div>
              </div>
              <button className="k-icon-btn text-green" type="button" onClick={() => onPickFile(null)} aria-label="Remove resume">
                <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
      {step === 'decision' && (
        <div>
          {readingWarnings.map((warning) => <Banner key={warning} tone="warn">{warning}</Banner>)}
          <p className="k-secondary">Review your skills and preferences first, or apply the new resume to your matches now.</p>
        </div>
      )}
      {step === 'review' && (
        <div>
          <p className="k-secondary mb-3">Remove any skill that isn't yours, or add one we missed. Confirming refreshes your matches.</p>
          <ul className="k-chip-row gap-1.5" aria-label="Detected skills">
            {reviewSkills.map((skill) => (
              <li key={skill}>
                <span className="k-skill pr-1">
                  {skill}
                  <button className="inline-flex h-8 w-8 items-center justify-center rounded-full text-mid hover:bg-cream-d hover:text-dark" type="button" onClick={() => onRemoveSkill(skill)} aria-label={`Remove ${skill}`}>
                    <FontAwesomeIcon icon={faXmark} className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Add a skill</span>
              <input
                className="k-input"
                value={skillInput}
                onChange={(event) => onSkillInput(event.target.value)}
                placeholder="Add a skill"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onAddSkill();
                  }
                }}
              />
            </label>
            <button className="k-btn k-btn-secondary" type="button" onClick={onAddSkill} disabled={!skillInput.trim()}>Add</button>
          </div>
        </div>
      )}
    </Modal>
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
    credentialUrl?: string;
  }) => void;
}) {
  const [title, setTitle] = useState(record?.title || prefill?.title || '');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>(record?.evidenceType || prefill?.evidenceType || 'Certificate');
  const [relatedSkill, setRelatedSkill] = useState(record?.relatedSkill || prefill?.relatedSkill || '');
  // Derived from the related skill when saving; never asked of the candidate.
  const category = record?.category || prefill?.category || '';
  const [notes, setNotes] = useState(record?.notes || '');
  const [file, setFile] = useState<File | null>(null);
  const [credentialUrl, setCredentialUrl] = useState(record?.credentialUrl || '');
  const hasProof = Boolean(file || credentialUrl.trim() || record?.fileName || record?.credentialUrl);
  return (
    <Modal
      title={record ? 'Replace proof' : prefill ? 'Add proof (optional)' : 'Upload proof'}
      subtitle={prefill ? 'You can skip this and add it later.' : undefined}
      onClose={onClose}
      fullOnMobile
      footer={(
        <>
          <button className="k-btn k-btn-ghost" type="button" onClick={onClose}>{prefill ? 'Skip for now' : 'Cancel'}</button>
          <button
            className="k-btn k-btn-primary"
            type="button"
            disabled={loading || !title.trim() || !relatedSkill.trim() || !hasProof}
            onClick={() => onSave({ id: record?.id, title, evidenceType, relatedSkill, category, notes, file, credentialUrl })}
          >
            {loading ? 'Saving…' : record ? 'Replace' : 'Upload'}
          </button>
        </>
      )}
    >
      {prefill && !record && (
        <p className="k-banner k-banner-info mb-4" role="note">
          <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />
          <span className="k-banner-body">Proof is not required to mark this done. {EMPLOYER_CHECK_REMINDER}</span>
        </p>
      )}
      <div className="k-form-grid">
        <FormField label="Title" className="k-span-2">
          <input className="k-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. SQL for Data Analysis certificate" />
        </FormField>
        <FormField label="Type">
          <select className="k-select" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value as EvidenceType)}>
            {['Certificate', 'Course Completion', 'Portfolio', 'Project', 'Training', 'Other'].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Related skill">
          <input className="k-input" value={relatedSkill} onChange={(event) => setRelatedSkill(event.target.value)} />
        </FormField>
        <div className="k-field k-span-2">
          <span className="k-label">PDF file (optional if you add a link)</span>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[8px] border border-dashed border-soft bg-bg px-3 py-2 hover:border-rust">
            <FontAwesomeIcon icon={faUpload} className="text-rust" aria-hidden="true" />
            <span className="k-secondary min-w-0 flex-1 [overflow-wrap:anywhere]">{file?.name || record?.fileName || 'Choose a PDF'}</span>
            <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </label>
          <span className="k-help block">PDF only. Stays pending until reviewed.</span>
        </div>
        <FormField
          label="Certificate or badge link"
          help="Most certificates are shared as a link, for example a Credly badge (credly.com/badges/…). We check that Credly badge links point to a real badge, and mark it Verified when the badge is issued to the name on your profile. We can't confirm the issuer is genuine."
          className="k-span-2"
        >
          <input className="k-input" type="url" inputMode="url" autoComplete="off" value={credentialUrl} onChange={(event) => setCredentialUrl(event.target.value)} placeholder="https://www.credly.com/badges/…" />
        </FormField>
        <FormField label="Notes (optional)" className="k-span-2">
          <textarea className="k-textarea min-h-[88px]" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}
