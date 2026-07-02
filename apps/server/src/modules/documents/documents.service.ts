import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async getMyDocuments(tenantId: string, employeeId: string) {
    return this.prisma.document.findMany({
      where: { tenantId, employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllDocuments(tenantId: string) {
    return this.prisma.document.findMany({
      where: { tenantId },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDocument(data: { tenantId: string; employeeId: string; title: string; type: string; fileUrl: string; expiryDate?: Date }) {
    return this.prisma.document.create({
      data: {
        tenantId: data.tenantId,
        employeeId: data.employeeId,
        title: data.title,
        type: data.type,
        fileUrl: data.fileUrl,
        expiryDate: data.expiryDate,
      },
    });
  }

  async deleteDocument(id: string, tenantId: string) {
    return this.prisma.document.delete({
      where: { id, tenantId },
    });
  }
}
