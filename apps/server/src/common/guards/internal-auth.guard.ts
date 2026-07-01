import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.headers['x-internal-secret'];
    const expectedSecret = this.configService.get<string>('INTERNAL_SERVICE_SECRET', 'super-secret-internal-key');
    
    if (secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }
    return true;
  }
}
