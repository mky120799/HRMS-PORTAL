import { Global, Module } from '@nestjs/common';
import { RateLimitStorage } from './rate-limit.storage';

@Global()
@Module({
  providers: [RateLimitStorage],
  exports: [RateLimitStorage],
})
export class RateLimitModule {}
