import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('chat')
  async chat(@Request() req: any, @Body() body: { message: string }) {
    // Gather employee context to give the AI relevant information
    let leaveBalance: number | undefined;
    let department: string | undefined;

    if (req.user.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: req.user.employeeId },
        include: {
          leaves: {
            where: { status: 'APPROVED', type: 'ANNUAL' },
          },
        },
      });
      department = employee?.department ?? undefined;
      // Simple heuristic: 21 days annual leave limit - used days
      leaveBalance = 21 - (employee?.leaves?.length ?? 0);
    }

    const reply = await this.aiService.chat(body.message, {
      name: req.user.name,
      role: req.user.role,
      leaveBalance,
      department,
    });

    return { reply };
  }
}
