import { useEffect, useMemo, useState } from 'react';
import {
  analyzeExternalJob,
  deleteSavedExternalJobMatch,
  listSavedExternalJobs,
  saveExternalJobMatch,
  type ExternalJobAnalysisResponse,
  type SavedExternalJobMatch,
} from '../lib/api';

type Props = { onOpenLearning: () => void };

const loadingSteps = ['Analyzing job requirements…', 'Comparing with your profile…', 'Identifying skill gaps…'];

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function downloadExternalJobReport(analysis: ExternalJobAnalysisResponse) {
  const safeUrl = (value: unknown) => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
  const list = (items: unknown[], emptyLabel: string) => items.length > 0
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : `<p class="muted">${escapeHtml(emptyLabel)}</p>`;
  const recommendations = analysis.learning_recommendations || [];
  const recommendationMarkup = recommendations.length > 0
    ? `<ul>${recommendations.slice(0, 5).map((resource) => {
      const title = resource.title || resource.course_or_certification_title || 'Learning resource';
      const provider = resource.provider || resource.offered_by_provider || 'Kareerly catalog';
      const url = safeUrl(resource.url || resource.external_course_or_certification_link);
      return `<li><strong>${escapeHtml(title)}</strong> <span class="muted">(${escapeHtml(provider)})</span>${url ? ` — <a href="${escapeHtml(url)}">Open resource</a>` : ''}</li>`;
    }).join('')}</ul>`
    : '<p class="muted">No current curated resource is available.</p>';
  const title = analysis.job.title || 'External job match';
  const filename = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'external-job-match'}-report.html`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} — Kareerly Match Report</title><style>
    body{font-family:Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#28251f;line-height:1.55}h1{margin-bottom:4px}h2{margin-top:28px;border-bottom:1px solid #ddd4c8;padding-bottom:6px}.muted{color:#766f65}.score{font-size:42px;font-weight:700;color:#a54d2d;margin:18px 0 0}ul{padding-left:22px}li{margin:6px 0}a{color:#a54d2d}
  </style></head><body><p class="muted">Kareerly External Job Match Report</p><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(analysis.job.company_name || 'Company not provided')}</p><div class="score">${Math.round(Number(analysis.match.match_percentage) || 0)}% match</div><p>${escapeHtml(analysis.match.match_type || '')}</p><h2>Why this matches</h2><p>${escapeHtml(analysis.match.explanation)}</p><h2>Matched skills</h2>${list(analysis.matched_skills || [], 'No confirmed matches detected yet.')}<h2>Skills to develop</h2>${list(analysis.missing_skills || [], 'No canonical required skill gaps were identified.')}<h2>What to learn next</h2>${recommendationMarkup}<p class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</p></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExternalJobAnalysisPage({ onOpenLearning }: Props) {
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [result, setResult] = useState<ExternalJobAnalysisResponse | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [savedMatches, setSavedMatches] = useState<SavedExternalJobMatch[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
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
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoading) return undefined;
    const timer = window.setInterval(() => setLoadingStep((step) => (step + 1) % loadingSteps.length), 1800);
    return () => window.clearInterval(timer);
  }, [isLoading]);

  const recommendations = useMemo(() => (result?.learning_recommendations || []).slice(0, 3), [result]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const description = jobDescription.trim();
    if (!description) {
      setError('Paste a job description to continue.');
      return;
    }
    if (description.length < 40) {
      setError('Please paste more of the job description so Kareerly can identify its requirements.');
      return;
    }
    setError('');
    setResult(null);
    setSavedCurrentId(null);
    setLoadingStep(0);
    setIsLoading(true);
    try {
      setResult(await analyzeExternalJob({ job_title: jobTitle.trim(), company_name: companyName.trim(), job_description: description }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'External job analysis failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setSavedCurrentId(null);
    setError('');
    setJobTitle('');
    setCompanyName('');
    setJobDescription('');
  };

  const saveCurrentResult = async () => {
    if (!result || isSaving || savedCurrentId) return;
    setError('');
    setIsSaving(true);
    try {
      const saved = await saveExternalJobMatch(result);
      setSavedMatches((matches) => [saved, ...matches].slice(0, 5));
      setSavedCurrentId(saved.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'This analysis could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const openSavedMatch = (saved: SavedExternalJobMatch) => {
    setResult(saved.analysis);
    setSavedCurrentId(saved.id);
    setError('');
  };

  const removeSavedMatch = async (saved: SavedExternalJobMatch) => {
    try {
      await deleteSavedExternalJobMatch(saved.id);
      setSavedMatches((matches) => matches.filter((match) => match.id !== saved.id));
      if (savedCurrentId === saved.id) setSavedCurrentId(null);
    } catch (requestError) {
      setSavedError(requestError instanceof Error ? requestError.message : 'This saved analysis could not be deleted.');
    }
  };

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Analyze External Job</h1>
        <p className="cand-page-subtitle">Paste a job description from another website to see how it matches your profile.</p>
      </div>

      <section className="cand-card mb-5 max-w-4xl" aria-labelledby="saved-external-analyses-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="saved-external-analyses-heading" className="cand-card-title">Saved external analyses</h2>
            <p className="mt-1 text-sm text-soft">Keep up to 5 job matches on your profile.</p>
          </div>
          <span className="rounded-full border border-bdr px-3 py-1 text-xs font-bold text-mid">{savedMatches.length} / 5 saved</span>
        </div>
        {savedLoading && <p className="mt-4 text-sm text-soft">Loading saved analyses…</p>}
        {!savedLoading && savedMatches.length === 0 && <p className="mt-4 text-sm text-soft">Saved results will appear here after you analyze an external job.</p>}
        {savedError && <div className="cand-notice error mt-4" role="alert">{savedError}</div>}
        {savedMatches.length > 0 && (
          <div className="mt-4 space-y-3">
            {savedMatches.map((saved) => (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bdr px-4 py-3" key={saved.id}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-dark">{saved.job_title}</div>
                  <div className="text-xs text-soft">{saved.company_name || 'Company not provided'} · {Math.round(Number(saved.match_percentage) || 0)}% match · {new Date(saved.created_at).toLocaleDateString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => openSavedMatch(saved)}>View</button>
                  <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => downloadExternalJobReport(saved.analysis)}>Download</button>
                  <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => removeSavedMatch(saved)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {!result && (
        <form className="cand-card max-w-4xl" onSubmit={submit} noValidate>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block text-sm font-bold text-dark">
              Job Title <span className="font-normal text-soft">Optional</span>
              <input className="cand-form-input mt-2 w-full" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} maxLength={200} />
            </label>
            <label className="block text-sm font-bold text-dark">
              Company <span className="font-normal text-soft">Optional</span>
              <input className="cand-form-input mt-2 w-full" value={companyName} onChange={(event) => setCompanyName(event.target.value)} maxLength={200} />
            </label>
          </div>
          <label className="mt-5 block text-sm font-bold text-dark" htmlFor="external-job-description">
            Job Description <span className="text-rust">Required</span>
            <textarea
              id="external-job-description"
              className="cand-form-input mt-2 min-h-[280px] w-full resize-y"
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              maxLength={30000}
              required
              aria-describedby="external-job-description-help"
            />
          </label>
          <div id="external-job-description-help" className="mt-2 flex justify-between text-xs text-soft">
            <span>Paste the role text as plain text. Kareerly will not visit links in the description.</span>
            <span>{jobDescription.length.toLocaleString()} / 30,000</span>
          </div>
          {error && <div className="cand-notice error mt-4" role="alert">{error}</div>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className="cand-btn-primary" type="submit" disabled={isLoading}>
              {isLoading ? loadingSteps[loadingStep] : 'Analyze Job'}
            </button>
            {isLoading && <span className="text-sm text-soft" role="status" aria-live="polite">This can take a moment while Kareerly compares your profile.</span>}
          </div>
        </form>
      )}

      {result && (
        <div className="space-y-5">
          <section className="cand-card">
            <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-rust">External Job Analysis</div>
            <h2 className="cand-card-title mt-2">{result.job.title}</h2>
            {result.job.company_name && <p className="text-sm text-soft">{result.job.company_name}</p>}
            <div className="mt-5 grid gap-4 md:grid-cols-[180px_1fr]">
              <div className="rounded-xl border border-bdr bg-cream px-5 py-4 text-center">
                <div className="font-display text-4xl font-extrabold text-rust">{Math.round(result.match.match_percentage)}%</div>
                <div className="text-sm font-bold text-dark">Match</div>
                <div className="mt-1 text-xs text-soft">Skill coverage {Math.round(result.match.skill_coverage * 100)}%</div>
              </div>
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-[0.08em] text-dark">Why this matches</h3>
                <p className="mt-2 text-sm leading-6 text-mid">{result.match.explanation}</p>
                <div className="mt-3 inline-flex rounded-full border border-bdr px-3 py-1 text-xs font-bold text-mid">{result.match.match_type}</div>
              </div>
            </div>
          </section>

          <section className="grid gap-5 md:grid-cols-2">
            <div className="cand-card">
              <h3 className="cand-card-title">Matched Skills</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {result.matched_skills.length > 0 ? result.matched_skills.map((skill) => <span className="cand-skill-match" key={`matched-${skill}`}>{skill}</span>) : <span className="text-sm text-soft">No confirmed matches detected yet.</span>}
              </div>
            </div>
            <div className="cand-card">
              <h3 className="cand-card-title">Skills to Develop</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {result.missing_skills.length > 0 ? result.missing_skills.map((skill) => <span className="cand-skill-miss" key={`missing-${skill}`}>{skill}</span>) : <span className="text-sm text-soft">No canonical required skill gaps were identified.</span>}
              </div>
            </div>
          </section>

          <section className="cand-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="cand-card-title">What to Learn Next</h3>
                <p className="mt-1 text-sm text-soft">Curated Kareerly resources for the identified gaps.</p>
              </div>
              <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenLearning}>View Learning Recommendations</button>
            </div>
            {recommendations.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {recommendations.map((resource, index) => {
                  const title = String(resource.title || resource.course_or_certification_title || 'Learning resource');
                  const provider = String(resource.provider || resource.offered_by_provider || 'Kareerly catalog');
                  const url = typeof resource.url === 'string' ? resource.url : typeof resource.external_course_or_certification_link === 'string' ? resource.external_course_or_certification_link : '';
                  return <div className="rounded-xl border border-bdr p-4" key={`${title}-${index}`}><div className="text-sm font-bold text-dark">{title}</div><div className="mt-1 text-xs text-soft">{provider}</div>{url && <a className="mt-3 inline-block text-xs font-bold text-rust underline" href={url} target="_blank" rel="noopener noreferrer">Open resource</a>}</div>;
                })}
              </div>
            ) : <p className="mt-4 text-sm text-soft">No current curated resource is available for these skills yet.</p>}
          </section>

          {result.warnings?.map((warning) => <div className="cand-notice warn" role="status" key={warning}>{warning}</div>)}

          <section className="cand-notice info" aria-label="External job notice">
            <span>This job was analyzed from a description you provided. Applications to external jobs are not tracked by Kareerly.</span>
          </section>
          <div className="flex flex-wrap gap-3">
            <button className="cand-btn-primary" type="button" onClick={saveCurrentResult} disabled={isSaving || Boolean(savedCurrentId)}>
              {savedCurrentId ? 'Saved to Profile' : isSaving ? 'Saving…' : 'Save Match to Profile'}
            </button>
            <button className="cand-btn-secondary" type="button" onClick={() => downloadExternalJobReport(result)}>Download Match Report</button>
            <button className="cand-btn-primary" type="button" onClick={reset}>Analyze Another Job</button>
            <button className="cand-btn-secondary" type="button" onClick={onOpenLearning}>View Learning Recommendations</button>
          </div>
        </div>
      )}
    </div>
  );
}
