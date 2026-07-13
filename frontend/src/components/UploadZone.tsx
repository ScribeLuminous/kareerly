import { useRef } from 'react';
import {
  faBullseye,
  faChartLine,
  faFileLines,
  faGraduationCap,
  faLock,
  faMagnifyingGlass,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useOnboarding } from '../hooks/useOnboarding';
import { validateResumeFile, formatFileSize } from '../lib/fileUtils';
import { analyzeResume } from '../lib/api';
import { getCurrentKareerlyUser } from '../lib/auth';
import { saveResumeAnalysis } from '../lib/userData';
import type { ResumeAnalysisResult, SelectedSkill } from '../types';

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
        throw new Error('No skills were extracted from your resume. Please upload a clearer PDF or DOCX file.');
      }

      setResumeAnalysis(analysis);
      const user = await getCurrentKareerlyUser().catch(() => null);
      if (user?.role === 'candidate') {
        const resumeId = await saveResumeAnalysis({
          userId: user.id,
          fileName: state.resumeFile.name,
          file: state.resumeFile,
          analysis,
        });
        setSavedResumeId(resumeId);
      }
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
    <div className="max-w-lg mx-auto px-6 py-12">
      <div className="mb-8">
        <h2 className="font-display text-2xl font-bold text-dark mb-2">Step 1: Upload Your Resume</h2>
        <p className="text-sm text-soft">Upload your resume to extract skills and continue to skills review.</p>
      </div>

      {!state.resumeFile ? (
        <>
          <div
            ref={dropZoneRef}
            onClick={handleChooseFile}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="bg-card border-2 border-dashed border-bdr rounded-2xl p-12 flex flex-col items-center gap-4 cursor-pointer hover:border-rust hover:bg-rust-l transition-all duration-200 text-center"
          >
            <div className="w-20 h-20 rounded-2xl bg-rust-l flex items-center justify-center hover:bg-white hover:shadow-lg transition-all duration-200">
              <span className="text-4xl text-rust">
                <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
              </span>
            </div>
            <div className="dz-title">
              <h3 className="font-display text-xl font-bold text-dark">Upload your resume</h3>
            </div>
            <p className="text-soft text-sm leading-relaxed">Drop it here, or tap the button below</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleChooseFile();
              }}
              className="w-full max-w-xs bg-rust text-white font-bold py-3 px-8 rounded-lg hover:opacity-90 transition-opacity duration-150"
            >
              Choose file
            </button>
            <div className="flex items-center gap-2 text-xs text-soft">
              <span className="bg-bg border border-bdr rounded px-2 py-1 font-bold text-mid">PDF</span>
              <span className="text-bdr">·</span>
              <span className="bg-bg border border-bdr rounded px-2 py-1 font-bold text-mid">DOCX</span>
              <span>· Max 5MB</span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              onChange={handleFileInput}
              className="hidden"
            />
          </div>

          {/* Features */}
          <div className="flex flex-col gap-2.5 mt-6">
            <div className="bg-card border border-bdr rounded-2xl p-4 flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-rust-l flex items-center justify-center flex-shrink-0 text-xl text-rust">
                <FontAwesomeIcon icon={faBullseye} aria-hidden="true" />
              </div>
              <div>
                <div className="font-bold text-sm text-dark">Job matches just for you</div>
                <div className="text-xs text-soft leading-relaxed mt-0.5">
                  We compare your skills to real jobs in the Philippines
                </div>
              </div>
            </div>
            <div className="bg-card border border-bdr rounded-2xl p-4 flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-forest-l flex items-center justify-center flex-shrink-0 text-xl text-forest">
                <FontAwesomeIcon icon={faChartLine} aria-hidden="true" />
              </div>
              <div>
                <div className="font-bold text-sm text-dark">See exactly what you're missing</div>
                <div className="text-xs text-soft leading-relaxed mt-0.5">
                  We identify the skills holding you back
                </div>
              </div>
            </div>
            <div className="bg-card border border-bdr rounded-2xl p-4 flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-tan-l flex items-center justify-center flex-shrink-0 text-xl text-tan">
                <FontAwesomeIcon icon={faGraduationCap} aria-hidden="true" />
              </div>
              <div>
                <div className="font-bold text-sm text-dark">Learning resources to close the gap</div>
                <div className="text-xs text-soft leading-relaxed mt-0.5">
                  We point you to relevant learning options based on your skill gaps
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs text-soft mt-6">
            <FontAwesomeIcon icon={faLock} aria-hidden="true" />
            <span>Your resume is processed securely. Logged-in users can keep their latest analysis on the dashboard.</span>
          </div>
        </>
      ) : (
        <>
          {/* File Selected */}
          <div className="bg-forest-l border border-forest-m rounded-2xl p-4 flex items-center gap-3.5 mb-3">
            <span className="text-2xl flex-shrink-0 text-forest">
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
            </span>
            <div className="flex-1">
              <div className="font-bold text-sm text-forest">{state.resumeFile.name}</div>
              <div className="text-xs text-forest-m mt-0.5">
                {formatFileSize(state.resumeFile.size)} · Ready for analysis
              </div>
            </div>
            <button
              onClick={handleRemoveFile}
              className="text-soft hover:text-red transition-colors text-xl px-1 flex-shrink-0"
              title="Remove"
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          </div>

          <button
            onClick={handleContinue}
            disabled={state.isLoading}
            className="w-full bg-forest text-white font-bold py-4 px-6 rounded-lg hover:opacity-90 transition-opacity duration-150 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
            <span>Analyze Resume</span>
          </button>

          <div className="flex items-center justify-center gap-1.5 text-xs text-soft mt-6">
            <FontAwesomeIcon icon={faLock} aria-hidden="true" />
            <span>Your resume is processed securely. Logged-in users can keep their latest analysis on the dashboard.</span>
          </div>
        </>
      )}

      {state.error && (
        <div className="mt-4 p-3 bg-red-l border border-red rounded-lg text-sm text-red font-medium">
          {state.error}
        </div>
      )}
    </div>
  );
}
