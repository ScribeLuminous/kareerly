import { supabase } from './supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export type AuthRole = 'candidate' | 'employer' | 'admin';
export type AuthStatus = 'loading' | 'signed_out' | 'verifying_role' | 'authenticated' | 'role_mismatch';

let authStatus: AuthStatus = 'loading';
let authOperationVersion = 0;

export function getAuthStatus(): AuthStatus {
  return authStatus;
}

export type KareerlyUser = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
  company?: string;
  birthday?: string | null;
  location?: string | null;
  educationJson?: unknown;
  certificationsJson?: unknown;
};

export class RoleMismatchError extends Error {
  actualRole: AuthRole;

  constructor(actualRole: AuthRole) {
    super('Unable to log in. Please check your login credentials and account type.');
    this.name = 'RoleMismatchError';
    this.actualRole = actualRole;
  }
}

type ProfileRow = {
  id: string;
  role: AuthRole;
  first_name: string;
  last_name: string;
  email: string;
  candidate_profiles?: {
    birthday?: string | null;
    location?: string | null;
    certifications_json?: unknown;
  } | null;
  employer_profiles?: Array<{ company_name: string | null }> | { company_name: string | null } | null;
};

function getFullName(firstName?: string | null, lastName?: string | null, email?: string | null) {
  const name = `${firstName || ''} ${lastName || ''}`.trim();
  return name || email?.split('@')[0] || 'Kareerly User';
}

function normalizeRole(value: unknown): AuthRole {
  return value === 'employer' || value === 'admin' || value === 'candidate' ? value : 'candidate';
}

function mapAuthUser(user: SupabaseUser): KareerlyUser {
  const metadata = user.user_metadata || {};
  const firstName = typeof metadata.first_name === 'string' ? metadata.first_name : '';
  const lastName = typeof metadata.last_name === 'string' ? metadata.last_name : '';
  const email = user.email || '';

  return {
    id: user.id,
    email,
    name: getFullName(firstName, lastName, email),
    role: normalizeRole(metadata.role),
    birthday: typeof metadata.birthday === 'string' ? metadata.birthday : null,
    company: typeof metadata.company_name === 'string' ? metadata.company_name : undefined,
  };
}

function mapProfile(profile: ProfileRow): KareerlyUser {
  const employerProfile = Array.isArray(profile.employer_profiles)
    ? profile.employer_profiles[0]
    : profile.employer_profiles;

  return {
    id: profile.id,
    email: profile.email,
    name: getFullName(profile.first_name, profile.last_name, profile.email),
    role: profile.role,
    birthday: profile.candidate_profiles?.birthday || null,
    location: profile.candidate_profiles?.location || null,
    educationJson: null,
    certificationsJson: profile.candidate_profiles?.certifications_json || null,
    company: employerProfile?.company_name || undefined,
  };
}

async function getProfileForUserId(userId: string): Promise<KareerlyUser | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, first_name, last_name, email, candidate_profiles(birthday,location,certifications_json), employer_profiles(company_name)')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapProfile(data as ProfileRow) : null;
}

async function getRoleVerifiedProfileForUserId(userId: string): Promise<KareerlyUser | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, first_name, last_name, email')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapProfile(data as ProfileRow) : null;
}

export async function getCurrentKareerlyUser(): Promise<KareerlyUser | null> {
  const operationVersion = authOperationVersion;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  if (operationVersion !== authOperationVersion || authStatus === 'verifying_role' || authStatus === 'role_mismatch') {
    return null;
  }

  const authUser = sessionData.session?.user;
  const userId = authUser?.id;
  if (!userId) {
    authStatus = 'signed_out';
    return null;
  }

  return getProfileForUserId(userId).then((user) => {
    if (operationVersion !== authOperationVersion || authStatus === 'verifying_role' || authStatus === 'role_mismatch') {
      return null;
    }
    authStatus = user ? 'authenticated' : 'signed_out';
    return user;
  }).catch((error) => {
    console.warn('Unable to load Kareerly profile, using auth user metadata:', error);
    if (operationVersion !== authOperationVersion || authStatus === 'verifying_role' || authStatus === 'role_mismatch') {
      return null;
    }
    authStatus = 'authenticated';
    return authUser ? mapAuthUser(authUser) : null;
  });
}

export async function signInWithEmail(email: string, password: string, expectedRole?: AuthRole): Promise<KareerlyUser> {
  authOperationVersion += 1;
  authStatus = 'verifying_role';
  const verificationErrorMessage = 'We could not verify your account profile. Please try again shortly or contact support.';
  const { data, error } = await supabase.auth.signInWithPassword({ email, password }).catch((error: unknown) => {
    authStatus = 'signed_out';
    throw error;
  });
  if (error) {
    authStatus = 'signed_out';
    throw error;
  }

  const userId = data.user?.id || data.session?.user.id;
  let user: KareerlyUser | null;
  try {
    user = userId ? await getRoleVerifiedProfileForUserId(userId) : null;
  } catch (profileError) {
    await supabase.auth.signOut().catch(() => undefined);
    authStatus = 'signed_out';
    throw new Error(verificationErrorMessage, { cause: profileError });
  }
  if (!user) {
    await supabase.auth.signOut().catch(() => undefined);
    authStatus = 'signed_out';
    throw new Error(verificationErrorMessage);
  }
  if (expectedRole && user.role !== expectedRole) {
    await supabase.auth.signOut().catch((signOutError) => {
      console.warn('Unable to sign out after role mismatch:', signOutError);
    });
    authStatus = 'role_mismatch';
    throw new RoleMismatchError(user.role);
  }
  if (userId) {
    const detailedUser = await getProfileForUserId(userId).catch((profileDetailsError) => {
      console.warn('Unable to load optional profile details after role verification:', profileDetailsError);
      return null;
    });
    if (detailedUser) user = detailedUser;
  }
  authStatus = 'authenticated';
  return user;
}

export function isEmailRateLimitError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const text = `${error instanceof Error ? error.message : ''} ${record.message ?? ''} ${record.code ?? ''}`.toLowerCase();
  return record.code === 'over_email_send_rate_limit' || text.includes('email rate limit') || text.includes('rate limit exceeded') || Number(record.status) === 429;
}

export function isEmailNotConfirmedError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return record.code === 'email_not_confirmed' || (error instanceof Error && /email not confirmed/i.test(error.message));
}

/** Sign-up / reset errors. Unlike sign-in, a 400 here is not "wrong password". */
export function getFriendlySignUpErrorMessage(error: unknown, fallback: string): string {
  if (isEmailRateLimitError(error)) return getFriendlyAuthErrorMessage(error);
  const message = error instanceof Error ? error.message : '';
  if (/already registered|already exists/i.test(message)) return message;
  if (/network|failed to fetch|load failed/i.test(message)) return getFriendlyAuthErrorMessage(error);
  return message || fallback;
}

export async function resendConfirmationEmail(email: string) {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export function getFriendlyAuthErrorMessage(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = [
    error instanceof Error ? error.message : '',
    typeof record.message === 'string' ? record.message : '',
    typeof record.msg === 'string' ? record.msg : '',
    typeof record.error_description === 'string' ? record.error_description : '',
    typeof record.details === 'string' ? record.details : '',
    typeof record.hint === 'string' ? record.hint : '',
    typeof record.code === 'string' ? record.code : '',
  ].find((item) => item.trim())?.trim() || '';
  const status = 'status' in record ? Number(record.status) : null;
  const lowerMessage = message.toLowerCase();

  if (
    record.name === 'AuthRetryableFetchError' ||
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('networkerror') ||
    lowerMessage.includes('network request failed') ||
    lowerMessage === 'load failed'
  ) {
    return 'Unable to reach the sign-in service. Please check your connection and try again. If this continues, contact support.';
  }

  if (isEmailRateLimitError(error)) {
    return 'We have sent too many emails recently. Please wait a few minutes (or up to an hour) and try again. If you already signed up, check your inbox and spam folder for the confirmation link.';
  }

  if (lowerMessage.includes('email not confirmed')) {
    return 'Please confirm your email address before logging in.';
  }

  if (lowerMessage.includes('invalid login credentials') || lowerMessage === 'unable to log in.' || status === 400) {
    return 'Invalid email or password. Please check your details or reset your password.';
  }

  if (lowerMessage.includes('profile was found')) {
    return 'Login succeeded, but your Kareerly profile is missing. Please sign up again or contact support.';
  }

  return message || 'Unable to log in. Please try again.';
}

export async function signUpCandidate(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  birthday: string;
}): Promise<KareerlyUser> {
  const birthDate = new Date(input.birthday);
  const today = new Date();
  const ageMs = today.getTime() - birthDate.getTime();
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
  if (Number.isNaN(birthDate.getTime())) throw new Error('Please provide a valid birthday.');
  if (ageYears < 18) throw new Error('You must be at least 18 years old to sign up.');

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        role: 'candidate',
        first_name: input.firstName,
        last_name: input.lastName,
        birthday: input.birthday,
      },
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error('Supabase did not return a user for this signup.');
  // With email confirmation on, Supabase hides duplicates by returning a fake user with no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('This email is already registered. Log in instead, or reset your password if you forgot it.');
  }

  const profile = await getProfileForUserId(userId).catch(() => null);
  return profile || {
    id: userId,
    email: input.email,
    name: getFullName(input.firstName, input.lastName, input.email),
    role: 'candidate',
  };
}

export async function signUpEmployer(input: {
  company: string;
  companySize: string;
  industry: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<KareerlyUser> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        role: 'employer',
        first_name: input.firstName,
        last_name: input.lastName,
        company_name: input.company,
        company_size: input.companySize,
        industry: input.industry,
      },
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error('Supabase did not return a user for this signup.');
  // With email confirmation on, Supabase hides duplicates by returning a fake user with no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('This email is already registered. Log in instead, or reset your password if you forgot it.');
  }

  const profile = await getProfileForUserId(userId).catch(() => null);
  return profile || {
    id: userId,
    email: input.email,
    name: getFullName(input.firstName, input.lastName, input.email),
    role: 'employer',
    company: input.company,
  };
}

export async function updateCandidateProfile(input: {
  userId: string;
  location?: string;
  birthday?: string;
  educationJson?: unknown;
  certificationsJson?: unknown;
  contactNumber?: string;
  address?: string;
  preferredIndustry?: string;
  preferredWorkSetup?: string;
  expectedSalary?: string;
  targetRole?: string;
  skillToDevelop?: string;
  preferredLocationScope?: string;
  preferredRegion?: string;
}) {
  const payload: Record<string, unknown> = {};
  if (typeof input.location === 'string') payload.location = input.location;
  if (typeof input.birthday === 'string') payload.birthday = input.birthday || null;
  if (input.certificationsJson !== undefined) payload.certifications_json = input.certificationsJson;
  if (typeof input.preferredIndustry === 'string') payload.preferred_industry = input.preferredIndustry;
  if (typeof input.preferredWorkSetup === 'string') payload.preferred_work_setup = input.preferredWorkSetup;
  if (typeof input.expectedSalary === 'string') payload.expected_salary = input.expectedSalary;
  if (typeof input.targetRole === 'string') payload.target_role = input.targetRole;
  if (typeof input.skillToDevelop === 'string') payload.skill_to_develop = input.skillToDevelop;
  if (typeof input.preferredLocationScope === 'string') payload.preferred_location_scope = input.preferredLocationScope || null;
  if (typeof input.preferredRegion === 'string') payload.preferred_region = input.preferredRegion || null;

  let { error } = await supabase
    .from('candidate_profiles')
    .upsert({ user_id: input.userId, ...payload }, { onConflict: 'user_id' });
  if (error && /preferred_location_scope|preferred_region/i.test(error.message || '')) {
    // The region columns are added by a migration; until it runs, keep saving the other answers.
    const { preferred_location_scope: _scope, preferred_region: _region, ...rest } = payload;
    void _scope;
    void _region;
    ({ error } = await supabase
      .from('candidate_profiles')
      .upsert({ user_id: input.userId, ...rest }, { onConflict: 'user_id' }));
  }
  if (error) throw error;
}

export async function signOutCurrentUser() {
  authOperationVersion += 1;
  authStatus = 'signed_out';
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email: string) {
  // The link opens the "choose a new password" screen (PASSWORD_RESET_PATH), not the home page.
  const redirectTo = `${window.location.origin}/reset-password`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}
