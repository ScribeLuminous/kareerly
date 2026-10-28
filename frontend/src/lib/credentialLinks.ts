import { authenticatedRequest } from './api';
import type { CredentialLinkCheck } from './evidence';

/** Cleans up a certificate link and, for Credly, asks the backend whether it points to a real badge. */
export async function checkCredentialLink(url: string, candidateName = ''): Promise<CredentialLinkCheck> {
  return authenticatedRequest(
    '/api/candidate/credential-links/check',
    { method: 'POST', body: JSON.stringify({ url, candidate_name: candidateName }) },
    'Unable to check the certificate link right now. Please try again.',
  ) as Promise<CredentialLinkCheck>;
}

/** How a saved link's check reads to the candidate. */
export function credentialStatusLabel(status: CredentialLinkCheck['status'] | undefined, provider = ''): string {
  if (status === 'verified') return `${provider || 'Credly'} badge found`;
  if (status === 'unreachable') return 'Link saved, not checked';
  if (status === 'not_checked') return `${provider || 'Link'} link, not checked`;
  return '';
}
