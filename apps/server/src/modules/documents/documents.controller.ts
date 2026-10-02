import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DocumentsService } from './documents.service';
import { CurrentUser, Permissions } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { RequiresPlan } from '../../common/decorators/plan.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

const listQuery = z.object({ employeeId: z.string().uuid().optional() });
const expiringQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
@RequiresPlan('BASIC')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.documents.mine(user);
  }

  @Get()
  @Permissions('documents.team.read')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.documents.list(user, q.employeeId);
  }

  @Get('expiring')
  @Permissions('documents.manage')
  expiring(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(expiringQuery)) q: z.infer<typeof expiringQuery>) {
    return this.documents.expiring(user.tenantId, q.days);
  }

  /** multipart/form-data: file (PDF/PNG/JPEG ≤ 10 MB), title, type, expiryDate?, employeeId? (admin only) */
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  async upload(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    return this.documents.upload(user, await req.file());
  }

  @Get(':id/download')
  async download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { stream, mimeType, filename } = await this.documents.download(user, id);
    return new StreamableFile(stream, { type: mimeType, disposition: `attachment; filename="${filename}"` });
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.remove(user, id);
  }
}
