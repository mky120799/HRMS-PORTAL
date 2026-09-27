import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, RequestMeta } from './auth.service';
import { GoogleAuthGuard } from './google-auth.guard';
import type { GoogleIdentity } from './strategies/google.strategy';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { EmployeeLimitGuard } from '../../common/guards/employee-limit.guard';
import {
  changePasswordSchema,
  inviteSchema,
  loginSchema,
  refreshSchema,
  resetRequestSchema,
  setPasswordSchema,
  signupSchema,
  ssoExchangeSchema,
  twoFactorCodeSchema,
  twoFactorLoginSchema,
  type ChangePasswordDto,
  type InviteDto,
  type LoginDto,
  type ResetRequestDto,
  type SetPasswordDto,
  type SignupDto,
} from './dto/auth.dto';

const meta = (req: FastifyRequest): RequestMeta => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signup(@Body(new ZodValidationPipe(signupSchema)) dto: SignupDto, @Req() req: FastifyRequest) {
    return this.auth.signup(dto, meta(req));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(STRICT)
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto, @Req() req: FastifyRequest) {
    return this.auth.login(dto, meta(req));
  }

  @Public()
  @Post('2fa/authenticate')
  @HttpCode(200)
  @Throttle(STRICT)
  authenticateTwoFactor(@Body(new ZodValidationPipe(twoFactorLoginSchema)) dto: { tempToken: string; code: string }, @Req() req: FastifyRequest) {
    return this.auth.completeTwoFactorLogin(dto.tempToken, dto.code, meta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: { refreshToken: string }) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.userId);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(200)
  @Throttle(STRICT)
  changePassword(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto);
  }

  // ─── Invitations & password reset ──────────────────────────────────────────

  @ApiBearerAuth()
  @Post('invite')
  @Roles('ADMIN')
  @UseGuards(EmployeeLimitGuard)
  invite(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(inviteSchema)) dto: InviteDto) {
    return this.auth.invite(user, dto);
  }

  @Public()
  @Post('accept-invite')
  @HttpCode(200)
  @Throttle(STRICT)
  acceptInvite(@Body(new ZodValidationPipe(setPasswordSchema)) dto: SetPasswordDto) {
    return this.auth.setPasswordWithToken('invite', dto.token, dto.password);
  }

  @Public()
  @Post('reset-password-request')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestReset(@Body(new ZodValidationPipe(resetRequestSchema)) dto: ResetRequestDto) {
    return this.auth.requestPasswordReset(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle(STRICT)
  resetPassword(@Body(new ZodValidationPipe(setPasswordSchema)) dto: SetPasswordDto) {
    return this.auth.setPasswordWithToken('reset', dto.token, dto.password);
  }

  // ─── 2FA management ────────────────────────────────────────────────────────

  @ApiBearerAuth()
  @Post('2fa/generate')
  generateTwoFactor(@CurrentUser() user: AuthUser) {
    return this.auth.beginTwoFactor(user.userId);
  }

  @ApiBearerAuth()
  @Post('2fa/turn-on')
  @HttpCode(200)
  @Throttle(STRICT)
  enableTwoFactor(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(twoFactorCodeSchema)) dto: { code: string }) {
    return this.auth.enableTwoFactor(user.userId, dto.code);
  }

  @ApiBearerAuth()
  @Post('2fa/turn-off')
  @HttpCode(200)
  @Throttle(STRICT)
  disableTwoFactor(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(twoFactorCodeSchema)) dto: { code: string }) {
    return this.auth.disableTwoFactor(user.userId, dto.code);
  }

  // ─── Google SSO ────────────────────────────────────────────────────────────

  /** GET /auth/google?tenant=<workspace-slug> */
  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    // Passport redirects to Google.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: FastifyRequest & { user?: GoogleIdentity | null }, @Query('state') state: string, @Res() reply: FastifyReply) {
    const frontend = this.config.get<string>('FRONTEND_URL');
    try {
      if (!req.user) throw new Error('google_failed');
      const tenant = this.auth.readSsoState(state);
      const code = await this.auth.ssoLogin(tenant, req.user.email);
      return reply.redirect(`${frontend}/auth/callback?code=${encodeURIComponent(code)}`, 302);
    } catch {
      return reply.redirect(`${frontend}/login?error=sso_failed`, 302);
    }
  }

  @Public()
  @Post('sso/exchange')
  @HttpCode(200)
  @Throttle(STRICT)
  exchangeSso(@Body(new ZodValidationPipe(ssoExchangeSchema)) dto: { code: string }, @Req() req: FastifyRequest) {
    return this.auth.exchangeSsoCode(dto.code, meta(req));
  }
}
