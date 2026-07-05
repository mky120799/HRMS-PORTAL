import { Controller, Get, UseGuards, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GdprService } from './gdpr.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('gdpr')
export class GdprController {
  constructor(private readonly gdprService: GdprService) {}

  @Get('export')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 2, ttl: 3600000 } }) // Max 2 exports per hour
  async exportData(@Request() req: any, @Res() res: Response) {
    const data = await this.gdprService.exportUserData(req.user.tenantId, req.user.sub);
    
    // Set headers to trigger a file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=gdpr-export-${req.user.sub}.json`);
    
    return res.status(200).send(JSON.stringify(data, null, 2));
  }
}
