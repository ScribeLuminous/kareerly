import { STRONG_MATCH_PERCENT } from '../matchTiers';
import type { Kpis } from '../insightsModel';

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="px-4 py-4 sm:px-6">
      <dt className="k-meta">{label}</dt>
      <dd className="k-num mt-1 text-[32px] font-bold leading-9 text-dark sm:text-[36px] sm:leading-10">{value}</dd>
      <dd className="k-meta mt-0.5">{note}</dd>
    </div>
  );
}

/** Three numbers and nothing else. */
export function SummaryCard({ kpis }: { kpis: Kpis }) {
  const withoutData = kpis.applicants - kpis.scored;
  return (
    <section aria-labelledby="insights-summary">
      <h2 id="insights-summary" className="sr-only">Summary</h2>
      <dl className="k-card grid grid-cols-3 divide-x divide-bdr p-0">
        <Stat label="Applicants" value={kpis.applicants} note={`${kpis.jobs} job${kpis.jobs === 1 ? '' : 's'}`} />
        <Stat label="Strong matches" value={kpis.strong} note={`${STRONG_MATCH_PERCENT}%+ of skills`} />
        <Stat label="Interviewing or hired" value={kpis.advanced} note="in progress" />
      </dl>
      {withoutData > 0 && (
        <p className="k-meta mt-2">{withoutData} applicant{withoutData === 1 ? ' has' : 's have'} no skill data yet, so can't be scored.</p>
      )}
    </section>
  );
}
