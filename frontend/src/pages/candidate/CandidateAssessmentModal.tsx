import { useState } from 'react';
import { Banner, Modal } from '../../components/ui';
import { saveAssessment, type CandidateAssessment } from '../../lib/assessmentApi';

export function CandidateAssessmentModal({ assessment, jobTitle, onClose, onSaved }: {
  assessment: CandidateAssessment;
  jobTitle: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(assessment.questions.map((item) => [item.id, item.response])));
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const readonly = assessment.status !== 'pending' || submitted;
  const save = async (submit: boolean) => {
    setAttempted(submit);
    if (submit && assessment.questions.some((item) => item.required && !answers[item.id]?.trim())) return;
    setSaving(true);
    setError('');
    try {
      await saveAssessment(assessment.id, answers, submit);
      if (submit) setSubmitted(true);
      onSaved();
      if (!submit) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save your responses.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Candidate Assessment" subtitle={jobTitle} onClose={onClose} size="lg" fullOnMobile
      footer={readonly ? <button className="k-btn k-btn-secondary" type="button" onClick={onClose}>Close</button> : (
        <div className="k-button-row w-full">
          <button className="k-btn k-btn-secondary" type="button" disabled={saving} onClick={() => void save(false)}>Save draft</button>
          <button className="k-btn k-btn-primary" type="button" disabled={saving} onClick={() => void save(true)}>Submit Assessment</button>
        </div>
      )}>
      {readonly ? <Banner tone="info" className="mb-4">Assessment submitted. Your responses have been sent to the employer and are read-only.</Banner>
        : <p className="k-secondary mb-4">The employer has requested additional information as part of your application review. Answer each required question before submitting.</p>}
      {error && <Banner tone="error" className="mb-4">{error}</Banner>}
      <ol className="space-y-5">
        {assessment.questions.map((item, index) => {
          const invalid = attempted && item.required && !answers[item.id]?.trim();
          return <li key={item.id} className="rounded-[12px] border border-bdr p-4">
            <h3 className="k-label">{index + 1}. {item.name} <span className="k-meta">· {item.required ? 'Required' : 'Optional'}</span></h3>
            {item.description && <p className="k-secondary mt-1">{item.description}</p>}
            <label className="k-label mt-3 block" htmlFor={`assessment-${item.id}`}>{item.question}</label>
            <textarea id={`assessment-${item.id}`} className="k-textarea mt-2" rows={5} maxLength={10000}
              required={item.required} aria-required={item.required} aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `assessment-error-${item.id}` : undefined}
              readOnly={readonly} value={answers[item.id] || ''}
              onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))} />
            {invalid && <p id={`assessment-error-${item.id}`} className="k-meta mt-1 text-rust" role="alert">This required question needs an answer.</p>}
          </li>;
        })}
      </ol>
    </Modal>
  );
}
