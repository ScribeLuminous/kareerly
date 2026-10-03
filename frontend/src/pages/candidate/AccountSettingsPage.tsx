import { useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEllipsisVertical, faEye, faFileLines, faTrash, faUpload } from '@fortawesome/free-solid-svg-icons';
import { Banner, EmptyState, Menu } from '../../components/ui';
import { RegionProvinceFields } from '../../components/ProvinceSelect';
import { CONTACT_NUMBER_DIGITS, contactNumberInput } from '../../lib/contactNumber';
import type { EvidenceUploadRecord } from '../../lib/evidence';
import { joinLocation, splitLocation } from '../../lib/phProvinces';
import { FormField, PageHeader } from './common';
import { cleanSkillDisplayName, formatDateLabel, tr } from './model';

type ProfileForm = {
  contactNumber: string;
  birthday: string;
  address: string;
  location: string;
  highestEducationalAttainment: string;
  degreeProgram: string;
  schoolUniversity: string;
  yearGraduated: string;
};

/**
 * Region, province, then city, saved together as one "City, Province"
 * location so the region can be read back from it.
 */
function LocationFields({ location, onChange, t }: { location: string; onChange: (location: string) => void; t: (text: string) => string }) {
  const { city, province } = splitLocation(location);
  // The city as typed, so spaces at the end survive until the field is left.
  const [typedCity, setTypedCity] = useState<string | null>(null);
  return (
    <>
      <RegionProvinceFields value={province} onChange={(next) => onChange(joinLocation(typedCity ?? city, next))} t={t} />
      <FormField label={t('City or municipality')}>
        <input
          className="k-input"
          autoComplete="address-level2"
          value={typedCity ?? city}
          onChange={(event) => {
            setTypedCity(event.target.value);
            onChange(joinLocation(event.target.value, province));
          }}
          onBlur={() => setTypedCity(null)}
          placeholder="e.g. Quezon City"
        />
      </FormField>
    </>
  );
}

type AccountSettingsPageProps = {
  user: { name: string; email: string; publicId: string };
  uiLanguage: 'en' | 'fil';
  evidenceRecords: EvidenceUploadRecord[];
  savedResumeFileName: string;
  profile: ProfileForm;
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
  onProfileChange: (profile: ProfileForm) => void;
  onIdentityChange: (identity: { name: string; email: string }) => void;
  onPasswordChange: (password: { current: string; next: string; confirm: string }) => void;
  onUpdatePassword: () => void;
  onSave: () => void;
};

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
}: AccountSettingsPageProps) {
  const t = (text: string) => tr(uiLanguage, text);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const sortedEvidence = useMemo(
    () => [...evidenceRecords].sort((left, right) => (left.category || 'Other').localeCompare(right.category || 'Other') || left.title.localeCompare(right.title)),
    [evidenceRecords],
  );
  const set = (key: keyof ProfileForm) => (event: React.ChangeEvent<HTMLInputElement>) => onProfileChange({ ...profile, [key]: event.target.value });

  return (
    <div className="k-page k-page-narrow">
      <PageHeader title={t('Profile & resume')}>
        {user.publicId && <p className="k-meta mt-1">{t('Candidate ID')}: <span className="k-num">{user.publicId}</span></p>}
      </PageHeader>

      <section className="k-section" aria-labelledby="profile-resume">
        <h2 id="profile-resume" className="k-section-title mb-3">{t('Resume')}</h2>
        <div className="k-card flex flex-wrap items-center gap-3">
          <FontAwesomeIcon icon={faFileLines} className="h-5 w-5 text-soft" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="k-label [overflow-wrap:anywhere]">{savedResumeFileName || t('No resume saved yet')}</p>
            <p className="k-meta">Updating it refreshes your matches, gaps and learning.</p>
          </div>
          <div className="k-button-row w-full sm:w-auto">
            <button className="k-btn k-btn-secondary flex-1 sm:flex-none" type="button" onClick={onViewResume} disabled={!savedResumeFileName}>
              <FontAwesomeIcon icon={faEye} aria-hidden="true" />{t('View')}
            </button>
            <button className="k-btn k-btn-primary flex-1 sm:flex-none" type="button" onClick={onOpenResume}>
              <FontAwesomeIcon icon={faUpload} aria-hidden="true" />{t('Update resume')}
            </button>
          </div>
        </div>
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <section className="k-section" aria-labelledby="profile-details">
          <h2 id="profile-details" className="k-section-title mb-3">{t('Personal details')}</h2>
          {profileSaveNotice && <Banner>{profileSaveNotice}</Banner>}
          <div className="k-form-grid">
            <FormField label={t('Full Name')} className="k-span-2">
              <input className="k-input" value={user.name} autoComplete="name" onChange={(event) => onIdentityChange({ name: event.target.value, email: user.email })} />
            </FormField>
            <FormField label={t('Email Address')}>
              <input className="k-input" type="email" inputMode="email" autoComplete="email" value={user.email} onChange={(event) => onIdentityChange({ name: user.name, email: event.target.value })} />
            </FormField>
            <FormField label={t('Contact Number')} help={t(`Up to ${CONTACT_NUMBER_DIGITS} digits, e.g. 09123456789.`)}>
              <input
                className="k-input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={profile.contactNumber}
                onChange={(event) => onProfileChange({ ...profile, contactNumber: contactNumberInput(event.target.value) })}
                placeholder="09123456789"
              />
            </FormField>
            <LocationFields location={profile.location} onChange={(location) => onProfileChange({ ...profile, location })} t={t} />
            <FormField label={t('Birthday')}>
              <input className="k-input" type="date" autoComplete="bday" value={profile.birthday} onChange={set('birthday')} />
            </FormField>
            <FormField label={t('Address')} className="k-span-2">
              <input className="k-input" autoComplete="street-address" value={profile.address} onChange={set('address')} />
            </FormField>
          </div>
        </section>

        <section className="k-section" aria-labelledby="profile-education">
          <h2 id="profile-education" className="k-section-title mb-3">{t('Education')}</h2>
          <div className="k-form-grid">
            <FormField label={t('Highest Educational Attainment')} className="k-span-2">
              <input className="k-input" value={profile.highestEducationalAttainment} onChange={set('highestEducationalAttainment')} placeholder="e.g. Bachelor's degree" />
            </FormField>
            <FormField label={t('Degree / Program')}>
              <input className="k-input" value={profile.degreeProgram} onChange={set('degreeProgram')} />
            </FormField>
            <FormField label={t('School / University')}>
              <input className="k-input" value={profile.schoolUniversity} onChange={set('schoolUniversity')} />
            </FormField>
            <FormField label={t('Year Graduated')}>
              <input className="k-input" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={profile.yearGraduated} onChange={set('yearGraduated')} />
            </FormField>
          </div>
          <div className="mt-5">
            <button className="k-btn k-btn-primary" type="submit" disabled={isSavingProfile}>
              {isSavingProfile ? `${t('Saving')}…` : t('Save changes')}
            </button>
          </div>
        </section>
      </form>

      <section className="k-section" aria-labelledby="profile-evidence">
        <div className="k-section-head">
          <h2 id="profile-evidence" className="k-section-title">{t('Certificates and proof')}</h2>
          <button className="k-btn k-btn-secondary k-btn-sm" type="button" onClick={onOpenEvidenceUpload}>
            <FontAwesomeIcon icon={faUpload} aria-hidden="true" />{t('Upload proof')}
          </button>
        </div>
        {sortedEvidence.length === 0 ? (
          <div className="k-card"><EmptyState className="py-4" title="Nothing uploaded yet" text="Add certificates or project samples to back up your skill progress." /></div>
        ) : (
          <ul className="k-list">
            {sortedEvidence.map((record) => (
              <li key={record.id} className="k-row pr-1">
                <div className="k-row-main">
                  <p className="k-label [overflow-wrap:anywhere]">{record.title}</p>
                  <p className="k-meta k-dot-sep mt-0.5">
                    <span>{cleanSkillDisplayName(record.relatedSkill || '') || 'No skill set'}</span>
                    <span>{record.evidenceType}</span>
                    <span>{formatDateLabel(record.uploadedAt)}</span>
                  </p>
                </div>
                <span className={record.status === 'Verified' ? 'k-badge k-badge-success' : 'k-badge k-badge-high'}>{record.status}</span>
                <Menu
                  label={`Actions for ${record.title}`}
                  trigger={<FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />}
                  items={[
                    { label: t('View'), icon: faEye, onSelect: () => onViewEvidence(record) },
                    { label: t('Replace'), icon: faUpload, onSelect: () => onReplaceEvidence(record) },
                    { label: t('Delete'), icon: faTrash, danger: true, onSelect: () => onDeleteEvidence(record) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="k-meta mt-2">PDF only. Uploads stay pending until reviewed; Kareerly does not confirm issuer authenticity.</p>
      </section>

      <section className="k-section" aria-labelledby="profile-security">
        <h2 id="profile-security" className="k-section-title mb-3">{t('Password and security')}</h2>
        {!passwordOpen ? (
          <button className="k-btn k-btn-secondary" type="button" onClick={() => setPasswordOpen(true)}>{t('Change password')}</button>
        ) : (
          <form
            className="k-card"
            onSubmit={(event) => {
              event.preventDefault();
              onUpdatePassword();
            }}
          >
            <div className="k-form-grid">
              <FormField label={t('Current Password')} className="k-span-2">
                <input className="k-input" type="password" autoComplete="current-password" value={password.current} onChange={(event) => onPasswordChange({ ...password, current: event.target.value })} />
              </FormField>
              <FormField label={t('New Password')}>
                <input className="k-input" type="password" autoComplete="new-password" value={password.next} onChange={(event) => onPasswordChange({ ...password, next: event.target.value })} />
              </FormField>
              <FormField label={t('Confirm New Password')}>
                <input className="k-input" type="password" autoComplete="new-password" value={password.confirm} onChange={(event) => onPasswordChange({ ...password, confirm: event.target.value })} />
              </FormField>
            </div>
            <div className="k-button-row mt-4">
              <button className="k-btn k-btn-primary" type="submit" disabled={isUpdatingPassword}>
                {isUpdatingPassword ? `${t('Updating')}…` : t('Update Password')}
              </button>
              <button className="k-btn k-btn-ghost" type="button" onClick={() => { setPasswordOpen(false); onPasswordChange({ current: '', next: '', confirm: '' }); }}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      <section className="k-section" aria-labelledby="profile-language">
        <h2 id="profile-language" className="k-section-title mb-1">{t('Language')}</h2>
        <p className="k-meta mb-3">
          {uiLanguage === 'fil' ? 'Para sa mga label ng Kareerly. Hindi isinasalin ang resume at mga job post.' : 'For Kareerly labels. Resumes and job posts stay in their original language.'}
        </p>
        <div className="k-seg sm:w-auto" role="radiogroup" aria-label={t('Language')}>
          {(['en', 'fil'] as const).map((language) => (
            <button key={language} className="k-seg-btn" type="button" role="radio" aria-checked={uiLanguage === language} onClick={() => onLanguage(language)}>
              {t(language === 'en' ? 'English' : 'Filipino')}
            </button>
          ))}
        </div>
      </section>

      <section className="k-section border-t border-bdr pt-6" aria-labelledby="profile-delete">
        <h2 id="profile-delete" className="k-section-title text-red">{t('Delete profile')}</h2>
        <p className="k-secondary mb-3 mt-1">Removes your candidate account, matches, applications and progress.</p>
        <button className="k-btn k-btn-danger-outline" type="button" onClick={onOpenDelete}>{t('Request deletion')}</button>
      </section>
    </div>
  );
}
