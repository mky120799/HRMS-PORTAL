import { ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';

/** Starts/finishes the Google OAuth dance, forwarding the signed workspace state. */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!this.config.get('GOOGLE_CLIENT_ID')) throw new ServiceUnavailableException('Google sign-in is not configured');
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.query?.tenant) {
      return { state: this.auth.createSsoState(String(req.query.tenant)), prompt: 'select_account', session: false };
    }
    return { session: false };
  }

  handleRequest<T>(err: unknown, user: T): T {
    // Let the controller redirect with a friendly error instead of a raw 401 page.
    return (err || !user ? null : user) as T;
  }
}
