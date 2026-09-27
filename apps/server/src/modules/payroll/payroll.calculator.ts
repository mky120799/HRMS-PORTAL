/**
 * Pure payroll maths — no I/O, fully unit-tested.
 *
 * All amounts are MONTHLY and handled in integer paise/cents internally, so
 * there is no floating-point drift (0.1 + 0.2 problems) in money.
 *
 * Model (India-oriented defaults, configurable per employee):
 *  - Loss of pay (LOP): unpaid-leave days pro-rate basic and allowances by calendar days.
 *  - Provident Fund: 12% of earned basic, on a wage ceiling of 15,000 (statutory
 *    minimum; employers may opt to contribute on higher wages — out of scope).
 *  - Income tax (TDS): NOT computed here. Tax depends on regime, declarations and
 *    projections; payroll admins enter the monthly TDS from their tax computation.
 *  - Other deductions: fixed monthly amount (e.g. professional tax, loan EMI).
 */
export const PF_RATE = 0.12;
export const PF_WAGE_CEILING = 15_000;

export interface SalaryInput {
  baseSalary: number;
  allowances: number;
  deductions: number;
  monthlyTds: number;
  pfEnabled: boolean;
}

export interface PayslipFigures {
  payableDays: number;
  lopDays: number;
  basicPay: number;
  allowances: number;
  grossPay: number;
  pfDeduction: number;
  tdsDeduction: number;
  otherDeductions: number;
  deductions: number;
  netPay: number;
  warnings: string[];
}

const toMinor = (amount: number) => Math.round(amount * 100);
const toMajor = (minor: number) => minor / 100;

export function calculatePayslip(salary: SalaryInput, calendarDays: number, lopDays: number): PayslipFigures {
  if (calendarDays <= 0) throw new Error('calendarDays must be positive');
  const lop = Math.min(Math.max(lopDays, 0), calendarDays);
  const payableDays = calendarDays - lop;
  const ratio = payableDays / calendarDays;
  const warnings: string[] = [];

  const basic = Math.round(toMinor(salary.baseSalary) * ratio);
  const allowances = Math.round(toMinor(salary.allowances) * ratio);
  const gross = basic + allowances;

  const pf = salary.pfEnabled ? Math.round(Math.min(basic, toMinor(PF_WAGE_CEILING)) * PF_RATE) : 0;
  const tds = payableDays > 0 ? toMinor(salary.monthlyTds) : 0;
  const other = toMinor(salary.deductions);
  let total = pf + tds + other;

  if (total > gross) {
    warnings.push('Deductions exceed gross pay; net pay capped at zero — review this employee.');
    total = gross;
  }

  return {
    payableDays,
    lopDays: lop,
    basicPay: toMajor(basic),
    allowances: toMajor(allowances),
    grossPay: toMajor(gross),
    pfDeduction: toMajor(pf),
    tdsDeduction: toMajor(tds),
    otherDeductions: toMajor(other),
    deductions: toMajor(total),
    netPay: toMajor(gross - total),
    warnings,
  };
}
