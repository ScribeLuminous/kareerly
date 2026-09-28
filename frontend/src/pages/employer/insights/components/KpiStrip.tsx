import { STRONG_MATCH_PERCENT } from '../matchTiers';
import type { Kpis } from '../insightsModel';

function Kpi({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="k-card px-3 py-3 sm:px-4">
      <dt className="k-meta">{label}</dt>
      <dd className="k-num mt-0.5 text-[22px] font-bold leading-8 text-dark sm:text-[24px]">{value}</dd>
      {helper && <dd className="k-meta">{helper}</dd>}
    </div>
  );
}

export function KpiStrip({ kpis }: { kpis: Kpis }) {
  return (
    <section aria-labelledby="insights-summary">
      <h2 id="insights-summary" className="sr-only">Summary</h2>
      <dl className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Kpi label="Total applicants" value={String(kpis.applicants)} helper={`across ${kpis.jobs} job${kpis.jobs === 1 ? '' : 's'}`} />
        <Kpi
          label="Average match"
          value={kpis.avgMatch === null ? '—' : `${kpis.avgMatch}%`}
          helper={kpis.avgMatch === null ? 'no skill evidence yet' : kpis.scored < kpis.applicants ? `${kpis.scored} with skill evidence` : 'of required skills'}
        />
        <Kpi label="Strong matches" value={String(kpis.strong)} helper={`${STRONG_MATCH_PERCENT}% or more`} />
        <Kpi label="Interviewing or hired" value={String(kpis.advanced)} />
      </dl>
    </section>
  );
}
