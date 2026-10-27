import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faClipboardList, faCopy, faPlus, faShareFromSquare, faTrash } from '@fortawesome/free-solid-svg-icons';
import { Banner, ConfirmDialog, EmptyState, FormField, Modal, PageHeader, SearchField, SkeletonRows, Tabs } from '../../components/ui';
import { AssessmentCriteriaEditor, AssessmentSummary } from './AssessmentCriteriaEditor';
import { combineTemplates, rubricToDraft, starterRubric, validateRubricDraft, type AssessmentTemplate, type Rubric, type RubricCriterionDraft } from './evaluation';
import { formatDateLabel, JOB_STATUS_LABEL, type EmployerJob } from './model';

export type JobsSection = 'postings' | 'templates';

/** Switches between job postings and the assessment templates they share. */
export function JobsSectionTabs({ section, templateCount, onChange }: { section: JobsSection; templateCount: number; onChange: (section: JobsSection) => void }) {
  return (
    <div className="mb-4">
      <Tabs<JobsSection>
        label="Jobs sections"
        idPrefix="jobs-section"
        value={section}
        onChange={onChange}
        items={[
          { id: 'postings', label: 'Job postings' },
          { id: 'templates', label: 'Assessment templates', count: templateCount || undefined },
        ]}
      />
    </div>
  );
}

/** A checkbox list of jobs, with select all. */
function JobChecklist({ jobs, selected, onChange, describe }: { jobs: EmployerJob[]; selected: Set<string>; onChange: (next: Set<string>) => void; describe: (job: EmployerJob) => string }) {
  const all = jobs.length > 0 && jobs.every((job) => selected.has(job.id));
  const some = !all && jobs.some((job) => selected.has(job.id));
  return (
    <div>
      <label className="k-select-all k-secondary">
        <span className="k-select-box -ml-1.5">
          <input type="checkbox" checked={all} ref={(input) => { if (input) input.indeterminate = some; }} onChange={() => onChange(all ? new Set() : new Set(jobs.map((job) => job.id)))} />
        </span>
        Select all {jobs.length} job{jobs.length === 1 ? '' : 's'}
      </label>
      <ul className="k-list max-h-[40vh] overflow-y-auto">
        {jobs.map((job) => (
          <li key={job.id}>
            <label className="k-row cursor-pointer py-2">
              <span className="k-select-box -ml-1.5">
                <input
                  type="checkbox"
                  checked={selected.has(job.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(job.id)) next.delete(job.id);
                    else next.add(job.id);
                    onChange(next);
                  }}
                />
              </span>
              <span className="k-row-main">
                <span className="k-label block truncate">{job.title}</span>
                <span className="k-meta k-dot-sep block"><span>{JOB_STATUS_LABEL[job.status]}</span><span>{describe(job)}</span></span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Templates are chosen; pick the jobs that should use them. */
export function ApplyToJobsModal({ templates, jobs, describeJob, initialJobIds = [], onApply, onClose }: {
  templates: AssessmentTemplate[];
  jobs: EmployerJob[];
  /** The job's current assessment, in words. */
  describeJob: (job: EmployerJob) => string;
  initialJobIds?: string[];
  onApply: (jobIds: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialJobIds));
  const [busy, setBusy] = useState(false);
  const combined = useMemo(() => combineTemplates(templates), [templates]);
  const problem = validateRubricDraft(combined);
  const apply = async () => {
    setBusy(true);
    try {
      if (await onApply(Array.from(selected))) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Use in jobs"
      subtitle={templates.length === 1 ? templates[0].name : `${templates.length} templates combined`}
      onClose={onClose}
      size="lg"
      fullOnMobile
      footer={(
        <>
          <button className="k-btn k-btn-ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="k-btn k-btn-primary" type="button" onClick={() => void apply()} disabled={busy || selected.size === 0 || Boolean(problem)}>
            Apply to {selected.size} job{selected.size === 1 ? '' : 's'}
          </button>
        </>
      )}
    >
      {templates.length > 1 && <p className="k-secondary mb-3">The selected templates are combined into one assessment, in the order shown. Questions with the same name are asked once.</p>}
      {problem && <Banner tone="error" className="mb-3">{problem}</Banner>}
      <AssessmentSummary criteria={combined} compact />
      <h3 className="k-label mb-2 mt-4">Jobs</h3>
      {jobs.length === 0 ? <p className="k-secondary">You have no jobs to use it in yet.</p> : (
        <JobChecklist jobs={jobs} selected={selected} onChange={setSelected} describe={describeJob} />
      )}
      <p className="k-meta mt-3">This replaces each job's current questions. Assessments already sent, and scorecards already started, keep the version they used.</p>
    </Modal>
  );
}

/** Jobs are chosen; pick one or more templates to give them. */
export function ChooseTemplatesModal({ templates, jobCount, onApply, onManage, onClose }: {
  templates: AssessmentTemplate[];
  jobCount: number;
  onApply: (templateIds: string[]) => Promise<boolean>;
  onManage: () => void;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const chosen = order.map((id) => templates.find((item) => item.id === id)).filter((item): item is AssessmentTemplate => Boolean(item));
  const combined = useMemo(() => combineTemplates(chosen), [chosen]);
  const problem = chosen.length > 0 ? validateRubricDraft(combined) : null;
  const toggle = (id: string) => setOrder((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const apply = async () => {
    setBusy(true);
    try {
      if (await onApply(order)) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Set assessment"
      subtitle={`${jobCount} selected job${jobCount === 1 ? '' : 's'}`}
      onClose={onClose}
      size="lg"
      fullOnMobile
      footer={(
        <>
          <button className="k-btn k-btn-ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="k-btn k-btn-primary" type="button" onClick={() => void apply()} disabled={busy || chosen.length === 0 || Boolean(problem)}>
            Apply to {jobCount} job{jobCount === 1 ? '' : 's'}
          </button>
        </>
      )}
    >
      {templates.length === 0 ? (
        <EmptyState
          icon={faClipboardList}
          title="No assessment templates yet"
          text="Save an assessment once and reuse it across jobs."
          actions={<button className="k-btn k-btn-primary" type="button" onClick={onManage}>Create a template</button>}
        />
      ) : (
        <>
          <p className="k-secondary mb-2">Choose one template, or several to combine them into one assessment.</p>
          <ul className="k-list">
            {templates.map((template) => (
              <li key={template.id}>
                <label className="k-row cursor-pointer py-2">
                  <span className="k-select-box -ml-1.5">
                    <input type="checkbox" checked={order.includes(template.id)} onChange={() => toggle(template.id)} />
                  </span>
                  <span className="k-row-main">
                    <span className="k-label block truncate">{template.name}</span>
                    <span className="k-meta block">{template.criteria.length} question{template.criteria.length === 1 ? '' : 's'}{template.description ? ` · ${template.description}` : ''}</span>
                  </span>
                  {order.includes(template.id) && order.length > 1 && <span className="k-badge k-badge-info">{order.indexOf(template.id) + 1}</span>}
                </label>
              </li>
            ))}
          </ul>
          {chosen.length > 0 && (
            <div className="mt-4">
              {problem && <Banner tone="error" className="mb-3">{problem}</Banner>}
              <AssessmentSummary criteria={combined} compact />
            </div>
          )}
          <p className="k-meta mt-3">This replaces each job's current questions. Assessments already sent, and scorecards already started, keep the version they used.</p>
        </>
      )}
    </Modal>
  );
}

type TemplateDraft = { id?: string; name: string; description: string; criteria: RubricCriterionDraft[] };

type AssessmentTemplatesPageProps = {
  templates: AssessmentTemplate[];
  status: 'loading' | 'ready' | 'error' | 'unavailable';
  jobs: EmployerJob[];
  /** Latest rubric per job id, to copy an existing job's assessment into a template. */
  latestRubrics: Map<string, Rubric>;
  /** How many jobs currently use each template. */
  usage: Map<string, number>;
  describeJob: (job: EmployerJob) => string;
  /** '' shows the list; 'new' or a template id shows that template's page. */
  templateId: string;
  onOpen: (templateId: string) => void;
  onBackToList: () => void;
  onSection: (section: JobsSection) => void;
  /** Resolves with the saved template's id, or null when saving failed. */
  onSave: (draft: TemplateDraft) => Promise<string | null>;
  onDelete: (templateIds: string[]) => Promise<void>;
  onApply: (templateIds: string[], jobIds: string[]) => Promise<boolean>;
};

/** One template's own page: name it, edit its questions, and use it in jobs. */
function TemplateEditorPage({ template, jobs, latestRubrics, usage, describeJob, onBack, onSave, onDelete, onApply }: Pick<AssessmentTemplatesPageProps, 'jobs' | 'latestRubrics' | 'usage' | 'describeJob' | 'onSave' | 'onDelete' | 'onApply'> & { template: AssessmentTemplate | null; onBack: () => void }) {
  const [name, setName] = useState(template?.name || '');
  const [description, setDescription] = useState(template?.description || '');
  const [criteria, setCriteria] = useState<RubricCriterionDraft[]>(() => (template ? template.criteria : starterRubric({ requiredSkills: [], responsibilities: [] })));
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(template?.id || '');
  const [applyOpen, setApplyOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const jobsWithAssessment = jobs.filter((job) => latestRubrics.has(job.id));
  const usedBy = savedId ? jobs.filter((job) => latestRubrics.get(job.id)?.templateId === savedId).map((job) => job.title) : [];

  const copyFromJob = (jobId: string) => {
    const rubric = latestRubrics.get(jobId);
    const job = jobs.find((item) => item.id === jobId);
    if (!rubric || !job) return;
    setCriteria(rubricToDraft(rubric).map((criterion, index) => ({ ...criterion, key: `copy-${Date.now()}-${index}` })));
    if (!name.trim()) setName(`${job.title} assessment`);
    setEditorKey((value) => value + 1);
  };
  const save = async (): Promise<string | null> => {
    const problem = !name.trim() ? 'Name the template.' : validateRubricDraft(criteria);
    setError(problem || '');
    if (problem) return null;
    setSaving(true);
    try {
      const id = await onSave({ id: savedId || undefined, name, description, criteria });
      if (id) setSavedId(id);
      return id;
    } finally {
      setSaving(false);
    }
  };
  const current: AssessmentTemplate = { id: savedId, name: name.trim() || 'This template', description, criteria, updatedAt: '' };

  return (
    <div className="k-page">
      <button className="k-btn k-btn-ghost k-btn-sm -ml-2 mb-3" type="button" onClick={onBack}>
        <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />Assessment templates
      </button>
      <PageHeader
        title={template ? template.name : 'New assessment template'}
        actions={(
          <>
            {savedId && (
              <button className="k-btn k-btn-secondary" type="button" disabled={saving} onClick={async () => { if (await save()) setApplyOpen(true); }}>
                <FontAwesomeIcon icon={faShareFromSquare} aria-hidden="true" />Use in jobs
              </button>
            )}
            <button className="k-btn k-btn-primary" type="button" disabled={saving} onClick={() => void save()}>{savedId ? 'Save changes' : 'Save template'}</button>
          </>
        )}
      >
        <p className="k-secondary mt-1">
          {savedId ? (usedBy.length > 0 ? `Used by ${usedBy.join(', ')}. ` : `Used by ${usage.get(savedId) || 0} jobs. `) : ''}
          Editing a template changes it for the next time you apply it; jobs already using it keep their questions.
        </p>
      </PageHeader>

      {error && <Banner tone="error" className="mb-4">{error}</Banner>}

      <div className="grid gap-3 [&>.k-field+.k-field]:mt-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <FormField label="Template name *">
          <input className="k-input" value={name} maxLength={120} placeholder="e.g. Customer support essentials" onChange={(event) => setName(event.target.value)} />
        </FormField>
        {!template && jobsWithAssessment.length > 0 ? (
          <FormField label="Copy from a job" help="Start from the questions a job already uses.">
            <select className="k-select" value="" onChange={(event) => copyFromJob(event.target.value)}>
              <option value="">Choose a job…</option>
              {jobsWithAssessment.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
            </select>
          </FormField>
        ) : <div />}
      </div>
      <FormField label="Description" help="Optional: when to use this assessment." className="mt-3">
        <input className="k-input" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
      </FormField>

      <div className="mt-5">
        <AssessmentCriteriaEditor key={editorKey} criteria={criteria} onChange={setCriteria} />
      </div>

      {savedId && (
        <div className="mt-6 border-t border-bdr pt-4">
          <button className="k-btn k-btn-danger-outline k-btn-sm" type="button" onClick={() => setConfirmDelete(true)}>
            <FontAwesomeIcon icon={faTrash} aria-hidden="true" />Delete template
          </button>
        </div>
      )}

      {applyOpen && (
        <ApplyToJobsModal templates={[current]} jobs={jobs.filter((job) => job.status !== 'archived')} describeJob={describeJob} onApply={(jobIds) => onApply([savedId], jobIds)} onClose={() => setApplyOpen(false)} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this template?"
          message="Jobs using it keep their questions; only the template is removed."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => { await onDelete([savedId]); setConfirmDelete(false); onBack(); }}
        />
      )}
    </div>
  );
}

export function AssessmentTemplatesPage(props: AssessmentTemplatesPageProps) {
  const { templates, status, jobs, usage, describeJob, templateId, onOpen, onBackToList, onSection, onDelete, onApply } = props;
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<AssessmentTemplate[] | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);

  if (templateId) {
    const template = templateId === 'new' ? null : templates.find((item) => item.id === templateId) || null;
    if (templateId !== 'new' && !template) {
      return (
        <div className="k-page">
          {status === 'loading' ? <SkeletonRows count={4} label="Loading template" /> : (
            <EmptyState icon={faClipboardList} title="Template not found" text="It may have been deleted." actions={<button className="k-btn k-btn-secondary" type="button" onClick={onBackToList}>All templates</button>} />
          )}
        </div>
      );
    }
    return <TemplateEditorPage key={templateId} template={template} onBack={onBackToList} {...props} />;
  }

  const query = search.trim().toLowerCase();
  const visible = templates.filter((template) => !query || `${template.name} ${template.description} ${template.criteria.map((item) => item.name).join(' ')}`.toLowerCase().includes(query));
  const selected = visible.filter((template) => selectedIds.has(template.id));
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const someSelected = selected.length > 0 && !allSelected;
  const toggle = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="k-page">
      <PageHeader
        title="Jobs"
        actions={status === 'ready' && templates.length > 0 ? (
          <button className="k-btn k-btn-primary" type="button" onClick={() => onOpen('new')}>
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />New template
          </button>
        ) : undefined}
      />
      <JobsSectionTabs section="templates" templateCount={templates.length} onChange={onSection} />
      <p className="k-secondary mb-4">Save a Candidate Assessment once and reuse it across job listings. Select several to use them together or tidy up.</p>

      {status === 'loading' ? (
        <SkeletonRows count={3} label="Loading templates" />
      ) : status === 'unavailable' ? (
        <Banner tone="warn">Assessment templates aren't available on this database yet. Apply the migration 20261003090000_assessment_templates.sql.</Banner>
      ) : status === 'error' ? (
        <EmptyState title="Templates couldn't load" text="Check your connection and refresh the page." />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={faClipboardList}
          title="No assessment templates yet"
          text="Create one from scratch, or copy the questions a job already uses, then apply it to any number of jobs."
          actions={<button className="k-btn k-btn-primary" type="button" onClick={() => onOpen('new')}>New template</button>}
        />
      ) : (
        <>
          <div className="k-toolbar">
            <SearchField value={search} onChange={(value) => { setSearch(value); setSelectedIds(new Set()); }} label="Search templates" placeholder="Search name or question" />
          </div>
          {visible.length === 0 ? (
            <EmptyState title="No templates match" actions={<button className="k-btn k-btn-secondary" type="button" onClick={() => setSearch('')}>Reset</button>} />
          ) : (
            <>
              <label className="k-select-all k-secondary">
                <span className="k-select-box -ml-1.5">
                  <input type="checkbox" checked={allSelected} ref={(input) => { if (input) input.indeterminate = someSelected; }} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(visible.map((item) => item.id)))} />
                </span>
                {selected.length > 0 ? `${selected.length} of ${visible.length} selected` : `Select all ${visible.length}`}
              </label>
              <div className="k-job-grid">
                {visible.map((template) => {
                  const required = template.criteria.filter((item) => item.isRequired).length;
                  const used = usage.get(template.id) || 0;
                  return (
                    <article key={template.id} className={`k-job-card ${selectedIds.has(template.id) ? 'k-job-card-selected' : ''}`}>
                      <div className="flex min-w-0 items-start gap-2">
                        <label className="k-select-box -ml-2 -mt-1.5">
                          <input type="checkbox" checked={selectedIds.has(template.id)} onChange={() => toggle(template.id)} aria-label={`Select ${template.name}`} />
                        </label>
                        <div className="min-w-0 flex-1">
                          <h3 className="k-item-title">
                            <button className="k-card-link" type="button" onClick={() => onOpen(template.id)} aria-label={`${template.name}, open template`}>{template.name}</button>
                          </h3>
                          {template.description && <p className="k-meta mt-0.5 truncate">{template.description}</p>}
                        </div>
                        <span className={used > 0 ? 'k-badge k-badge-success' : 'k-badge k-badge-outline'}>{used > 0 ? `${used} job${used === 1 ? '' : 's'}` : 'Unused'}</span>
                      </div>
                      <p className="k-secondary k-dot-sep pl-8">
                        <span>{template.criteria.length} question{template.criteria.length === 1 ? '' : 's'}</span>
                        <span>{required} required</span>
                        {template.updatedAt && <span>Updated {formatDateLabel(template.updatedAt.slice(0, 10))}</span>}
                      </p>
                      <p className="k-meta truncate pl-8">{template.criteria.map((item) => item.name).join(' · ')}</p>
                    </article>
                  );
                })}
              </div>
              {selected.length > 0 && (
                <div className="k-bulk-bar" role="toolbar" aria-label="Actions for selected templates">
                  <span className="k-bulk-bar-count">{selected.length} selected</span>
                  <button className="k-btn k-btn-primary k-btn-sm" type="button" onClick={() => setApplying(selected)}>
                    <FontAwesomeIcon icon={faShareFromSquare} aria-hidden="true" />{selected.length > 1 ? 'Combine and use in jobs' : 'Use in jobs'}
                  </button>
                  {selected.length === 1 && (
                    <button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={() => onOpen(selected[0].id)}>
                      <FontAwesomeIcon icon={faCopy} aria-hidden="true" />Open
                    </button>
                  )}
                  <button className="k-btn k-btn-danger-outline k-btn-sm" type="button" onClick={() => setDeleting(selected.map((item) => item.id))}>
                    <FontAwesomeIcon icon={faTrash} aria-hidden="true" />Delete ({selected.length})
                  </button>
                  <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={() => setSelectedIds(new Set())}>Clear</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {applying && (
        <ApplyToJobsModal
          templates={applying}
          jobs={jobs.filter((job) => job.status !== 'archived')}
          describeJob={describeJob}
          onApply={async (jobIds) => {
            const done = await onApply(applying.map((item) => item.id), jobIds);
            if (done) setSelectedIds(new Set());
            return done;
          }}
          onClose={() => setApplying(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.length} template${deleting.length === 1 ? '' : 's'}?`}
          message="Jobs using them keep their questions; only the templates are removed."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { await onDelete(deleting); setSelectedIds(new Set()); setDeleting(null); }}
        />
      )}
    </div>
  );
}
