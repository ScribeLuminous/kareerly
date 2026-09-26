import type { EvidenceUploadRecord } from '../../lib/evidence';
import { useMemo } from 'react';
import { cleanSkillDisplayName, formatDateLabel, tr } from './model';
import { FormField } from './common';
import { UIIcon } from './icons';

export function AccountSettingsPage({
  user,
  uiLanguage,
  evidenceRecords,
  profile,
  password,
  savedResumeFileName,
  isSavingProfile,
  isUpdatingPassword,
  profileSaveNotice,
  onLanguage,
  onOpenDelete,
  onOpenResume,
  onViewResume,
  onOpenEvidenceUpload,
  onViewEvidence,
  onReplaceEvidence,
  onDeleteEvidence,
  onProfileChange,
  onIdentityChange,
  onPasswordChange,
  onUpdatePassword,
  onSave,
}: {
  user: { name: string; email: string; publicId: string };
  uiLanguage: 'en' | 'fil';
  evidenceRecords: EvidenceUploadRecord[];
  savedResumeFileName: string;
  profile: {
    contactNumber: string;
    birthday: string;
    address: string;
    location: string;
    highestEducationalAttainment: string;
    degreeProgram: string;
    schoolUniversity: string;
    yearGraduated: string;
  };
  password: { current: string; next: string; confirm: string };
  isSavingProfile: boolean;
  isUpdatingPassword: boolean;
  profileSaveNotice: string | null;
  onLanguage: (lang: 'en' | 'fil') => void;
  onOpenDelete: () => void;
  onOpenResume: () => void;
  onViewResume: () => void;
  onOpenEvidenceUpload: () => void;
  onViewEvidence: (record: EvidenceUploadRecord) => void;
  onReplaceEvidence: (record: EvidenceUploadRecord) => void;
  onDeleteEvidence: (record: EvidenceUploadRecord) => void;
  onProfileChange: (profile: {
    contactNumber: string;
    birthday: string;
    address: string;
    location: string;
    highestEducationalAttainment: string;
    degreeProgram: string;
    schoolUniversity: string;
    yearGraduated: string;
  }) => void;
  onIdentityChange: (identity: { name: string; email: string }) => void;
  onPasswordChange: (password: { current: string; next: string; confirm: string }) => void;
  onUpdatePassword: () => void;
  onSave: () => void;
}) {
  const t = (text: string) => tr(uiLanguage, text);
  const groupedEvidence = useMemo(() => {
    const groups = new Map<string, EvidenceUploadRecord[]>();
    evidenceRecords.forEach((record) => {
      const key = record.category?.trim() || 'Other';
      const current = groups.get(key) || [];
      current.push(record);
      groups.set(key, current);
    });
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [evidenceRecords]);

  return (
    <div>
      <div className="cand-page-header">
        <h1 className="cand-page-title">{t('Account Settings')}</h1>
        <p className="cand-page-subtitle">{t('Manage personal details, resume, education, and account controls')}</p>
      </div>

      <div className="cand-acct-section">
        <div className="cand-acct-title">{t('Language Preference')}</div>
        <p className="mb-3 text-xs text-soft-text">
          {uiLanguage === 'fil'
            ? 'Gagamitin ang Filipino sa mga label at tagubilin ng Kareerly. Mananatili sa orihinal na wika ang nilalaman ng resume at mga trabahong ipinaskil ng employer.'
            : 'Choose the language used for Kareerly labels and instructions. Resume content and employer-provided job posts remain in their original language.'}
        </p>
        <div className="flex gap-2">
          <button className={`cand-tab-btn ${uiLanguage === 'en' ? 'active' : ''}`} type="button" onClick={() => onLanguage('en')}>
            {t('English')}
          </button>
          <button className={`cand-tab-btn ${uiLanguage === 'fil' ? 'active' : ''}`} type="button" onClick={() => onLanguage('fil')}>
            {t('Filipino')}
          </button>
        </div>
      </div>

      <div className="cand-acct-grid">
        <div className="cand-acct-section">
          <div className="cand-acct-title">{t('Personal Details')}</div>
          {profileSaveNotice && (
            <div className="cand-notice info mb-3">
              <span>{profileSaveNotice}</span>
            </div>
          )}
          <div className="space-y-3">
            <FormField label={t('Full Name')}><input className="cand-form-input" value={user.name} onChange={(event) => onIdentityChange({ name: event.target.value, email: user.email })} /></FormField>
            <FormField label={t('Email Address')}><input className="cand-form-input" type="email" value={user.email} onChange={(event) => onIdentityChange({ name: user.name, email: event.target.value })} /></FormField>
            <FormField label={t('Candidate ID')}><input className="cand-form-input" value={user.publicId || t('Not available')} readOnly /></FormField>
            <FormField label={t('Contact Number')}><input className="cand-form-input" value={profile.contactNumber} onChange={(event) => onProfileChange({ ...profile, contactNumber: event.target.value })} placeholder={t('Enter contact number')} /></FormField>
            <FormField label={t('Birthday')}><input className="cand-form-input" value={profile.birthday} onChange={(event) => onProfileChange({ ...profile, birthday: event.target.value })} type="date" /></FormField>
            <FormField label={t('Address')}><input className="cand-form-input" value={profile.address} onChange={(event) => onProfileChange({ ...profile, address: event.target.value })} placeholder={t('Enter your address')} /></FormField>
            <FormField label={t('Location / Region')}><input className="cand-form-input" value={profile.location} onChange={(event) => onProfileChange({ ...profile, location: event.target.value })} placeholder={t('Enter your region')} /></FormField>
          </div>
          <button className="cand-btn-primary mt-4" type="button" onClick={onSave} disabled={isSavingProfile}>
            {isSavingProfile ? `${t('Saving')}...` : t('Save Details')}
          </button>
        </div>

        <div>
          <div className="cand-acct-section">
            <div className="cand-acct-title">{t('Password & Security')}</div>
            <div className="space-y-3">
              <FormField label={t('Current Password')}><input className="cand-form-input" type="password" value={password.current} onChange={(event) => onPasswordChange({ ...password, current: event.target.value })} /></FormField>
              <FormField label={t('New Password')}><input className="cand-form-input" type="password" value={password.next} onChange={(event) => onPasswordChange({ ...password, next: event.target.value })} /></FormField>
              <FormField label={t('Confirm New Password')}><input className="cand-form-input" type="password" value={password.confirm} onChange={(event) => onPasswordChange({ ...password, confirm: event.target.value })} /></FormField>
            </div>
            <button className="cand-btn-primary mt-4" type="button" onClick={onUpdatePassword} disabled={isUpdatingPassword}>
              {isUpdatingPassword ? `${t('Updating')}...` : t('Update Password')}
            </button>
          </div>

          <div className="cand-acct-section">
            <div className="cand-acct-title">{t('Resume')}</div>
            <div className="cand-notice info mb-3">
              <span>{uiLanguage === 'fil' ? 'Tingnan o i-upload ang pinakabagong resume. Ang pag-update nito ay magre-refresh ng mga tugmang trabaho, kakulangan sa kasanayan, at rekomendasyon.' : 'View or upload your latest resume. Updating resume refreshes matches, gaps, and recommendations.'}</span>
            </div>
            <div className="mb-3 text-sm text-mid">
              {t('Saved resume:')} <strong>{savedResumeFileName || t('No resume saved yet')}</strong>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button className="cand-btn-secondary flex-1 justify-center" type="button" onClick={onViewResume} disabled={!savedResumeFileName}>
                <UIIcon name="eye" className="cand-btn-icon" />{t('View Resume')}
              </button>
              <button className="cand-btn-secondary flex-1 justify-center" type="button" onClick={onOpenResume}>
                <UIIcon name="upload" className="cand-btn-icon" />{t('Update Resume')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="cand-acct-section">
          <div className="cand-acct-title">Education</div>
          <div className="cand-form-grid">
          <FormField label="Highest Educational Attainment"><input className="cand-form-input" value={profile.highestEducationalAttainment} onChange={(event) => onProfileChange({ ...profile, highestEducationalAttainment: event.target.value })} placeholder="Enter highest educational attainment" /></FormField>
          <FormField label="Degree / Program"><input className="cand-form-input" value={profile.degreeProgram} onChange={(event) => onProfileChange({ ...profile, degreeProgram: event.target.value })} placeholder="Enter degree or program" /></FormField>
          <FormField label="School / University"><input className="cand-form-input" value={profile.schoolUniversity} onChange={(event) => onProfileChange({ ...profile, schoolUniversity: event.target.value })} placeholder="Enter school or university" /></FormField>
          <FormField label="Year Graduated"><input className="cand-form-input" value={profile.yearGraduated} onChange={(event) => onProfileChange({ ...profile, yearGraduated: event.target.value })} placeholder="Enter graduation year" /></FormField>
          </div>
        <button className="cand-btn-primary mt-3" type="button" onClick={onSave} disabled={isSavingProfile}>
          {isSavingProfile ? 'Saving...' : 'Save Education'}
        </button>
      </div>

      <div className="cand-acct-section">
        <div className="cand-acct-title">User-Uploaded Evidence</div>
        <p className="mb-3 text-xs text-soft-text">
          Parsed resume information is used for your profile and job matching. Only PDFs submitted through Upload Evidence appear here. File checks do not confirm issuer authenticity, completion, or certificate validity. Uploads remain Pending Verification.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-soft-text">Upload certificates, course completion files, portfolio outputs, or project samples to support your Skill Development Progress.</div>
          <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={onOpenEvidenceUpload}>
            <UIIcon name="upload" className="cand-btn-icon" />Upload Evidence
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {groupedEvidence.length > 0 ? (
            groupedEvidence.map(([category, records]) => (
              <div key={category} className="cand-evidence-group">
                <div className="cand-evidence-group-title">{category}</div>
                <div className="space-y-3">
                  {records.map((record) => (
                    <div key={record.id} className="cand-evidence-card">
                      <div className="cand-evidence-card-main">
                        <div className="cand-evidence-card-title-row">
                          <div className="cand-evidence-card-title">{record.title}</div>
                          <span className={`cand-msg-badge ${record.status === 'Verified' ? 'accepted' : 'pending'}`}>{record.status}</span>
                        </div>
                        <div className="cand-evidence-card-meta">
                          <span>{cleanSkillDisplayName(record.relatedSkill || '') || 'Related skill not set'}</span>
                          <span>{record.evidenceType}</span>
                          <span>Uploaded {formatDateLabel(record.uploadedAt)}</span>
                        </div>
                        {record.notes ? <div className="cand-evidence-card-note">{record.notes}</div> : null}
                      </div>
                      <div className="cand-evidence-card-actions">
                        <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onViewEvidence(record)}>
                          <UIIcon name="eye" className="cand-btn-icon" />View
                        </button>
                        <button className="cand-btn-secondary cand-btn-sm" type="button" onClick={() => onReplaceEvidence(record)}>
                          <UIIcon name="upload" className="cand-btn-icon" />Replace
                        </button>
                        <button className="cand-btn-danger cand-btn-sm" type="button" onClick={() => onDeleteEvidence(record)}>
                          <UIIcon name="trash" className="cand-btn-icon" />Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="cand-gap-empty-state">
              No evidence uploaded yet. Upload certificates, course completion files, portfolio outputs, or project samples to support your Skill Development Progress.
            </div>
          )}
        </div>
      </div>

      <div className="cand-acct-section border border-red">
        <div className="cand-acct-title border-b border-red-l text-red">Delete Profile</div>
        <p className="text-sm text-mid">
          Requesting profile deletion may affect your saved matches, applications, and progress records.
        </p>
        <button className="cand-btn-danger mt-4" type="button" onClick={onOpenDelete}>
          Request Profile Deletion
        </button>
      </div>
    </div>
  );
}
