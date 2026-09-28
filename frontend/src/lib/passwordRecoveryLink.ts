// Reads what a password-reset email link brought back in the URL. Supabase
// either signs the user in (#access_token…&type=recovery, or ?code= with PKCE),
// hands over a one-time token for the app to verify (?token_hash=…&type=recovery),
// or reports why the link failed (#error=access_denied&error_code=otp_expired…).

export const PASSWORD_RESET_PATH = '/reset-password';

export type RecoveryLink =
  | { kind: 'none' }
  | { kind: 'session' }
  | { kind: 'token'; tokenHash: string }
  | { kind: 'error'; code: string; description: string };

export function parseRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href);
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.replace(/^#/, '')).forEach((value, key) => params.set(key, value));

  const errorCode = params.get('error_code') || params.get('error');
  const onResetPage = url.pathname === PASSWORD_RESET_PATH;
  const isRecovery = onResetPage || params.get('type') === 'recovery';

  if (errorCode && (isRecovery || params.get('error_description'))) {
    return { kind: 'error', code: errorCode, description: params.get('error_description') || '' };
  }
  if (!isRecovery) return { kind: 'none' };

  const tokenHash = params.get('token_hash');
  if (tokenHash) return { kind: 'token', tokenHash };
  return { kind: 'session' };
}

export function describeRecoveryError(code: string): string {
  if (code === 'otp_expired') {
    return 'This reset link has expired or was already used. Each link works once, and only the newest email is valid. Request a new link below.';
  }
  return 'This reset link is not valid. Request a new link below.';
}

// Captured when the app loads, before the auth client clears the token from the URL.
export const initialRecoveryLink: RecoveryLink =
  typeof window === 'undefined' ? { kind: 'none' } : parseRecoveryLink(window.location.href);
