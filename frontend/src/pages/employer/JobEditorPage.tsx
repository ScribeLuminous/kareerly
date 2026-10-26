import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faCircleCheck, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { Banner, ConfirmDialog, FormField, PageHeader } from '../../components/ui';
import { CityField, RegionProvinceFields } from '../../components/ProvinceSelect';
import { canonicalCity } from '../../lib/phCities';
import { addSkills, clearJobDraft, draftSavedLabel, hasJobDraftContent, jobDraftSignature, jobToDraft, readJobDraft, useStoredJobDraft, writeJobDraft, type JobEditorDraft, type JobLocation } from './jobDraft';
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  jobCategoryOptions,
  jobSubcategoryMap,
  MIN_EMPLOYER_SALARY,
  WORK_SETUPS,
  type EmployerJob,
  type JobFormState,
  type JobStatus,
} from './model';

type SkillKind = 'required' | 'nice';

type JobEditorPageProps = {
  /** The job being edited, or null for a new posting. */
  job: EmployerJob | null;
  /** Where unsaved work for this job is kept on this device. */
  draftKey: string;
  /** The company's location from its profile; a new posting starts there. */
  companyLocation: JobLocation;
  /** Where Back goes, e.g. "All jobs" or the job's title. */
  backLabel: string;
  onBack: () => void;
  /** Saves to the job; resolves with what blocked it, or null once saved. */
  onSave: (mode: 'draft' | 'post', draft: JobEditorDraft) => Promise<string | null>;
  onConfigureAssessment: () => void;
};

/** Where the editor opens: changes kept from an earlier visit, else the saved job. */
function openingDraft(job: EmployerJob | null, draftKey: string, companyLocation: JobLocation) {
  const source = jobToDraft(job, companyLocation);
  const baseline = jobDraftSignature(source);
  const stored = readJobDraft(draftKey, source.form);
  const restore = stored && jobDraftSignature(stored) !== baseline && (job || hasJobDraftContent(stored)) ? stored : null;
  return { draft: restore || source, baseline, restoredAt: restore?.savedAt || '' };
}

const blockNonDigits = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (['e', 'E', '+', '-', '.'].includes(event.key)) event.preventDefault();
};

/** Keeps a saved value that is not in the list so it is never silently replaced. */
function withSaved(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [value, ...options] : options;
}

function SkillEditor({ kind, label, help, placeholder, skills, input, onInput, onAdd, onRemove }: {
  kind: SkillKind;
  label: string;
  help: string;
  placeholder: string;
  skills: string[];
  input: string;
  onInput: (kind: SkillKind, value: string) => void;
  onAdd: (kind: SkillKind) => void;
  onRemove: (kind: SkillKind, skill: string) => void;
}) {
  const inputId = `job-skill-${kind}`;
  return (
    <div className="k-field">
      <label className="k-label" htmlFor={inputId}>{label}</label>
      <div className="flex gap-2">
        <input
          id={inputId}
          className="k-input min-w-0 flex-1"
          value={input}
          placeholder={placeholder}
          aria-describedby={`${inputId}-help`}
          onChange={(event) => onInput(kind, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd(kind);
            }
          }}
        />
        <button className="k-btn k-btn-secondary shrink-0" type="button" onClick={() => onAdd(kind)} disabled={!input.trim()}>
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />Add
        </button>
      </div>
      <span id={`${inputId}-help`} className="k-help block">{help}</span>
      {skills.length > 0 && (
        <ul className="k-chip-row mt-2" aria-label={label}>
          {skills.map((skill) => (
            <li key={skill}>
              <button className="k-chip k-chip-removable" type="button" onClick={() => onRemove(kind, skill)} aria-label={`Remove ${skill}`}>
                {skill}<FontAwesomeIcon icon={faXmark} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Posting or editing a job, as its own page. Changes are kept on this device
 * as they are typed, so leaving the page never loses them.
 */
/**
 * Posting or editing a job, as its own page. Changes are kept on this device
 * as they are typed, so leaving the page or the tab never loses them.
 */
export function JobEditorPage({ job, draftKey, companyLocation, backLabel, onBack, onSave, onConfigureAssessment }: JobEditorPageProps) {
  const editing = Boolean(job);
  const [opening] = useState(() => openingDraft(job, draftKey, companyLocation));
  const [form, setForm] = useState<JobFormState>(opening.draft.form);
  const [requiredSkills, setRequiredSkills] = useState(opening.draft.requiredSkills);
  const [niceSkills, setNiceSkills] = useState(opening.draft.niceSkills);
  const [requiredSkillInput, setRequiredSkillInput] = useState(opening.draft.requiredSkillInput);
  const [niceSkillInput, setNiceSkillInput] = useState(opening.draft.niceSkillInput);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Once saved to the job, nothing more is kept on this device.
  const [saved, setSaved] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  const localSavedAt = useStoredJobDraft(draftKey)?.savedAt || '';
  const restoredAt = opening.restoredAt;
  // What is already kept, so reopening a draft doesn't count as editing it.
  const keptSignature = useRef(restoredAt ? jobDraftSignature(opening.draft) : '');

  // Keep the work on this device as it changes; nothing is kept once it matches the saved job again.
  useEffect(() => {
    if (saving || saved) return;
    const draft: JobEditorDraft = { form, requiredSkills, niceSkills, requiredSkillInput, niceSkillInput };
    const signature = jobDraftSignature(draft);
    if (signature === keptSignature.current) return;
    keptSignature.current = signature;
    if (signature === opening.baseline || (!editing && !hasJobDraftContent(draft))) clearJobDraft(draftKey);
    else writeJobDraft(draftKey, draft);
  }, [draftKey, editing, opening.baseline, saving, saved, form, requiredSkills, niceSkills, requiredSkillInput, niceSkillInput]);

  const onUpdateForm = <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => {
    setForm((current) => (field === 'category' ? { ...current, category: String(value), subcategory: '' } : { ...current, [field]: value }));
  };
  const setSkillInput = (kind: SkillKind, value: string) => (kind === 'required' ? setRequiredSkillInput(value) : setNiceSkillInput(value));
  const addSkill = (kind: SkillKind) => {
    const input = kind === 'required' ? requiredSkillInput : niceSkillInput;
    if (!input.trim()) return;
    const next = addSkills(kind === 'required' ? requiredSkills : niceSkills, input);
    if (!next) {
      setError(kind === 'required' ? 'That required skill is already added.' : 'That nice-to-have skill is already added.');
      return;
    }
    setError('');
    if (kind === 'required') {
      setRequiredSkills(next);
      setRequiredSkillInput('');
    } else {
      setNiceSkills(next);
      setNiceSkillInput('');
    }
  };
  const removeSkill = (kind: SkillKind, value: string) => {
    if (kind === 'required') setRequiredSkills((current) => current.filter((skill) => skill !== value));
    else setNiceSkills((current) => current.filter((skill) => skill !== value));
  };
  const save = async (mode: 'draft' | 'post') => {
    setSaving(true);
    try {
      const problem = await onSave(mode, { form, requiredSkills, niceSkills, requiredSkillInput, niceSkillInput });
      setError(problem || '');
      if (!problem) {
        setSaved(true);
        clearJobDraft(draftKey);
      }
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    clearJobDraft(draftKey);
    onBack();
  };

  const subcategories = form.category ? jobSubcategoryMap[form.category] || [] : [];
  const [salaryMinimum = '', salaryMaximum = ''] = form.salaryRange.split('-');
  const updateSalary = (field: 'minimum' | 'maximum', value: string) => {
    const digits = value.replace(/[^\d]/g, '');
    onUpdateForm('salaryRange', field === 'minimum' ? `${digits}-${salaryMaximum}` : `${salaryMinimum}-${digits}`);
  };
  const set = (field: keyof JobFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onUpdateForm(field, event.target.value as never);

  const savedLabel = localSavedAt ? draftSavedLabel(localSavedAt) : '';
  const restoredLabel = restoredAt ? draftSavedLabel(restoredAt) : '';
  const discardLabel = editing ? 'Discard changes' : 'Discard draft';

  return (
    <div className="k-page k-page-narrow">
      <button className="k-btn k-btn-ghost k-btn-sm -ml-2 mb-3" type="button" onClick={onBack}>
        <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />{backLabel}
      </button>
      <PageHeader title={editing ? 'Edit job' : 'Post a job'}>
        <p className="k-secondary mt-1">Required fields are marked *. Your changes are kept on this device until you save or post, so you can leave and come back.</p>
      </PageHeader>

      {restoredAt && !restoreDismissed && (
        <Banner
          tone="info"
          className="mb-4"
          onDismiss={() => setRestoreDismissed(true)}
          actions={<button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={() => setConfirmDiscard(true)}>{discardLabel}</button>}
        >
          {editing ? 'Picked up your unsaved changes' : 'Picked up your unsaved draft'}{restoredLabel ? ` from ${restoredLabel}` : ''}. They aren't saved to the job until you choose Save draft or Post job.
        </Banner>
      )}

      <form
        id="job-editor-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save('post');
        }}
      >
        <section className="k-section" aria-labelledby="job-basics">
          <h2 id="job-basics" className="k-section-title mb-3">Basics</h2>
          <div className="k-form-grid">
            <FormField label="Job title *" className="k-span-2">
              <input className="k-input" value={form.title} onChange={set('title')} placeholder="e.g. Data Analyst" required />
            </FormField>
            <FormField label="Category *">
              <select className="k-select" value={form.category} onChange={set('category')} required>
                <option value="">Select a category</option>
                {jobCategoryOptions.map((category) => <option key={category.code} value={category.value}>{category.label}</option>)}
              </select>
            </FormField>
            <FormField label="Sub-category *">
              <select className="k-select" value={form.subcategory} onChange={set('subcategory')} disabled={!form.category} required>
                <option value="">{form.category ? 'Select a sub-category' : 'Choose a category first'}</option>
                {withSaved(subcategories, form.subcategory).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
            <FormField label="Experience level *">
              <select className="k-select" value={form.experienceLevel} onChange={set('experienceLevel')} required>
                <option value="">Select a level</option>
                {withSaved(EXPERIENCE_LEVELS, form.experienceLevel).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
            <FormField label="Employment type">
              <select className="k-select" value={form.employmentType} onChange={set('employmentType')}>
                <option value="">Not specified</option>
                {withSaved(EMPLOYMENT_TYPES, form.employmentType).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
          </div>
        </section>

        <section className="k-section" aria-labelledby="job-where">
          <h2 id="job-where" className="k-section-title mb-1">Where and when</h2>
          <p className="k-meta mb-3">
            {!editing && (companyLocation.city || companyLocation.province)
              ? "The location starts from your company profile. Change it if this job is somewhere else."
              : 'The region places the job in candidates\' location filters.'}
          </p>
          <div className="k-form-grid">
            <RegionProvinceFields
              value={form.province}
              // A new province keeps the city only when that province lists it.
              onChange={(province) => setForm((current) => ({ ...current, province, city: canonicalCity(province, current.city) }))}
              required
            />
            <CityField province={form.province} value={form.city} onChange={(city) => onUpdateForm('city', city)} required />
            <FormField label="Work setup *">
              <select className="k-select" value={form.workSetup} onChange={set('workSetup')} required>
                <option value="">Select a setup</option>
                {withSaved(WORK_SETUPS, form.workSetup).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
            <FormField label="Application deadline *">
              <input className="k-input" type="date" value={form.deadline} onChange={set('deadline')} required />
            </FormField>
          </div>
        </section>

        <section className="k-section" aria-labelledby="job-pay">
          <h2 id="job-pay" className="k-section-title mb-3">Monthly salary *</h2>
          <div className="k-form-grid">
            <FormField label="Minimum (₱)">
              <input
                className="k-input"
                type="number"
                inputMode="numeric"
                min={MIN_EMPLOYER_SALARY}
                step="1000"
                value={salaryMinimum}
                placeholder="10000"
                onKeyDown={blockNonDigits}
                onChange={(event) => updateSalary('minimum', event.target.value)}
                required
              />
            </FormField>
            <FormField label="Maximum (₱)">
              <input
                className="k-input"
                type="number"
                inputMode="numeric"
                min={MIN_EMPLOYER_SALARY}
                step="1000"
                value={salaryMaximum}
                placeholder="20000"
                onKeyDown={blockNonDigits}
                onChange={(event) => updateSalary('maximum', event.target.value)}
                required
              />
            </FormField>
          </div>
          <p className="k-help mt-1">The minimum is at least ₱{MIN_EMPLOYER_SALARY.toLocaleString('en-PH')}.</p>
        </section>

        <section className="k-section" aria-labelledby="job-description">
          <h2 id="job-description" className="k-section-title mb-3">Description</h2>
          <FormField label="About the role *" help="A short overview of the role and why it matters.">
            <textarea className="k-textarea min-h-[112px]" value={form.description} onChange={set('description')} required />
          </FormField>
          <FormField label="Responsibilities *" help="One per line. Candidates see these as a list." className="mt-4">
            <textarea
              className="k-textarea min-h-[132px]"
              value={form.responsibilities}
              placeholder={'Resolve support tickets within agreed response times\nWrite weekly reports'}
              onChange={set('responsibilities')}
              required
            />
          </FormField>
        </section>

        <section className="k-section" aria-labelledby="job-skills">
          <h2 id="job-skills" className="k-section-title mb-1">Skills</h2>
          <p className="k-meta mb-3">Matching uses these to score applicants.</p>
          <SkillEditor
            kind="required"
            label="Required skills *"
            help="Press Enter or Add. Separate several with commas."
            placeholder="e.g. SQL, Excel"
            skills={requiredSkills}
            input={requiredSkillInput}
            onInput={setSkillInput}
            onAdd={addSkill}
            onRemove={removeSkill}
          />
          <div className="mt-4">
            <SkillEditor
              kind="nice"
              label="Nice to have"
              help="Optional. Helps break ties between applicants."
              placeholder="e.g. Power BI"
              skills={niceSkills}
              input={niceSkillInput}
              onInput={setSkillInput}
              onAdd={addSkill}
              onRemove={removeSkill}
            />
          </div>
        </section>

        {editing && <section className="k-section" aria-labelledby="job-assessment">
          <h2 id="job-assessment" className="k-section-title">Candidate Assessment</h2>
          <p className="k-secondary mt-1">Set questions candidates answer and the scorecard criteria employers use to review them.</p>
          <button className="k-btn k-btn-secondary mt-3" type="button" onClick={onConfigureAssessment}>Configure Assessment</button>
        </section>}

        {editing && (
          <section className="k-section" aria-labelledby="job-status">
            <h2 id="job-status" className="k-section-title mb-3">Status</h2>
            <FormField label="Posting status" help="Save draft always keeps it hidden from candidates.">
              <select className="k-select" value={form.status} onChange={(event) => onUpdateForm('status', event.target.value as JobStatus)}>
                <option value="open">Open</option>
                <option value="draft">Draft</option>
                <option value="closed">Closed</option>
              </select>
            </FormField>
          </section>
        )}
      </form>

      <div className="k-savebar k-editor-bar" role="group" aria-label="Save this job">
        {error && <Banner tone="error" className="k-editor-bar-error">{error}</Banner>}
        <span className="k-meta k-editor-bar-status" aria-live="polite">
          {savedLabel ? (
            <><FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" className="text-green" />{editing ? 'Changes' : 'Draft'} kept on this device · {savedLabel}</>
          ) : editing ? 'No unsaved changes' : 'Nothing entered yet'}
        </span>
        {localSavedAt && (
          <button className="k-btn k-btn-ghost" type="button" onClick={() => setConfirmDiscard(true)} disabled={saving}>{discardLabel}</button>
        )}
        <button className="k-btn k-btn-secondary" type="button" onClick={() => void save('draft')} disabled={saving}>Save draft</button>
        <button className="k-btn k-btn-primary" type="submit" form="job-editor-form" disabled={saving}>
          {saving ? 'Saving…' : editing && form.status === 'closed' ? 'Save' : 'Post job'}
        </button>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title={editing ? 'Discard your changes?' : 'Discard this draft?'}
          message={editing ? 'The job goes back to how it was last saved.' : "Everything you entered for this job is cleared. This can't be undone."}
          confirmLabel={discardLabel}
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => { setConfirmDiscard(false); discard(); }}
        />
      )}
    </div>
  );
}
