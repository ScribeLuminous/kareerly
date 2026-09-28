import { profileMatch } from '../evaluation';
import type { CandidateApplication, EmployerJob } from '../model';
import { GAP_ALERT_SHARE_PERCENT, getTier, SMALL_SAMPLE_MAX, type MatchLevel } from './matchTiers';

export const INSIGHTS_DISCLAIMER = 'Match scores are decision-support information, not hiring decisions.';

export type StatusFilter = 'open' | 'closed' | 'all';
export const STATUS_FILTERS: StatusFilter[] = ['open', 'closed', 'all'];
export const DEFAULT_STATUS_FILTER: StatusFilter = 'open';

export function parseStatusFilter(value: string | null | undefined): StatusFilter {
  return STATUS_FILTERS.find((filter) => filter === value) || DEFAULT_STATUS_FILTER;
}

export type SkillStat = {
  skill: string;
  /** Applicants with skill evidence who lack this required skill. */
  missing: number;
  /** Applicants with skill evidence for a job that requires it. */
  assessed: number;
};

/** Aggregate figures for one job. Nothing here identifies an applicant. */
export type JobInsight = {
  jobId: string;
  title: string;
  isOpen: boolean;
  /** Applicants still in the running or decided; withdrawn applications are left out. */
  applicants: number;
  /** Applicants with recorded skill evidence, so a match figure exists. */
  scored: number;
  /** Sum of the scored applicants' match percentages, so averages across jobs stay exact. */
  matchSum: number;
  /** null when nobody has skill evidence yet; never 0 for "unknown". */
  avgMatch: number | null;
  level: MatchLevel;
  counts: Record<MatchLevel, number>;
  strong: number;
  advanced: number;
  /** Every required skill with applicant evidence, most often missing first. */
  skills: SkillStat[];
};

export function buildJobInsights(applications: CandidateApplication[], jobs: EmployerJob[]): JobInsight[] {
  return jobs
    .map((job): JobInsight => {
      const forJob = applications.filter((candidate) => candidate.jobId === job.id && candidate.status !== 'Withdrawn');
      const counts: Record<MatchLevel, number> = { top: 0, good: 0, partial: 0, none: 0 };
      const stats = new Map<string, SkillStat>();
      let matchSum = 0;
      let scored = 0;
      forJob.forEach((candidate) => {
        const profile = profileMatch(candidate, job);
        counts[getTier(profile.percent)] += 1;
        if (profile.percent === null) return;
        scored += 1;
        matchSum += profile.percent;
        profile.required.forEach((skill) => {
          const key = skill.trim().toLowerCase();
          const stat = stats.get(key) || { skill, missing: 0, assessed: 0 };
          stat.assessed += 1;
          if (profile.notFound.includes(skill)) stat.missing += 1;
          stats.set(key, stat);
        });
      });
      const avgMatch = scored > 0 ? Math.round(matchSum / scored) : null;
      return {
        jobId: job.id,
        title: job.title,
        isOpen: job.status === 'open',
        applicants: forJob.length,
        scored,
        matchSum,
        avgMatch,
        level: getTier(avgMatch),
        counts,
        strong: counts.top + counts.good,
        advanced: forJob.filter((candidate) => candidate.status === 'Interviewing' || candidate.status === 'Hired').length,
        skills: Array.from(stats.values()).sort((a, b) => b.missing - a.missing || a.skill.localeCompare(b.skill)),
      };
    })
    .filter((insight) => insight.applicants > 0);
}

/** The skills applicants for this job most often lack. */
export const missingSkills = (job: JobInsight): SkillStat[] => job.skills.filter((stat) => stat.missing > 0);

export function filterJobs(jobs: JobInsight[], filter: StatusFilter): JobInsight[] {
  return filter === 'all' ? jobs : jobs.filter((job) => job.isOpen === (filter === 'open'));
}

/** Open jobs first, then most strong matches, then highest average, then title. */
export function sortJobs(jobs: JobInsight[]): JobInsight[] {
  return [...jobs].sort((a, b) =>
    Number(b.isOpen) - Number(a.isOpen)
    || b.strong - a.strong
    || (b.avgMatch ?? -1) - (a.avgMatch ?? -1)
    || a.title.localeCompare(b.title));
}

export type Kpis = {
  applicants: number;
  jobs: number;
  /** Across applicants with skill evidence only; null when there are none. */
  avgMatch: number | null;
  scored: number;
  strong: number;
  advanced: number;
};

export function buildKpis(jobs: JobInsight[]): Kpis {
  const sum = (pick: (job: JobInsight) => number) => jobs.reduce((total, job) => total + pick(job), 0);
  const scored = sum((job) => job.scored);
  return {
    applicants: sum((job) => job.applicants),
    jobs: jobs.length,
    avgMatch: scored > 0 ? Math.round(sum((job) => job.matchSum) / scored) : null,
    scored,
    strong: sum((job) => job.strong),
    advanced: sum((job) => job.advanced),
  };
}

export const isSmallSample = (assessed: number): boolean => assessed < SMALL_SAMPLE_MAX;

export type SkillGap = SkillStat & {
  /** Percent of assessed applicants missing the skill. */
  share: number;
  smallSample: boolean;
  /** True only for a widespread gap in a sample large enough to trust. */
  alert: boolean;
  jobTitles: string[];
};

/** Skills applicants most often lack across the jobs, by share of applicants missing them. */
export function topMissingSkills(jobs: JobInsight[], limit = Infinity): SkillGap[] {
  const merged = new Map<string, SkillStat & { jobTitles: Set<string> }>();
  jobs.forEach((job) => {
    job.skills.forEach((stat) => {
      const key = stat.skill.trim().toLowerCase();
      const entry = merged.get(key) || { skill: stat.skill, missing: 0, assessed: 0, jobTitles: new Set<string>() };
      entry.missing += stat.missing;
      entry.assessed += stat.assessed;
      if (stat.missing > 0) entry.jobTitles.add(job.title);
      merged.set(key, entry);
    });
  });
  return Array.from(merged.values())
    .filter((entry) => entry.missing > 0)
    .map((entry): SkillGap => {
      const share = Math.round((100 * entry.missing) / entry.assessed);
      const smallSample = isSmallSample(entry.assessed);
      return {
        skill: entry.skill,
        missing: entry.missing,
        assessed: entry.assessed,
        share,
        smallSample,
        alert: !smallSample && share >= GAP_ALERT_SHARE_PERCENT,
        jobTitles: Array.from(entry.jobTitles).sort(),
      };
    })
    .sort((a, b) => b.share - a.share || b.missing - a.missing || a.skill.localeCompare(b.skill))
    .slice(0, limit);
}
