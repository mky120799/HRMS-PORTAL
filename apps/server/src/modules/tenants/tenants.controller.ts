import { Controller, Get, Post, Body, Param, UseGuards, UsePipes } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { createTenantSchema } from './dto/create-tenant.dto';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('internal/tenants')
@UseGuards(InternalAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createTenantSchema))
  async createTenant(@Body() dto: CreateTenantDto) {
    return this.tenantsService.createTenant(dto);
  }

  @Get(':id')
  async getTenantById(@Param('id') id: string) {
    return this.tenantsService.getTenantById(id);
  }

  @Get('lookup/:identifier')
  async lookupTenant(@Param('identifier') identifier: string) {
    return this.tenantsService.lookupTenant(identifier);
  }
}
