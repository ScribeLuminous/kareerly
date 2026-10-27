import { useState } from 'react';
import { Banner, FormField, Modal } from '../../components/ui';
import { AssessmentCriteriaEditor } from './AssessmentCriteriaEditor';
import {
  canDraftFromJob,
  combineTemplates,
  rubricToDraft,
  starterRubric,
  validateRubricDraft,
  type AssessmentTemplate,
  type Rubric,
  type RubricCriterionDraft,
} from './evaluation';
import type { EmployerJob } from './model';

type RubricEditorModalProps = {
  job: EmployerJob;
  /** The job's latest rubric version, if any. */
  rubric: Rubric | null;
  /** The latest version is used by scorecards or sent assessments, so saving creates a new version. */
  inUse: boolean;
  saving: boolean;
  /** The employer's saved assessments, to start from instead of a blank one. */
  templates: AssessmentTemplate[];
  /** Closes without saving. For a job with no assessment yet this is "Skip for now": the step is optional. */
  onCancel: () => void;
  /** Saving also keeps the assessment in Assessment templates, so there is nothing extra to choose. */
  onSave: (criteria: RubricCriterionDraft[]) => void;
  /** Leaves the dialog and shows that template's page. */
  onOpenTemplate: (templateId: string) => void;
};

export function RubricEditorModal({ job, rubric, inUse, saving, templates, onCancel, onSave, onOpenTemplate }: RubricEditorModalProps) {
  const isNew = !rubric;
  const [criteria, setCriteria] = useState<RubricCriterionDraft[]>(() => (rubric ? rubricToDraft(rubric) : starterRubric(job)));
  // The questions shown are our draft from the job, not something the employer saved.
  const [isJobDraft, setIsJobDraft] = useState(() => isNew && canDraftFromJob(job));
  // Remounts the editor so its open/closed cards follow a newly loaded template.
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState('');
  const usedTemplate = rubric?.templateId ? templates.find((item) => item.id === rubric.templateId) : null;

  const loadTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setCriteria(combineTemplates([template]));
    setIsJobDraft(false);
    setEditorKey((value) => value + 1);
    setError('');
  };
  const submit = () => {
    const problem = validateRubricDraft(criteria);
    setError(problem || '');
    if (!problem) onSave(criteria);
  };

  return (
    <Modal
      title={rubric ? 'Candidate Assessment' : (
        <span className="inline-flex flex-wrap items-center gap-2">
          Configure Candidate Assessment
          {isJobDraft && <span className="k-badge k-badge-outline">Draft</span>}
        </span>
      )}
      subtitle={job.title}
      onClose={onCancel}
      size="lg"
      fullOnMobile
      footer={(
        <>
          {isNew && <span className="k-meta self-center text-center sm:mr-auto sm:text-left">Optional. You can set it up later from the job page.</span>}
          <button className="k-btn k-btn-ghost" type="button" onClick={onCancel} disabled={saving}>{isNew ? 'Skip for now' : 'Cancel'}</button>
          <button className="k-btn k-btn-primary" type="button" onClick={submit} disabled={saving}>
            {inUse ? `Save as version ${(rubric?.version || 0) + 1}` : 'Save assessment'}
          </button>
        </>
      )}
    >
      <p className="k-secondary">
        Set the questions candidates answer when shortlisted, and the criteria reviewers use to rate their answers.
      </p>
      {usedTemplate && (
        <p className="k-meta mt-2">
          Saved as the template <strong>{usedTemplate.name}</strong>.{' '}
          <button className="k-link" type="button" onClick={() => onOpenTemplate(usedTemplate.id)} disabled={saving}>View template</button>
        </p>
      )}
      {isNew && (
        <p className="k-secondary mt-2">
          <strong>Optional, but recommended.</strong> Shortlisted applicants answer these automatically, so your team compares everyone on the same points instead of resumes alone.
        </p>
      )}
      {isJobDraft && (
        <Banner tone="info" className="mt-3">
          <strong>Draft built from this job.</strong> We wrote these questions from the required skills and responsibilities you listed. Nothing is saved until you choose Save assessment, so edit or remove anything that doesn't fit.
        </Banner>
      )}
      {templates.length > 0 && (
        <FormField label="Start from a template" help="Replaces the questions below. You can still edit them for this job." className="mt-3">
          <select className="k-select" value="" onChange={(event) => loadTemplate(event.target.value)}>
            <option value="">Choose a saved assessment…</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.criteria.length} question{template.criteria.length === 1 ? '' : 's'}</option>)}
          </select>
        </FormField>
      )}
      {inUse && (
        <Banner tone="info" className="mt-3">
          Applicants have already received or been scored on this assessment. Your changes apply to new scorecards only; existing scorecards and their results stay as they were and are never recalculated.
        </Banner>
      )}
      {error && <Banner tone="error" className="mt-3">{error}</Banner>}

      <div className="mt-4">
        <AssessmentCriteriaEditor key={editorKey} criteria={criteria} onChange={setCriteria} />
      </div>

      <p className="k-meta mt-4">Saving also keeps this assessment in Assessment templates, so you can review it or reuse it in other jobs anytime.</p>
    </Modal>
  );
}
