import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { TenantDemoSeederService } from './tenant-demo-seeder.service';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, TenantDemoSeederService],
  exports: [TenantsService],
})
export class TenantsModule {}
