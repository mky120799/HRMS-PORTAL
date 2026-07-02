import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID', 'MISSING'),
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET', 'MISSING'),
      callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL', 'http://localhost:3000/auth/google/callback'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { emails, displayName, photos, id } = profile;
    const email = emails?.[0]?.value;

    if (!email) {
      return done(new Error('No email provided by Google'), false);
    }

    try {
      // Look up user across all tenants matching this Google email
      let user = await this.prisma.user.findFirst({
        where: { email },
      });

      if (!user) {
        // Auto-provision: find the first tenant or create a default one
        const tenant = await this.prisma.tenant.findFirst();
        if (!tenant) {
        return done(new Error('No tenant configured. Please create an account first.'), false);
        }

        user = await this.prisma.user.create({
          data: {
            email,
            name: displayName,
            tenantId: tenant.id,
            passwordHash: '', // No password for SSO users
            role: 'EMPLOYEE',
          },
        });
        this.logger.log(`Auto-provisioned SSO user: ${email}`);
      }

      const { passwordHash, refreshToken: _, ...safeUser } = user;
      return done(null, safeUser);
    } catch (error: any) {
      this.logger.error(`Google SSO error: ${error.message}`);
      return done(error, false);
    }
  }
}
