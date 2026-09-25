// Pure state helpers for the Good match / Bad match controls on job matches.

export type MatchVote = 'good' | 'bad';
export type MatchFeedbackSource = 'internal' | 'employer';

export type MatchFeedbackRow = {
  job_id: string;
  job_source: MatchFeedbackSource;
  vote: MatchVote;
  updated_at?: string | null;
};

export type MatchFeedbackStatus =
  | { state: 'idle' }
  | { state: 'saving'; vote: MatchVote | null }
  | { state: 'error'; message: string; retryVote: MatchVote };

export function matchFeedbackKey(jobId: string, jobSource: MatchFeedbackSource = 'internal'): string {
  return `${jobSource}:${jobId}`;
}

/** Selecting the current vote again removes it; selecting the other vote changes it. */
export function nextMatchVote(current: MatchVote | null, clicked: MatchVote): MatchVote | null {
  return current === clicked ? null : clicked;
}

export function feedbackMapFromRows(rows: MatchFeedbackRow[]): Record<string, MatchVote> {
  const map: Record<string, MatchVote> = {};
  rows.forEach((row) => {
    if (!row || !row.job_id || (row.vote !== 'good' && row.vote !== 'bad')) return;
    map[matchFeedbackKey(row.job_id, row.job_source === 'employer' ? 'employer' : 'internal')] = row.vote;
  });
  return map;
}

export function feedbackStatusText(vote: MatchVote | null, status: MatchFeedbackStatus): string {
  if (status.state === 'saving') {
    return status.vote === null ? 'Removing your rating…' : 'Saving your rating…';
  }
  if (status.state === 'error') return '';
  if (vote === 'good') return 'Saved as a good match. Select it again to remove your rating.';
  if (vote === 'bad') return 'Saved as a bad match. Select it again to remove your rating.';
  return '';
}

export function feedbackErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (!message || /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Your rating could not be saved. Check your connection and try again.';
  }
  return message;
}
