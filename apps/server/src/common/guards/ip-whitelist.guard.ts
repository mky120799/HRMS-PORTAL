import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IpWhitelistGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    // If not authenticated or tenantId is missing, bypass check (handled by AuthGuard)
    if (!user || !user.tenantId) {
      return true;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { whitelistedIps: true },
    });

    if (tenant && tenant.whitelistedIps && tenant.whitelistedIps.length > 0) {
      // Get client IP address
      const clientIp = request.ip || request.connection.remoteAddress;
      
      // Basic check, you can use a library like 'ipaddr.js' for subnet matching
      if (!tenant.whitelistedIps.includes(clientIp)) {
        throw new ForbiddenException(`Access denied from IP: ${clientIp}`);
      }
    }

    return true;
  }
}
