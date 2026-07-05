import { Injectable, BadRequestException } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TwoFactorAuthService {
  constructor(private prisma: PrismaService) {}

  public async generateTwoFactorAuthenticationSecret(user: any) {
    const secret = authenticator.generateSecret();
    const appName = process.env.APP_NAME || 'HRMS Enterprise';
    
    // Create the otpauth:// URI
    const otpauthUrl = authenticator.keyuri(user.email, appName, secret);

    // Update user in DB with secret (but do not enable it yet)
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: secret,
      },
    });

    return {
      secret,
      otpauthUrl,
    };
  }

  public async generateQrCodeDataURL(otpAuthUrl: string) {
    return qrcode.toDataURL(otpAuthUrl);
  }

  public async isTwoFactorAuthenticationCodeValid(twoFactorAuthenticationCode: string, user: any) {
    if (!user.twoFactorSecret) {
      throw new BadRequestException('2FA is not configured for this user');
    }
    return authenticator.verify({
      token: twoFactorAuthenticationCode,
      secret: user.twoFactorSecret,
    });
  }

  public async turnOnTwoFactorAuthentication(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isTwoFactorEnabled: true,
      },
    });
  }
}
