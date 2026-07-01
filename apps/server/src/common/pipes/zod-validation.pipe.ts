import { PipeTransform, BadRequestException, ArgumentMetadata, Injectable } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body') {
      return value;
    }
    const parsedValue = this.schema.safeParse(value);
    if (!parsedValue.success) {
      throw new BadRequestException(parsedValue.error.errors);
    }
    return parsedValue.data;
  }
}
