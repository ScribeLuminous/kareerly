export type CareerAreaSkill = { id: string; name: string };

/**
 * Each area's canonical taxonomy skills, most recognisable first; a skill may
 * belong to several areas. The one definition is
 * backend/data/career_area_skills.json, served by GET /api/career-areas, so
 * the "Your confirmed skills here" labels, the job-level lock and the
 * backend's own lock all read the same mapping (with the level thresholds). These only help a candidate
 * choose: selecting an area never adds them to the candidate's skills.
 */
export type CareerAreaSkillMap = Record<string, CareerAreaSkill[]>;

export type CareerAreaOption = {
  value: string;
  label: string;
};

export const careerAreaOptions: CareerAreaOption[] = [
  { value: 'technology-data', label: 'Technology & Data' },
  { value: 'business-office', label: 'Business & Office' },
  { value: 'sales-marketing-customer-service', label: 'Sales, Marketing & Customer Service' },
  { value: 'communications-creative-media', label: 'Communications & Creative Media' },
  { value: 'education-training', label: 'Education & Training' },
  { value: 'healthcare-wellness', label: 'Healthcare & Wellness' },
  { value: 'community-social-services', label: 'Community & Social Services' },
  { value: 'engineering-architecture', label: 'Engineering & Architecture' },
  { value: 'construction-maintenance', label: 'Construction & Maintenance' },
  { value: 'manufacturing-logistics-transport', label: 'Manufacturing, Logistics & Transport' },
  { value: 'hospitality-tourism-food-services', label: 'Hospitality, Tourism & Food Services' },
  { value: 'agriculture-environment', label: 'Agriculture & Environment' },
  { value: 'government-legal-security', label: 'Government, Legal & Security' },
];

/**
 * Broad areas offered before the list above. A saved preference keeps its
 * value; the backend matches it against every area it used to cover until the
 * candidate picks a current area.
 */
export const legacyCareerAreaOptions: Array<{ value: string; label: string; covers: string[] }> = [
  {
    value: 'education-health-community',
    label: 'Education, Health & Community',
    covers: ['education-training', 'healthcare-wellness', 'community-social-services'],
  },
  {
    value: 'engineering-trades-operations',
    label: 'Engineering, Trades & Operations',
    covers: [
      'engineering-architecture',
      'construction-maintenance',
      'manufacturing-logistics-transport',
      'hospitality-tourism-food-services',
      'agriculture-environment',
    ],
  },
];

export const careerAreaLabels: Record<string, string> = Object.fromEntries(
  [...careerAreaOptions, ...legacyCareerAreaOptions].map((option) => [option.value, option.label]),
);

const careerAreaAliases: Record<string, string> = {
  tech: 'technology-data',
  finance: 'business-office',
  bpo: 'sales-marketing-customer-service',
  healthcare: 'healthcare-wellness',
  'tech-business-finance': 'technology-data',
  'sales-marketing-service-creative': 'sales-marketing-customer-service',
  'education-healthcare-hospitality-community': 'education-health-community',
  'engineering-manufacturing-agriculture-logistics': 'engineering-trades-operations',
  'public-service-legal-protective-other': 'government-legal-security',
  'technology, data, business & finance': 'technology-data',
  'sales, marketing, customer service & creative media': 'sales-marketing-customer-service',
  'education, healthcare, hospitality & community services': 'education-health-community',
  'engineering, manufacturing, agriculture, logistics & field operations': 'engineering-trades-operations',
  'public service, legal, protective services & other': 'government-legal-security',
};

// The dashboard saves the label, so labels resolve back to their value.
const careerAreaLabelValues: Record<string, string> = Object.fromEntries(
  Object.entries(careerAreaLabels).map(([value, label]) => [label.toLowerCase(), value]),
);

export function normalizeCareerAreaValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (careerAreaLabels[normalized]) return normalized;
  return careerAreaLabelValues[normalized] || careerAreaAliases[normalized] || value;
}

export function getCareerAreaLabel(value: string): string {
  const normalized = normalizeCareerAreaValue(value);
  return careerAreaLabels[normalized] || value;
}

export function isLegacyCareerArea(value: string): boolean {
  const normalized = normalizeCareerAreaValue(value);
  return legacyCareerAreaOptions.some((option) => option.value === normalized);
}

function areaSkills(value: string, mapping: CareerAreaSkillMap): CareerAreaSkill[] {
  const normalized = normalizeCareerAreaValue(value);
  const legacy = legacyCareerAreaOptions.find((option) => option.value === normalized);
  return (legacy ? legacy.covers : [normalized]).flatMap((area) => mapping[area] || []);
}

/** The first few skills of an area, to help a candidate choose. */
export function careerAreaSkillExamples(value: string, mapping: CareerAreaSkillMap, count = 4): string[] {
  return areaSkills(value, mapping).slice(0, count).map((skill) => skill.name);
}

/**
 * Names of the candidate's own confirmed skills that belong to an area (every
 * area a legacy broad area covers). Only skills the candidate already
 * confirmed are returned; an area's other skills are never attributed to the
 * candidate.
 */
export function confirmedSkillsInCareerArea(
  value: string,
  confirmedSkillIds: Array<string | null | undefined>,
  mapping: CareerAreaSkillMap,
): string[] {
  const held = new Set(confirmedSkillIds.filter(Boolean).map((id) => String(id).trim().toUpperCase()));
  return [...new Set(areaSkills(value, mapping).filter((skill) => held.has(skill.id)).map((skill) => skill.name))];
}

/** Confirmed skills in the chosen area needed to open mid-level and senior. */
export type JobLevelThresholds = { mid: number; senior: number };

/** What GET /api/career-areas serves: the area skills and the job-level thresholds. */
export type CareerAreaRules = { areas: CareerAreaSkillMap; levelThresholds: JobLevelThresholds };

export type CappedJobLevel = 'entry' | 'mid';

/**
 * The highest job level Step 3 may offer for an area, or null when every level
 * is open: fewer than levelThresholds.mid confirmed skills in the area opens
 * entry-level only, fewer than levelThresholds.senior opens up to mid-level.
 * "I'm not sure" is never locked. Counts the same skills as the "Your
 * confirmed skills here" labels, and the backend applies the same rule.
 * Without the rules (not loaded yet, or unavailable) nothing is locked here;
 * the backend still enforces them.
 */
export function maxJobLevel(
  value: string,
  confirmedSkillIds: Array<string | null | undefined>,
  rules: CareerAreaRules | null,
): CappedJobLevel | null {
  if (!rules || !value.trim() || areaSkills(value, rules.areas).length === 0) return null;
  const count = confirmedSkillsInCareerArea(value, confirmedSkillIds, rules.areas).length;
  if (count >= rules.levelThresholds.senior) return null;
  return count >= rules.levelThresholds.mid ? 'mid' : 'entry';
}
