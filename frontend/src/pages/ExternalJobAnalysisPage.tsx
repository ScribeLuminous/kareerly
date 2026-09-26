import { useEffect, useMemo, useRef, useState } from 'react';
import {
  faArrowRight,
  faBookmark,
  faCheck,
  faChevronDown,
  faChevronUp,
  faDownload,
  faEllipsisVertical,
  faFolderOpen,
  faInfoCircle,
  faRotateRight,
  faSpinner,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  analyzeExternalJob,
  deleteSavedExternalJobMatch,
  downloadExternalJobMatchReport,
  listSavedExternalJobs,
  saveExternalJobMatch,
  type ExternalJobAnalysisResponse,
  type SavedExternalJobMatch,
} from '../lib/api';

type Props = { onOpenLearning: () => void };

const loadingSteps = ['Analyzing requirements…', 'Comparing with your profile…', 'Identifying skill gaps…'];
const SKILL_PREVIEW_COUNT = 6;

function SkillList({ items, kind, emptyLabel }: { items: string[]; kind: 'match' | 'miss'; emptyLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, SKILL_PREVIEW_COUNT);
  const remaining = Math.max(0, items.length - SKILL_PREVIEW_COUNT);

  return (
    <div>
      {visibleItems.length > 0 ? (
        <div className="external-skill-list">
          {visibleItems.map((skill, index) => (
            <span className={kind === 'match' ? 'k-skill k-skill-have' : 'k-skill k-skill-missing'} key={`${kind}-${skill}-${index}`}>{skill}</span>
          ))}
        </div>
      ) : <p className="external-empty-copy">{emptyLabel}</p>}
      {items.length > SKILL_PREVIEW_COUNT && (
        <button
          className="external-expand-btn"
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : `+ ${remaining} more`}
          <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SavedAnalysesRail({
  matches,
  loading,
  error,
  activeId,
  onOpen,
  onDelete,
}: {
  matches: SavedExternalJobMatch[];
  loading: boolean;
  error: string;
  activeId: string | null;
  onOpen: (saved: SavedExternalJobMatch) => void;
  onDelete: (saved: SavedExternalJobMatch) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!menuId) return undefined;
    const closeMenu = () => setMenuId(null);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, [menuId]);

  return (
    <aside className="external-saved-rail" aria-labelledby="saved-external-analyses-heading">
      <div className="external-saved-header">
        <h2 id="saved-external-analyses-heading">Saved analyses</h2>
        <span>{matches.length} / 5</span>
      </div>
      {loading && <div className="external-rail-status" role="status"><FontAwesomeIcon className="fa-spin" icon={faSpinner} /> Loading…</div>}
      {!loading && matches.length === 0 && (
        <div className="external-rail-empty">
          <strong>No saved analyses yet.</strong>
          <span>Save a result to compare it later.</span>
        </div>
      )}
      {error && <div className="external-inline-error" role="alert">{error}</div>}
      {matches.length > 0 && (
        <div className="external-saved-list">
          {matches.map((saved) => (
            <article className={`external-saved-item ${activeId === saved.id ? 'active' : ''}`} key={saved.id}>
              <button className="external-saved-open" type="button" onClick={() => onOpen(saved)}>
                <strong>{saved.job_title || 'External Job'}</strong>
                {saved.company_name && <span>{saved.company_name}</span>}
                <small>{Math.round(Number(saved.match_percentage) || 0)}% · {new Date(saved.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small>
              </button>
              <div className="external-saved-menu-wrap">
                <button
                  className="external-icon-btn"
                  type="button"
                  aria-label={`Actions for ${saved.job_title || 'saved analysis'}`}
                  title="Saved analysis actions"
                  aria-expanded={menuId === saved.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuId((value) => value === saved.id ? null : saved.id);
                  }}
                >
                  <FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />
                </button>
                {menuId === saved.id && (
                  <div className="external-saved-menu" onClick={(event) => event.stopPropagation()}>
                    <button type="button" onClick={() => { setMenuId(null); onOpen(saved); }}><FontAwesomeIcon icon={faFolderOpen} /> Open</button>
                    <button className="danger" type="button" onClick={() => { setMenuId(null); onDelete(saved); }}><FontAwesomeIcon icon={faTrash} /> Delete</button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}

export default function ExternalJobAnalysisPage({ onOpenLearning }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [result, setResult] = useState<ExternalJobAnalysisResponse | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [savedMatches, setSavedMatches] = useState<SavedExternalJobMatch[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [savedCurrentId, setSavedCurrentId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listSavedExternalJobs()
      .then((matches) => {
        if (active) setSavedMatches(matches);
      })
      .catch((requestError) => {
        if (active) setSavedError(requestError instanceof Error ? requestError.message : 'Saved analyses could not be loaded.');
      })
      .finally(() => {
        if (active) setSavedLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isLoading) return undefined;
    const timer = window.setInterval(() => setLoadingStep((step) => (step + 1) % loadingSteps.length), 1800);
    return () => window.clearInterval(timer);
  }, [isLoading]);

  const recommendations = useMemo(() => (result?.learning_recommendations || []).slice(0, 3), [result]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;
    const description = jobDescription.trim();
    if (!description) {
      setAnalysisError('Paste a job description to continue.');
      return;
    }
    if (description.length < 40) {
      setAnalysisError('Please paste more of the job description so Kareerly can identify its requirements.');
      return;
    }
    setAnalysisError('');
    setActionError('');
    setResult(null);
    setSavedCurrentId(null);
    setLoadingStep(0);
    setIsLoading(true);
    try {
      setResult(await analyzeExternalJob({ job_title: jobTitle.trim(), company_name: companyName.trim(), job_description: description }));
    } catch (requestError) {
      setAnalysisError(requestError instanceof Error ? requestError.message : 'External job analysis failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setSavedCurrentId(null);
    setAnalysisError('');
    setActionError('');
    setJobTitle('');
    setCompanyName('');
    setJobDescription('');
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const saveCurrentResult = async () => {
    if (!result || isSaving || savedCurrentId) return;
    setActionError('');
    setIsSaving(true);
    try {
      const saved = await saveExternalJobMatch(result);
      setSavedMatches((matches) => [saved, ...matches.filter((match) => match.id !== saved.id)].slice(0, 5));
      setSavedCurrentId(saved.id);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'This analysis could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const downloadCurrentResult = async () => {
    if (!result || isDownloading) return;
    setActionError('');
    setIsDownloading(true);
    try {
      await downloadExternalJobMatchReport(result);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'The report could not be downloaded.');
    } finally {
      setIsDownloading(false);
    }
  };

  const openSavedMatch = (saved: SavedExternalJobMatch) => {
    setResult(saved.analysis);
    setSavedCurrentId(saved.id);
    setActionError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeSavedMatch = async (saved: SavedExternalJobMatch) => {
    setSavedError('');
    try {
      await deleteSavedExternalJobMatch(saved.id);
      setSavedMatches((matches) => matches.filter((match) => match.id !== saved.id));
      if (savedCurrentId === saved.id) setSavedCurrentId(null);
    } catch (requestError) {
      setSavedError(requestError instanceof Error ? requestError.message : 'This saved analysis could not be deleted.');
    }
  };

  return (
    <div className="k-page external-analysis-page">
      <div className="k-page-header">
        <div>
          <h1 className="k-page-title">Analyze a job</h1>
          <p className="k-secondary mt-1">Paste a job post from any site to see how well it fits you.</p>
        </div>
      </div>

      <div className="external-analysis-layout">
        <div className="external-analysis-main">
          {!result && (
            <form className="external-input-surface" onSubmit={submit} noValidate ref={formRef} aria-busy={isLoading}>
              <label className="external-description-label k-field block" htmlFor="external-job-description">
                <span className="k-label">Job description</span>
                <textarea
                  id="external-job-description"
                  className="k-textarea mt-1.5 min-h-[220px]"
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                  maxLength={30000}
                  required
                  disabled={isLoading}
                  placeholder="Paste the full job post here"
                  aria-invalid={Boolean(analysisError)}
                  aria-describedby="external-job-description-help external-analysis-error"
                />
              </label>
              <div id="external-job-description-help" className="k-help flex justify-between gap-3">
                <span>Kareerly won't open links in the text.</span>
                <span className="k-num">{jobDescription.length.toLocaleString()} / 30,000</span>
              </div>
              <details className="mt-4" open={Boolean(jobTitle || companyName)}>
                <summary className="k-link cursor-pointer">Add job title and company (optional)</summary>
                <div className="k-form-grid mt-3">
                  <label className="k-field block">
                    <span className="k-label">Job title</span>
                    <input className="k-input mt-1.5" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} maxLength={200} disabled={isLoading} />
                  </label>
                  <label className="k-field block">
                    <span className="k-label">Company</span>
                    <input className="k-input mt-1.5" value={companyName} onChange={(event) => setCompanyName(event.target.value)} maxLength={200} disabled={isLoading} autoComplete="organization" />
                  </label>
                </div>
              </details>
              {analysisError && <p id="external-analysis-error" className="k-error" role="alert">{analysisError}</p>}
              <div className="external-form-submit">
                <button className="k-btn k-btn-primary" type="submit" disabled={isLoading}>
                  {isLoading && <FontAwesomeIcon className="fa-spin" icon={faSpinner} aria-hidden="true" />}
                  {isLoading ? loadingSteps[loadingStep] : 'Analyze Job'}
                </button>
                {isLoading && <span className="k-meta" role="status" aria-live="polite">This takes a few seconds.</span>}
              </div>
            </form>
          )}

          {result && (
            <div className="external-result" aria-live="polite">
              <section className="external-result-header" aria-labelledby="external-result-title">
                <div className="external-result-eyebrow-row">
                  <span>External Job Analysis</span>
                  <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={reset}>
                    <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" /> Analyze another job
                  </button>
                </div>
                <h2 id="external-result-title">{result.job.title?.trim() || 'External Job'}</h2>
                {result.job.company_name?.trim() && <p className="external-result-company">{result.job.company_name}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="k-score k-score-lg">{Math.round(Number(result.match.match_percentage) || 0)}%</span>
                  <span className={/fit/i.test(result.match.match_type || '') ? 'k-badge k-badge-fit' : 'k-badge k-badge-aspiration'}>{result.match.match_type}</span>
                  <span className="k-meta">Skill coverage {Math.round((Number(result.match.skill_coverage) || 0) * 100)}%</span>
                </div>
                <div className="external-why">
                  <h3>Why this matches</h3>
                  <p>{result.match.explanation}</p>
                </div>
                <div className="external-result-actions">
                  <button className={savedCurrentId ? 'k-btn k-btn-secondary' : 'k-btn k-btn-primary'} type="button" onClick={saveCurrentResult} disabled={isSaving || Boolean(savedCurrentId) || (savedMatches.length >= 5 && !savedCurrentId)}>
                    <FontAwesomeIcon icon={savedCurrentId ? faCheck : faBookmark} aria-hidden="true" />
                    {savedCurrentId ? 'Saved' : isSaving ? 'Saving…' : 'Save Match'}
                  </button>
                  <button className="k-btn k-btn-secondary" type="button" onClick={downloadCurrentResult} disabled={isDownloading}>
                    <FontAwesomeIcon className={isDownloading ? 'fa-spin' : ''} icon={isDownloading ? faSpinner : faDownload} aria-hidden="true" />
                    {isDownloading ? 'Generating…' : 'Download'}
                  </button>
                </div>
                {savedMatches.length >= 5 && !savedCurrentId && <p className="external-action-hint">Saved limit reached. Delete one saved analysis before saving this result.</p>}
                {actionError && <div className="external-inline-error" role="alert">{actionError}</div>}
              </section>

              <section className="external-section external-skills-section" aria-labelledby="external-skills-heading">
                <h3 id="external-skills-heading">Skills</h3>
                <div className="external-skills-grid">
                  <div>
                    <h4>Matched Skills</h4>
                    <SkillList items={result.matched_skills || []} kind="match" emptyLabel="No confirmed matches detected yet." />
                  </div>
                  <div>
                    <h4>Skills to Develop</h4>
                    <SkillList items={result.missing_skills || []} kind="miss" emptyLabel="No canonical required skill gaps were identified." />
                  </div>
                </div>
              </section>

              <section className="external-section external-learning-section" aria-labelledby="external-learning-heading">
                <div className="external-section-heading-row">
                  <div>
                    <h3 id="external-learning-heading">What to Learn Next</h3>
                  </div>
                  <button className="k-link" type="button" onClick={onOpenLearning}>View recommendations <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" /></button>
                </div>
                {recommendations.length > 0 ? (
                  <div className="external-resource-list">
                    {recommendations.map((resource, index) => {
                      const title = String(resource.title || resource.course_or_certification_title || 'Learning resource');
                      const provider = String(resource.provider || resource.offered_by_provider || 'Kareerly catalog');
                      const url = typeof resource.url === 'string' ? resource.url : typeof resource.external_course_or_certification_link === 'string' ? resource.external_course_or_certification_link : '';
                      return (
                        <div className="external-resource" key={`${title}-${index}`}>
                          <div><strong>{title}</strong><span>{provider}</span></div>
                          {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title}`}><FontAwesomeIcon icon={faArrowRight} aria-hidden="true" /></a>}
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="external-empty-copy">No curated learning resource is available for these skills yet.</p>}
              </section>

              {result.warnings?.map((warning) => <div className="k-banner k-banner-warn mt-4" role="status" key={warning}>{warning}</div>)}

              <div className="external-info-notice" aria-label="External job notice">
                <FontAwesomeIcon icon={faInfoCircle} aria-hidden="true" />
                <span>Applications on other sites aren't tracked in Kareerly.</span>
              </div>
            </div>
          )}
        </div>

        <SavedAnalysesRail
          matches={savedMatches}
          loading={savedLoading}
          error={savedError}
          activeId={savedCurrentId}
          onOpen={openSavedMatch}
          onDelete={removeSavedMatch}
        />
      </div>
    </div>
  );
}
