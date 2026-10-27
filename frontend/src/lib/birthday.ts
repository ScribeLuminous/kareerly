export const MIN_SIGNUP_AGE = 18;

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Latest allowed birthday for someone at least `minAge` years old today, in local time,
// as YYYY-MM-DD for <input type="date" max>. With no age it is today, so the year
// picker stops at the current year.
export function maxBirthdayDate(minAge = 0, today: Date = new Date()): string {
  const latest = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
  // Feb 29 in a non-leap year rolls into March; step back to Feb 28 instead.
  if (latest.getMonth() !== today.getMonth()) latest.setDate(0);
  return toDateInputValue(latest);
}

// True when a YYYY-MM-DD birthday makes the person at least `minAge` years old today.
export function isOldEnough(birthday: string, minAge = MIN_SIGNUP_AGE, today: Date = new Date()): boolean {
  return birthday <= maxBirthdayDate(minAge, today);
}
