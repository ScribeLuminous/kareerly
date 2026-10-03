/** A Philippine mobile number is 11 digits (09XX XXX XXXX). */
export const CONTACT_NUMBER_DIGITS = 11;

/** Digits only, cut to the 11 a contact number can have. Pasted dashes and spaces are dropped, not counted. */
export function contactNumberInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, CONTACT_NUMBER_DIGITS);
}
