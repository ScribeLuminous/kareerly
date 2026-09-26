import { useRef } from 'react';
import {
  faFileLines,
  faLock,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useOnboarding } from '../hooks/useOnboarding';
import { validateResumeFile, formatFileSize } from '../lib/fileUtils';
import { analyzeResume } from '../lib/api';
import { extractionWarnings, RESUME_FILE_ACCEPT } from '../lib/resumeFreshness';
import { getCurrentKareerlyUser } from '../lib/auth';
import { saveResumeAnalysis } from '../lib/userData';
import type { ResumeAnalysisResult, SelectedSkill } from '../types';
import StepArrowButton from './StepArrowButton';

const CONFIRMED_SKILL_LIMIT = 20;

function dedupeSkills(skills: SelectedSkill[]): SelectedSkill[] {
  const seen = new Set<string>();
  const cleaned: SelectedSkill[] = [];

  for (const skill of skills) {
    const skillId = skill.skill_id?.trim().toUpperCase();
    const skillName = skill.skill_name?.trim();
    if (!skillId || !skillName || seen.has(skillId)) continue;
    seen.add(skillId);
    cleaned.push({
      ...skill,
      skill_id: skillId,
      skill_name: skillName,
    });
  }

  return cleaned
    .sort((a, b) => (Number(b.skill_priority_score || 0) - Number(a.skill_priority_score || 0)))
    .slice(0, CONFIRMED_SKILL_LIMIT);
}

function getExtractedSkillsFromAnalysis(analysis: ResumeAnalysisResult): SelectedSkill[] {
  const fromCandidate = (analysis.candidate_profile?.skills || []).map((skill) => ({
    skill_id: skill.skill_id,
    skill_name: skill.skill_name,
    skill_category: skill.skill_category,
    skill_subcategory: skill.skill_subcategory,
    source: skill.source || 'resume_extracted',
    source_metadata: skill.source_metadata,
    skill_priority_score: skill.skill_priority_score,
  }));

  const fromNormalized = (analysis.normalized_for_matching?.skill_ids || []).map((skillId, index) => ({
    skill_id: skillId,
    skill_name: analysis.normalized_for_matching?.skill_names?.[index] || skillId,
    source: 'resume_extracted',
  }));

  return dedupeSkills([...fromCandidate, ...fromNormalized]);
}

export default function UploadZone() {
  const { state, setResumeFile, setResumeAnalysis, setSelectedSkills, setSavedResumeId, setLoading, goToStep, setError } = useOnboarding();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleFile = (file: File | null) => {
    if (!file) return;

    const validation = validateResumeFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setResumeFile(file);
    setError(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    dropZoneRef.current?.classList.add('border-rust', 'bg-rust-l');
  };

  const handleDragLeave = () => {
    dropZoneRef.current?.classList.remove('border-rust', 'bg-rust-l');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dropZoneRef.current?.classList.remove('border-rust', 'bg-rust-l');
    handleFile(e.dataTransfer.files[0]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0] || null);
  };

  const handleContinue = async () => {
    if (state.isLoading) return;

    if (!state.resumeFile) {
      setError('Please select a resume first.');
      return;
    }

    // Choosing a different file clears the analysis, so an existing one belongs to this file.
    // Reusing it keeps the skills a user added or removed in Step 2 when they come back.
    if (state.resumeAnalysis) {
      setError(null);
      goToStep(2);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const analysis = await analyzeResume(state.resumeFile);
      const resumeText = analysis.normalized_for_matching?.resume_text_for_matching?.trim() || '';
      if (!resumeText) {
        throw new Error('No resume text was returned for matching. Please try another resume file.');
      }

      const extractedSkills = getExtractedSkillsFromAnalysis(analysis);
      if (extractedSkills.length === 0) {
        // Say why when the file could not be read (a failed or unavailable OCR),
        // instead of implying the resume lists no skills.
        const readingProblems = extractionWarnings(analysis);
        throw new Error(readingProblems.length > 0
          ? readingProblems.join(' ')
          : 'No skills were extracted from your resume. Please upload a clearer PDF, DOCX or DOC file.');
      }

      const user = await getCurrentKareerlyUser().catch(() => null);
      let resumeId: string | null = null;
      if (user?.role === 'candidate') {
        resumeId = await saveResumeAnalysis({
          userId: user.id,
          fileName: state.resumeFile.name,
          file: state.resumeFile,
          analysis,
        });
      }
      // Commit analysis state only after a signed-in candidate's file and row
      // are durable. A retry after a failed save must retry persistence too.
      setResumeAnalysis(analysis);
      setSavedResumeId(resumeId);
      setSelectedSkills(extractedSkills.slice(0, CONFIRMED_SKILL_LIMIT));
      goToStep(2);
    } catch (error) {
      setError(error instanceof Error ? `Resume analysis failed: ${error.message}` : 'Resume analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFile = () => {
    setResumeFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="mx-auto max-w-lg px-4 pb-12 sm:px-6">

      {!state.resumeFile ? (
        <>
          <div
            ref={dropZoneRef}
            onClick={handleChooseFile}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-soft bg-card px-6 py-10 text-center transition-colors duration-150 hover:border-rust hover:bg-rust-l"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rust-l text-2xl text-rust">
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
            </span>
            <h2 className="font-display text-lg font-bold text-dark">Upload your resume</h2>
            <p className="text-sm text-mid">Drop it here, or choose a file</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleChooseFile();
              }}
              type="button"
              className="k-btn k-btn-primary w-full max-w-xs"
            >
              Choose file
            </button>
            <p className="text-xs text-soft-text">PDF, DOCX or DOC · up to 5 MB</p>

            <input
              ref={fileInputRef}
              type="file"
              accept={RESUME_FILE_ACCEPT}
              onChange={handleFileInput}
              className="hidden"
            />
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs text-soft-text mt-6">
            <FontAwesomeIcon icon={faLock} aria-hidden="true" />
            <span>Processed securely. Sign in to keep your report.</span>
          </div>
        </>
      ) : (
        <>
          {/* File Selected */}
          <div className="bg-forest-l border border-forest-m rounded-2xl p-4 flex items-center gap-3.5 mb-3">
            <span className="text-2xl flex-shrink-0 text-forest">
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm text-forest [overflow-wrap:anywhere]">{state.resumeFile.name}</div>
              <div className="text-xs text-forest-m mt-0.5">
                {formatFileSize(state.resumeFile.size)} · Ready for analysis
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemoveFile}
              className="k-icon-btn flex-shrink-0 text-forest hover:text-red"
              aria-label="Remove resume"
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-2">
            <StepArrowButton direction="next" text={state.isLoading ? 'Analyzing resume…' : 'Analyze resume'} label="Analyze resume and review skills" onClick={handleContinue} loading={state.isLoading} />
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs text-soft-text mt-6">
            <FontAwesomeIcon icon={faLock} aria-hidden="true" />
            <span>Processed securely. Sign in to keep your report.</span>
          </div>
        </>
      )}

      {state.error && (
        <div className="k-banner k-banner-error mt-4" role="alert">
          {state.error}
        </div>
      )}
    </div>
  );
}
