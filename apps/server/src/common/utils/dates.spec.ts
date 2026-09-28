import { countWorkingDays, daysInMonth, overlap, parseDateOnly, todayIn, toDateOnly } from './dates';

describe('dates', () => {
  it('parses and formats calendar dates without timezone drift', () => {
    expect(toDateOnly(parseDateOnly('2026-03-31'))).toBe('2026-03-31');
    expect(() => parseDateOnly('2026-02-30')).toThrow();
  });

  it('counts working days excluding weekends and holidays', () => {
    // Mon 5 Jan 2026 .. Sun 11 Jan 2026
    expect(countWorkingDays(parseDateOnly('2026-01-05'), parseDateOnly('2026-01-11'))).toBe(5);
    expect(countWorkingDays(parseDateOnly('2026-01-05'), parseDateOnly('2026-01-11'), new Set(['2026-01-06']))).toBe(4);
    expect(countWorkingDays(parseDateOnly('2026-01-10'), parseDateOnly('2026-01-11'))).toBe(0);
  });

  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('resolves "today" in the tenant timezone', () => {
    const instant = new Date('2026-01-01T20:00:00Z'); // 01:30 on Jan 2 in India
    expect(todayIn('Asia/Kolkata', instant)).toBe('2026-01-02');
    expect(todayIn('America/New_York', instant)).toBe('2026-01-01');
  });

  it('intersects date ranges', () => {
    const r = overlap(parseDateOnly('2026-01-28'), parseDateOnly('2026-02-03'), parseDateOnly('2026-02-01'), parseDateOnly('2026-02-28'));
    expect(r && toDateOnly(r.start)).toBe('2026-02-01');
    expect(overlap(parseDateOnly('2026-01-01'), parseDateOnly('2026-01-02'), parseDateOnly('2026-02-01'), parseDateOnly('2026-02-02'))).toBeNull();
  });
});
