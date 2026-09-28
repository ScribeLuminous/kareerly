import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp, faChevronDown, faChevronRight, faCircleCheck, faCircleExclamation, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FormField, InfoTip } from '../../components/ui';
import { emptyCriterion, RATING_SCALE, summarizeCriteria, type RubricCriterionDraft } from './evaluation';

const truncate = (text: string, length = 90) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/**
 * The whole assessment in a few lines: each criterion with its weight, whether
 * it's required, its candidate question and anything still missing. Selecting
 * a line opens that criterion when `onJump` is given.
 */
export function AssessmentSummary({ criteria, onJump, compact = false }: { criteria: RubricCriterionDraft[]; onJump?: (key: string) => void; compact?: boolean }) {
  const { rows, required, ready } = summarizeCriteria(criteria);
  return (
    <section className="rounded-[12px] border border-bdr bg-bg p-3" aria-label="Assessment summary">
      <p className="k-label flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Summary</span>
        <span className="k-meta k-dot-sep">
          <span>{rows.length} question{rows.length === 1 ? '' : 's'}</span>
          <span>{required} required</span>
          {!compact && <span className={ready === rows.length ? 'text-green' : 'text-rust'}>{ready} of {rows.length} ready</span>}
        </span>
      </p>
      <ol className="mt-2 space-y-1">
        {rows.map((row) => {
          const content = (
            <>
              <span className="k-num w-5 shrink-0 text-soft-text">{row.index + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="k-label">{row.name || 'Untitled criterion'}</span>
                  <span className="k-meta">{row.share}% · {row.isRequired ? 'Required' : 'Optional'}</span>
                </span>
                <span className="k-secondary block truncate text-[13px]">{row.question ? truncate(row.question) : 'No question yet'}</span>
              </span>
              {!compact && (row.issues.length === 0
                ? <FontAwesomeIcon icon={faCircleCheck} className="mt-1 shrink-0 text-green" aria-label="Ready" />
                : <span className="k-badge k-badge-warn shrink-0"><FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />{row.issues[0]}</span>)}
            </>
          );
          return (
            <li key={row.key}>
              {onJump ? (
                <button className="flex w-full items-start gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-card" type="button" onClick={() => onJump(row.key)}>{content}</button>
              ) : (
                <div className="flex items-start gap-2 px-2 py-1.5">{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type EditorProps = {
  criteria: RubricCriterionDraft[];
  onChange: (criteria: RubricCriterionDraft[]) => void;
};

/**
 * Criteria editor: the summary on top, then one collapsible card per
 * criterion, so a long assessment doesn't turn into one endless form.
 */
export function AssessmentCriteriaEditor({ criteria, onChange }: EditorProps) {
  // Cards start closed once filled in; ones still missing something start open.
  const [open, setOpen] = useState<Set<string>>(() => new Set(summarizeCriteria(criteria).rows.filter((row) => row.issues.length > 0).map((row) => row.key)));
  const { rows } = summarizeCriteria(criteria);

  const update = (key: string, patch: Partial<RubricCriterionDraft>) => onChange(criteria.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const move = (index: number, delta: number) => {
    const next = [...criteria];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  const toggle = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const jump = (key: string) => {
    setOpen((current) => new Set(current).add(key));
    window.setTimeout(() => document.getElementById(`criterion-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const add = () => {
    const criterion = emptyCriterion();
    onChange([...criteria, criterion]);
    jump(criterion.key);
  };
  const allOpen = criteria.every((criterion) => open.has(criterion.key));

  return (
    <div className="space-y-4">
      <AssessmentSummary criteria={criteria} onJump={jump} />

      <div className="flex items-center justify-between gap-2">
        <h3 className="k-label">Questions and criteria</h3>
        <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(criteria.map((item) => item.key)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <ol className="space-y-3">
        {criteria.map((criterion, index) => {
          const row = rows[index];
          const isOpen = open.has(criterion.key);
          const label = criterion.name || `criterion ${index + 1}`;
          return (
            <li key={criterion.key} id={`criterion-${criterion.key}`} className="scroll-mt-4 rounded-[12px] border border-bdr">
              <div className="flex items-start gap-2 p-3">
                <button className="flex min-w-0 flex-1 items-start gap-2 text-left" type="button" aria-expanded={isOpen} aria-controls={`criterion-body-${criterion.key}`} onClick={() => toggle(criterion.key)}>
                  <FontAwesomeIcon icon={isOpen ? faChevronDown : faChevronRight} className="mt-1 w-3 shrink-0 text-soft-text" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="k-label block">{index + 1}. {criterion.name || 'Untitled criterion'}</span>
                    <span className="k-meta block">
                      {row.share}% of the weight · {criterion.isRequired ? 'Required' : 'Optional'}
                      {row.issues.length > 0 && <span className="text-rust"> · {row.issues.join(', ')}</span>}
                    </span>
                    {!isOpen && criterion.question && <span className="k-secondary block truncate text-[13px]">{truncate(criterion.question, 120)}</span>}
                  </span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button className="k-icon-btn" type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${label} up`}><FontAwesomeIcon icon={faArrowUp} aria-hidden="true" /></button>
                  <button className="k-icon-btn" type="button" onClick={() => move(index, 1)} disabled={index === criteria.length - 1} aria-label={`Move ${label} down`}><FontAwesomeIcon icon={faArrowDown} aria-hidden="true" /></button>
                  <button className="k-icon-btn" type="button" onClick={() => onChange(criteria.filter((item) => item.key !== criterion.key))} disabled={criteria.length === 1} aria-label={`Remove ${label}`}><FontAwesomeIcon icon={faTrash} aria-hidden="true" /></button>
                </div>
              </div>

              {isOpen && (
                <div id={`criterion-body-${criterion.key}`} className="border-t border-bdr p-3">
                  <div className="grid gap-3 [&>.k-field+.k-field]:mt-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <FormField label="Name">
                      <input className="k-input" value={criterion.name} maxLength={120} onChange={(event) => update(criterion.key, { name: event.target.value })} />
                    </FormField>
                    <FormField label="Weight (1–5)" help="How much it counts relative to the others.">
                      <select className="k-select" value={criterion.weight} onChange={(event) => update(criterion.key, { weight: Number(event.target.value) })}>
                        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </FormField>
                  </div>
                  <FormField label="Candidate Assessment question *" className="mt-3">
                    <textarea className="k-textarea" rows={3} maxLength={1000} required value={criterion.question} onChange={(event) => update(criterion.key, { question: event.target.value })} />
                  </FormField>
                  <FormField label="What it means for this job" className="mt-3">
                    <textarea className="k-textarea" rows={2} maxLength={1000} value={criterion.description} onChange={(event) => update(criterion.key, { description: event.target.value })} />
                  </FormField>
                  <label className="mt-3 flex items-center gap-2">
                    <input type="checkbox" checked={criterion.isRequired} onChange={(event) => update(criterion.key, { isRequired: event.target.checked })} />
                    <span className="k-label">Required answer</span>
                    <InfoTip label="About required criteria">The team score stays hidden until every required criterion has been assessed by at least one reviewer.</InfoTip>
                  </label>
                  <details className="mt-3">
                    <summary className="k-label cursor-pointer">Rating guidance and reviewer prompts</summary>
                    <fieldset className="mt-2">
                      <legend className="k-meta">What each rating means</legend>
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
                      <legend className="k-meta">Questions or prompts for reviewers</legend>
                      <div className="mt-1 space-y-2">
                        {criterion.prompts.map((prompt, promptIndex) => (
                          <div key={promptIndex} className="flex gap-2">
                            <input
                              className="k-input"
                              value={prompt}
                              maxLength={300}
                              aria-label={`Reviewer prompt ${promptIndex + 1} for ${label}`}
                              onChange={(event) => update(criterion.key, { prompts: criterion.prompts.map((item, itemIndex) => (itemIndex === promptIndex ? event.target.value : item)) })}
                            />
                            <button className="k-icon-btn" type="button" aria-label={`Remove reviewer prompt ${promptIndex + 1}`} onClick={() => update(criterion.key, { prompts: criterion.prompts.filter((_, itemIndex) => itemIndex !== promptIndex) })}>
                              <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                        <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={() => update(criterion.key, { prompts: [...criterion.prompts, ''] })}>
                          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />Add prompt
                        </button>
                      </div>
                    </fieldset>
                  </details>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button className="k-btn k-btn-secondary" type="button" onClick={add} disabled={criteria.length >= 12}>
        <FontAwesomeIcon icon={faPlus} aria-hidden="true" />Add question
      </button>
    </div>
  );
}
