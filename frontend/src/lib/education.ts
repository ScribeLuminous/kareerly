// Highest educational attainment as one fixed list, so the same level is never
// stored as "Bachelor", "bachelor's deg." and "Bachelors Degree".
//
// The rules are mirrored in backend/app/services/education.py and in the SQL
// function public.normalize_education_level (migration 20261028110000); the
// three share the same test cases.

export const EDUCATION_LEVELS = [
  'High School',
  'Vocational / Technical',
  'Some College',
  'Associate Degree',
  "Bachelor's Degree",
  "Master's Degree",
  'Doctorate Degree',
] as const;

export type EducationLevel = typeof EDUCATION_LEVELS[number];

// Checked in order, so "master's in education" is not read as a bachelor's.
const RULES: Array<[EducationLevel, RegExp]> = [
  ['Doctorate Degree', /\b(doctor|doctorate|doctoral|phd|edd|dba)\b/],
  ["Master's Degree", /\b(master|masters|mba|msc|ms|ma|postgrad|postgraduate|post graduate)\b/],
  ["Bachelor's Degree", /\b(bachelor|bachelors|baccalaureate|college graduate|bs|bsc|ba|ab|bse|bsed|beed|undergraduate degree)\b/],
  ['Associate Degree', /\b(associate|associates|aas)\b/],
  ['Vocational / Technical', /\b(vocational|technical|tesda|trade|nc ii|nc iii|nc iv)\b/],
  ['Some College', /\b(some college|college level|undergraduate|undergrad|currently enrolled|ongoing)\b/],
  ['High School', /\b(high school|highschool|senior high|junior high|shs|secondary|k 12|k12)\b/],
];

const squash = (value: string): string => value.replace(/[^a-z0-9]+/g, ' ').trim();

/** The matching entry of EDUCATION_LEVELS, or '' when the text names none. */
export function normalizeEducationLevel(value: unknown): EducationLevel | '' {
  const text = squash(String(value ?? '').toLowerCase().replace(/’/g, "'").replace(/['.]/g, ''));
  if (!text) return '';
  const exact = EDUCATION_LEVELS.find((level) => squash(level.toLowerCase().replace(/'/g, '')) === text);
  if (exact) return exact;
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? '';
}
