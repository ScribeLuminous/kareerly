import { canonicalCity, provinceCities } from '../../lib/phCities';
import { canonicalProvince } from '../../lib/phProvinces';
import { addSkills, validateDraftSave, validateJobDraft, type JobEditorDraft } from './jobDraft';
import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, jobCategoryOptions, WORK_SETUPS, emptyJobForm, todayIso } from './model';

/**
 * Bulk upload: many jobs from one spreadsheet (CSV). Each row goes through the
 * same checks as the job editor. Rows that pass can be posted; rows that only
 * have a title can be saved as drafts and finished in the editor.
 */

export const MAX_BULK_JOBS = 100;

type ColumnKey =
  | 'title' | 'category' | 'subcategory' | 'experienceLevel' | 'employmentType' | 'workSetup'
  | 'city' | 'province' | 'salaryMin' | 'salaryMax' | 'deadline'
  | 'description' | 'responsibilities' | 'qualifications' | 'requiredSkills' | 'niceSkills';

type Column = { key: ColumnKey; header: string; required: boolean; aliases: string[]; example: string; help: string };

export const BULK_JOB_COLUMNS: Column[] = [
  { key: 'title', header: 'job_title', required: true, aliases: ['title', 'job title', 'position'], example: 'Hotel Front Desk Agent', help: 'The job title.' },
  { key: 'category', header: 'category', required: true, aliases: ['job category', 'category code'], example: 'Hospitality and Tourism', help: 'A category from the list below, or its code (e.g. K18).' },
  { key: 'subcategory', header: 'subcategory', required: true, aliases: ['sub-category', 'sub category'], example: 'Hospitality', help: 'One of the chosen category\'s sub-categories.' },
  { key: 'experienceLevel', header: 'experience_level', required: true, aliases: ['level', 'job level', 'experience'], example: 'Entry-level / Fresh Graduate', help: EXPERIENCE_LEVELS.join(', ') + '.' },
  { key: 'employmentType', header: 'employment_type', required: false, aliases: ['employment', 'type', 'job type'], example: 'Full-time', help: `Optional. ${EMPLOYMENT_TYPES.join(', ')}.` },
  { key: 'workSetup', header: 'work_setup', required: true, aliases: ['setup', 'work arrangement', 'arrangement'], example: 'On-site', help: `${WORK_SETUPS.join(', ')}.` },
  { key: 'city', header: 'city', required: true, aliases: ['city or municipality', 'municipality', 'town'], example: 'Iloilo City', help: 'A city or municipality in the province.' },
  { key: 'province', header: 'province', required: true, aliases: [], example: 'Iloilo', help: 'A Philippine province, or Metro Manila.' },
  { key: 'salaryMin', header: 'salary_min', required: true, aliases: ['minimum salary', 'min salary', 'salary minimum', 'salary_min_php'], example: '18000', help: `Monthly, in pesos. At least ₱10,000.` },
  { key: 'salaryMax', header: 'salary_max', required: true, aliases: ['maximum salary', 'max salary', 'salary maximum', 'salary_max_php'], example: '22000', help: 'Monthly, in pesos. At least the minimum.' },
  { key: 'deadline', header: 'deadline', required: true, aliases: ['application deadline', 'closing date', 'closes'], example: '', help: 'A future date, as YYYY-MM-DD (e.g. 2026-12-31) or MM/DD/YYYY.' },
  { key: 'description', header: 'description', required: true, aliases: ['about the role', 'job description', 'about'], example: 'Welcome guests and keep the front desk running smoothly.', help: 'A short overview of the role.' },
  { key: 'responsibilities', header: 'responsibilities', required: true, aliases: ['duties'], example: 'Check guests in and out | Answer calls and emails | Handle billing', help: 'Separate items with | or put each on its own line in the cell.' },
  { key: 'qualifications', header: 'qualifications', required: false, aliases: ['requirements'], example: 'At least 1 year in a hotel or front office', help: 'Optional. Separate items with | or new lines.' },
  { key: 'requiredSkills', header: 'required_skills', required: true, aliases: ['skills', 'required skill', 'must have skills'], example: 'Customer Service, Communication, Cash Handling', help: 'Separate skills with commas.' },
  { key: 'niceSkills', header: 'nice_to_have_skills', required: false, aliases: ['nice to have', 'preferred skills', 'preferred_skills', 'nice to have skill'], example: 'Opera PMS', help: 'Optional. Separate skills with commas.' },
];

const normalizeHeader = (value: string) => value.toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const HEADER_LOOKUP = new Map<string, ColumnKey>();
BULK_JOB_COLUMNS.forEach((column) => {
  [column.header, column.key, ...column.aliases].forEach((name) => HEADER_LOOKUP.set(normalizeHeader(name), column.key));
});

/** Splits CSV text into rows of cells: quoted cells may hold commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  // Spreadsheets in some regions save with semicolons; tabs come from pasting.
  const delimiter = [',', ';', '\t'].map((mark) => ({ mark, count: firstLine.split(mark).length - 1 }))
    .sort((a, b) => b.count - a.count)[0];
  const sep = delimiter.count > 0 ? delimiter.mark : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === sep) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const loose = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function pick(options: string[], value: string, extra: Record<string, string> = {}): string {
  const key = loose(value);
  if (!key) return '';
  return options.find((option) => loose(option) === key) || extra[key] || '';
}

const LEVEL_ALIASES: Record<string, string> = {
  entry: EXPERIENCE_LEVELS[0], entrylevel: EXPERIENCE_LEVELS[0], freshgraduate: EXPERIENCE_LEVELS[0], fresher: EXPERIENCE_LEVELS[0],
  junior: EXPERIENCE_LEVELS[1], mid: EXPERIENCE_LEVELS[2], midlevel: EXPERIENCE_LEVELS[2], senior: EXPERIENCE_LEVELS[3],
};
const SETUP_ALIASES: Record<string, string> = { onsite: 'On-site', inoffice: 'On-site', office: 'On-site', wfh: 'Remote', workfromhome: 'Remote' };
const TYPE_ALIASES: Record<string, string> = { fulltime: 'Full-time', parttime: 'Part-time', contractual: 'Contract', temp: 'Temporary', intern: 'Internship', ojt: 'Internship' };

function pickCategory(value: string): string {
  const key = loose(value);
  if (!key) return '';
  return jobCategoryOptions.find((option) => loose(option.value) === key || loose(option.code) === key)?.value || '';
}

/** A listed city, also when written with or without "City" (e.g. "Iloilo" for "Iloilo City"). */
function pickCity(province: string, value: string): string {
  const text = value.trim();
  if (!text) return '';
  const cities = provinceCities(province);
  const bare = (city: string) => loose(city.replace(/^city of\s+/i, '').replace(/\s+city$/i, ''));
  return canonicalCity(province, text) || cities.find((city) => loose(city) === loose(text)) || cities.find((city) => bare(city) === bare(text)) || '';
}

/** YYYY-MM-DD from ISO or the US-style dates spreadsheets write (MM/DD/YYYY); '' when unreadable. */
export function parseDeadline(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const us = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  const named = !iso && !us && /[a-z]/i.test(text) ? new Date(text) : null;
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : us ? [Number(us[3].length === 2 ? `20${us[3]}` : us[3]), Number(us[1]), Number(us[2])]
      : named && !Number.isNaN(named.getTime()) ? [named.getFullYear(), named.getMonth() + 1, named.getDate()]
        : null;
  if (!parts) return '';
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const salaryDigits = (value: string) => {
  // "18,000.00" → 18000: drop centavos, then everything but digits.
  const whole = value.trim().replace(/\.\d{1,2}$/, '');
  return whole.replace(/[^\d]/g, '');
};

/** List cells: "a | b", or one item per line. */
const listCell = (value: string) => value.split(/\r?\n|\s*\|\s*/).map((item) => item.trim()).filter(Boolean).join('\n');

export type BulkJobRow = {
  /** The spreadsheet row number, counting the header as row 1. */
  rowNumber: number;
  draft: JobEditorDraft;
  /** Why the row can't be posted; empty when it is ready. */
  problems: string[];
  /** Notes that don't block, such as a title already used. */
  warnings: string[];
  /** 'post' when complete, 'draft' when only a draft can be saved, 'skip' when nothing can be saved. */
  outcome: 'post' | 'draft' | 'skip';
};

export type BulkJobParse = { rows: BulkJobRow[]; error: string; unknownHeaders: string[] };

/** Reads an uploaded sheet into checked job drafts. */
export function parseBulkJobs(text: string, options: { existingTitles?: string[]; today?: string } = {}): BulkJobParse {
  const today = options.today || todayIso();
  const table = parseCsv(text).filter((cells) => cells.some((cell) => cell.trim() !== ''));
  if (table.length === 0) return { rows: [], error: 'The file is empty.', unknownHeaders: [] };
  const headers = table[0].map((cell) => HEADER_LOOKUP.get(normalizeHeader(cell)) || null);
  const unknownHeaders = table[0].filter((cell, index) => !headers[index] && cell.trim()).map((cell) => cell.trim());
  if (!headers.includes('title')) {
    return { rows: [], error: 'The first row must name the columns, including job_title. Download the template to start from the right columns.', unknownHeaders };
  }
  const body = table.slice(1);
  if (body.length === 0) return { rows: [], error: 'The file has column names but no jobs.', unknownHeaders };
  if (body.length > MAX_BULK_JOBS) return { rows: [], error: `Upload up to ${MAX_BULK_JOBS} jobs at a time. This file has ${body.length}.`, unknownHeaders };

  const existing = new Set((options.existingTitles || []).map((title) => title.trim().toLowerCase()));
  const seenInFile = new Map<string, number>();

  const rows = body.map((cells, index): BulkJobRow => {
    const value = (key: ColumnKey) => {
      const at = headers.indexOf(key);
      return at >= 0 ? (cells[at] || '').trim() : '';
    };
    const problems: string[] = [];
    const warnings: string[] = [];
    const recognised = (label: string, raw: string, picked: string) => {
      if (raw && !picked) problems.push(`${label} "${raw}" isn't one of the options.`);
      return picked;
    };

    const category = recognised('Category', value('category'), pickCategory(value('category')));
    const subcategoryOptions = category ? jobCategoryOptions.find((option) => option.value === category)?.subcategories || [] : [];
    const rawSubcategory = value('subcategory');
    const subcategory = category ? recognised('Sub-category', rawSubcategory, pick(subcategoryOptions, rawSubcategory)) : '';
    const experienceLevel = recognised('Experience level', value('experienceLevel'), pick(EXPERIENCE_LEVELS, value('experienceLevel'), LEVEL_ALIASES));
    const employmentType = recognised('Employment type', value('employmentType'), pick(EMPLOYMENT_TYPES, value('employmentType'), TYPE_ALIASES));
    const workSetup = recognised('Work setup', value('workSetup'), pick(WORK_SETUPS, value('workSetup'), SETUP_ALIASES));
    const province = recognised('Province', value('province'), canonicalProvince(value('province')));
    const rawCity = value('city');
    const city = province ? pickCity(province, rawCity) : '';
    if (province && rawCity && !city) problems.push(`City "${rawCity}" isn't listed under ${province}.`);

    const rawDeadline = value('deadline');
    const deadline = parseDeadline(rawDeadline);
    if (rawDeadline && !deadline) problems.push(`Deadline "${rawDeadline}" isn't a date. Use YYYY-MM-DD.`);
    else if (deadline && deadline <= today) problems.push('The deadline must be after today.');

    const salaryMin = salaryDigits(value('salaryMin'));
    const salaryMax = salaryDigits(value('salaryMax'));
    const requiredSkills = addSkills([], value('requiredSkills').replace(/;/g, ',')) || [];
    const niceSkills = (addSkills([], value('niceSkills').replace(/;/g, ',')) || [])
      .filter((skill) => !requiredSkills.some((required) => required.toLowerCase() === skill.toLowerCase()));

    const draft: JobEditorDraft = {
      form: {
        ...emptyJobForm,
        title: value('title'),
        category,
        subcategory,
        experienceLevel,
        employmentType,
        workSetup,
        city,
        province,
        salaryRange: salaryMin || salaryMax ? `${salaryMin}-${salaryMax}` : '',
        // A past deadline can't be posted or kept: the job would close at once.
        deadline: deadline && deadline > today ? deadline : '',
        description: value('description'),
        responsibilities: listCell(value('responsibilities')),
        qualifications: listCell(value('qualifications')),
        status: 'draft',
      },
      requiredSkills,
      niceSkills,
      requiredSkillInput: '',
      niceSkillInput: '',
    };

    const missing = validateJobDraft(draft);
    // The editor's first problem, unless it is about a value already flagged above.
    if (missing && problems.length === 0) problems.push(missing);

    const titleKey = draft.form.title.toLowerCase();
    if (titleKey) {
      if (existing.has(titleKey)) warnings.push('You already have a job with this title.');
      const earlier = seenInFile.get(titleKey);
      if (earlier) warnings.push(`Same title as row ${earlier}.`);
      else seenInFile.set(titleKey, index + 2);
    }

    const outcome = problems.length === 0 ? 'post' : validateDraftSave(draft) ? 'skip' : 'draft';
    return { rowNumber: index + 2, draft, problems, warnings, outcome };
  });

  return { rows, error: '', unknownHeaders };
}

/** The template: column names and one filled-in example row. */
export function bulkJobTemplateCsv(today = todayIso()): string {
  const [year, month] = today.split('-').map(Number);
  // An example deadline about two months out, so the example row is valid as is.
  const deadline = `${month >= 11 ? year + 1 : year}-${String(((month + 1) % 12) + 1).padStart(2, '0')}-15`;
  const cell = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const header = BULK_JOB_COLUMNS.map((column) => column.header).join(',');
  const example = BULK_JOB_COLUMNS.map((column) => cell(column.key === 'deadline' ? deadline : column.example)).join(',');
  return `${header}\r\n${example}\r\n`;
}
