import { careerAreaOptions } from './careerAreas';

export type PsocGroup = { code: string; title: string };

export type EmployerIndustry = {
  /** The career-area slug candidates choose in Step 3 and skills are grouped under. */
  area: string;
  /** Saved as the employer's industry; the same words as the career area. */
  label: string;
  /** The PSOC 2012 groups whose occupations this industry mostly hires for. */
  psoc: PsocGroup[];
};

// PSOC 2012 (PSA) sub-major, minor or unit groups behind each career area, so an
// employer's industry, a job's skills and a reviewer-assigned PSOC code line up.
const PSOC_BY_AREA: Record<string, PsocGroup[]> = {
  'technology-data': [
    { code: '25', title: 'Information and communications technology professionals' },
    { code: '35', title: 'Information and communications technicians' },
  ],
  'business-office': [
    { code: '12', title: 'Administrative and commercial managers' },
    { code: '24', title: 'Business and administration professionals' },
    { code: '33', title: 'Business and administration associate professionals' },
    { code: '41', title: 'General and keyboard clerks' },
    { code: '43', title: 'Numerical and material recording clerks' },
  ],
  'sales-marketing-customer-service': [
    { code: '243', title: 'Sales, marketing and public relations professionals' },
    { code: '42', title: 'Customer services clerks' },
    { code: '52', title: 'Sales workers' },
  ],
  'communications-creative-media': [
    { code: '264', title: 'Authors, journalists and linguists' },
    { code: '265', title: 'Creative and performing artists' },
    { code: '343', title: 'Artistic, cultural and culinary associate professionals' },
  ],
  'education-training': [
    { code: '23', title: 'Teaching professionals' },
  ],
  'healthcare-wellness': [
    { code: '22', title: 'Health professionals' },
    { code: '32', title: 'Health associate professionals' },
    { code: '53', title: 'Personal care workers' },
  ],
  'community-social-services': [
    { code: '263', title: 'Social and religious professionals' },
    { code: '341', title: 'Legal, social and religious associate professionals' },
  ],
  'engineering-architecture': [
    { code: '21', title: 'Science and engineering professionals' },
    { code: '31', title: 'Science and engineering associate professionals' },
  ],
  'construction-maintenance': [
    { code: '71', title: 'Building and related trades workers, excluding electricians' },
    { code: '72', title: 'Metal, machinery and related trades workers' },
    { code: '74', title: 'Electrical and electronics trades workers' },
  ],
  'manufacturing-logistics-transport': [
    { code: '13', title: 'Production and specialized services managers' },
    { code: '75', title: 'Food processing, woodworking, garment and other craft workers' },
    { code: '8', title: 'Plant and machine operators and assemblers' },
    { code: '93', title: 'Laborers in mining, construction, manufacturing and transport' },
  ],
  'hospitality-tourism-food-services': [
    { code: '14', title: 'Hospitality, retail and other services managers' },
    { code: '51', title: 'Personal service workers' },
    { code: '94', title: 'Food preparation assistants' },
  ],
  'agriculture-environment': [
    { code: '6', title: 'Skilled agricultural, forestry and fishery workers' },
    { code: '92', title: 'Agricultural, forestry and fishery laborers' },
  ],
  'government-legal-security': [
    { code: '11', title: 'Chief executives, senior officials and legislators' },
    { code: '261', title: 'Legal professionals' },
    { code: '54', title: 'Protective services workers' },
  ],
};

/** Industries follow the skill career areas one to one, in the same order. */
export const EMPLOYER_INDUSTRY_OPTIONS: EmployerIndustry[] = careerAreaOptions.map((option) => ({
  area: option.value,
  label: option.label,
  psoc: PSOC_BY_AREA[option.value] || [],
}));

export const OTHER_INDUSTRY = 'Other';

// One list for sign-up and the account page. A saved value outside the list is
// kept as its own option so it is never silently replaced.
export const EMPLOYER_INDUSTRIES = [...EMPLOYER_INDUSTRY_OPTIONS.map((option) => option.label), OTHER_INDUSTRY];

// Industries offered before they followed the career areas.
const LEGACY_INDUSTRIES: Record<string, string> = {
  'technology & software': 'Technology & Data',
  'data & analytics': 'Technology & Data',
  'bpo & customer service': 'Sales, Marketing & Customer Service',
  'finance & banking': 'Business & Office',
  healthcare: 'Healthcare & Wellness',
  'retail & e-commerce': 'Sales, Marketing & Customer Service',
  'manufacturing & logistics': 'Manufacturing, Logistics & Transport',
  'hospitality & tourism': 'Hospitality, Tourism & Food Services',
  'government & public sector': 'Government, Legal & Security',
};

/** A saved industry in the current list's words; unknown values are kept as they are. */
export function normalizeEmployerIndustry(value: string | null | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  const known = EMPLOYER_INDUSTRIES.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  return known || LEGACY_INDUSTRIES[trimmed.toLowerCase()] || trimmed;
}

/** The PSOC 2012 groups behind an industry label, or none for Other and unknown values. */
export function industryPsocGroups(label: string): PsocGroup[] {
  return EMPLOYER_INDUSTRY_OPTIONS.find((option) => option.label === label)?.psoc || [];
}

export const EMPLOYER_COMPANY_SIZES = ['1-10 employees', '11-50 employees', '51-200 employees', '201-500 employees', '500+ employees'];
