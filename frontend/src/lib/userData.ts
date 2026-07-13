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

export async function saveResumeAnalysis(input: {
  userId: string;
  fileName?: string;
  file?: File | null;
  analysis: ResumeAnalysisResult;
}): Promise<string | null> {
  const parsedText = input.analysis.normalized_for_matching?.resume_text_for_matching || '';
  let storagePath = '';
  let storageBucket = '';

  if (input.file) {
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
    file_mime_type: input.file?.type || null,
    file_size_bytes: input.file?.size || null,
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
    return null;
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

  return data?.id || null;
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

  if (error) {
    console.warn('Unable to load latest resume:', error.message);
    return null;
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
  }
}
