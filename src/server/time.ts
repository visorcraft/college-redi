const DAY_MS = 86_400_000;

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

export function localDateKey(at: Date, timeZone: string): string {
  const { year, month, day } = localParts(at, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

function startOfLocalDate(key: string, timeZone: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  const guess = Date.UTC(year!, month! - 1, day!);
  let low = guess - 36 * 60 * 60_000;
  let high = guess + 36 * 60 * 60_000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDateKey(new Date(mid), timeZone) < key) low = mid + 1;
    else high = mid;
  }
  return new Date(low);
}

export function zonedDayBounds(
  at: Date,
  timeZone: string,
  spanDays = 1,
): { date: string; start: Date; end: Date } {
  const date = localDateKey(at, timeZone);
  return zonedDateBounds(date, timeZone, spanDays);
}

export function zonedDateBounds(
  date: string,
  timeZone: string,
  spanDays = 1,
): { date: string; start: Date; end: Date } {
  return {
    date,
    start: startOfLocalDate(date, timeZone),
    end: startOfLocalDate(shiftDateKey(date, spanDays), timeZone),
  };
}

export function localDayOrdinal(at: Date, timeZone: string): number {
  const { year, month, day } = localParts(at, timeZone);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}
