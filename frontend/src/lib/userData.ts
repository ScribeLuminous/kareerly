import type { JobMatchRunResults, ResumeAnalysisResult, SurveyAnswers } from '../types';
import { supabase } from './supabase';

const RESUME_STORAGE_BUCKET = 'resumes';

export type SavedResumeRecord = {
  id: string;
  user_id: string;
  original_filename: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  parsed_text: string | null;
  extracted_profile_json: ResumeAnalysisResult | null;
  created_at: string | null;
};

// A resume file already in storage, re-analysed without uploading it again.
export type ExistingResumeFile = {
  bucket: string;
  path: string;
  name: string;
  mimeType: string;
  size: number | null;
};

export async function saveResumeAnalysis(input: {
  userId: string;
  fileName?: string;
  file?: File | null;
  existingFile?: ExistingResumeFile | null;
  analysis: ResumeAnalysisResult;
}): Promise<string> {
  const parsedText = input.analysis.normalized_for_matching?.resume_text_for_matching || '';
  let storagePath = '';
  let storageBucket = '';
  // Only a file uploaded by this call may be removed when saving fails; an
  // existing file is the user's stored original.
  let uploadedNow = false;

  if (input.existingFile && input.existingFile.path.startsWith(`${input.userId}/`)) {
    storageBucket = input.existingFile.bucket;
    storagePath = input.existingFile.path;
  } else if (input.file) {
    const extension = input.file.name.includes('.') ? input.file.name.split('.').pop() : 'resume';
    storageBucket = RESUME_STORAGE_BUCKET;
    storagePath = `${input.userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(storageBucket)
      .upload(storagePath, input.file, {
        contentType: input.file.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      console.warn('Unable to upload resume file:', uploadError.message);
      throw new Error(`Unable to store the resume file: ${uploadError.message}`);
    }
    uploadedNow = true;
  }

  const basePayload = {
    user_id: input.userId,
    original_filename: input.fileName || null,
    parsed_text: parsedText,
    extracted_profile_json: input.analysis,
  };
  const resumePayload = {
    ...basePayload,
    storage_bucket: storageBucket || null,
    storage_path: storagePath || null,
    file_mime_type: input.file?.type || input.existingFile?.mimeType || null,
    file_size_bytes: input.file?.size || input.existingFile?.size || null,
  };

  let { data, error } = await supabase
    .from('resumes')
    .insert(resumePayload)
    .select('id')
    .single();

  if (error && /storage_bucket|storage_path|file_mime_type|file_size_bytes|column/i.test(error.message || '')) {
    const retry = await supabase
      .from('resumes')
      .insert(basePayload)
      .select('id')
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.warn('Unable to save resume analysis:', error.message);
    // Do not leave an orphaned file behind when the database row fails. More
    // importantly, do not report the resume as saved to the UI when it is not.
    if (uploadedNow) {
      const { error: cleanupError } = await supabase.storage
        .from(storageBucket)
        .remove([storagePath]);
      if (cleanupError) {
        console.warn('Unable to remove orphaned resume file:', cleanupError.message);
      }
    }
    throw new Error(`Unable to save the resume to your profile: ${error.message}`);
  }

  const skills = input.analysis.candidate_profile?.skills || [];
  if (skills.length > 0) {
    const { error: skillsError } = await supabase.from('user_skills').insert(
      skills.map((skill) => ({
        user_id: input.userId,
        skill_id: skill.skill_id,
        skill_name: skill.skill_name,
        confidence: skill.confidence || 0,
        source: skill.source_section || skill.method || 'resume_analysis',
      })),
    );

    if (skillsError) {
      console.warn('Unable to save extracted skills:', skillsError.message);
    }
  }

  if (!data?.id) {
    if (uploadedNow) {
      await supabase.storage.from(storageBucket).remove([storagePath]);
    }
    throw new Error('Unable to save the resume to your profile: no resume record was returned.');
  }

  return data.id;
}

export async function loadLatestResume(input: { userId: string }): Promise<SavedResumeRecord | null> {
  let { data, error } = await supabase
    .from('resumes')
    .select('id,user_id,original_filename,storage_bucket,storage_path,file_mime_type,file_size_bytes,parsed_text,extracted_profile_json,created_at')
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && /storage_bucket|storage_path|file_mime_type|file_size_bytes|column/i.test(error.message || '')) {
    const retry = await supabase
      .from('resumes')
      .select('id,user_id,original_filename,parsed_text,extracted_profile_json,created_at')
      .eq('user_id', input.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    data = retry.data
      ? {
          ...retry.data,
          storage_bucket: null,
          storage_path: null,
          file_mime_type: null,
          file_size_bytes: null,
        }
      : null;
    error = retry.error;
  }

  // A failed read is an error, not "no resume": treating it as empty would send a
  // returning candidate back to Step 1 and hide their saved matches.
  if (error) {
    console.warn('Unable to load latest resume:', error.message);
    throw new Error(`Unable to load your saved resume: ${error.message}`);
  }

  return (data as SavedResumeRecord | null) || null;
}

export async function saveMatchHistory(input: {
  userId: string;
  resumeId?: string | null;
  preferences: SurveyAnswers | Record<string, unknown>;
  results: JobMatchRunResults;
}) {
  const { error } = await supabase.from('match_history').insert({
    user_id: input.userId,
    resume_id: input.resumeId || null,
    preferences_json: input.preferences,
    results_json: input.results,
  });

  if (error) {
    console.warn('Unable to save match history:', error.message);
    return false;
  }
  return true;
}

// Match results only live in memory, so a reload shows zero matches unless the
// last saved run is restored. Only use a run made from the given resume: an
// older resume's matches would be wrong after a failed refresh.
export async function loadLatestMatchHistory(input: { userId: string; resumeId?: string | null }): Promise<JobMatchRunResults | null> {
  return (await loadLatestMatchRun(input))?.results || null;
}

// The saved run with the Step 3 answers it was made with, so a reload shows the
// candidate's preferences instead of the defaults.
export async function loadLatestMatchRun(input: { userId: string; resumeId?: string | null }): Promise<{
  results: JobMatchRunResults;
  preferences: SurveyAnswers | null;
  /** When the run was saved; jobs posted later are not in it. */
  savedAt: string | null;
} | null> {
  const latestFor = (resumeId: string | null) => {
    const query = supabase
      .from('match_history')
      .select('results_json,preferences_json,created_at')
      .eq('user_id', input.userId);
    return (resumeId ? query.eq('resume_id', resumeId) : query.is('resume_id', null))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  };

  let { data, error } = await latestFor(input.resumeId || null);
  if (!error && !data && input.resumeId) {
    // Rows saved before the resume id was recorded.
    ({ data, error } = await latestFor(null));
  }
  if (error) {
    console.warn('Unable to load match history:', error.message);
    throw new Error(`Unable to load your saved matches: ${error.message}`);
  }
  const results = (data?.results_json as JobMatchRunResults | null) || null;
  if (!results) return null;
  const preferences = data?.preferences_json as Partial<SurveyAnswers> | null | undefined;
  return {
    results,
    savedAt: typeof data?.created_at === 'string' ? data.created_at : null,
    preferences: preferences && typeof preferences.industry === 'string' && preferences.industry
      ? {
          industry: preferences.industry,
          role: preferences.role || '',
          setup: preferences.setup || '',
          salary: preferences.salary || '',
          skill: preferences.skill || '',
          employmentType: preferences.employmentType || '',
          locationScope: preferences.locationScope || 'anywhere',
          region: preferences.region || '',
        }
      : null,
  };
}
