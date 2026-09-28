import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AiService } from './ai.service';
import { LeavesService } from '../leaves/leaves.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { RequiresPlan } from '../../common/decorators/plan.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { readValidatedFile } from '../../common/files/file-validation';

const chatSchema = z.object({ message: z.string().trim().min(1).max(1000) });

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
@RequiresPlan('ENTERPRISE')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly leaves: LeavesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('chat')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async chat(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(chatSchema)) dto: { message: string }) {
    const [employee, balances] = user.employeeId
      ? await Promise.all([
          this.prisma.employee.findFirst({ where: { id: user.employeeId, tenantId: user.tenantId }, select: { department: true } }),
          this.leaves.balance(user, undefined, new Date().getUTCFullYear()).catch(() => []),
        ])
      : [null, []];
    const reply = await this.ai.chat(dto.message, { name: user.name, role: user.role, department: employee?.department, leaveBalances: balances });
    return { reply };
  }

  /** Recruiter helper: extract structured details from a PDF resume. */
  @Post('parse-resume')
  @Roles('ADMIN', 'MANAGER')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async parseResume(@Req() req: FastifyRequest) {
    const file = await readValidatedFile(await req.file(), { allowed: ['application/pdf'], maxBytes: 5 * 1024 * 1024 });
    const text = await this.ai.extractText(file.buffer, file.mime);
    if (text.length < 50) throw new BadRequestException('Could not read text from this PDF (is it a scanned image?)');
    return this.ai.parseResume(text);
  }
}
