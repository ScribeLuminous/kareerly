// Missing values must stay distinguishable from legitimate zero scores.
export function savedMatchScore(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? Math.round(score) : null;
}

export function scoreLabel(score: number | null): string {
  return score === null ? 'Not available' : `${score}%`;
}

type ApplicationNoticeSource = {
  id: string;
  company: string;
  jobTitle: string;
  status: string;
  messageRequestState?: string;
  updatedAt?: string;
};

export function applicationNotices(applications: ApplicationNoticeSource[]) {
  return applications.flatMap<{ id: string; kind: 'message' | 'application'; title: string; message: string; time: string }>((app) => {
    const time = app.updatedAt && Number.isFinite(new Date(app.updatedAt).getTime())
      ? new Date(app.updatedAt).toLocaleString() : 'Update time unavailable';
    if ((app.status === 'Interviewing' || app.status === 'Hired') && app.messageRequestState === 'pending') {
      return [{ id: `${app.id}-request`, kind: 'message' as const, title: 'Pending message request', message: `${app.company} has a pending message request for ${app.jobTitle}.`, time }];
    }
    if (app.status === 'Shortlisted') {
      return [{ id: `${app.id}-shortlisted`, kind: 'application' as const, title: 'Application shortlisted', message: `${app.jobTitle} at ${app.company} is shortlisted.`, time }];
    }
    return [];
  });
}
