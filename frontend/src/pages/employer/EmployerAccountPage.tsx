import { useState } from 'react';
import { FormField, PageHeader } from '../../components/ui';
import { CityField, RegionProvinceFields } from '../../components/ProvinceSelect';
import { CONTACT_NUMBER_DIGITS, contactNumberInput } from '../../lib/contactNumber';
import { canonicalCity } from '../../lib/phCities';
import { EMPLOYER_COMPANY_SIZES, EMPLOYER_INDUSTRIES } from './model';

export type EmployerAccountForm = {
  company: string;
  industry: string;
  size: string;
  city: string;
  province: string;
  website: string;
  about: string;
  contactPerson: string;
  contactRole: string;
  contactEmail: string;
  contactNumber: string;
};

type PasswordForm = { current: string; next: string; confirm: string };

type EmployerAccountPageProps = {
  profile: EmployerAccountForm;
  password: PasswordForm;
  isSaving: boolean;
  onProfileChange: (profile: EmployerAccountForm) => void;
  onSave: () => void;
  onPasswordChange: (password: PasswordForm) => void;
  onUpdatePassword: () => void;
  onRequestDelete: () => void;
};

function withSaved(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [value, ...options] : options;
}

const ACCESS_RULES = [
  'You see only people who applied to your own job posts.',
  'There is no global candidate search or cross-employer profile access.',
  'Applicant identity stays masked until Interviewing.',
  'Messaging opens only after Interviewing and the candidate accepts.',
  'Withdrawn applications are read-only and cannot be messaged.',
];

export function EmployerAccountPage({ profile, password, isSaving, onProfileChange, onSave, onPasswordChange, onUpdatePassword, onRequestDelete }: EmployerAccountPageProps) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const set = (key: keyof EmployerAccountForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onProfileChange({ ...profile, [key]: event.target.value });

  return (
    <div className="k-page k-page-narrow">
      <PageHeader title="Company profile" />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <section className="k-section" aria-labelledby="acct-company">
          <h2 id="acct-company" className="k-section-title mb-3">Company</h2>
          <div className="k-form-grid">
            <FormField label="Company name *" className="k-span-2">
              <input className="k-input" value={profile.company} onChange={set('company')} autoComplete="organization" required />
            </FormField>
            <FormField label="Industry" className="k-span-2">
              <select className="k-select" value={profile.industry} onChange={set('industry')}>
                <option value="">Select an industry</option>
                {withSaved(EMPLOYER_INDUSTRIES, profile.industry).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
            <RegionProvinceFields
              value={profile.province}
              // A new province keeps the city only when that province lists it.
              onChange={(province) => onProfileChange({ ...profile, province, city: canonicalCity(province, profile.city) })}
            />
            <CityField
              province={profile.province}
              value={profile.city}
              onChange={(city) => onProfileChange({ ...profile, city })}
              help="New job posts start at this location."
            />
            <FormField label="Company size">
              <select className="k-select" value={profile.size} onChange={set('size')}>
                <option value="">Select a size</option>
                {withSaved(EMPLOYER_COMPANY_SIZES, profile.size).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
            <FormField label="Website">
              <input className="k-input" type="url" inputMode="url" value={profile.website} onChange={set('website')} placeholder="https://" autoComplete="url" />
            </FormField>
            <FormField label="About the company" className="k-span-2" help="Candidates see this on your job posts.">
              <textarea className="k-textarea min-h-[96px]" value={profile.about} onChange={set('about')} />
            </FormField>
          </div>
        </section>

        <section className="k-section" aria-labelledby="acct-contact">
          <h2 id="acct-contact" className="k-section-title mb-3">Contact person</h2>
          <div className="k-form-grid">
            <FormField label="Full name">
              <input className="k-input" value={profile.contactPerson} onChange={set('contactPerson')} autoComplete="name" />
            </FormField>
            <FormField label="Position">
              <input className="k-input" value={profile.contactRole} onChange={set('contactRole')} placeholder="e.g. HR Manager" autoComplete="organization-title" />
            </FormField>
            <FormField label="Email">
              <input className="k-input" type="email" inputMode="email" value={profile.contactEmail} onChange={set('contactEmail')} autoComplete="email" />
            </FormField>
            <FormField label="Contact number" help={`Up to ${CONTACT_NUMBER_DIGITS} digits, e.g. 09123456789.`}>
              <input
                className="k-input"
                type="tel"
                inputMode="numeric"
                value={profile.contactNumber}
                onChange={(event) => onProfileChange({ ...profile, contactNumber: contactNumberInput(event.target.value) })}
                placeholder="09123456789"
                autoComplete="tel-national"
              />
            </FormField>
          </div>
          <div className="mt-5">
            <button className="k-btn k-btn-primary" type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </section>
      </form>

      <section className="k-section" aria-labelledby="acct-security">
        <h2 id="acct-security" className="k-section-title mb-3">Password and security</h2>
        {!passwordOpen ? (
          <button className="k-btn k-btn-secondary" type="button" onClick={() => setPasswordOpen(true)}>Change password</button>
        ) : (
          <form
            className="k-card"
            onSubmit={(event) => {
              event.preventDefault();
              onUpdatePassword();
            }}
          >
            <div className="k-form-grid">
              <FormField label="Current password" className="k-span-2">
                <input className="k-input" type="password" autoComplete="current-password" value={password.current} onChange={(event) => onPasswordChange({ ...password, current: event.target.value })} />
              </FormField>
              <FormField label="New password" help="At least 8 characters.">
                <input className="k-input" type="password" autoComplete="new-password" value={password.next} onChange={(event) => onPasswordChange({ ...password, next: event.target.value })} />
              </FormField>
              <FormField label="Confirm new password">
                <input className="k-input" type="password" autoComplete="new-password" value={password.confirm} onChange={(event) => onPasswordChange({ ...password, confirm: event.target.value })} />
              </FormField>
            </div>
            <div className="k-button-row mt-4">
              <button className="k-btn k-btn-primary" type="submit" disabled={isSaving}>{isSaving ? 'Updating…' : 'Update password'}</button>
              <button className="k-btn k-btn-ghost" type="button" onClick={() => { setPasswordOpen(false); onPasswordChange({ current: '', next: '', confirm: '' }); }}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      <details className="k-section k-detail-section">
        <summary>Privacy and access</summary>
        <ul className="k-secondary mt-2 list-disc space-y-1 pl-5">
          {ACCESS_RULES.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
        <p className="k-meta mt-3">Kareerly doesn't independently verify employer identity or organisation legitimacy.</p>
      </details>

      <section className="k-section border-t border-bdr pt-6" aria-labelledby="acct-delete">
        <h2 id="acct-delete" className="k-section-title text-red">Delete employer profile</h2>
        <p className="k-secondary mb-3 mt-1">Asks the Kareerly administrators to remove your account, job posts, applicant records and messages. Your account stays active until they approve it.</p>
        <button className="k-btn k-btn-danger-outline" type="button" onClick={onRequestDelete}>Request deletion</button>
      </section>
    </div>
  );
}
