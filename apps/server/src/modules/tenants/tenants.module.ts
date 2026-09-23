import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController, TenantsSelfController } from './tenants.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TenantsController, TenantsSelfController],
  providers: [TenantsService]
})
export class TenantsModule {}
