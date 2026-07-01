import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import PDFDocument from 'pdfkit';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as crypto from 'crypto';
import { PassThrough } from 'stream';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);
  private s3Client: S3Client | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    }
  }

  async updateSalaryStructure(tenantId: string, employeeId: string, dto: any) {
    return this.prisma.salaryStructure.upsert({
      where: { employeeId },
      update: { baseSalary: dto.baseSalary, allowances: dto.allowances, deductions: dto.deductions },
      create: { tenantId, employeeId, ...dto },
    });
  }

  async generatePayslip(tenantId: string, employeeId: string, month: number, year: number) {
    const salary = await this.prisma.salaryStructure.findUnique({
      where: { employeeId },
      include: { employee: true },
    });
    if (!salary) throw new BadRequestException('Salary structure not found');

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const attendance = await this.prisma.attendanceRecord.count({
      where: {
        employeeId,
        date: { gte: startDate, lte: endDate },
        status: 'PRESENT',
      },
    });

    const workingDays = endDate.getDate();
    const basicPay = (salary.baseSalary / workingDays) * attendance;
    const netPay = basicPay + salary.allowances - salary.deductions;

    const doc = new PDFDocument();
    const pass = new PassThrough();
    doc.pipe(pass);

    doc.fontSize(20).text('Payslip', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Employee: ${salary.employee.firstName} ${salary.employee.lastName}`);
    doc.text(`Month/Year: ${month}/${year}`);
    doc.moveDown();
    doc.text(`Present Days: ${attendance} / ${workingDays}`);
    doc.text(`Basic Pay: $${basicPay.toFixed(2)}`);
    doc.text(`Allowances: $${salary.allowances.toFixed(2)}`);
    doc.text(`Deductions: $${salary.deductions.toFixed(2)}`);
    doc.moveDown();
    doc.fontSize(16).text(`Net Pay: $${netPay.toFixed(2)}`, { underline: true });
    doc.end();

    let pdfUrl = null;
    if (this.s3Client) {
      const bucket = process.env.AWS_S3_BUCKET_NAME || 'hrms-production-bucket';
      const filename = `payslips/${employeeId}-${month}-${year}-${crypto.randomUUID()}.pdf`;
      try {
        const upload = new Upload({
          client: this.s3Client,
          params: { Bucket: bucket, Key: filename, Body: pass, ContentType: 'application/pdf' },
        });
        await upload.done();
        pdfUrl = `https://${bucket}.s3.amazonaws.com/${filename}`;
      } catch (err) {
        this.logger.error('Failed to upload payslip PDF to S3');
      }
    } else {
        pass.resume(); // consume stream
    }

    return this.prisma.payslip.create({
      data: {
        tenantId,
        employeeId,
        month,
        year,
        basicPay,
        allowances: salary.allowances,
        deductions: salary.deductions,
        netPay,
        pdfUrl,
      },
    });
  }

  async getMyPayslips(tenantId: string, userId: string) {
    const employee = await this.prisma.employee.findFirst({
        where: { userId, tenantId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.payslip.findMany({
      where: { tenantId, employeeId: employee.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }
}
