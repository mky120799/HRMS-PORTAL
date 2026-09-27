import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';

export interface GoogleIdentity {
  email: string;
}

/**
 * Only extracts a *verified* Google email. Account lookup happens in
 * AuthService.ssoLogin, scoped to the workspace named in the signed state.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') ?? 'not-configured',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') ?? 'not-configured',
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL') ?? 'http://localhost:3000/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) {
    const primary = profile.emails?.find((e) => (e as any).verified === true || (e as any).verified === 'true');
    if (!primary?.value) return done(null, false);
    return done(null, { email: primary.value.toLowerCase() } satisfies GoogleIdentity);
  }
}
