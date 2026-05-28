import { useOnboarding } from '../hooks/useOnboarding';
import {
  faBookOpen,
  faBriefcase,
  faBullseye,
  faChartLine,
  faCircleCheck,
  faGraduationCap,
  faLightbulb,
  faRocket,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { JobMatchRunResults, LearningRecommendation, MatchResultItem, PrioritizedSkillGap, ResumeAnalysisResult } from '../types';
import { extractMatchPercent, formatMatchPercentLabel, normalizePercentValue } from '../lib/matchScoring';

type SnapshotStepProps = {
  isLoggedIn: boolean;
  onViewDashboard: () => void;
};

function formatMetricPercent(value: unknown): string {
  const normalized = normalizePercentValue(value);
  if (normalized === null) return '—';
  return `${Math.round(normalized)}%`;
}

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

function toSkillLabels(skillIds: string[] | undefined, skillNameLookup: Map<string, string>): string[] {
  if (!Array.isArray(skillIds)) return [];
  return skillIds.map((skillId) => skillNameLookup.get(skillId) || skillId);
}

function getMatchedSkillText(match: MatchResultItem, skillNameLookup: Map<string, string>): string {
  if (Array.isArray(match.matched_skill_ids) && match.matched_skill_ids.length > 0) {
    return toSkillLabels(match.matched_skill_ids, skillNameLookup).slice(0, 6).join(', ');
  }
  if (Array.isArray(match.matched_skills) && match.matched_skills.length > 0) {
    return match.matched_skills.slice(0, 6).join(', ');
  }
  return '';
}

function getMissingSkillText(match: MatchResultItem, skillNameLookup: Map<string, string>): string {
  if (Array.isArray(match.missing_skill_ids) && match.missing_skill_ids.length > 0) {
    return toSkillLabels(match.missing_skill_ids, skillNameLookup).slice(0, 6).join(', ');
  }
  if (Array.isArray(match.missing_skills) && match.missing_skills.length > 0) {
    return match.missing_skills.slice(0, 6).join(', ');
  }
  return '';
}

function MatchRow({
  match,
  matchType,
  skillNameLookup,
}: {
  match: MatchResultItem;
  matchType: 'fit_now' | 'aspiration';
  skillNameLookup: Map<string, string>;
}) {
  const matchedText = getMatchedSkillText(match, skillNameLookup);
  const missingText = getMissingSkillText(match, skillNameLookup);
  const matchPercent = extractMatchPercent(match, matchType);
  const matchPercentLabel = formatMatchPercentLabel(matchPercent);

  return (
    <div className="rounded-lg bg-bg px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-dark">{match.job_title || 'Untitled role'}</div>
          <div className="text-xs text-soft">{match.location || 'Location not listed'}</div>
        </div>
        <div
          className={`rounded-md px-3 py-1 text-xs font-extrabold ${
            matchPercent === null ? 'bg-bdr text-soft' : 'bg-rust text-white'
          }`}
        >
          {matchPercentLabel}
        </div>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-soft">
        Text similarity: {formatMetricPercent(match.text_similarity)} · Skill coverage: {formatMetricPercent(match.skill_coverage)}
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <div className="text-green">{matchedText ? `Matched skills: ${matchedText}` : 'Matched skills: Not available yet.'}</div>
        <div className="text-soft">{missingText ? `Missing skills: ${missingText}` : 'Missing skills: None found (or not provided).'}</div>
      </div>
    </div>
  );
}

function SkillGapRow({ gap }: { gap: PrioritizedSkillGap }) {
  return (
    <div className="rounded-lg bg-bg px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-dark">{gap.skill_name}</span>
        <span className="text-xs text-soft">{gap.severity || 'To work on'}</span>
      </div>
      <div className="mt-1 text-xs text-soft">
        {typeof gap.appears_in_top_matches === 'number'
          ? `Missing in ${gap.appears_in_top_matches} match${gap.appears_in_top_matches === 1 ? '' : 'es'}`
          : typeof gap.missing_count === 'number'
            ? `Missing in ${gap.missing_count} match${gap.missing_count === 1 ? '' : 'es'}`
            : 'Missing count not available.'}
      </div>
    </div>
  );
}

function LearningRow({ recommendation }: { recommendation: LearningRecommendation }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-bg px-4 py-3">
      <div className="min-w-0">
        <div className="truncate font-semibold text-dark">{recommendation.title || 'Untitled course or certification'}</div>
        <div className="truncate text-xs text-soft">{recommendation.provider || 'Provider not listed'}</div>
      </div>
      <div
        className={`flex-shrink-0 rounded-lg px-3 py-1 text-xs font-bold ${
          String(recommendation.cost_type || '').toLowerCase().includes('paid') ? 'bg-rust-l text-rust' : 'bg-green-l text-green'
        }`}
      >
        {String(recommendation.cost_type || '').toLowerCase().includes('paid') ? 'Paid' : 'Free'}
      </div>
    </div>
  );
}

export default function SnapshotStep({ isLoggedIn, onViewDashboard }: SnapshotStepProps) {
  const { state, goToStep } = useOnboarding();
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
          <p className="text-sm text-soft mb-5">Upload a resume and complete the survey to generate your career snapshot.</p>
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

  const reportData = shouldUseLimitedReport
    ? {
        fit_now_matches: limitedReport?.fit_now_matches || [],
        aspiration_matches: limitedReport?.aspiration_matches || [],
        skill_gaps: limitedReport?.skill_gaps || [],
        learning_recommendations: limitedReport?.learning_recommendations || [],
      }
    : {
        fit_now_matches: matchResults.fit_now_matches || [],
        aspiration_matches: matchResults.aspiration_matches || [],
        skill_gaps: matchResults.skill_gaps || [],
        learning_recommendations: matchResults.learning_recommendations || [],
      };

  const fitNowMatches = reportData.fit_now_matches;
  const aspirationMatches = reportData.aspiration_matches;
  const skillGaps = reportData.skill_gaps;
  const learningRecommendations = reportData.learning_recommendations;
  const topFitNow = fitNowMatches[0];
  const topFitNowPercent = topFitNow ? extractMatchPercent(topFitNow, 'fit_now') : null;
  const skillNameLookup = buildSkillNameLookup(resumeAnalysis, matchResults);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <div className="inline-flex items-center gap-1.5 bg-green-l text-green text-xs font-bold py-1.5 px-3.5 rounded-full mb-4">
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
          <span>Analysis complete</span>
        </div>
        <h2 className="font-display text-2xl font-bold text-dark mb-2">Step 4: Your Career Report</h2>
        <p className="text-sm text-soft">Based on your resume and preferences, here is your current Kareerly snapshot.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="bg-card border border-bdr rounded-xl p-6">
          <div className="mb-3 text-2xl text-rust">
            <FontAwesomeIcon icon={faBullseye} aria-hidden="true" />
          </div>
          <div className="text-sm font-bold text-dark mb-2">Fit-Now Matches</div>
          <div className="text-4xl font-bold text-rust mb-1">{String(fitNowMatches.length)}</div>
          <div className="text-xs text-soft leading-relaxed">
            Best match: {topFitNow?.job_title || 'Not available yet'} {topFitNow ? `at ${formatMatchPercentLabel(topFitNowPercent)}.` : ''}
          </div>
        </div>

        <div className="bg-card border border-bdr rounded-xl p-6">
          <div className="mb-3 text-2xl text-rust">
            <FontAwesomeIcon icon={faChartLine} aria-hidden="true" />
          </div>
          <div className="text-sm font-bold text-dark mb-2">Skill Gaps Identified</div>
          <div className="text-4xl font-bold text-rust mb-1">{String(skillGaps.length)}</div>
          <div className="text-xs text-soft leading-relaxed">
            Most important: {skillGaps[0]?.skill_name || 'Not available yet'}.
          </div>
        </div>

        <div className="bg-card border border-bdr rounded-xl p-6">
          <div className="mb-3 text-2xl text-rust">
            <FontAwesomeIcon icon={faGraduationCap} aria-hidden="true" />
          </div>
          <div className="text-sm font-bold text-dark mb-2">Learning Recommendations</div>
          <div className="text-4xl font-bold text-rust mb-1">{String(learningRecommendations.length)}</div>
          <div className="text-xs text-soft leading-relaxed">Personalized learning options to close your top gaps.</div>
        </div>
      </div>

      <div className="bg-card border border-bdr rounded-xl p-6 mb-4">
        <div className="text-base font-bold text-dark mb-4 flex items-center gap-2">
          <FontAwesomeIcon className="text-rust" icon={faBriefcase} aria-hidden="true" />
          <span>Fit-Now Matches</span>
        </div>
        {fitNowMatches.length > 0 ? (
          <div className="space-y-2.5">
            {fitNowMatches.map((match) => (
              <MatchRow key={`${match.job_id}-fit`} match={match} matchType="fit_now" skillNameLookup={skillNameLookup} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-bg p-4 text-sm text-soft">No fit-now matches returned yet.</div>
        )}
      </div>

      <div className="bg-card border border-bdr rounded-xl p-6 mb-4">
        <div className="text-base font-bold text-dark mb-4 flex items-center gap-2">
          <FontAwesomeIcon className="text-amber" icon={faRocket} aria-hidden="true" />
          <span>Aspiration Matches</span>
        </div>
        {aspirationMatches.length > 0 ? (
          <div className="space-y-2.5">
            {aspirationMatches.map((match) => (
              <MatchRow key={`${match.job_id}-asp`} match={match} matchType="aspiration" skillNameLookup={skillNameLookup} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-bg p-4 text-sm text-soft">No aspiration matches returned yet.</div>
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
          <div className="rounded-lg bg-bg p-4 text-sm text-soft">No skill gaps returned yet.</div>
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
          <div className="rounded-lg bg-bg p-4 text-sm text-soft">No learning recommendations available yet.</div>
        )}
      </div>

      {isLoggedIn ? (
        <div className="bg-rust-l border border-rust rounded-xl p-4 mb-6 text-center">
          <div className="text-sm font-bold text-rust mb-3">Ready to keep this as your latest report?</div>
          <button
            onClick={onViewDashboard}
            className="inline-flex items-center justify-center gap-1.5 bg-rust text-white font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-opacity duration-150"
          >
            Save and View Dashboard
          </button>
        </div>
      ) : (
        <div className="bg-bg border border-bdr rounded-xl p-4 mb-6 text-center">
          <div className="text-sm font-bold text-dark mb-1">Want to save this report and view a full dashboard?</div>
          <div className="text-xs text-soft">Sign up or log in to save progress, applications, and ongoing recommendations.</div>
        </div>
      )}

      <button
        onClick={() => goToStep(3)}
        className="w-full mt-8 px-5 py-3 border-1.5 border-bdr rounded-lg bg-white text-mid font-semibold hover:border-rust hover:text-rust transition-all duration-150"
      >
        Go Back
      </button>
    </div>
  );
}
