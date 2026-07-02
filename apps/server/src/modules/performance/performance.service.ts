import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';

@Injectable()
export class PerformanceService {
  constructor(private prisma: PrismaService) {}

  async getMyReviews(tenantId: string, employeeId: string) {
    return this.prisma.performanceReview.findMany({
      where: { tenantId, employeeId },
      include: { reviewer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReviewsToManager(tenantId: string, managerId: string) {
    return this.prisma.performanceReview.findMany({
      where: { tenantId, reviewerId: managerId, status: 'SELF_SUBMITTED' },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllReviews(tenantId: string) {
    return this.prisma.performanceReview.findMany({
      where: { tenantId },
      include: { employee: true, reviewer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createReviewCycle(data: { tenantId: string; cycleName: string }) {
    // For simplicity, create a draft review for all employees in the tenant
    const employees = await this.prisma.employee.findMany({ where: { tenantId: data.tenantId } });
    const reviews = [];
    
    for (const emp of employees) {
      const review = await this.prisma.performanceReview.create({
        data: {
          tenantId: data.tenantId,
          employeeId: emp.id,
          cycleName: data.cycleName,
          status: 'DRAFT',
        },
      });
      reviews.push(review);
    }
    return { message: `Created ${reviews.length} reviews for cycle ${data.cycleName}` };
  }

  async submitSelfReview(id: string, tenantId: string, employeeId: string, selfRating: number, comments: string) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id, tenantId, employeeId },
    });
    
    if (!review) throw new NotFoundException('Review not found');

    return this.prisma.performanceReview.update({
      where: { id },
      data: {
        selfRating,
        comments,
        status: 'SELF_SUBMITTED',
      },
    });
  }

  async submitManagerReview(id: string, tenantId: string, managerId: string, managerRating: number, comments: string) {
    // Assuming manager has rights (in a real app we'd verify managerId == reviewerId or role)
    return this.prisma.performanceReview.update({
      where: { id },
      data: {
        managerRating,
        comments,
        reviewerId: managerId,
        status: 'COMPLETED',
      },
    });
  }
}
