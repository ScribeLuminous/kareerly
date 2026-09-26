import { useState } from 'react';
import { useOnboarding } from '../hooks/useOnboarding';
import { cleanSkillLabel, toDisplayLabels, toSkillLabels } from '../lib/skillLabels';
import { answersFromPreferencesUsed, summarizePreferences } from '../lib/preferenceOptions';
import type { PreferenceSummaryItem } from '../lib/preferenceOptions';
import { downloadCareerReportPdf } from '../lib/reportPdf';
import type { CareerReportContent, ReportMatchEntry } from '../lib/reportPdf';
import RegionFilterNotice from './RegionFilterNotice';
import StepArrowButton from './StepArrowButton';
import {
  faBookOpen,
  faBriefcase,
  faBullseye,
  faChartLine,
  faCircleCheck,
  faFilePdf,
  faGraduationCap,
  faLightbulb,
  faRocket,
  faSliders,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { JobMatchRunResults, LearningRecommendation, MatchResultItem, PrioritizedSkillGap, ResumeAnalysisResult } from '../types';
import { extractMatchPercent, extractSkillGapMatchCount, extractSkillGapMatchPercent, formatMatchPercentLabel, matchCategoryLabel, parseNumericValue } from '../lib/matchScoring';
import { CLOSEST_MATCH_LABEL, closestMatchesFor, emptyFitNowText, fitNowSummaryDetail } from '../lib/closestMatches';

type SnapshotStepProps = {
  isLoggedIn: boolean;
  onSignUp: () => void;
  onViewDashboard: () => void;
};

function buildSkillNameLookup(
  resumeAnalysis: ResumeAnalysisResult | undefined,
  matchResults: JobMatchRunResults | undefined,
): Map<string, string> {
  const lookup = new Map<string, string>();

  (resumeAnalysis?.candidate_profile?.skills || []).forEach((skill) => {
    if (skill.skill_id && skill.skill_name) {
      lookup.set(skill.skill_id, skill.skill_name);
    }
  });

  const ids = resumeAnalysis?.normalized_for_matching?.skill_ids || [];
  const names = resumeAnalysis?.normalized_for_matching?.skill_names || [];
  ids.forEach((id, index) => {
    const name = names[index];
    if (id && name) {
      lookup.set(id, name);
    }
  });

  const gaps = [...(matchResults?.skill_gaps || []), ...(matchResults?.limited_report?.skill_gaps || [])];
  gaps.forEach((gap) => {
    if (gap.skill_id && gap.skill_name) {
      lookup.set(gap.skill_id, gap.skill_name);
    }
  });

  return lookup;
}

// The backend already resolves every skill to a readable name, including
// employer skills with no taxonomy ID; the ID lists are only a fallback, since
// the lookup cannot name IDs the candidate does not hold.
function skillText(names: string[] | undefined, ids: string[] | undefined, skillNameLookup: Map<string, string>): string {
  const labels = toDisplayLabels(names);
  return (labels.length > 0 ? labels : toSkillLabels(ids, skillNameLookup)).slice(0, 6).join(', ');
}

function getMatchedSkillText(match: MatchResultItem, skillNameLookup: Map<string, string>): string {
  return skillText(match.matched_skills, match.matched_skill_ids, skillNameLookup);
}

function getMissingSkillText(match: MatchResultItem, skillNameLookup: Map<string, string>): string {
  return skillText(match.missing_skills, match.missing_skill_ids, skillNameLookup);
}

function buildMatchExplanation(
  matchType: 'fit_now' | 'aspiration',
  matchedText: string,
  missingText: string,
): string {
  const matchedLead = matchedText ? `This role matches your experience in ${matchedText}.` : 'This role connects to your current profile, but no strong matching skills were identified yet.';
  const missingLead = missingText
    ? `Strengthening ${missingText} could improve your fit.`
    : 'No major missing skills were identified from the current analysis.';

  if (matchType === 'fit_now') {
    return `${matchedLead} ${missingLead}`;
  }

  return `${matchedLead} Building ${missingText || 'the recommended missing skills'} can help you prepare for similar opportunities.`;
}

type MatchDescription = {
  title: string;
  location: string;
  matchPercent: number | null;
  scoreLabel: string;
  skillLines: Array<{ tone: 'matched' | 'missing' | 'note'; text: string }>;
  explanation: string;
};

// One description feeds both the on-screen row and the PDF, so they cannot differ.
// Closest matches are read like Fit-Now for their percentage but keep their own
// "Closest Match" label and the backend's reason for not being Fit-Now.
function describeMatch(
  match: MatchResultItem,
  listType: 'fit_now' | 'aspiration' | 'closest',
  skillNameLookup: Map<string, string>,
): MatchDescription {
  const matchType = listType === 'aspiration' ? 'aspiration' : 'fit_now';
  const matchPercent = extractMatchPercent(match, matchType);
  const categoryLabel = listType === 'closest' ? CLOSEST_MATCH_LABEL : matchCategoryLabel(match, matchType);
  const base = {
    title: match.job_title || 'Untitled role',
    location: match.location || 'Location not listed',
    matchPercent,
  };

  // The posting lists no skills to compare: claiming "none matched" or "no
  // gaps" would be wrong, and the percentage is role similarity alone.
  if (match.skill_requirements_available === false) {
    return {
      ...base,
      scoreLabel: matchPercent === null ? 'Not scored' : `${formatMatchPercentLabel(matchPercent)} role similarity • ${categoryLabel}`,
      skillLines: [{ tone: 'note', text: 'Skills: This posting lists no skills to compare with your resume.' }],
      explanation: 'The score compares your resume with the role description only, so no matched or missing skills are shown for this role.',
    };
  }

  const matchedText = getMatchedSkillText(match, skillNameLookup);
  const missingText = getMissingSkillText(match, skillNameLookup);
  return {
    ...base,
    scoreLabel: matchPercent === null ? formatMatchPercentLabel(matchPercent) : `${formatMatchPercentLabel(matchPercent)} • ${categoryLabel}`,
    skillLines: [
      { tone: 'matched', text: matchedText ? `Matched Skills: ${matchedText}` : 'Matched Skills: None identified yet.' },
      { tone: 'missing', text: missingText ? `Missing Skills: ${missingText}` : 'Missing Skills: No major missing skills identified.' },
    ],
    // The backend explanation quotes the resume evidence (phrase and section)
    // and says whether a missing skill was not found or removed; the local
    // sentence is only for results saved before it existed.
    explanation: listType === 'closest'
      ? match.match_reason || 'Not a Fit-Now match yet: some required skills are still missing.'
      : match.explanation?.trim() || buildMatchExplanation(matchType, matchedText, missingText),
  };
}

function MatchRow({ description }: { description: MatchDescription }) {
  const toneClass = { matched: 'text-green', missing: 'text-soft-text', note: 'text-soft-text' };
  return (
    <div className="rounded-lg bg-bg px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-dark">{description.title}</div>
          <div className="text-xs text-soft-text">{description.location}</div>
        </div>
        <div
          className={`rounded-md px-3 py-1 text-xs font-extrabold ${
            description.matchPercent === null ? 'bg-bdr text-soft-text' : 'bg-rust text-white'
          }`}
        >
          {description.scoreLabel}
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs">
        {description.skillLines.map((line) => (
          <div key={line.text} className={toneClass[line.tone]}>{line.text}</div>
        ))}
      </div>
      <div className="mt-2 text-xs leading-relaxed text-soft-text">{description.explanation}</div>
    </div>
  );
}

function skillGapText(gap: PrioritizedSkillGap): string {
  const gapCount = extractSkillGapMatchCount(gap);
  const gapPercent = extractSkillGapMatchPercent(gap);
  return gapCount !== null && gapPercent !== null
    ? `Missing in ${gapCount} match${gapCount === 1 ? '' : 'es'} (${formatMatchPercentLabel(gapPercent)})`
    : gapCount !== null
      ? `Missing in ${gapCount} match${gapCount === 1 ? '' : 'es'}`
      : gapPercent !== null
        ? `Match impact: ${formatMatchPercentLabel(gapPercent)}`
        : 'Missing count not available.';
}

function SkillGapRow({ gap }: { gap: PrioritizedSkillGap }) {
  const gapText = skillGapText(gap);

  return (
    <div className="rounded-lg bg-bg px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-dark">{cleanSkillLabel(gap.skill_name)}</span>
        <span className="text-xs text-soft-text">{gap.severity || 'To work on'}</span>
      </div>
      <div className="mt-1 text-xs text-soft-text">{gapText}</div>
    </div>
  );
}

function LearningRow({ recommendation }: { recommendation: LearningRecommendation }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-bg px-4 py-3">
      <div className="min-w-0">
        <div className="truncate font-semibold text-dark">{recommendation.title || 'Untitled course or certification'}</div>
        <div className="truncate text-xs text-soft-text">{recommendation.provider || 'Provider not listed'}</div>
      </div>
      <div
        className={`flex-shrink-0 rounded-lg px-3 py-1 text-xs font-bold ${
          String(recommendation.cost_type || '').toLowerCase() === 'free' ? 'bg-green-l text-green' : 'bg-bg text-soft-text'
        }`}
      >
        {recommendation.cost_type || 'Cost unknown'}
      </div>
    </div>
  );
}

function PreferenceSummary({ items }: { items: PreferenceSummaryItem[] }) {
  return (
    <div className="bg-card border border-bdr rounded-xl p-6 mb-4">
      <div className="text-base font-bold text-dark mb-4 flex items-center gap-2">
        <FontAwesomeIcon className="text-rust" icon={faSliders} aria-hidden="true" />
        <span>Your Preferences</span>
      </div>
      {items.length > 0 ? (
        <dl className="grid gap-2.5 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.label} className="rounded-lg bg-bg px-4 py-3">
              <dt className="text-xs text-soft-text">{item.label}</dt>
              <dd className="text-sm font-semibold text-dark">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="rounded-lg bg-bg p-4 text-sm text-soft-text">No preferences were recorded for this report.</div>
      )}
    </div>
  );
}

function toReportEntry(description: MatchDescription): ReportMatchEntry {
  return {
    title: description.title,
    location: description.location,
    scoreLabel: description.scoreLabel,
    lines: [...description.skillLines.map((line) => line.text), description.explanation],
  };
}

function resolveSnapshotCount(metadataCount: unknown, fallbackItems: unknown[] | undefined): number {
  const parsedCount = parseNumericValue(metadataCount);
  if (parsedCount !== null && parsedCount >= 0) return Math.round(parsedCount);
  return Array.isArray(fallbackItems) ? fallbackItems.length : 0;
}

export default function SnapshotStep({ isLoggedIn, onSignUp, onViewDashboard }: SnapshotStepProps) {
  const { state, goToStep, setSurveyAnswers } = useOnboarding();
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'working' | 'failed'>('idle');
  const resumeAnalysis = state.resumeAnalysis;
  const matchResults = state.matchResults;
  const limitedReport = state.limitedReport || matchResults?.limited_report;
  const accessControl = matchResults?.access_control;
  const shouldUseLimitedReport =
    !matchResults || !accessControl || accessControl.user_mode === 'guest' || accessControl.view_mode === 'initial';

  if (!matchResults) {
    return (
      <div className="max-w-lg mx-auto px-6 py-12">
        <div className="bg-card border border-bdr rounded-lg p-6 text-center">
          <h2 className="font-display text-2xl font-bold text-dark mb-2">No report yet</h2>
          <p className="text-sm text-soft-text mb-5">Upload a resume and complete the survey to generate your career snapshot.</p>
          <button
            onClick={() => goToStep(1)}
            className="w-full px-5 py-3 rounded-lg bg-rust text-white font-semibold hover:opacity-90 transition-opacity duration-150"
          >
            Start Again
          </button>
        </div>
      </div>
    );
  }

  const stepFourLimit = isLoggedIn ? 5 : 3;
  const reportData = shouldUseLimitedReport
    ? {
        fit_now_matches: (limitedReport?.fit_now_matches || []).slice(0, stepFourLimit),
        closest_matches: closestMatchesFor(matchResults, limitedReport, stepFourLimit),
        aspiration_matches: (limitedReport?.aspiration_matches || []).slice(0, stepFourLimit),
        skill_gaps: limitedReport?.skill_gaps || [],
        learning_recommendations: (limitedReport?.learning_recommendations || []).slice(0, stepFourLimit),
      }
    : {
        fit_now_matches: matchResults.fit_now_matches || [],
        closest_matches: closestMatchesFor(matchResults),
        aspiration_matches: matchResults.aspiration_matches || [],
        skill_gaps: matchResults.skill_gaps || [],
        learning_recommendations: matchResults.learning_recommendations || [],
      };

  const fitNowMatches = reportData.fit_now_matches;
  const closestMatches = reportData.closest_matches;
  const aspirationMatches = reportData.aspiration_matches;
  const skillGaps = reportData.skill_gaps;
  const learningRecommendations = reportData.learning_recommendations;
  const fullFitNowMatches = matchResults.fit_now_matches || [];
  const fullSkillGaps = matchResults.skill_gaps || matchResults.prioritized_skill_gaps || [];
  const fullLearningRecommendations = matchResults.learning_recommendations || [];
  const fitNowSnapshotCount = resolveSnapshotCount(matchResults.debug_summary?.fit_now_count, fullFitNowMatches);
  // The gap list is capped; the backend states how many gaps there are in all.
  const skillGapSnapshotCount = resolveSnapshotCount(matchResults.total_skill_gap_count, fullSkillGaps);
  const learningSnapshotCount = resolveSnapshotCount(undefined, fullLearningRecommendations);
  const isGuestReport = accessControl?.user_mode === 'guest' || !isLoggedIn;
  // A guest who just signed up: App is saving the report to the new account.
  const isSavingReport = isLoggedIn && !state.savedResumeId && !state.error;
  const topFitNow = fitNowMatches[0];
  const topFitNowPercent = topFitNow ? extractMatchPercent(topFitNow, 'fit_now') : null;
  const skillNameLookup = buildSkillNameLookup(resumeAnalysis, matchResults);
  // The answers this report was generated with; state.surveyAnswers is the fallback for older results.
  const preferenceItems = summarizePreferences(answersFromPreferencesUsed(matchResults.preferences_used) || state.surveyAnswers);
  const fitNowDescriptions = fitNowMatches.map((match) => ({ key: `${match.job_id}-fit`, ...describeMatch(match, 'fit_now', skillNameLookup) }));
  const closestDescriptions = closestMatches.map((match) => ({ key: `${match.job_id}-closest`, ...describeMatch(match, 'closest', skillNameLookup) }));
  const aspirationDescriptions = aspirationMatches.map((match) => ({ key: `${match.job_id}-asp`, ...describeMatch(match, 'aspiration', skillNameLookup) }));
  const noFitNowText = emptyFitNowText(matchResults, closestMatches.length);
  const summaryCards = [
    {
      label: 'Fit-Now Matches',
      value: String(fitNowSnapshotCount),
      detail: fitNowSummaryDetail(topFitNow, topFitNowPercent, closestMatches[0]),
    },
    {
      label: 'Skill Gaps Identified',
      value: String(skillGapSnapshotCount),
      detail: `Most important: ${cleanSkillLabel(skillGaps[0]?.skill_name || '') || 'Not available yet'}.`,
    },
    {
      label: 'Learning Recommendations',
      value: String(learningSnapshotCount),
      detail: 'Personalized learning options to close your top gaps.',
    },
  ];

  const handleDownloadPdf = async () => {
    // Built only from what this report shows, so guest limits carry over to the file.
    const content: CareerReportContent = {
      title: 'Kareerly Career Report',
      generatedAt: new Date(),
      accessNote: isGuestReport ? 'Guest report: showing the top results only. Sign up to save this report and view your full dashboard.' : '',
      summary: summaryCards,
      preferences: preferenceItems,
      sections: [
        { heading: 'Fit-Now Matches', emptyText: noFitNowText, entries: fitNowDescriptions.map(toReportEntry) },
        ...(closestDescriptions.length > 0
          ? [{ heading: 'Closest Opportunities (not Fit-Now)', emptyText: '', entries: closestDescriptions.map(toReportEntry) }]
          : []),
        { heading: 'Aspiration Matches', emptyText: 'No aspiration matches returned yet.', entries: aspirationDescriptions.map(toReportEntry) },
        {
          heading: 'Skill Gaps to Work On',
          emptyText: 'No skill gaps returned yet.',
          entries: skillGaps.map((gap) => ({
            title: cleanSkillLabel(gap.skill_name),
            location: '',
            scoreLabel: gap.severity || 'To work on',
            lines: [skillGapText(gap)],
          })),
        },
        {
          heading: 'Learning Recommendations',
          emptyText: 'No learning recommendations available yet.',
          entries: learningRecommendations.map((recommendation) => ({
            title: recommendation.title || 'Untitled course or certification',
            location: recommendation.provider || 'Provider not listed',
            scoreLabel: recommendation.cost_type || 'Cost unknown',
            lines: [],
          })),
        },
      ],
    };
    setPdfStatus('working');
    try {
      await downloadCareerReportPdf(content);
      setPdfStatus('idle');
    } catch (error) {
      console.warn('Unable to create the report PDF:', error);
      setPdfStatus('failed');
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <div className="inline-flex items-center gap-1.5 bg-green-l text-green text-xs font-bold py-1.5 px-3.5 rounded-full mb-4">
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
          <span>Analysis complete</span>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-dark mb-2">Step 4: Your Career Report</h2>
            <p className="text-sm text-soft-text">Based on your resume and preferences, here is your current Kareerly snapshot.</p>
          </div>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={pdfStatus === 'working'}
            className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-lg border border-rust bg-white px-4 py-2.5 text-sm font-bold text-rust transition-colors hover:bg-rust-l disabled:cursor-wait disabled:opacity-60"
          >
            <FontAwesomeIcon icon={faFilePdf} aria-hidden="true" />
            <span>{pdfStatus === 'working' ? 'Preparing PDF…' : 'Download PDF'}</span>
          </button>
        </div>
        {pdfStatus === 'failed' && (
          <div className="mt-3 rounded-lg border border-red bg-red-l p-3 text-sm font-medium text-red" role="alert">
            The PDF could not be created. Please try again.
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="bg-card border border-bdr rounded-xl p-6">
          <div className="mb-3 text-2xl text-rust">
            <FontAwesomeIcon icon={faBullseye} aria-hidden="true" />
          </div>
          <div className="text-sm font-bold text-dark mb-2">Fit-Now Matches</div>
          <div className="text-4xl font-bold text-rust mb-1">{summaryCards[0].value}</div>
          <div className="text-xs text-soft-text leading-relaxed">{summaryCards[0].detail}</div>
        </div>

        <div className="bg-card border border-bdr rounded-xl p-6">
          <div className="mb-3 text-2xl text-rust">
            <FontAwesomeIcon icon={faChartLine} aria-hidden="true" />
          </div>
          <div className="text-sm font-bold text-dark mb-2">Skill Gaps Identified</div>
          <div className="text-4xl font-bold text-rust mb-1">{summaryCards[1].value}</div>
          <div className="text-xs text-soft-text leading-relaxed">{summaryCards[1].detail}</div>
        </div>

        <div className="bg-card border border-bdr rounded-xl p-6">
          <div className="mb-3 text-2xl text-rust">
            <FontAwesomeIcon icon={faGraduationCap} aria-hidden="true" />
          </div>
          <div className="text-sm font-bold text-dark mb-2">Learning Recommendations</div>
          <div className="text-4xl font-bold text-rust mb-1">{summaryCards[2].value}</div>
          <div className="text-xs text-soft-text leading-relaxed">{summaryCards[2].detail}</div>
        </div>
      </div>

      <PreferenceSummary items={preferenceItems} />

      <RegionFilterNotice
        filter={matchResults.location_filter}
        hasMatches={fitNowMatches.length + aspirationMatches.length + closestMatches.length > 0}
        onChangeRegion={() => goToStep(3)}
        onRemoveFilter={() => {
          // Step 3 opens with the filter removed; generating the report again applies it.
          if (state.surveyAnswers) setSurveyAnswers({ ...state.surveyAnswers, locationScope: 'anywhere', region: '' });
          goToStep(3);
        }}
      />

      <div className="bg-card border border-bdr rounded-xl p-6 mb-4">
        <div className="text-base font-bold text-dark mb-4 flex items-center gap-2">
          <FontAwesomeIcon className="text-rust" icon={faBriefcase} aria-hidden="true" />
          <span>Fit-Now Matches</span>
        </div>
        {fitNowMatches.length > 0 ? (
          <div className="space-y-2.5">
            {fitNowDescriptions.map(({ key, ...description }) => (
              <MatchRow key={key} description={description} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-bg p-4 text-sm text-soft-text" role="status">{noFitNowText}</div>
        )}
        {closestDescriptions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-bold text-dark">Closest opportunities (not Fit-Now)</div>
            <div className="space-y-2.5">
              {closestDescriptions.map(({ key, ...description }) => (
                <MatchRow key={key} description={description} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-card border border-bdr rounded-xl p-6 mb-4">
        <div className="text-base font-bold text-dark mb-4 flex items-center gap-2">
          <FontAwesomeIcon className="text-amber" icon={faRocket} aria-hidden="true" />
          <span>Aspiration Matches</span>
        </div>
        {aspirationMatches.length > 0 ? (
          <div className="space-y-2.5">
            {aspirationDescriptions.map(({ key, ...description }) => (
              <MatchRow key={key} description={description} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-bg p-4 text-sm text-soft-text">No aspiration matches returned yet.</div>
        )}
      </div>

      <div className="bg-card border border-bdr rounded-xl p-6 mb-4">
        <div className="text-base font-bold text-dark mb-4 flex items-center gap-2">
          <FontAwesomeIcon className="text-amber" icon={faLightbulb} aria-hidden="true" />
          <span>Skill Gaps to Work On</span>
        </div>
        {skillGaps.length > 0 ? (
          <div className="space-y-2.5">
            {skillGaps.map((gap) => (
              <SkillGapRow key={gap.skill_id || gap.skill_name} gap={gap} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-bg p-4 text-sm text-soft-text">No skill gaps returned yet.</div>
        )}
      </div>

      <div className="bg-card border border-bdr rounded-xl p-6 mb-4">
        <div className="text-base font-bold text-dark mb-4 flex items-center gap-2">
          <FontAwesomeIcon className="text-forest" icon={faBookOpen} aria-hidden="true" />
          <span>Learning Recommendations</span>
        </div>
        {learningRecommendations.length > 0 ? (
          <div className="space-y-2.5">
            {learningRecommendations.map((recommendation) => (
              <LearningRow key={recommendation.resource_id || recommendation.title} recommendation={recommendation} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-bg p-4 text-sm text-soft-text">No learning recommendations available yet.</div>
        )}
      </div>

      {isLoggedIn ? (
        <div className="bg-rust-l border border-rust rounded-xl p-4 mb-6 text-center">
          <div className="text-sm font-bold text-rust mb-3">
            {isSavingReport ? 'Saving this report to your account...' : 'Ready to keep this as your latest report?'}
          </div>
          {state.error && <div className="mb-3 text-sm font-semibold text-red">{state.error}</div>}
          <button
            onClick={onViewDashboard}
            disabled={isSavingReport}
            className="inline-flex items-center justify-center gap-1.5 bg-rust text-white font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save and View Dashboard
          </button>
        </div>
      ) : isGuestReport ? (
        <div className="bg-rust-l border border-rust rounded-xl p-4 mb-6 text-center">
          <div className="text-sm font-bold text-rust mb-3">Sign up to save this report and view your full dashboard.</div>
          <button
            type="button"
            onClick={onSignUp}
            className="inline-flex items-center justify-center gap-1.5 bg-rust text-white font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-opacity duration-150"
          >
            Sign up to Save Report
          </button>
        </div>
      ) : null}

      <div className="mt-8">
        <StepArrowButton direction="back" label="Back to career preferences" onClick={() => goToStep(3)} />
      </div>
    </div>
  );
}
