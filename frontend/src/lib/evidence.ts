export type EvidenceType = 'Certificate' | 'Course Completion' | 'Portfolio' | 'Project' | 'Training' | 'Other';

/** What the backend found when it checked a certificate link (services/credential_links.py). */
export type CredentialLinkCheck = {
  /** verified: a real Credly badge page was read. not_checked: another provider, saved as a plain link. unreachable: Credly could not be reached, saved unchecked. not_found and invalid are refused. */
  status: 'verified' | 'not_found' | 'unreachable' | 'not_checked' | 'invalid';
  url: string;
  provider: string;
  message: string;
  badge_name?: string;
  issuer?: string;
  recipient?: string;
  /** The badge names the signed-in candidate as its recipient. */
  recipient_match?: boolean;
};

export type EvidenceUploadRecord = {
  id: string;
  title: string;
  evidenceType: EvidenceType;
  relatedSkill: string;
  category: string;
  uploadedAt: string;
  notes?: string;
  fileName?: string;
  fileUrl?: string;
  /** A link to the certificate or badge (for example on Credly), instead of or beside a PDF. */
  credentialUrl?: string;
  credentialProvider?: string;
  /** Whether the link was checked; "verified" means a real badge page exists, not that it belongs to the candidate. */
  credentialStatus?: CredentialLinkCheck['status'];
  badgeName?: string;
  issuer?: string;
  status: 'Pending Verification' | 'Verified';
};

export type EvidenceDraft = Pick<EvidenceUploadRecord, 'title' | 'evidenceType' | 'relatedSkill' | 'category' | 'notes'> & {
  id?: string;
  file: File | null;
  /** The link as typed; it must come with the result of checking it. */
  credentialUrl?: string;
  credentialCheck?: CredentialLinkCheck;
};

// Resume analysis is deliberately not an input to evidence creation.
export async function prepareEvidenceUpload(
  draft: EvidenceDraft,
  existing: EvidenceUploadRecord | undefined,
  validate: (file: File) => Promise<{ status: string; message: string }>,
): Promise<EvidenceUploadRecord> {
  const file = draft.file;
  if (draft.id && (!existing || existing.id !== draft.id)) throw new Error('Evidence record no longer exists.');
  const typedLink = (draft.credentialUrl || '').trim();
  const check = draft.credentialCheck;
  if (typedLink) {
    // A link is only kept once it has been checked, and never when the check refused it.
    if (!check) throw new Error('The certificate link could not be checked. Please try again.');
    if (check.status === 'invalid' || check.status === 'not_found') throw new Error(check.message || 'That certificate link does not point to a real badge.');
  }
  const hasExistingProof = Boolean(existing && ((existing.fileName && existing.fileUrl) || existing.credentialUrl));
  if (!file && !typedLink && !hasExistingProof) throw new Error('Please upload a PDF evidence file or add a certificate link before saving.');
  if (file) {
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) throw new Error('Only PDF evidence files are accepted.');
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Upload a non-empty PDF no larger than 5MB.');
    const result = await validate(file);
    if (result.status !== 'valid') throw new Error(result.message || 'PDF file validation failed.');
  }
  // A Credly badge page that names this candidate is the one case checked without a reviewer.
  // A PDF uploaded beside the link has not been checked, so it keeps the record pending.
  const autoVerified = Boolean(typedLink && !file && check?.status === 'verified' && check.recipient_match);
  return {
    id: existing?.id || crypto.randomUUID(),
    title: draft.title.trim(), evidenceType: draft.evidenceType,
    relatedSkill: draft.relatedSkill.trim(), category: draft.category.trim() || 'Other',
    notes: draft.notes?.trim() || '',
    uploadedAt: file || typedLink ? new Date().toISOString().slice(0, 10) : existing!.uploadedAt,
    fileName: file ? file.name : existing?.fileName,
    fileUrl: file ? URL.createObjectURL(file) : existing?.fileUrl,
    ...(typedLink && check
      ? { credentialUrl: check.url, credentialProvider: check.provider, credentialStatus: check.status, badgeName: check.badge_name || undefined, issuer: check.issuer || undefined }
      : { credentialUrl: existing?.credentialUrl, credentialProvider: existing?.credentialProvider, credentialStatus: existing?.credentialStatus, badgeName: existing?.badgeName, issuer: existing?.issuer }),
    status: autoVerified ? 'Verified' : file || typedLink ? 'Pending Verification' : existing!.status,
  };
}
