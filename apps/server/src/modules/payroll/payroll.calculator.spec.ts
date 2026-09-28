import { calculatePayslip } from './payroll.calculator';

const base = { baseSalary: 30000, allowances: 10000, deductions: 200, monthlyTds: 1500, pfEnabled: true };

describe('calculatePayslip', () => {
  it('computes a full month', () => {
    const p = calculatePayslip(base, 30, 0);
    expect(p).toMatchObject({ payableDays: 30, grossPay: 40000, pfDeduction: 1800, tdsDeduction: 1500, otherDeductions: 200, deductions: 3500, netPay: 36500 });
  });

  it('caps PF at the statutory wage ceiling', () => {
    expect(calculatePayslip({ ...base, baseSalary: 100000 }, 30, 0).pfDeduction).toBe(1800);
    expect(calculatePayslip({ ...base, baseSalary: 10000 }, 30, 0).pfDeduction).toBe(1200);
  });

  it('skips PF when disabled', () => {
    expect(calculatePayslip({ ...base, pfEnabled: false }, 30, 0).pfDeduction).toBe(0);
  });

  it('pro-rates earnings for loss-of-pay days', () => {
    const p = calculatePayslip(base, 30, 3);
    expect(p.payableDays).toBe(27);
    expect(p.basicPay).toBe(27000);
    expect(p.allowances).toBe(9000);
    expect(p.grossPay).toBe(36000);
  });

  it('never produces floating-point money artefacts', () => {
    const p = calculatePayslip({ baseSalary: 10000.1, allowances: 0.2, deductions: 0.1, monthlyTds: 0, pfEnabled: false }, 31, 1);
    for (const v of [p.basicPay, p.allowances, p.grossPay, p.netPay]) {
      expect(Number.isInteger(Math.round(v * 100))).toBe(true);
      expect(v.toString()).not.toMatch(/\.\d{3,}/);
    }
  });

  it('clamps LOP to the month and zeroes tax for an unpaid month', () => {
    const p = calculatePayslip(base, 30, 45);
    expect(p.payableDays).toBe(0);
    expect(p.grossPay).toBe(0);
    expect(p.tdsDeduction).toBe(0);
  });

  it('caps net pay at zero and warns when deductions exceed gross', () => {
    const p = calculatePayslip({ ...base, deductions: 50000 }, 30, 0);
    expect(p.netPay).toBe(0);
    expect(p.warnings).toHaveLength(1);
  });
});
