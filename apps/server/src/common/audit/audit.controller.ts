import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from './audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth-user';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { paginationSchema } from '../validation/common.schemas';

const querySchema = paginationSchema.extend({
  resource: z.string().max(50).optional(),
  userId: z.string().uuid().optional(),
});

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('ADMIN')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(querySchema)) q: z.infer<typeof querySchema>) {
    return this.auditService.list(user.tenantId, { resource: q.resource, userId: q.userId }, q);
  }
}
