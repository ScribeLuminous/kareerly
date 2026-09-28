import { useState } from 'react';
import { Banner, FormField, Modal } from '../../components/ui';
import { AssessmentCriteriaEditor } from './AssessmentCriteriaEditor';
import {
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
  onCancel: () => void;
  /** `templateName` is set when the employer also wants to keep it as a reusable template. */
  onSave: (criteria: RubricCriterionDraft[], templateName: string) => void;
};

export function RubricEditorModal({ job, rubric, inUse, saving, templates, onCancel, onSave }: RubricEditorModalProps) {
  const [criteria, setCriteria] = useState<RubricCriterionDraft[]>(() => (rubric ? rubricToDraft(rubric) : starterRubric(job)));
  // Remounts the editor so its open/closed cards follow a newly loaded template.
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState(`${job.title} assessment`);
  const usedTemplate = rubric?.templateId ? templates.find((item) => item.id === rubric.templateId) : null;

  const loadTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setCriteria(combineTemplates([template]));
    setEditorKey((value) => value + 1);
    setError('');
  };
  const submit = () => {
    const problem = validateRubricDraft(criteria) || (saveAsTemplate && !templateName.trim() ? 'Name the template.' : null);
    setError(problem || '');
    if (!problem) onSave(criteria, saveAsTemplate ? templateName.trim() : '');
  };

  return (
    <Modal
      title={rubric ? `Candidate Assessment · v${rubric.version}` : 'Configure Candidate Assessment'}
      subtitle={job.title}
      onClose={onCancel}
      size="lg"
      fullOnMobile
      footer={(
        <>
          <button className="k-btn k-btn-ghost" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="k-btn k-btn-primary" type="button" onClick={submit} disabled={saving}>
            {inUse ? `Save as version ${(rubric?.version || 0) + 1}` : 'Save assessment'}
          </button>
        </>
      )}
    >
      <p className="k-secondary">
        Set the questions candidates answer when shortlisted, and the criteria reviewers use to rate their answers.
        {usedTemplate && <> Based on the template <strong>{usedTemplate.name}</strong>.</>}
      </p>
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
          Sent assessments or scorecards already use version {rubric?.version}. Saving creates version {(rubric?.version || 0) + 1} for new scorecards; existing scorecards and their results stay on version {rubric?.version} and are never recalculated.
        </Banner>
      )}
      {error && <Banner tone="error" className="mt-3">{error}</Banner>}

      <div className="mt-4">
        <AssessmentCriteriaEditor key={editorKey} criteria={criteria} onChange={setCriteria} />
      </div>

      <div className="mt-5 rounded-[12px] border border-bdr p-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={saveAsTemplate} onChange={(event) => setSaveAsTemplate(event.target.checked)} />
          <span className="k-label">Also save as a reusable template</span>
        </label>
        {saveAsTemplate && (
          <FormField label="Template name" className="mt-2">
            <input className="k-input" value={templateName} maxLength={120} onChange={(event) => setTemplateName(event.target.value)} />
          </FormField>
        )}
      </div>
    </Modal>
  );
}
