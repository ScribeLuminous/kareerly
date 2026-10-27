// Latest allowed birthday: today, in local time, as YYYY-MM-DD for <input type="date" max>.
// Keeps the year picker capped at the current year so future dates can't be chosen.
export function maxBirthdayDate(today: Date = new Date()): string {
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
