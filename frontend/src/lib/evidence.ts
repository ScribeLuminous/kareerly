export type EvidenceType = 'Certificate' | 'Course Completion' | 'Portfolio' | 'Project' | 'Training' | 'Other';

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
  status: 'Pending Verification' | 'Verified';
};

export type EvidenceDraft = Pick<EvidenceUploadRecord, 'title' | 'evidenceType' | 'relatedSkill' | 'category' | 'notes'> & { id?: string; file: File | null };

// Resume analysis is deliberately not an input to evidence creation.
export async function prepareEvidenceUpload(
  draft: EvidenceDraft,
  existing: EvidenceUploadRecord | undefined,
  validate: (file: File) => Promise<{ status: string; message: string }>,
): Promise<EvidenceUploadRecord> {
  const file = draft.file;
  if (draft.id && (!existing || existing.id !== draft.id)) throw new Error('Evidence record no longer exists.');
  if (!file && (!existing?.fileName || !existing.fileUrl)) throw new Error('Please upload a PDF evidence file before saving.');
  if (file) {
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) throw new Error('Only PDF evidence files are accepted.');
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Upload a non-empty PDF no larger than 5MB.');
    const result = await validate(file);
    if (result.status !== 'valid') throw new Error(result.message || 'PDF file validation failed.');
  }
  return {
    id: existing?.id || crypto.randomUUID(),
    title: draft.title.trim(), evidenceType: draft.evidenceType,
    relatedSkill: draft.relatedSkill.trim(), category: draft.category.trim() || 'Other',
    notes: draft.notes?.trim() || '',
    uploadedAt: file ? new Date().toISOString().slice(0, 10) : existing!.uploadedAt,
    fileName: file ? file.name : existing!.fileName,
    fileUrl: file ? URL.createObjectURL(file) : existing!.fileUrl,
    status: file ? 'Pending Verification' : existing!.status,
  };
}
