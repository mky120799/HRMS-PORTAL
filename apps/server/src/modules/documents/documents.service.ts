import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { can } from '../../common/auth/permissions';
import type { AuthUser } from '../../common/auth/auth-user';
import { DOCUMENT_MIME_TYPES, fieldValue, readValidatedFile } from '../../common/files/file-validation';
import { DOCUMENT_TYPES } from '../../common/constants/domain';
import { isoDate } from '../../common/validation/common.schemas';
import { parseDateOnly } from '../../common/utils/dates';

const MAX_BYTES = 10 * 1024 * 1024;
const metaSchema = z.object({
  title: z.string().trim().min(1).max(150),
  type: z.enum(DOCUMENT_TYPES).default('OTHER'),
  expiryDate: isoDate.optional(),
  employeeId: z.string().uuid().optional(),
});

const PUBLIC_FIELDS = { id: true, employeeId: true, title: true, type: true, mimeType: true, sizeBytes: true, expiryDate: true, createdAt: true } as const;

/**
 * Employee documents (IDs, contracts, certificates). Files live in private
 * object storage under tenants/<tenantId>/documents/ and are only ever
 * streamed through the authorised download endpoint.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  mine(user: AuthUser) {
    if (!user.employeeId) return [];
    return this.prisma.document.findMany({ where: { tenantId: user.tenantId, employeeId: user.employeeId }, select: PUBLIC_FIELDS, orderBy: { createdAt: 'desc' } });
  }

  async list(user: AuthUser, employeeId?: string) {
    const scope = can(user, 'documents.manage') ? {} : { employee: { managerId: user.employeeId ?? '__none__' } };
    return this.prisma.document.findMany({
      where: { tenantId: user.tenantId, ...scope, ...(employeeId ? { employeeId } : {}) },
      select: { ...PUBLIC_FIELDS, employee: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  expiring(tenantId: string, withinDays: number) {
    return this.prisma.document.findMany({
      where: { tenantId, expiryDate: { lte: new Date(Date.now() + withinDays * 86_400_000) }, employee: { status: { not: 'EXITED' } } },
      select: { ...PUBLIC_FIELDS, employee: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { expiryDate: 'asc' },
    });
  }

  async upload(user: AuthUser, part: MultipartFile | undefined) {
    const file = await readValidatedFile(part, { allowed: DOCUMENT_MIME_TYPES, maxBytes: MAX_BYTES });
    const meta = metaSchema.safeParse({
      title: fieldValue(part!, 'title'),
      type: fieldValue(part!, 'type') || undefined,
      expiryDate: fieldValue(part!, 'expiryDate') || undefined,
      employeeId: fieldValue(part!, 'employeeId') || undefined,
    });
    if (!meta.success) throw new BadRequestException({ message: 'Validation failed', errors: meta.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

    const employeeId = meta.data.employeeId ?? user.employeeId;
    if (!employeeId) throw new BadRequestException('Your account is not linked to an employee profile');
    if (employeeId !== user.employeeId && !can(user, 'documents.manage')) throw new ForbiddenException('Only document admins can upload documents for other employees');
    const employee = await this.prisma.employee.count({ where: { id: employeeId, tenantId: user.tenantId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const key = StorageService.tenantKey(user.tenantId, 'documents', employeeId, `${randomUUID()}.${file.ext}`);
    await this.storage.put(key, file.buffer, file.mime);
    return this.prisma.document.create({
      data: {
        tenantId: user.tenantId,
        employeeId,
        title: meta.data.title,
        type: meta.data.type,
        expiryDate: meta.data.expiryDate ? parseDateOnly(meta.data.expiryDate) : null,
        storageKey: key,
        mimeType: file.mime,
        sizeBytes: file.size,
        uploadedById: user.userId,
      },
      select: PUBLIC_FIELDS,
    });
  }

  async download(user: AuthUser, id: string) {
    const doc = await this.authorised(user, id);
    if (!doc.storageKey) throw new NotFoundException('This document has no file attached');
    const stream = await this.storage.getStream(doc.storageKey);
    const ext = doc.storageKey.split('.').pop();
    return { stream, mimeType: doc.mimeType ?? 'application/octet-stream', filename: `${doc.title.replace(/[^\w.-]+/g, '_')}.${ext}` };
  }

  async remove(user: AuthUser, id: string) {
    const doc = await this.authorised(user, id);
    await this.prisma.document.delete({ where: { id: doc.id } });
    if (doc.storageKey) await this.storage.delete(doc.storageKey);
    return { deleted: true };
  }

  /** Owner or tenant admin only. Returns 404 (not 403) for other tenants' ids to avoid confirming they exist. */
  private async authorised(user: AuthUser, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.employeeId !== user.employeeId && !can(user, 'documents.manage')) throw new ForbiddenException('You cannot access this document');
    return doc;
  }
}
