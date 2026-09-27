/**
 * Calendar-date helpers. HR dates (leave days, attendance days, holidays) are
 * *calendar dates*, not instants, so they are stored as UTC midnight and all
 * arithmetic happens on 'YYYY-MM-DD' strings to avoid timezone drift.
 */

/** 'YYYY-MM-DD' → Date at UTC midnight. */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== d) throw new Error(`Invalid date: ${value}`);
  return date;
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in an IANA timezone, e.g. todayIn('Asia/Kolkata'). */
export function todayIn(timeZone: string, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Counts Mon–Fri days in [start, end] (inclusive) that are not holidays. */
export function countWorkingDays(start: Date, end: Date, holidays: Set<string> = new Set()): number {
  let count = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(toDateOnly(d))) count++;
  }
  return count;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month - 1, daysInMonth(year, month))) };
}

/** Intersection of two inclusive date ranges, or null. */
export function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): { start: Date; end: Date } | null {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return start <= end ? { start, end } : null;
}
