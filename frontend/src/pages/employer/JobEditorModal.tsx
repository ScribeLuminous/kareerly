import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { Banner, FormField, Modal } from '../../components/ui';
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  jobCategoryOptions,
  jobSubcategoryMap,
  MIN_EMPLOYER_SALARY,
  WORK_SETUPS,
  type JobFormState,
  type JobStatus,
} from './model';

type SkillKind = 'required' | 'nice';

type JobEditorModalProps = {
  editing: boolean;
  form: JobFormState;
  error: string;
  requiredSkills: string[];
  niceSkills: string[];
  requiredSkillInput: string;
  niceSkillInput: string;
  saving: boolean;
  onUpdateForm: <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => void;
  onSkillInput: (kind: SkillKind, value: string) => void;
  onAddSkill: (kind: SkillKind) => void;
  onRemoveSkill: (kind: SkillKind, skill: string) => void;
  onCancel: () => void;
  onSaveDraft: () => void;
  onPost: () => void;
};

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

export function JobEditorModal({
  editing,
  form,
  error,
  requiredSkills,
  niceSkills,
  requiredSkillInput,
  niceSkillInput,
  saving,
  onUpdateForm,
  onSkillInput,
  onAddSkill,
  onRemoveSkill,
  onCancel,
  onSaveDraft,
  onPost,
}: JobEditorModalProps) {
  const subcategories = form.category ? jobSubcategoryMap[form.category] || [] : [];
  const [salaryMinimum = '', salaryMaximum = ''] = form.salaryRange.split('-');
  const updateSalary = (field: 'minimum' | 'maximum', value: string) => {
    const digits = value.replace(/[^\d]/g, '');
    onUpdateForm('salaryRange', field === 'minimum' ? `${digits}-${salaryMaximum}` : `${salaryMinimum}-${digits}`);
  };
  const set = (field: keyof JobFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onUpdateForm(field, event.target.value as never);

  return (
    <Modal
      title={editing ? 'Edit job' : 'Post a job'}
      subtitle="Required fields are marked *"
      onClose={onCancel}
      size="lg"
      fullOnMobile
      closeLabel="Cancel"
      footer={(
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button className="k-btn k-btn-ghost hidden sm:inline-flex" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="k-btn k-btn-secondary" type="button" onClick={onSaveDraft} disabled={saving}>Save draft</button>
          <button className="k-btn k-btn-primary" type="submit" form="job-editor-form" disabled={saving}>
            {saving ? 'Saving…' : editing && form.status === 'closed' ? 'Save' : 'Post job'}
          </button>
        </div>
      )}
    >
      <form
        id="job-editor-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onPost();
        }}
      >
        {error && <Banner tone="error" className="mb-4">{error}</Banner>}

        <section className="k-section" aria-labelledby="job-basics">
          <h3 id="job-basics" className="k-section-title mb-3">Basics</h3>
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
          <h3 id="job-where" className="k-section-title mb-3">Where and when</h3>
          <div className="k-form-grid">
            <FormField label="Work setup *">
              <select className="k-select" value={form.workSetup} onChange={set('workSetup')} required>
                <option value="">Select a setup</option>
                {withSaved(WORK_SETUPS, form.workSetup).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
            <FormField label="Location *">
              <input className="k-input" value={form.location} onChange={set('location')} placeholder="City, Province" autoComplete="off" required />
            </FormField>
            <FormField label="Application deadline *">
              <input className="k-input" type="date" value={form.deadline} onChange={set('deadline')} required />
            </FormField>
          </div>
        </section>

        <section className="k-section" aria-labelledby="job-pay">
          <h3 id="job-pay" className="k-section-title mb-3">Monthly salary *</h3>
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
          <h3 id="job-description" className="k-section-title mb-3">Description</h3>
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
          <h3 id="job-skills" className="k-section-title mb-1">Skills</h3>
          <p className="k-meta mb-3">Matching uses these to score applicants.</p>
          <SkillEditor
            kind="required"
            label="Required skills *"
            help="Press Enter or Add. Separate several with commas."
            placeholder="e.g. SQL, Excel"
            skills={requiredSkills}
            input={requiredSkillInput}
            onInput={onSkillInput}
            onAdd={onAddSkill}
            onRemove={onRemoveSkill}
          />
          <div className="mt-4">
            <SkillEditor
              kind="nice"
              label="Nice to have"
              help="Optional. Helps break ties between applicants."
              placeholder="e.g. Power BI"
              skills={niceSkills}
              input={niceSkillInput}
              onInput={onSkillInput}
              onAdd={onAddSkill}
              onRemove={onRemoveSkill}
            />
          </div>
        </section>

        {editing && (
          <section className="k-section" aria-labelledby="job-status">
            <h3 id="job-status" className="k-section-title mb-3">Status</h3>
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
    </Modal>
  );
}
