// The sign-up rule, enforced by the form's `pattern` and shown as a checklist.
export const STRONG_PASSWORD_PATTERN = '^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{14,}$';

/** The same rule for every new password: sign-up, reset and the account pages. */
export const STRONG_PASSWORD_MESSAGE =
  'Use at least 14 characters, with an uppercase letter, a number and a symbol.';

export function isStrongPassword(value: string): boolean {
  return new RegExp(STRONG_PASSWORD_PATTERN).test(value);
}
