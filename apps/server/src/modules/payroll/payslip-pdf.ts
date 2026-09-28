import PDFDocument from 'pdfkit';

export interface PayslipPdfData {
  companyName: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  month: number;
  year: number;
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
}

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Renders a payslip PDF in memory (no temp files, nothing written to disk). */
export function renderPayslipPdf(d: PayslipPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Payslip ${MONTHS[d.month - 1]} ${d.year}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(d.companyName, { align: 'left' });
    doc.fontSize(12).fillColor('#555').text(`Payslip for ${MONTHS[d.month - 1]} ${d.year}`).moveDown();
    doc.fillColor('#000').fontSize(10);
    doc.text(`Employee: ${d.employeeName}${d.employeeCode ? ` (${d.employeeCode})` : ''}`);
    if (d.designation || d.department) doc.text(`Role: ${[d.designation, d.department].filter(Boolean).join(', ')}`);
    doc.text(`Payable days: ${d.payableDays}   Loss-of-pay days: ${d.lopDays}`).moveDown();

    const row = (label: string, value: number, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 50, y, { width: 300 });
      doc.text(fmt(value), 350, y, { width: 190, align: 'right' });
      doc.moveDown(0.4);
    };
    doc.font('Helvetica-Bold').text('Earnings').moveDown(0.3);
    row('Basic', d.basicPay);
    row('Allowances', d.allowances);
    row('Gross earnings', d.grossPay, true);
    doc.moveDown(0.5).font('Helvetica-Bold').text('Deductions', 50).moveDown(0.3);
    row('Provident Fund', d.pfDeduction);
    row('Income tax (TDS)', d.tdsDeduction);
    row('Other deductions', d.otherDeductions);
    row('Total deductions', d.deductions, true);
    doc.moveDown();
    row('NET PAY', d.netPay, true);
    doc.moveDown(2).font('Helvetica').fontSize(8).fillColor('#777').text('This is a system-generated payslip and does not require a signature.', 50);
    doc.end();
  });
}
