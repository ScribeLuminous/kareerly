// Certificates and proof, saved per user in Supabase so they survive a reload and
// follow the candidate across devices. Table: candidate_evidence (migration
// 20261028150000_candidate_evidence.sql). The PDF file itself is not stored: a
// saved PDF record keeps its file name only, so it has no fileUrl after a reload.
import type { CredentialLinkCheck, EvidenceType, EvidenceUploadRecord } from './evidence';
import { supabase } from './supabase';

type EvidenceRow = {
  id: string;
  title: string;
  evidence_type: string;
  related_skill: string | null;
  category: string | null;
  notes: string | null;
  file_name: string | null;
  credential_url: string | null;
  credential_provider: string | null;
  credential_status: string | null;
  badge_name: string | null;
  issuer: string | null;
  status: string;
  uploaded_at: string;
};

const COLUMNS = 'id,title,evidence_type,related_skill,category,notes,file_name,credential_url,credential_provider,credential_status,badge_name,issuer,status,uploaded_at';
const LINK_STATUSES: CredentialLinkCheck['status'][] = ['verified', 'unreachable', 'not_checked'];

export function evidenceToRow(userId: string, record: EvidenceUploadRecord) {
  return {
    id: record.id,
    user_id: userId,
    title: record.title,
    evidence_type: record.evidenceType,
    related_skill: record.relatedSkill || '',
    category: record.category || 'Other',
    notes: record.notes || '',
    file_name: record.fileName || null,
    credential_url: record.credentialUrl || null,
    credential_provider: record.credentialProvider || null,
    credential_status: record.credentialStatus && LINK_STATUSES.includes(record.credentialStatus) ? record.credentialStatus : null,
    badge_name: record.badgeName || null,
    issuer: record.issuer || null,
    status: record.status,
    uploaded_at: record.uploadedAt,
  };
}

export function rowToEvidence(row: EvidenceRow): EvidenceUploadRecord {
  return {
    id: row.id,
    title: row.title,
    evidenceType: row.evidence_type as EvidenceType,
    relatedSkill: row.related_skill || '',
    category: row.category || 'Other',
    uploadedAt: row.uploaded_at,
    notes: row.notes || '',
    fileName: row.file_name || undefined,
    credentialUrl: row.credential_url || undefined,
    credentialProvider: row.credential_provider || undefined,
    credentialStatus: LINK_STATUSES.includes(row.credential_status as CredentialLinkCheck['status']) ? row.credential_status as CredentialLinkCheck['status'] : undefined,
    badgeName: row.badge_name || undefined,
    issuer: row.issuer || undefined,
    status: row.status === 'Verified' ? 'Verified' : 'Pending Verification',
  };
}

/** Every record saved for this user, newest first. Throws when they cannot be read, so a failure is never mistaken for "nothing saved". */
export async function loadEvidence(userId: string): Promise<EvidenceUploadRecord[]> {
  const { data, error } = await supabase.from('candidate_evidence').select(COLUMNS).eq('user_id', userId).order('uploaded_at', { ascending: false });
  if (error) throw new Error(`Unable to load your saved certificates: ${error.message}`);
  return ((data || []) as EvidenceRow[]).map(rowToEvidence);
}

export async function saveEvidence(userId: string, record: EvidenceUploadRecord): Promise<void> {
  const { error } = await supabase.from('candidate_evidence').upsert(evidenceToRow(userId, record), { onConflict: 'id' });
  if (error) throw new Error(`Unable to save your certificate: ${error.message}`);
}

export async function deleteEvidence(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('candidate_evidence').delete().eq('user_id', userId).eq('id', id);
  if (error) throw new Error(`Unable to delete your certificate: ${error.message}`);
}
