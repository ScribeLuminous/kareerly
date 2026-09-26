import { scoreLabel } from '../../lib/uiData';
import type { ReactNode } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faArrowRight, faBan, faBars, faBell, faBookmark, faBolt, faBriefcase, faBuilding, faCalendar, faCalendarCheck, faCheck, faChevronDown, faCircle, faCircleInfo, faCircleXmark, faClock, faComments, faEnvelope, faEye, faFlag, faGear, faHandshake, faLayerGroup, faLock, faLocationDot, faMagnifyingGlass, faPaperPlane, faPenToSquare, faPlus, faRightFromBracket, faShieldHalved, faStar, faTable, faTableCellsLarge, faTag, faUserTie, faUsers, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { MIN_EMPLOYER_SALARY, getInitials, getMatchBucket, getMatchColor, getStatusBadgeClass, jobCategoryOptions, jobSubcategoryMap, maskedName, matchBucketLabel, shouldRevealIdentity, type CandidateApplication, type EmployerJob, type JobFormState, type JobStatus, type MatchBucket, type ReviewAction } from './model';

export type IconName =
  | 'menu'
  | 'bell'
  | 'chevron-down'
  | 'dashboard'
  | 'briefcase'
  | 'users'
  | 'messages'
  | 'building'
  | 'cog'
  | 'star'
  | 'layers'
  | 'calendar-check'
  | 'envelope'
  | 'times-circle'
  | 'clock'
  | 'bolt'
  | 'plus'
  | 'search'
  | 'edit'
  | 'close'
  | 'shield'
  | 'table'
  | 'eye'
  | 'bookmark'
  | 'handshake'
  | 'ban'
  | 'flag'
  | 'paper-plane'
  | 'check'
  | 'lock'
  | 'map-pin'
  | 'tag'
  | 'calendar'
  | 'arrow-right'
  | 'info'
  | 'user-tie'
  | 'logout';

export const iconMap: Record<IconName, IconDefinition> = {
  menu: faBars,
  bell: faBell,
  'chevron-down': faChevronDown,
  dashboard: faTableCellsLarge,
  briefcase: faBriefcase,
  users: faUsers,
  messages: faComments,
  building: faBuilding,
  cog: faGear,
  star: faStar,
  layers: faLayerGroup,
  'calendar-check': faCalendarCheck,
  envelope: faEnvelope,
  'times-circle': faCircleXmark,
  clock: faClock,
  bolt: faBolt,
  plus: faPlus,
  search: faMagnifyingGlass,
  edit: faPenToSquare,
  close: faXmark,
  shield: faShieldHalved,
  table: faTable,
  eye: faEye,
  bookmark: faBookmark,
  handshake: faHandshake,
  ban: faBan,
  flag: faFlag,
  'paper-plane': faPaperPlane,
  check: faCheck,
  lock: faLock,
  'map-pin': faLocationDot,
  tag: faTag,
  calendar: faCalendar,
  'arrow-right': faArrowRight,
  info: faCircleInfo,
  'user-tie': faUserTie,
  logout: faRightFromBracket,
};

export function UIIcon({ name, className = '' }: { name: IconName; className?: string }) {
  const iconClass = `emp-inline-icon ${className}`.trim();
  return <FontAwesomeIcon className={iconClass} icon={iconMap[name] || faCircle} aria-hidden="true" />;
}

export function SidebarItem({
  icon,
  active,
  onClick,
  children,
}: {
  icon: IconName;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={`emp-nav-item ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <UIIcon name={icon} />
      {children}
    </button>
  );
}

export function MetricCard({
  icon,
  iconClass,
  number,
  label,
  numberClass,
}: {
  icon: IconName;
  iconClass: string;
  number: number | string;
  label: string;
  numberClass: string;
}) {
  return (
    <div className="emp-metric-card">
      <div className={`emp-metric-icon ${iconClass}`}>
        <UIIcon name={icon} className="emp-icon-lg" />
      </div>
      <div className={`emp-metric-number ${numberClass}`}>{number}</div>
      <div className="emp-metric-label">{label}</div>
    </div>
  );
}

export function CandidateFilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`emp-cand-tab ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

export function CandidateGroup({
  title,
  type,
  candidates,
  onReview,
}: {
  title: string;
  type: MatchBucket;
  candidates: CandidateApplication[];
  onReview: (candidateId: string) => void;
}) {
  return (
    <div className="emp-kanban-col">
      <div className={`emp-kanban-header ${type}`}>
        <UIIcon name={type === 'top' ? 'star' : type === 'good' ? 'check' : type === 'unknown' ? 'users' : 'times-circle'} />
        {title}
        <span className="emp-kanban-count">{candidates.length}</span>
      </div>
      <div className="emp-kanban-content">
        {candidates.length > 0 ? (
          candidates.map((candidate) => {
            return (
              <div key={candidate.id} className={`emp-app-card ${candidate.status === 'Withdrawn' ? 'withdrawn' : ''}`}>
                <div className="emp-app-head">
                  <div className="emp-app-avatar">{getInitials(candidate.fullName)}</div>
                  <div>
                    <div className="emp-app-name">
                      {shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName)}
                    </div>
                    <div className="emp-app-id">{candidate.publicId || 'Not available'}</div>
                  </div>
                </div>
                <div className="emp-app-match-row">
                  <div className="emp-app-match" style={{ color: getMatchColor(candidate.matchPercent) }}>
                    {scoreLabel(candidate.hasMatchScore ? candidate.matchPercent : null)}
                  </div>
                  <div className="emp-app-role">{candidate.role}</div>
                </div>
                <div>
                  <span className="emp-skill-label">Matched Skills</span>
                  <div className="emp-skill-chips">
                    {candidate.matchedSkills.slice(0, 4).map((skill) => (
                      <span key={`${candidate.id}-match-${skill}`} className="emp-skill-chip emp-skill-matched">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="emp-skill-label">Missing Skills</span>
                  <div className="emp-skill-chips">
                    {candidate.missingSkills.slice(0, 4).map((skill) => (
                      <span key={`${candidate.id}-gap-${skill}`} className="emp-skill-chip emp-skill-missing">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="emp-app-foot">
                  <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
                  <button className="emp-link-action" type="button" onClick={() => onReview(candidate.id)}>
                    {candidate.status === 'Withdrawn' ? 'View' : 'Review'}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="emp-empty">No candidates in this group.</div>
        )}
      </div>
    </div>
  );
}

export function FinalCandidateCard({
  candidate,
  onReview,
}: {
  candidate: CandidateApplication;
  onReview: (candidateId: string) => void;
}) {
  return (
    <div className={`emp-final-card ${candidate.status === 'Withdrawn' ? 'withdrawn' : ''}`}>
      <div className="emp-final-card-top">
        <div className="emp-final-avatar">{getInitials(candidate.fullName)}</div>
        <div>
          <div className="emp-final-name">{shouldRevealIdentity(candidate.status) ? candidate.fullName : maskedName(candidate.fullName)}</div>
          <div className="emp-final-role">
            {candidate.publicId || 'Not available'} · {candidate.role}
          </div>
        </div>
      </div>
      <div className="emp-skill-chips">
        {candidate.matchedSkills.slice(0, 3).map((skill) => (
          <span key={`${candidate.id}-final-match-${skill}`} className="emp-skill-chip emp-skill-matched">
            {skill}
          </span>
        ))}
      </div>
      {candidate.status === 'Withdrawn' && <div className="emp-final-note">Withdrawn by candidate. Read-only record.</div>}
      <div className="emp-final-footer">
        <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
        <button className="emp-link-action" type="button" onClick={() => onReview(candidate.id)}>
          View
        </button>
      </div>
    </div>
  );
}

export function ApplicantReviewModal({
  candidate,
  job,
  onClose,
  onAction,
  onSendRequest,
  onOpenMessages,
}: {
  candidate: CandidateApplication;
  job: EmployerJob | null;
  onClose: () => void;
  onAction: (action: ReviewAction, candidateId: string) => void;
  onSendRequest: (candidateId: string) => void;
  onOpenMessages: (candidateId: string) => void;
}) {
  const bucket = getMatchBucket(candidate.matchPercent, candidate.hasMatchScore);
  const bucketLabel = matchBucketLabel(bucket);
  const isFinal = candidate.status === 'Hired' || candidate.status === 'Rejected' || candidate.status === 'Withdrawn';
  const isWithdrawn = candidate.status === 'Withdrawn';
  const revealIdentity = shouldRevealIdentity(candidate.status);

  return (
    <div className="emp-modal-overlay" onClick={onClose}>
      <div className="emp-modal lg" onClick={(event) => event.stopPropagation()}>
        <div className="emp-modal-header">
          <div>
            <div className="emp-modal-title">Applicant Review — {candidate.publicId || 'Not available'}</div>
            <div className="emp-modal-subtitle">
              {candidate.publicId || 'Not available'} · {candidate.role}
            </div>
          </div>
          <button className="emp-modal-close" type="button" onClick={onClose}>
            <UIIcon name="close" />
          </button>
        </div>

        {isWithdrawn && (
          <div className="emp-withdrawn-banner">
            <UIIcon name="times-circle" className="mt-[2px]" />
            <div>
              <strong>Withdrawn by Candidate</strong>
              <br />
              <span className="text-xs">
                This application is closed and read-only. You cannot reactivate, message, or move this record.
              </span>
            </div>
          </div>
        )}

        <div className="emp-review-sec">
          <div
            className="emp-match-band"
            style={{
              background:
                !candidate.hasMatchScore ? 'var(--bg)' : candidate.matchPercent >= 90
                  ? 'var(--green-l)'
                  : candidate.matchPercent >= 75
                    ? 'var(--amber-l)'
                    : 'var(--rust-l)',
              color:
                !candidate.hasMatchScore ? 'var(--soft)' : candidate.matchPercent >= 90
                  ? 'var(--green)'
                  : candidate.matchPercent >= 75
                    ? 'var(--amber)'
                    : 'var(--rust)',
            }}
          >
            <UIIcon name="star" />
            {candidate.hasMatchScore ? `${candidate.matchPercent}% Match` : 'Match not available'}
            <span className="text-xs opacity-80">· {bucketLabel}</span>
          </div>

          {!revealIdentity && (
            <div className="emp-masked-notice">
              <UIIcon name="eye" className="mt-[2px]" />
              <span>
                Early applicant review uses <strong>data masking</strong>. Name, age, gender, and direct contact details remain hidden during Pending and Shortlisted stages.
              </span>
            </div>
          )}

          <div className="emp-detail-grid">
            <div>
              <div className="emp-detail-label">Candidate ID</div>
              <div className="emp-detail-value">{candidate.publicId || 'Not available'}</div>
            </div>
            <div>
              <div className="emp-detail-label">Applied Role</div>
              <div className="emp-detail-value">{candidate.role}</div>
            </div>
            <div>
              <div className="emp-detail-label">Match Category</div>
              <div className="emp-detail-value">{bucketLabel}</div>
            </div>
            <div>
              <div className="emp-detail-label">Application Status</div>
              <div className="emp-detail-value">
                <span className={getStatusBadgeClass(candidate.status)}>{candidate.status}</span>
              </div>
            </div>
            {revealIdentity && (
              <>
                <div>
                  <div className="emp-detail-label">Full Name</div>
                  <div className="emp-detail-value">{candidate.fullName}</div>
                </div>
                <div>
                  <div className="emp-detail-label">Location</div>
                  <div className="emp-detail-value">{candidate.location}</div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="emp-review-sec">
          <div className="emp-review-sec-title">Matched Skills (Required)</div>
          <div className="emp-skill-chips">
            {candidate.matchedSkills.map((skill) => (
              <span key={`${candidate.id}-modal-match-${skill}`} className="emp-skill-chip emp-skill-matched">
                {skill}
              </span>
            ))}
          </div>
        </div>

        <div className="emp-review-sec">
          <div className="emp-review-sec-title">Missing Skills (Required)</div>
          <div className="emp-skill-chips">
            {candidate.missingSkills.map((skill) => (
              <span key={`${candidate.id}-modal-gap-${skill}`} className="emp-skill-chip emp-skill-missing">
                {skill}
              </span>
            ))}
          </div>
        </div>

        <div className="emp-review-sec">
          <div className="emp-review-sec-title">Match Analysis</div>
          <div className="emp-analysis-box strength">
            <div className="emp-analysis-title">
              <UIIcon name="check" />
              Strength
            </div>
            {candidate.strengthNote}
          </div>
          <div className="emp-analysis-box gap">
            <div className="emp-analysis-title">
              <UIIcon name="times-circle" />
              Gap
            </div>
            {candidate.gapNote}
          </div>
          <div className="emp-analysis-box rec">
            <div className="emp-analysis-title">
              <UIIcon name="arrow-right" />
              Recommendation
            </div>
            {candidate.recommendation}
          </div>
          <div className="mt-2 rounded-lg bg-bg p-3 text-sm text-mid">{candidate.matchSummary}</div>
          {job && (
            <div className="mt-2 text-xs text-soft">
              Applied to: <strong className="text-mid">{job.title}</strong> · {job.city}, {job.province}
            </div>
          )}
        </div>

        <div className="emp-review-sec">
          <div className="emp-review-sec-title">Application Status Actions</div>
          <div className="mb-3 text-xs text-soft">
            Final hiring decisions remain the employer’s responsibility. Kareerly provides skill-alignment decision support only.
          </div>

          {isFinal ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-bg p-4 text-center text-sm text-soft">
                <UIIcon name="lock" className="mr-1" />
                This application is in a final state. No further status changes are allowed.
              </div>
              {(candidate.status === 'Rejected' || candidate.status === 'Withdrawn') && (
                <button className="emp-status-btn" style={{ width: '100%' }} type="button" disabled title={`Messaging is unavailable for ${candidate.status.toLowerCase()} applications.`}>
                  <UIIcon name="messages" /> Send Message Request
                </button>
              )}
            </div>
          ) : candidate.status === 'Pending' ? (
            <div className="emp-status-actions">
              <button className="emp-status-btn" type="button" onClick={() => onAction('shortlisted', candidate.id)}>
                <UIIcon name="bookmark" />
                Shortlist
              </button>
              <button className="emp-status-btn primary" type="button" onClick={() => onAction('interviewing', candidate.id)}>
                <UIIcon name="calendar-check" />
                Move to Interviewing
              </button>
              <button
                className="emp-status-btn danger"
                style={{ gridColumn: 'span 2' }}
                type="button"
                onClick={() => onAction('rejected', candidate.id)}
              >
                <UIIcon name="times-circle" />
                Reject
              </button>
            </div>
          ) : candidate.status === 'Shortlisted' ? (
            <div className="emp-status-actions">
              <button className="emp-status-btn primary" type="button" onClick={() => onAction('interviewing', candidate.id)}>
                <UIIcon name="calendar-check" />
                Move to Interviewing
              </button>
              <button className="emp-status-btn danger" type="button" onClick={() => onAction('rejected', candidate.id)}>
                <UIIcon name="times-circle" />
                Reject
              </button>
            </div>
          ) : (
            <div className="emp-status-actions">
              <button className="emp-status-btn primary" type="button" onClick={() => onAction('hired', candidate.id)}>
                <UIIcon name="handshake" />
                Mark as Hired
              </button>
              <button className="emp-status-btn danger" type="button" onClick={() => onAction('rejected', candidate.id)}>
                <UIIcon name="times-circle" />
                Reject
              </button>
              {candidate.messageRequestState === 'none' ? (
                <button
                  className="emp-status-btn"
                  style={{ gridColumn: 'span 2' }}
                  type="button"
                  onClick={() => onSendRequest(candidate.id)}
                >
                  <UIIcon name="messages" />
                  Send Message Request
                </button>
              ) : (
                <button
                  className="emp-status-btn"
                  style={{ gridColumn: 'span 2' }}
                  type="button"
                  onClick={() => onOpenMessages(candidate.id)}
                >
                  <UIIcon name="messages" />
                  {candidate.messageRequestState === 'accepted' ? 'Open Messages' : 'View Pending Message Request'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConfirmActionModal({
  title,
  description,
  rejectionReason,
  onRejectionReason,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  rejectionReason?: string;
  onRejectionReason?: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="emp-modal-overlay" onClick={onCancel}>
      <div className="emp-modal sm" onClick={(event) => event.stopPropagation()}>
        <div className="emp-modal-header">
          <div className="emp-modal-title">{title}</div>
          <button className="emp-modal-close" type="button" onClick={onCancel}>
            <UIIcon name="close" />
          </button>
        </div>
        <div className="text-sm text-mid">{description}</div>
        {onRejectionReason && (
          <div className="emp-form-group mt-4">
            <label className="emp-form-label required">Reason for rejection</label>
            <select className="emp-select" value={rejectionReason || ''} onChange={(event) => onRejectionReason(event.target.value)}>
              <option value="">Select a concise, job-related reason...</option>
              <option value="Another candidate more closely matched the role requirements.">Another candidate more closely matched the role requirements</option>
              <option value="The application did not demonstrate the required level of relevant experience.">Required relevant experience was not sufficiently demonstrated</option>
              <option value="The application did not demonstrate one or more essential technical skills.">Essential technical skills were not sufficiently demonstrated</option>
              <option value="The candidate's availability did not align with the role's current requirements.">Availability did not align with the role requirements</option>
              <option value="The candidate's location or work-setup preference did not align with this position.">Location or work-setup preference did not align</option>
              <option value="The position has been placed on hold or is no longer being filled.">Position placed on hold or no longer being filled</option>
              <option value="The compensation expectations could not be aligned with the approved range.">Compensation expectations did not align with the approved range</option>
            </select>
            <p className="mt-2 text-xs text-soft">Use only objective, job-related reasons. Do not include sensitive or discriminatory information.</p>
          </div>
        )}
        <div className="emp-modal-footer">
          <button className="emp-btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="emp-btn-primary" type="button" onClick={onConfirm} disabled={Boolean(onRejectionReason && !rejectionReason)}>
            <UIIcon name="check" />
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export function JobEditorPanel({
  editing,
  form,
  requiredSkills,
  niceSkills,
  requiredSkillInput,
  niceSkillInput,
  onCancel,
  onUpdateForm,
  onRequiredInput,
  onNiceInput,
  onAddRequired,
  onAddNice,
  onRemoveRequired,
  onRemoveNice,
  onSaveDraft,
  onPost,
  saving,
}: {
  editing: boolean;
  form: JobFormState;
  requiredSkills: string[];
  niceSkills: string[];
  requiredSkillInput: string;
  niceSkillInput: string;
  onCancel: () => void;
  onUpdateForm: <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => void;
  onRequiredInput: (value: string) => void;
  onNiceInput: (value: string) => void;
  onAddRequired: () => void;
  onAddNice: () => void;
  onRemoveRequired: (skill: string) => void;
  onRemoveNice: (skill: string) => void;
  onSaveDraft: () => void;
  onPost: () => void;
  saving: boolean;
}) {
  const subcategoryOptions = form.category ? jobSubcategoryMap[form.category] || [] : [];
  const [salaryMinimum = '', salaryMaximum = ''] = form.salaryRange.split('-');
  const updateSalaryRange = (field: 'minimum' | 'maximum', value: string) => {
    const sanitizedValue = value.replace(/[^\d]/g, '');
    onUpdateForm('salaryRange', field === 'minimum' ? `${sanitizedValue}-${salaryMaximum}` : `${salaryMinimum}-${sanitizedValue}`);
  };

  return (
    <div className="emp-job-editor">
      <div className="emp-job-editor-header">
        <div>
          <div className="emp-job-editor-title">{editing ? 'Edit Job Posting' : 'Post New Job'}</div>
          <div className="emp-job-editor-subtitle">All required fields are marked with *</div>
        </div>
        <button className="emp-btn-secondary" type="button" onClick={onCancel}>
          <UIIcon name="close" />
          Cancel
        </button>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Job Title</label>
          <input className="emp-input" value={form.title} onChange={(event) => onUpdateForm('title', event.target.value)} placeholder="Enter job title" />
        </div>
        <div className="emp-form-group">
          <label className="emp-form-label required">Category</label>
          <select className="emp-select" value={form.category} onChange={(event) => onUpdateForm('category', event.target.value)}>
            <option value="">Select category</option>
            {jobCategoryOptions.map((category) => (
              <option key={category.code} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Sub-category</label>
          <select className="emp-select" value={form.subcategory} onChange={(event) => onUpdateForm('subcategory', event.target.value)}>
            <option value="">Select sub-category</option>
            {subcategoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="emp-form-group">
          <label className="emp-form-label required">Experience Level</label>
          <select className="emp-select" value={form.experienceLevel} onChange={(event) => onUpdateForm('experienceLevel', event.target.value)}>
            <option value="">Select level</option>
            <option value="Entry-level / Fresh Graduate">Entry-level / Fresh Graduate</option>
            <option value="Junior (1-2 yrs)">Junior (1-2 yrs)</option>
            <option value="Mid-level (3-5 yrs)">Mid-level (3-5 yrs)</option>
            <option value="Senior (5+ yrs)">Senior (5+ yrs)</option>
          </select>
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Work Setup</label>
          <select className="emp-select" value={form.workSetup} onChange={(event) => onUpdateForm('workSetup', event.target.value)}>
            <option value="">Select setup</option>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="On-site">On-site</option>
          </select>
        </div>
        <div className="emp-form-group">
          <label className="emp-form-label required">Location</label>
          <input className="emp-input" value={form.location} onChange={(event) => onUpdateForm('location', event.target.value)} placeholder="City, Province" />
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label" htmlFor="job-employment-type">Employment Type</label>
          <select id="job-employment-type" className="emp-select" value={form.employmentType} onChange={(event) => onUpdateForm('employmentType', event.target.value)}>
            <option value="">Not specified</option>
            {form.employmentType && !['Full-time', 'Part-time', 'Contract', 'Temporary', 'Internship'].includes(form.employmentType) && <option value={form.employmentType}>{form.employmentType}</option>}
            <option value="Full-time">Full-time</option>
            <option value="Part-time">Part-time</option>
            <option value="Contract">Contract</option>
            <option value="Temporary">Temporary</option>
            <option value="Internship">Internship</option>
          </select>
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Salary Range</label>
          <div className="emp-money-range">
            <div className="emp-money-input">
              <span className="emp-money-prefix">₱</span>
              <input
                className="emp-input"
                value={salaryMinimum}
                onChange={(event) => updateSalaryRange('minimum', event.target.value)}
                onKeyDown={(event) => {
                  if (['e', 'E', '+', '-', '.'].includes(event.key)) {
                    event.preventDefault();
                  }
                }}
                placeholder="0"
                required
                type="number"
                min={MIN_EMPLOYER_SALARY}
                step="1000"
                inputMode="numeric"
                aria-label="Minimum salary"
              />
            </div>
            <span className="emp-money-separator">-</span>
            <div className="emp-money-input">
              <span className="emp-money-prefix">₱</span>
              <input
                className="emp-input"
                value={salaryMaximum}
                onChange={(event) => updateSalaryRange('maximum', event.target.value)}
                onKeyDown={(event) => {
                  if (['e', 'E', '+', '-', '.'].includes(event.key)) {
                    event.preventDefault();
                  }
                }}
                placeholder="0"
                required
                type="number"
                min={MIN_EMPLOYER_SALARY}
                step="1000"
                inputMode="numeric"
                aria-label="Maximum salary"
              />
            </div>
          </div>
          <div className="emp-form-hint">Enter a salary range. Minimum salary is ₱10,000.</div>
        </div>
        <div className="emp-form-group">
          <label className="emp-form-label required">Application Deadline</label>
          <input className="emp-input" type="date" value={form.deadline} onChange={(event) => onUpdateForm('deadline', event.target.value)} />
        </div>
      </div>

      <div className="emp-form-grid full">
        <div className="emp-form-group">
          <label className="emp-form-label required">Job Description</label>
          <textarea
            className="emp-textarea"
            style={{ minHeight: 96 }}
            value={form.description}
            placeholder="Describe the role and its purpose..."
            onChange={(event) => onUpdateForm('description', event.target.value)}
          />
          <div className="emp-form-hint">Give candidates a concise overview of the role.</div>
        </div>
      </div>

      <div className="emp-form-grid full">
        <div className="emp-form-group">
          <label className="emp-form-label required">Responsibilities</label>
          <textarea
            className="emp-textarea"
            style={{ minHeight: 132 }}
            value={form.responsibilities}
            placeholder={'Enter one responsibility per line.\nExample: Resolve customer support tickets within agreed response times.'}
            onChange={(event) => onUpdateForm('responsibilities', event.target.value)}
          />
          <div className="emp-form-hint">Enter one responsibility per line. These appear as a separate list on the candidate job view.</div>
        </div>
      </div>

      <div className="emp-form-grid full">
        <div className="emp-form-group">
          <label className="emp-form-label required">Required Skills</label>
          <div className="emp-skill-input-row">
            <input
              className="emp-input"
              value={requiredSkillInput}
              placeholder="e.g., SQL, Excel, Python"
              onChange={(event) => onRequiredInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onAddRequired();
                }
              }}
            />
            <button className="emp-btn-forest" type="button" onClick={onAddRequired}>
              <UIIcon name="plus" />
              Add
            </button>
          </div>
          <div className="emp-added-skills">
            {requiredSkills.map((skill) => (
              <span key={`req-${skill}`} className="emp-skill-tag">
                {skill}
                <button type="button" onClick={() => onRemoveRequired(skill)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="emp-form-grid full">
        <div className="emp-form-group">
          <label className="emp-form-label">Nice-to-Have Skills</label>
          <div className="emp-skill-input-row">
            <input
              className="emp-input"
              value={niceSkillInput}
              placeholder="e.g., Figma, Power BI"
              onChange={(event) => onNiceInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onAddNice();
                }
              }}
            />
            <button className="emp-btn-secondary" type="button" onClick={onAddNice}>
              <UIIcon name="plus" />
              Add
            </button>
          </div>
          <div className="emp-added-skills">
            {niceSkills.map((skill) => (
              <span key={`nice-${skill}`} className="emp-skill-tag nice">
                {skill}
                <button type="button" onClick={() => onRemoveNice(skill)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="emp-form-grid">
        <div className="emp-form-group">
          <label className="emp-form-label required">Status</label>
          <select className="emp-select" value={form.status} onChange={(event) => onUpdateForm('status', event.target.value as JobStatus)}>
            <option value="open">Open</option>
            <option value="draft">Draft</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      <div className="emp-job-editor-actions">
        <button className="emp-btn-secondary" type="button" onClick={onSaveDraft} disabled={saving}>
          <UIIcon name="bookmark" />
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button className="emp-btn-primary" type="button" onClick={onPost} disabled={saving}>
          <UIIcon name="paper-plane" />
          {saving ? 'Posting...' : 'Post Job'}
        </button>
      </div>
    </div>
  );
}

export function DeleteProfileModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="emp-modal-overlay" onClick={onCancel}>
      <div className="emp-modal sm" onClick={(event) => event.stopPropagation()}>
        <div className="emp-modal-header">
          <div className="emp-modal-title text-red">Delete Employer Profile</div>
          <button className="emp-modal-close" type="button" onClick={onCancel}>
            <UIIcon name="close" />
          </button>
        </div>
        <div className="emp-danger-notice">
          <UIIcon name="times-circle" />
          <span>
            This is a deletion request. You will receive an email confirmation before any employer data is removed.
          </span>
        </div>
        <p className="mt-3 text-sm text-soft">
          This prototype does not independently verify employer identity or organization legitimacy.
        </p>
        <div className="emp-modal-footer">
          <button className="emp-btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="emp-btn-danger" type="button" onClick={onConfirm}>
            <UIIcon name="times-circle" />
            Request Deletion
          </button>
        </div>
      </div>
    </div>
  );
}
