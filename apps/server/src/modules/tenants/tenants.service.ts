import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async createTenant(dto: CreateTenantDto) {
    const slug = dto.slug || dto.name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, '');
    
    let row = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!row) {
      row = await this.prisma.tenant.create({ data: { name: dto.name, slug } });
    }
    
    return row;
  }

  async getTenantById(id: string) {
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Tenant not found');
    }
    return row;
  }

  async lookupTenant(identifier: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    
    let tenant = null;
    if (isUuid) {
      tenant = await this.prisma.tenant.findUnique({ where: { id: identifier } });
    }
    
    if (!tenant) {
      tenant = await this.prisma.tenant.findUnique({ where: { slug: identifier } });
    }
  
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
  
    return tenant;
  }
}
