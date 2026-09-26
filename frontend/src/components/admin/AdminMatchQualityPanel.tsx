import { useCallback, useEffect, useState } from 'react';
import { fetchMatchFeedbackStats } from '../../lib/api';
import type { MatchFeedbackStats, VoteBucket } from '../../lib/api';
import { buttonClass } from './adminShared';
import { PanelMessage } from './adminUi';
import type { AdminPanelProps } from './adminShared';

function percent(rate: number | null): string {
  return rate === null ? '-' : `${Math.round(rate * 100)}%`;
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-bdr bg-card px-4 py-3">
      <div className="text-xs font-bold uppercase text-soft-text">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-dark">{value}</div>
      {hint && <div className="text-xs text-soft-text">{hint}</div>}
    </div>
  );
}

// One row per group: a 100% bar split into good (green) and bad (red) votes,
// with the counts written out so the colors are never the only cue.
function SplitBars({ title, rows }: { title: string; rows: Array<{ label: string; bucket: VoteBucket }> }) {
  return (
    <section className="rounded-lg border border-bdr bg-card p-4">
      <h3 className="mb-3 text-sm font-extrabold text-dark">{title}</h3>
      <div className="space-y-3">
        {rows.map(({ label, bucket }) => {
          const goodShare = bucket.total ? (bucket.good / bucket.total) * 100 : 0;
          return (
            <div key={label} title={`${label}: ${bucket.good} good, ${bucket.bad} bad (${percent(bucket.good_rate)} good)`}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="font-bold text-mid">{label}</span>
                <span className="whitespace-nowrap text-soft-text">
                  {bucket.total ? <><strong className="text-dark">{percent(bucket.good_rate)}</strong> good · {bucket.good} / {bucket.bad}</> : 'No votes'}
                </span>
              </div>
              <div className="flex h-2.5 gap-[2px] overflow-hidden rounded bg-bg">
                {bucket.good > 0 && <div className="h-full rounded bg-green" style={{ width: `${goodShare}%` }} />}
                {bucket.bad > 0 && <div className="h-full flex-1 rounded bg-red" />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function weekLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? isoDate : `Week of ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export default function AdminMatchQualityPanel({ getToken, notify }: AdminPanelProps) {
  const [stats, setStats] = useState<MatchFeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await fetchMatchFeedbackStats(await getToken()));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to load match feedback statistics.', 'error');
    } finally {
      setLoading(false);
    }
  }, [getToken, notify]);

  useEffect(() => {
    // Loading data from the server; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading && !stats) return <PanelMessage>Loading match feedback...</PanelMessage>;
  if (!stats) return <PanelMessage>Match feedback statistics are unavailable.</PanelMessage>;
  if (stats.totals.total === 0) return <PanelMessage>No candidate has rated a match yet. Ratings appear here once candidates mark recommendations as good or bad.</PanelMessage>;

  return (
    <div className="space-y-4 border-t border-bdr p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-soft-text">
          Candidates rate each recommended job as a good or bad match. <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green" /> Good</span>{' '}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red" /> Bad</span>
        </p>
        <button className={buttonClass} type="button" onClick={() => void load()}>Refresh</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Good match rate" value={percent(stats.totals.good_rate)} hint="share of all votes" />
        <Tile label="Good votes" value={stats.totals.good} />
        <Tile label="Bad votes" value={stats.totals.bad} />
        <Tile label="Total votes" value={stats.totals.total} />
        <Tile label="Candidates voting" value={stats.totals.voters} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SplitBars title="By match type" rows={Object.entries(stats.by_category).map(([label, bucket]) => ({ label, bucket }))} />
        <SplitBars title="By match score shown" rows={stats.by_score_band.map((item) => ({ label: item.band, bucket: item }))} />
        <SplitBars title="Last 8 weeks" rows={stats.by_week.map((item) => ({ label: weekLabel(item.week_start), bucket: item }))} />
        <SplitBars title="By ranking model" rows={stats.by_ranker_version.map((item) => ({ label: item.version, bucket: item }))} />
      </div>

      <section className="rounded-lg border border-bdr bg-card">
        <h3 className="px-4 py-3 text-sm font-extrabold text-dark">Jobs most often rated a bad match</h3>
        {stats.most_downvoted_jobs.length === 0 ? <PanelMessage>No job has a bad rating yet.</PanelMessage> : (
          <div className="overflow-x-auto border-t border-bdr">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-bg text-xs uppercase text-soft-text">
                <tr>
                  <th className="px-4 py-3 font-extrabold">Job</th>
                  <th className="px-4 py-3 font-extrabold">Source</th>
                  <th className="px-4 py-3 text-right font-extrabold">Bad</th>
                  <th className="px-4 py-3 text-right font-extrabold">Good</th>
                  <th className="px-4 py-3 text-right font-extrabold">Good rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bdr">
                {stats.most_downvoted_jobs.map((job) => (
                  <tr key={`${job.job_source}:${job.job_id}`} className="bg-card">
                    <td className="px-4 py-3">
                      <div className="font-bold text-dark">{job.job_title || job.job_id}</div>
                      <div className="text-xs text-soft-text">{job.company_name ? `${job.company_name} · ` : ''}{job.job_id}</div>
                    </td>
                    <td className="px-4 py-3 capitalize text-mid">{job.job_source}</td>
                    <td className="px-4 py-3 text-right font-bold text-dark">{job.bad}</td>
                    <td className="px-4 py-3 text-right text-mid">{job.good}</td>
                    <td className="px-4 py-3 text-right text-mid">{percent(job.good_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
