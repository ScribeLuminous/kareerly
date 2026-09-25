import type { ResumeAnalysisResult } from '../types';

// Must match RESUME_PARSER_VERSION in backend/app/services/resume_parser.py
// (tests/resumeFreshness.test.mjs checks this).
export const CURRENT_RESUME_PARSER_VERSION = '2026.09-ocr-columns-doc';

export const RESUME_FILE_ACCEPT = '.pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword';

export type SavedResumeFreshness = {
  // Read by an older parser: skills from scanned pages, columns, split words,
  // images or .doc files may be missing from this analysis.
  stale: boolean;
  analyzedAt: string | null;
  parserVersion: string | null;
};

/**
 * Whether a saved analysis came from the current resume reader. `liveVersion`
 * is the reader the backend actually runs (null for one that predates version
 * reporting): an analysis it produced cannot be improved by uploading again.
 */
export function assessSavedResume(record: {
  created_at?: string | null;
  extracted_profile_json?: Pick<ResumeAnalysisResult, 'extraction'> | null;
} | null | undefined, liveVersion: string | null = CURRENT_RESUME_PARSER_VERSION): SavedResumeFreshness | null {
  if (!record?.extracted_profile_json) return null;
  const parserVersion = record.extracted_profile_json.extraction?.parser_version || null;
  return {
    stale: parserVersion !== CURRENT_RESUME_PARSER_VERSION && parserVersion !== liveVersion,
    analyzedAt: record.created_at || null,
    parserVersion,
  };
}

/** Problems reading the file (OCR, page limits) to show beside the extracted skills. */
export function extractionWarnings(analysis: Pick<ResumeAnalysisResult, 'extraction_warnings'> | null | undefined): string[] {
  return Array.from(new Set((analysis?.extraction_warnings || []).map((warning) => warning.trim()).filter(Boolean)));
}

export function staleResumeMessage(freshness: SavedResumeFreshness, fileAvailable: boolean): string {
  const when = freshness.analyzedAt ? ` on ${new Date(freshness.analyzedAt).toLocaleDateString()}` : '';
  const shown = `Your skills come from an older scan${when} that may have missed some.`;
  return fileAvailable
    ? `${shown} Re-scan your saved resume to catch them.`
    : `${shown} Upload your resume again to re-scan it.`;
}
