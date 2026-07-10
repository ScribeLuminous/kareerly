import { supabase } from './supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export type AuthRole = 'candidate' | 'employer' | 'admin';

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

type ProfileRow = {
  id: string;
  role: AuthRole;
  first_name: string;
  last_name: string;
  email: string;
  candidate_profiles?: {
    birthday?: string | null;
    location?: string | null;
    education_json?: unknown;
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
    educationJson: profile.candidate_profiles?.education_json || null,
    certificationsJson: profile.candidate_profiles?.certifications_json || null,
    company: employerProfile?.company_name || undefined,
  };
}

async function getProfileForUserId(userId: string): Promise<KareerlyUser | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, first_name, last_name, email, candidate_profiles(birthday,location,education_json,certifications_json), employer_profiles(company_name)')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapProfile(data as ProfileRow) : null;
}

export async function getCurrentKareerlyUser(): Promise<KareerlyUser | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const authUser = sessionData.session?.user;
  const userId = authUser?.id;
  if (!userId) return null;

  return getProfileForUserId(userId).catch((error) => {
    console.warn('Unable to load Kareerly profile, using auth user metadata:', error);
    return authUser ? mapAuthUser(authUser) : null;
  });
}

export async function signInWithEmail(email: string, password: string, expectedRole?: AuthRole): Promise<KareerlyUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const userId = data.user?.id || data.session?.user.id;
  const authUser = data.user || data.session?.user;
  const user = userId
    ? await getProfileForUserId(userId).catch((profileError) => {
        console.warn('Unable to load Kareerly profile after login, using auth user metadata:', profileError);
        return authUser ? mapAuthUser(authUser) : null;
      })
    : await getCurrentKareerlyUser();
  if (!user) throw new Error('Login succeeded, but no Kareerly profile was found.');
  if (expectedRole && user.role !== expectedRole) {
    await supabase.auth.signOut().catch((signOutError) => {
      console.warn('Unable to sign out after role mismatch:', signOutError);
    });
    throw new Error(`This email is registered as a ${user.role} account. Please use the ${user.role} login instead.`);
  }
  return user;
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

  if (lowerMessage.includes('email not confirmed')) {
    return 'Please confirm your email address before logging in.';
  }

  if (lowerMessage.includes('registered as a candidate account')) {
    return 'This email is registered as a candidate account. Please use the job seeker login instead.';
  }

  if (lowerMessage.includes('registered as a employer account')) {
    return 'This email is registered as an employer account. Please use the employer login instead.';
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
    },
  });

  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error('Supabase did not return a user for this signup.');

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
    },
  });

  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error('Supabase did not return a user for this signup.');

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
}) {
  const payload: Record<string, unknown> = {};
  if (typeof input.location === 'string') payload.location = input.location;
  if (typeof input.birthday === 'string') payload.birthday = input.birthday || null;
  if (input.educationJson !== undefined) {
    const education =
      input.educationJson && typeof input.educationJson === 'object' && !Array.isArray(input.educationJson)
        ? { ...(input.educationJson as Record<string, unknown>) }
        : {};
    if (typeof input.contactNumber === 'string') education.contactNumber = input.contactNumber;
    if (typeof input.address === 'string') education.address = input.address;
    payload.education_json = education;
  }
  if (input.certificationsJson !== undefined) payload.certifications_json = input.certificationsJson;
  if (typeof input.preferredIndustry === 'string') payload.preferred_industry = input.preferredIndustry;
  if (typeof input.preferredWorkSetup === 'string') payload.preferred_work_setup = input.preferredWorkSetup;
  if (typeof input.expectedSalary === 'string') payload.expected_salary = input.expectedSalary;
  if (typeof input.targetRole === 'string') payload.target_role = input.targetRole;
  if (typeof input.skillToDevelop === 'string') payload.skill_to_develop = input.skillToDevelop;

  const { error } = await supabase
    .from('candidate_profiles')
    .upsert({ user_id: input.userId, ...payload }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function signOutCurrentUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email: string) {
  const redirectTo = `${window.location.origin}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}
