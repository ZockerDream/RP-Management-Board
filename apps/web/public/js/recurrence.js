const parseDate = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export function occursOn(start, frequency, interval, date) {
  if (date < start) return false;
  if (frequency === 'none') return date === start;

  const origin = parseDate(start);
  const candidate = parseDate(date);
  const count = Math.max(1, Number(interval) || 1);
  const days = (candidate - origin) / 86400000;

  if (frequency === 'daily' || frequency === 'custom') return days % count === 0;
  if (frequency === 'weekly') {
    return candidate.getUTCDay() === origin.getUTCDay() && Math.floor(days / 7) % count === 0;
  }
  if (frequency === 'monthly') {
    const months = (candidate.getUTCFullYear() - origin.getUTCFullYear()) * 12
      + candidate.getUTCMonth() - origin.getUTCMonth();
    return months % count === 0
      && candidate.getUTCDate() === Math.min(origin.getUTCDate(), daysInMonth(candidate.getUTCFullYear(), candidate.getUTCMonth()));
  }
  if (frequency === 'yearly') {
    const years = candidate.getUTCFullYear() - origin.getUTCFullYear();
    return years % count === 0
      && candidate.getUTCMonth() === origin.getUTCMonth()
      && candidate.getUTCDate() === Math.min(origin.getUTCDate(), daysInMonth(candidate.getUTCFullYear(), candidate.getUTCMonth()));
  }
  return date === start;
}
