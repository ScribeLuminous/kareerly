import { useState } from 'react';
import { UIIcon, type IconName } from './icons';
import { formatGapMissingCount, getMatchReadinessClass, getMatchScoreBadge, matchCategoryBadge, severityClass, type DashboardApplication, type DashboardCourse, type DashboardGap, type DashboardJob } from './model';

export function DashboardOverview({
  hasData,
  metrics,
  topJobHighlights,
  recentApplications,
  topMissingSkills,
  recommendedSteps,
  courseRecommendations,
  onOpenMatches,
  onOpenGaps,
  onOpenUpskilling,
  onOpenMessages,
}: {
  hasData: boolean;
  metrics: Array<{ label: string; value: string; detail: string; iconClass: string; valueColor: string; icon: IconName }>;
  topJobHighlights: DashboardJob[];
  recentApplications: DashboardApplication[];
  topMissingSkills: DashboardGap[];
  recommendedSteps: string[];
  courseRecommendations: DashboardCourse[];
  onOpenMatches: () => void;
  onOpenGaps: () => void;
  onOpenUpskilling: () => void;
  onOpenMessages: () => void;
}) {
  const summaryTabs = [
    { id: 'steps', label: 'Next Steps', icon: 'list' },
    { id: 'matches', label: 'Job Highlights', icon: 'briefcase' },
    { id: 'gaps', label: 'Skills to Develop', icon: 'lightbulb' },
    { id: 'upskilling', label: 'Upskilling', icon: 'book' },
  ] as const;
  type SummaryTab = (typeof summaryTabs)[number]['id'];
  const [activeSummaryTab, setActiveSummaryTab] = useState<SummaryTab>('steps');

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">Career Overview</h1>
        <p className="cand-page-subtitle">Your personalized career guidance workspace powered by Kareerly</p>
      </div>

      <div className="cand-metrics-grid">
        {metrics.map((metric) => (
          <div key={metric.label} className="cand-metric-card">
            <div className={`cand-metric-icon ${metric.iconClass}`}>
              <UIIcon name={metric.icon} />
            </div>
            <div className="cand-metric-num" style={{ color: metric.valueColor }}>
              {metric.value}
            </div>
            <div className="cand-metric-label">{metric.label}</div>
            <div className="mt-1 text-[11px] text-soft-text">{metric.detail}</div>
          </div>
        ))}
      </div>

      {!hasData && (
        <div className="mb-4 rounded-lg border border-bdr bg-bg p-3 text-sm text-soft-text">
          Upload and analyze a resume to generate your dashboard overview.
        </div>
      )}

      <div className="cand-tab-row cand-summary-tabs">
        {summaryTabs.map((tab) => (
          <button
            key={tab.id}
            className={`cand-tab-btn ${activeSummaryTab === tab.id ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveSummaryTab(tab.id)}
          >
            <span className="inline-flex items-center gap-1.5">
              <UIIcon name={tab.icon} className="cand-tab-icon" />
              <span>{tab.label}</span>
            </span>
          </button>
        ))}
      </div>

      {activeSummaryTab === 'matches' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="briefcase" className="cand-title-icon" />Top Job Match Highlights</h2>
          {topJobHighlights.length > 0 ? (
            <>
              {topJobHighlights.map((job) => (
                <div key={job.id} className="cand-match-preview">
                  <div>
                    <div className="text-sm font-bold text-dark">{job.title}</div>
                    <div className="cand-job-meta-row">
                      <span><UIIcon name="building" className="cand-mini-icon" />{job.company}</span>
                      <span><UIIcon name="location" className="cand-mini-icon" />{job.location}</span>
                      <span><UIIcon name="setup" className="cand-mini-icon" />{job.setup}</span>
                      <span className={`cand-type-tag ${job.sourceType === 'internal' ? 'cand-type-internal' : 'cand-type-external'}`}>{job.sourceType === 'internal' ? 'Internal' : 'External'}</span>
                    </div>
                    <div className="cand-badge-row">
                      {job.category && <span className="cand-job-badge">{job.category}</span>}
                      {job.subCategory && <span className="cand-job-badge tan">{job.subCategory}</span>}
                      {job.jobLevel && <span className="cand-job-badge amber">{job.jobLevel}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`cand-match-badge friendly ${getMatchReadinessClass(job.matchScore)}`}>
                      {getMatchScoreBadge(job)}
                    </div>
                    <span className={`cand-match-cat ${job.matchCategory === 'fit-now' ? 'cand-cat-fit' : 'cand-cat-aspiration'}`}>
                      {job.hasMatchScore ? matchCategoryBadge(job) : 'Match not available'}
                    </span>
                  </div>
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenMatches}>
                View All Job Matches
              </button>
            </>
          ) : (
            <div className="cand-empty">No match highlights available yet.</div>
          )}
        </div>
      )}

      {activeSummaryTab === 'gaps' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="lightbulb" className="cand-title-icon" />Skills to Develop</h2>
          {topMissingSkills.length > 0 ? (
            <>
              {topMissingSkills.map((gap) => (
                <div key={gap.skill} className="flex items-center justify-between border-b border-bdr py-3 last:border-b-0">
                  <div>
                    <div className="text-sm font-bold text-dark">{gap.skill}</div>
                    <div className="text-xs text-soft-text">{formatGapMissingCount(gap)}</div>
                  </div>
                  <span className={`cand-gap-priority ${severityClass(gap.severity)}`}>{gap.severity}</span>
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenGaps}>
                View All Skills to Develop
              </button>
            </>
          ) : (
            <div className="cand-empty">No skill gaps found yet.</div>
          )}
        </div>
      )}

      {activeSummaryTab === 'steps' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="list" className="cand-title-icon" />Recommended Next Steps</h2>
          <div className="space-y-3 text-sm text-mid">
            {recommendedSteps.map((step, idx) => (
              <div key={step} className="flex gap-2">
                <span className="mt-[2px] inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-rust text-[10px] font-extrabold text-white">
                  {idx + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          {recentApplications.some((app) => app.status === 'Interviewing') && (
            <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenMessages}>
              Open Messages
            </button>
          )}
        </div>
      )}

      {activeSummaryTab === 'upskilling' && (
        <div className="cand-card mb-6">
          <h2 className="cand-card-title"><UIIcon name="book" className="cand-title-icon" />Recommended Learning Resources</h2>
          {courseRecommendations.length > 0 ? (
            <>
              {courseRecommendations.map((course) => (
                <div key={course.id} className="flex items-center justify-between border-b border-bdr py-3 last:border-b-0">
                  <div>
                    <div className="text-sm font-bold text-dark">{course.title}</div>
                    <div className="text-xs text-soft-text">{course.provider} · {course.duration}</div>
                  </div>
                  <span className={`cand-pill ${course.isFree ? 'free' : 'paid'}`}>{course.fees}</span>
                </div>
              ))}
              <button className="cand-btn-secondary mt-4 w-full justify-center" type="button" onClick={onOpenUpskilling}>
                View resources
              </button>
            </>
          ) : (
            <div className="cand-empty">No course recommendations available yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
