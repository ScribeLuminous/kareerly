import { STRONG_MATCH_PERCENT } from '../matchTiers';
import type { Kpis } from '../insightsModel';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The one thing to take in first: how many applicants match well, with the rest as fine print. */
export function SummaryCard({ kpis }: { kpis: Kpis }) {
  const share = kpis.applicants > 0 ? Math.round((100 * kpis.strong) / kpis.applicants) : 0;
  const withoutData = kpis.applicants - kpis.scored;
  const details = [
    `${plural(kpis.applicants, 'applicant')} across ${plural(kpis.jobs, 'job')}`,
    `${kpis.advanced} interviewing or hired`,
    withoutData > 0 ? `${withoutData} without skill data yet` : '',
  ].filter(Boolean);
  return (
    <section className="k-card p-5" aria-labelledby="insights-summary">
      <h2 id="insights-summary" className="sr-only">Summary</h2>
      <p className="k-num text-[40px] font-bold leading-[44px] text-dark">
        {kpis.strong}<span className="ml-2 text-[20px] font-semibold text-mid">of {kpis.applicants}</span>
      </p>
      <p className="k-secondary mt-1">
        applicants match {STRONG_MATCH_PERCENT}% or more of the skills you asked for
      </p>
      <span
        className="k-meter mt-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share}
        aria-label={`${kpis.strong} of ${plural(kpis.applicants, 'applicant')} are a strong match`}
      >
        <span style={{ width: `${share}%` }} />
      </span>
      <p className="k-meta mt-3">{details.join(' · ')}</p>
    </section>
  );
}
