import { scoreLabel } from '../../lib/uiData';
import { useMemo, useState } from 'react';
import { APPLICATION_STATUS_FILTERS, formatDateLabel, statusKey, type DashboardApplication } from './model';
import { UIIcon } from './icons';
import { ActiveFilterChip, FilterPanel, StatusBadge } from './common';

export function ApplicationsPage({
  loadStatus,
  applications,
  onViewJob,
  onWithdraw,
  onOpenMessages,
}: {
  loadStatus: 'loading' | 'ready' | 'error';
  applications: DashboardApplication[];
  onViewJob: (application: DashboardApplication) => void;
  onWithdraw: (application: DashboardApplication) => void;
  onOpenMessages: () => void;
}) {
  const [searchValue, setSearchValue] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'shortlisted' | 'interviewing' | 'hired' | 'rejected' | 'withdrawn'>('all');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const hasInterviewing = applications.some((app) => app.status === 'Interviewing');
  const activeFilterCount = statusFilter === 'all' ? 0 : 1;
  const filteredApplications = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    return applications.filter((application) => {
      if (statusFilter !== 'all' && statusKey(application.status) !== statusFilter) return false;
      if (!query) return true;
      return `${application.jobTitle} ${application.company} ${application.status} ${scoreLabel(application.matchScore)}`
        .toLowerCase()
        .includes(query);
    });
  }, [applications, searchValue, statusFilter]);

  return (
    <div>
      <div className="cand-sticky-controls">
        <div className="cand-page-header cand-page-header-inline">
          <h1 className="cand-page-title">My Applications</h1>
          <p className="cand-page-subtitle">Track your internal Kareerly job applications and their current statuses</p>
        </div>
        <div className="cand-toolbar cand-app-toolbar">
          <div className="cand-app-search">
            <UIIcon name="search" className="cand-search-icon" />
            <input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search by job title, company, status, or match %..."
            />
          </div>
          <div className="cand-filter-control">
            <button
              className={`cand-filter-button ${activeFilterCount > 0 ? 'active' : ''}`}
              type="button"
              aria-expanded={filterPanelOpen}
              aria-controls="applications-filter-panel"
              onClick={() => setFilterPanelOpen((current) => !current)}
            >
              <UIIcon name="filter" className="cand-btn-icon" />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            <FilterPanel
              open={filterPanelOpen}
              panelId="applications-filter-panel"
              title="Application filters"
              labelledBy="applications-filter-panel-title"
              onClose={() => setFilterPanelOpen(false)}
              onApply={() => setFilterPanelOpen(false)}
              onClear={() => { setStatusFilter('all'); setFilterPanelOpen(false); }}
            >
              <fieldset className="cand-filter-section">
                <legend className="cand-filter-section-title">Status</legend>
                <label className="cand-filter-radio">
                  <input type="radio" name="application-status" checked={statusFilter === 'all'} onChange={() => setStatusFilter('all')} />
                  <span>All statuses</span>
                </label>
                {APPLICATION_STATUS_FILTERS.map(([value, label]) => (
                  <label key={value} className="cand-filter-radio">
                    <input type="radio" name="application-status" checked={statusFilter === value} onChange={() => setStatusFilter(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            </FilterPanel>
          </div>
        </div>
        {activeFilterCount > 0 && (
          <div className="cand-active-filter-chips" aria-label="Active application filters">
            <ActiveFilterChip label={APPLICATION_STATUS_FILTERS.find(([value]) => value === statusFilter)?.[1] || statusFilter} onRemove={() => setStatusFilter('all')} />
            <button className="cand-filter-reset-link" type="button" onClick={() => setStatusFilter('all')}>Clear all</button>
          </div>
        )}
        </div>

      <div className="cand-notice info">
        <span>
          Only internal Kareerly applications are tracked here. External opportunities are link-outs only. Messaging is available only at Interviewing or Hired stage after employer request and candidate acceptance.
        </span>
      </div>

      {filteredApplications.length > 0 ? (
        <div className="cand-table-wrap">
          <table className="cand-table">
            <thead>
              <tr>
                <th>Job & Company</th>
                <th>Match</th>
                <th>Date Applied</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredApplications.map((application) => {
                const canWithdraw = ['Pending', 'Shortlisted', 'Interviewing'].includes(application.status);
                const canMessage = application.status === 'Interviewing' || application.status === 'Hired';
                return (
                  <tr key={application.id} className={application.status === 'Withdrawn' ? 'cand-row-closed' : ''}>
                    <td>
                      <div className="text-sm font-bold text-dark">{application.jobTitle}</div>
                      <div className="text-xs text-soft-text">{application.company}</div>
                    </td>
                    <td>
                      <span className="font-display text-sm font-extrabold text-rust">{scoreLabel(application.matchScore)}</span>
                    </td>
                    <td className="text-xs text-soft-text">{formatDateLabel(application.dateApplied)}</td>
                    <td><StatusBadge status={application.status} /></td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onViewJob(application)}>
                          <UIIcon name="eye" className="cand-btn-icon" />View
                        </button>
                        <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onWithdraw(application)} disabled={!canWithdraw}>
                          <UIIcon name="trash" className="cand-btn-icon" />Withdraw
                        </button>
                        {canMessage && (
                          <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenMessages}>
                            <UIIcon name="message" className="cand-btn-icon" />Message
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cand-empty">
          {loadStatus === 'loading' ? 'Loading applications…' : loadStatus === 'error' ? 'Applications could not be loaded. Please try again later.' : applications.length > 0 ? 'No applications match the selected filter/search.' : 'No internal applications yet. Apply from Job Matches to start tracking.'}
        </div>
      )}

      <div className="cand-card mt-4">
        <div className="text-sm font-bold text-dark">Application Rules</div>
        <p className="mt-2 text-sm text-soft-text">
          Allowed statuses are Pending, Shortlisted, Interviewing, Hired, Rejected, and Withdrawn. Withdraw is enabled only for Pending, Shortlisted, and Interviewing. Hired, Rejected, and Withdrawn are final and read-only.
        </p>
        {hasInterviewing && (
          <button className="cand-btn-secondary mt-3" type="button" onClick={onOpenMessages}>
            Open Interview Messaging
          </button>
        )}
      </div>
    </div>
  );
}
