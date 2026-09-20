// Skill and category identifiers are internal. A candidate should never read
// "SK_CRM" or "SK004" in a match, a gap or a learning recommendation, so every
// label shown to a user goes through here.

const PRESERVED_ACRONYMS = new Set(['SQL', 'HTML', 'CSS', 'CRM', 'API', 'UI', 'UX', 'HR', 'QA', 'SEO', 'AWS', 'PHP', 'BI', 'ETL']);

/** Canonical taxonomy IDs (SK004), legacy job IDs (SK_CRM) and category codes (K02). */
const TAXONOMY_ID = /^SK\d+$/i;
const LEGACY_SKILL_ID = /^SK[_-][A-Z0-9_-]+$/i;
const CATEGORY_ID = /^K\d{1,2}$/i;

export function isInternalId(value: string): boolean {
  const trimmed = value.trim();
  return TAXONOMY_ID.test(trimmed) || LEGACY_SKILL_ID.test(trimmed) || CATEGORY_ID.test(trimmed);
}

/** A readable name for a legacy ID such as SK_CUSTOMER_SERVICE, or '' when there is none. */
function humanizeLegacyId(value: string): string {
  if (!LEGACY_SKILL_ID.test(value.trim())) return '';
  return value
    .trim()
    .replace(/^SK[_-]/i, '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => (PRESERVED_ACRONYMS.has(word.toUpperCase()) || word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ');
}

export function cleanSkillLabel(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (TAXONOMY_ID.test(trimmed) || CATEGORY_ID.test(trimmed)) return '';
  if (LEGACY_SKILL_ID.test(trimmed)) return humanizeLegacyId(trimmed);
  return trimmed
    .split(/(\s+|\/|-|\(|\))/)
    .map((part) => {
      const word = part.trim();
      if (!word) return part;
      if (PRESERVED_ACRONYMS.has(word.toUpperCase())) return word.toUpperCase();
      if (word === word.toUpperCase() && word.length > 3) return word.charAt(0) + word.slice(1).toLowerCase();
      return word;
    })
    .join('');
}

/** Names for skill IDs, using the lookup first and dropping anything still unreadable. */
export function toSkillLabels(skillIds: string[] | undefined, lookup: Map<string, string>): string[] {
  if (!Array.isArray(skillIds)) return [];
  return skillIds
    .map((skillId) => cleanSkillLabel(lookup.get(skillId) || skillId))
    .filter((label) => Boolean(label) && !isInternalId(label));
}

/** Labels for display, dropping identifiers that have no name behind them. */
export function toDisplayLabels(values: (string | undefined)[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => cleanSkillLabel(value || '')).filter((label) => Boolean(label) && !isInternalId(label));
}
