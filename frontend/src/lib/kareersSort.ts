import type { DashboardJob } from '../pages/candidate/model';

export type KareersSortOrder = 'newest' | 'oldest' | 'salary-high' | 'salary-low' | 'az' | 'za';

type SortableJob = Pick<DashboardJob, 'title' | 'sourceType' | 'salaryMin' | 'salaryMax' | 'createdAt'>;

/** Jobs candidates apply to on Kareerly come before jobs on external sites; the chosen order applies within each group. */
export function sortKareers<T extends SortableJob>(jobs: T[], order: KareersSortOrder): T[] {
  const sourceRank = (job: T) => (job.sourceType === 'external' ? 1 : 0);
  const salary = (job: T) => job.salaryMax || job.salaryMin || 0;
  const date = (job: T) => new Date(job.createdAt || 0).getTime() || 0;
  return [...jobs].sort((left, right) => {
    const bySource = sourceRank(left) - sourceRank(right);
    if (bySource) return bySource;
    if (order === 'az' || order === 'za') return (order === 'az' ? 1 : -1) * left.title.localeCompare(right.title);
    if (order === 'salary-high' || order === 'salary-low') return (order === 'salary-high' ? -1 : 1) * (salary(left) - salary(right));
    return order === 'oldest' ? date(left) - date(right) : date(right) - date(left);
  });
}
