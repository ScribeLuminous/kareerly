import { useCallback, useEffect, useState } from 'react';
import {
  fetchLearningStatus,
  fetchSkillCandidates,
  reviewSkillCandidate,
  rollbackRankingModel,
  runLearningJobs,
} from '../lib/api';
import type { LearningStatus, SkillCandidate, SkillReviewInput } from '../lib/api';

const BASELINE_VERSION = 'baseline-composite-v1';

const REASON_LABELS: Record<string, string> = {
  low_confidence: 'Low confidence',
  profile_only: 'Only from candidate profiles',
  single_company: 'Only one employer',
  near_existing_skill: 'Close to an existing skill',
  contains_existing_skill: 'Contains an existing skill',
  ambiguous_existing_match: 'Matches several skills',
};

const OUTCOME_LABELS: Record<string, string> = {
  promoted: 'New model activated',
  kept_current: 'Kept current ranking',
  insufficient_data: 'Not enough feedback yet',
  failed: 'Run failed',
  rolled_back: 'Rolled back',
};

type Props = { getToken: () => Promise<string> };

export default function AdminLearningPanel({ getToken }: Props) {
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { label: string; skillId: string; categoryId: string }>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getToken();
      const [nextStatus, nextCandidates] = await Promise.all([fetchLearningStatus(token), fetchSkillCandidates(token)]);
      setStatus(nextStatus);
      setCandidates(nextCandidates.candidates);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load learning status.');
    }
  }, [getToken]);

  useEffect(() => {
    // Loading data from the server on mount; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = async (key: string, action: (token: string) => Promise<string>) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      setMessage(await action(await getToken()));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const runJobs = (dryRun: boolean) => act(dryRun ? 'dry-run' : 'run', async (token) => {
    const report = await runLearningJobs(token, { job: 'all', dry_run: dryRun }) as { ranking?: { outcome?: string; reason?: string } };
    const outcome = report.ranking?.outcome || 'unknown';
    return `${dryRun ? 'Evaluation only (nothing saved)' : 'Learning run finished'}: ${OUTCOME_LABELS[outcome] || outcome}${report.ranking?.reason ? ` — ${report.ranking.reason}` : ''}.`;
  });

  const rollback = (version?: string) => {
    const target = version || BASELINE_VERSION;
    if (!window.confirm(`Switch job ranking to ${target}? Matching picks this up within five minutes.`)) return;
    void act(`rollback-${target}`, async (token) => {
      const result = await rollbackRankingModel(token, version);
      return `Ranking switched from ${result.previous_version} to ${result.active_version}.`;
    });
  };

  const review = (candidate: SkillCandidate, input: SkillReviewInput) => act(`review-${candidate.id}`, async (token) => {
    const result = await reviewSkillCandidate(token, candidate.id, input);
    return result.status === 'rejected'
      ? `Rejected “${candidate.display_label}”.`
      : `Approved “${input.label || candidate.display_label}” as ${result.kind === 'alias' ? `an alias of ${result.skill_id}` : `new skill ${result.skill_id}`}. It is usable within five minutes.`;
  });

  const edit = (candidate: SkillCandidate) => edits[candidate.id] || {
    label: candidate.display_label, skillId: candidate.suggested_skill_id || '', categoryId: '',
  };
  const setEdit = (candidate: SkillCandidate, patch: Partial<{ label: string; skillId: string; categoryId: string }>) =>
    setEdits((current) => ({ ...current, [candidate.id]: { ...edit(candidate), ...patch } }));

  const active = status?.ranking.active_model.version || BASELINE_VERSION;
  const restorable = (status?.ranking.versions || []).filter((row) => row.status === 'retired' || row.status === 'rejected');

  return (
    <div className="space-y-5 p-4">
      {error && <div className="rounded-lg border border-red bg-red-l px-4 py-3 text-sm font-semibold text-red" role="alert">{error}</div>}
      {message && <div className="rounded-lg border border-green bg-green-l px-4 py-3 text-sm font-semibold text-green" role="status">{message}</div>}

      <section aria-labelledby="ranking-heading" className="rounded-lg border border-bdr p-4">
        <h3 id="ranking-heading" className="text-sm font-extrabold">Job ranking from match feedback</h3>
        <p className="mt-1 text-xs text-soft">
          A scheduled job retrains from Good/Bad match ratings and activates a new ranking only when it beats the current one on recent ratings.
          It reorders jobs inside Fit-Now and Aspiration only; eligibility and match percentages never change.
        </p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs font-bold uppercase text-soft">Active ranking</dt><dd className="font-bold">{active}{active === BASELINE_VERSION ? ' (baseline)' : ''}</dd></div>
          <div><dt className="text-xs font-bold uppercase text-soft">Ratings collected</dt><dd className="font-bold">{status?.feedback_votes ?? '—'}</dd></div>
          <div><dt className="text-xs font-bold uppercase text-soft">Server override</dt><dd className="font-bold">{status?.ranker_override === 'baseline' ? 'Forced baseline' : 'None'}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border border-bdr px-3 py-2 text-sm font-bold text-mid hover:border-rust hover:text-rust disabled:opacity-60" disabled={Boolean(busy)} onClick={() => void runJobs(true)}>
            {busy === 'dry-run' ? 'Evaluating…' : 'Evaluate now (no changes)'}
          </button>
          <button type="button" className="rounded-lg bg-rust px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60" disabled={Boolean(busy)} onClick={() => void runJobs(false)}>
            {busy === 'run' ? 'Running…' : 'Run learning jobs now'}
          </button>
          <button type="button" className="rounded-lg border border-red px-3 py-2 text-sm font-bold text-red disabled:opacity-60" disabled={Boolean(busy) || active === BASELINE_VERSION} onClick={() => rollback()}>
            Roll back to baseline
          </button>
        </div>
        {restorable.length > 0 && (
          <div className="mt-3 text-xs">
            <span className="font-bold text-soft">Restore an earlier version: </span>
            {restorable.slice(0, 5).map((row) => (
              <button key={row.version} type="button" className="mr-2 underline text-rust disabled:opacity-60" disabled={Boolean(busy)} onClick={() => rollback(row.version)}>
                {row.version}
              </button>
            ))}
          </div>
        )}
        <h4 className="mt-4 text-xs font-bold uppercase text-soft">Recent runs</h4>
        <ul className="mt-1 space-y-1 text-xs">
          {(status?.ranking.recent_runs || []).map((run) => (
            <li key={`${run.started_at}-${run.outcome}`}>
              <span className="font-bold">{new Date(run.started_at).toLocaleString()}</span> · {OUTCOME_LABELS[run.outcome] || run.outcome}
              {run.reason ? ` — ${run.reason}` : ''} <span className="text-soft">({run.trigger})</span>
            </li>
          ))}
          {status && status.ranking.recent_runs.length === 0 && <li className="text-soft">No runs yet. Check that the daily schedule is configured.</li>}
        </ul>
      </section>

      <section aria-labelledby="skills-heading" className="rounded-lg border border-bdr p-4">
        <h3 id="skills-heading" className="text-sm font-extrabold">Skill proposals awaiting review ({candidates.length})</h3>
        <p className="mt-1 text-xs text-soft">
          Found in job posts and candidates’ custom skills. Nothing is added to the skill catalog until it is approved here.
        </p>
        {candidates.length === 0 && <p className="mt-3 text-sm text-soft">No pending proposals.</p>}
        <ul className="mt-3 space-y-3">
          {candidates.map((candidate) => {
            const values = edit(candidate);
            const rowBusy = busy === `review-${candidate.id}`;
            return (
              <li key={candidate.id} className="rounded-lg border border-bdr p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-extrabold">{candidate.display_label}</div>
                  <div className="text-xs text-soft">
                    Confidence {Math.round(candidate.confidence * 100)}% · {candidate.job_source_count} jobs · {candidate.company_count} employers · {candidate.profile_source_count} profiles
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-xs">
                  <span className="rounded bg-cream px-2 py-0.5 font-bold">
                    Suggested: {candidate.suggested_action === 'alias' ? `alias of ${candidate.suggested_skill_id}` : candidate.suggested_action === 'new_skill' ? 'new skill' : 'needs review'}
                  </span>
                  {candidate.review_reasons.map((reason) => <span key={reason} className="rounded bg-amber-l px-2 py-0.5 text-amber">{REASON_LABELS[reason] || reason}</span>)}
                </div>
                {candidate.evidence.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-mid">
                    {candidate.evidence.map((item, index) => (
                      <li key={index}>{item.snippet ? `“${item.snippet}”` : 'Candidate custom skill'}{item.job ? ` — ${item.job}` : ''}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <label className="text-xs font-bold text-soft">Skill name
                    <input className="mt-1 w-full rounded border border-bdr px-2 py-1 text-sm text-dark" value={values.label} onChange={(event) => setEdit(candidate, { label: event.target.value })} />
                  </label>
                  <label className="text-xs font-bold text-soft">Category (new skill, e.g. K02)
                    <input className="mt-1 w-full rounded border border-bdr px-2 py-1 text-sm text-dark" value={values.categoryId} onChange={(event) => setEdit(candidate, { categoryId: event.target.value })} />
                  </label>
                  <label className="text-xs font-bold text-soft">Existing skill ID (alias)
                    <input className="mt-1 w-full rounded border border-bdr px-2 py-1 text-sm text-dark" value={values.skillId} onChange={(event) => setEdit(candidate, { skillId: event.target.value })} />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg bg-green px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60" disabled={Boolean(busy)}
                    onClick={() => void review(candidate, { action: 'approve_new', label: values.label, category_id: values.categoryId || undefined })}>
                    {rowBusy ? 'Saving…' : 'Approve as new skill'}
                  </button>
                  <button type="button" className="rounded-lg border border-green px-3 py-1.5 text-xs font-bold text-green disabled:opacity-60" disabled={Boolean(busy) || !values.skillId}
                    onClick={() => void review(candidate, { action: 'approve_alias', label: values.label, skill_id: values.skillId })}>
                    Approve as alias
                  </button>
                  <button type="button" className="rounded-lg border border-red px-3 py-1.5 text-xs font-bold text-red disabled:opacity-60" disabled={Boolean(busy)}
                    onClick={() => void review(candidate, { action: 'reject' })}>
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
