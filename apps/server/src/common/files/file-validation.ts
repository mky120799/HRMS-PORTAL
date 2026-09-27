import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';

/**
 * Content sniffing by magic bytes. The client-supplied Content-Type and file
 * extension are attacker-controlled, so we trust only the file signature.
 */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // DOCX is a ZIP container; we additionally require the declared extension.
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
];

export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export const RESUME_MIME_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export interface ValidatedFile {
  buffer: Buffer;
  mime: string;
  ext: string;
  originalName: string;
  size: number;
}

export async function readValidatedFile(
  part: MultipartFile | undefined,
  opts: { allowed: string[]; maxBytes: number },
): Promise<ValidatedFile> {
  if (!part) throw new BadRequestException('A file is required');

  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch (err: any) {
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE') throw new PayloadTooLargeException('File is too large');
    throw err;
  }
  if (buffer.length === 0) throw new BadRequestException('File is empty');
  if (buffer.length > opts.maxBytes) {
    throw new PayloadTooLargeException(`File exceeds ${Math.round(opts.maxBytes / 1024 / 1024)} MB`);
  }

  const originalName = (part.filename || 'file').slice(0, 200);
  const declaredExt = originalName.split('.').pop()?.toLowerCase();
  const match = SIGNATURES.find((s) => opts.allowed.includes(s.mime) && s.test(buffer) && (s.ext !== 'docx' || declaredExt === 'docx'));
  if (!match) throw new BadRequestException(`Unsupported file type. Allowed: ${opts.allowed.map((m) => m.split('/').pop()).join(', ')}`);

  return { buffer, mime: match.mime, ext: match.ext, originalName, size: buffer.length };
}

/** Reads a plain text multipart field value. */
export function fieldValue(part: MultipartFile, name: string): string | undefined {
  const field = (part.fields as Record<string, any>)[name];
  const value = Array.isArray(field) ? field[0]?.value : field?.value;
  return typeof value === 'string' ? value.trim() : undefined;
}
