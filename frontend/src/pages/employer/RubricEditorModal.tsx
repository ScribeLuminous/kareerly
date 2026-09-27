import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { Banner, FormField, InfoTip, Modal } from '../../components/ui';
import {
  emptyCriterion,
  RATING_SCALE,
  rubricToDraft,
  starterRubric,
  validateRubricDraft,
  weightShares,
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
  onCancel: () => void;
  onSave: (criteria: RubricCriterionDraft[]) => void;
};

export function RubricEditorModal({ job, rubric, inUse, saving, onCancel, onSave }: RubricEditorModalProps) {
  const [criteria, setCriteria] = useState<RubricCriterionDraft[]>(() => (rubric ? rubricToDraft(rubric) : starterRubric(job)));
  const [error, setError] = useState('');
  const shares = weightShares(criteria);

  const update = (key: string, patch: Partial<RubricCriterionDraft>) => setCriteria((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const move = (index: number, delta: number) => setCriteria((current) => {
    const next = [...current];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    return next;
  });
  const submit = () => {
    const problem = validateRubricDraft(criteria);
    setError(problem || '');
    if (!problem) onSave(criteria);
  };

  return (
    <Modal
      title={rubric ? `Evaluation rubric · v${rubric.version}` : 'Configure Candidate Assessment'}
      subtitle={job.title}
      onClose={onCancel}
      size="lg"
      fullOnMobile
      footer={(
        <>
          <button className="k-btn k-btn-ghost" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="k-btn k-btn-primary" type="button" onClick={submit} disabled={saving}>
            {inUse ? `Save as version ${(rubric?.version || 0) + 1}` : 'Save rubric'}
          </button>
        </>
      )}
    >
      <p className="k-secondary">
        Set the questions candidates will answer and the criteria employers will use to rate their responses.
      </p>
      {inUse && (
        <Banner tone="info" className="mt-3">
          Sent assessments or scorecards already use version {rubric?.version}. Saving creates version {(rubric?.version || 0) + 1} for new scorecards; existing scorecards and their results stay on version {rubric?.version} and are never recalculated.
        </Banner>
      )}
      {error && <Banner tone="error" className="mt-3">{error}</Banner>}

      <ol className="mt-4 space-y-4">
        {criteria.map((criterion, index) => (
          <li key={criterion.key} className="rounded-[12px] border border-bdr p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="k-label">Criterion {index + 1} <span className="k-meta">· {shares[index]}% of the total weight</span></p>
              <div className="flex gap-1">
                <button className="k-icon-btn" type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${criterion.name || `criterion ${index + 1}`} up`}><FontAwesomeIcon icon={faArrowUp} aria-hidden="true" /></button>
                <button className="k-icon-btn" type="button" onClick={() => move(index, 1)} disabled={index === criteria.length - 1} aria-label={`Move ${criterion.name || `criterion ${index + 1}`} down`}><FontAwesomeIcon icon={faArrowDown} aria-hidden="true" /></button>
                <button className="k-icon-btn" type="button" onClick={() => setCriteria((current) => current.filter((item) => item.key !== criterion.key))} disabled={criteria.length === 1} aria-label={`Remove ${criterion.name || `criterion ${index + 1}`}`}><FontAwesomeIcon icon={faTrash} aria-hidden="true" /></button>
              </div>
            </div>
            <div className="mt-2 grid gap-3 [&>.k-field+.k-field]:mt-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <FormField label="Name">
                <input className="k-input" value={criterion.name} maxLength={120} onChange={(event) => update(criterion.key, { name: event.target.value })} />
              </FormField>
              <FormField label="Weight (1–5)" help="How much it counts relative to the others.">
                <select className="k-select" value={criterion.weight} onChange={(event) => update(criterion.key, { weight: Number(event.target.value) })}>
                  {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </FormField>
            </div>
            <FormField label="What it means for this job" className="mt-3">
              <textarea className="k-textarea" rows={2} maxLength={1000} value={criterion.description} onChange={(event) => update(criterion.key, { description: event.target.value })} />
            </FormField>
            <label className="mt-3 flex items-center gap-2">
              <input type="checkbox" checked={criterion.isRequired} onChange={(event) => update(criterion.key, { isRequired: event.target.checked })} />
              <span className="k-label">Required answer</span>
              <InfoTip label="About required criteria">The team score stays hidden until every required criterion has been assessed by at least one reviewer.</InfoTip>
            </label>
            <FormField label="Candidate Assessment question *" className="mt-3">
              <textarea className="k-textarea" rows={3} maxLength={1000} required value={criterion.question} onChange={(event) => update(criterion.key, { question: event.target.value })} />
            </FormField>
            <fieldset className="mt-3">
              <legend className="k-label">Rating guidance</legend>
              <div className="mt-1 grid gap-2 [&>.k-field+.k-field]:mt-0 sm:grid-cols-2">
                {RATING_SCALE.map((option) => (
                  <FormField key={option.value} label={`${option.value} · ${option.label}`}>
                    <input
                      className="k-input"
                      value={criterion.anchors[option.value - 1] || ''}
                      maxLength={300}
                      onChange={(event) => update(criterion.key, { anchors: criterion.anchors.map((anchor, anchorIndex) => (anchorIndex === option.value - 1 ? event.target.value : anchor)) })}
                    />
                  </FormField>
                ))}
              </div>
            </fieldset>
            <fieldset className="mt-3">
              <legend className="k-label">Questions or prompts for reviewers</legend>
              <div className="mt-1 space-y-2">
                {criterion.prompts.map((prompt, promptIndex) => (
                  <div key={promptIndex} className="flex gap-2">
                    <input
                      className="k-input"
                      value={prompt}
                      maxLength={300}
                      aria-label={`Question ${promptIndex + 1} for ${criterion.name || `criterion ${index + 1}`}`}
                      onChange={(event) => update(criterion.key, { prompts: criterion.prompts.map((item, itemIndex) => (itemIndex === promptIndex ? event.target.value : item)) })}
                    />
                    <button className="k-icon-btn" type="button" aria-label={`Remove question ${promptIndex + 1}`} onClick={() => update(criterion.key, { prompts: criterion.prompts.filter((_, itemIndex) => itemIndex !== promptIndex) })}>
                      <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={() => update(criterion.key, { prompts: [...criterion.prompts, ''] })}>
                  <FontAwesomeIcon icon={faPlus} aria-hidden="true" />Add question
                </button>
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <button className="k-btn k-btn-secondary mt-4" type="button" onClick={() => setCriteria((current) => [...current, emptyCriterion()])} disabled={criteria.length >= 12}>
        <FontAwesomeIcon icon={faPlus} aria-hidden="true" />Add criterion
      </button>
    </Modal>
  );
}
