import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, RequestMeta } from './auth.service';
import { OidcAuthService, type SsoStart } from './oidc-auth.service';
import { SamlAuthService } from './saml-auth.service';
import { CurrentUser, Permissions, Public, RequireStepUp } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import {
  clearRefreshCookie,
  clearSsoNonceCookie,
  readCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
  setSsoNonceCookie,
  SSO_NONCE_COOKIE,
} from '../../common/auth/cookies';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { EmployeeLimitGuard } from '../../common/guards/employee-limit.guard';
import {
  changePasswordSchema,
  inviteSchema,
  loginSchema,
  mfaEnrollmentCompleteSchema,
  mfaEnrollmentStartSchema,
  refreshSchema,
  resetRequestSchema,
  setPasswordSchema,
  signupSchema,
  ssoExchangeSchema,
  stepUpSchema,
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
  private readonly secureCookies: boolean;
  private readonly frontendUrl: string;

  constructor(
    private readonly auth: AuthService,
    private readonly oidc: OidcAuthService,
    private readonly saml: SamlAuthService,
    config: ConfigService,
  ) {
    this.secureCookies = config.get<string>('NODE_ENV') === 'production';
    this.frontendUrl = config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
  }

  /**
   * Responses that start or rotate a session put the refresh token in an
   * httpOnly cookie and remove it from the JSON body, so script on the page
   * (including injected script) never sees it. Other results pass through.
   */
  private session<T>(reply: FastifyReply, result: T): T | Omit<T, 'refreshToken' | 'refreshTokenExpiresAt'> {
    if (!result || typeof result !== 'object' || !('refreshToken' in result)) return result;
    const { refreshToken, refreshTokenExpiresAt, ...body } = result as T & { refreshToken: string; refreshTokenExpiresAt: Date };
    const maxAge = Math.max(0, Math.floor((new Date(refreshTokenExpiresAt).getTime() - Date.now()) / 1000));
    setRefreshCookie(reply, refreshToken, maxAge, this.secureCookies);
    return body;
  }

  private ssoRedirect(reply: FastifyReply, start: SsoStart) {
    setSsoNonceCookie(reply, start.browserNonce);
    return reply.redirect(start.url, 302);
  }

  private ssoDone(reply: FastifyReply, exchangeCode: string) {
    clearSsoNonceCookie(reply);
    return reply.redirect(`${this.frontendUrl}/auth/callback?code=${encodeURIComponent(exchangeCode)}`, 302);
  }

  private ssoFailed(reply: FastifyReply) {
    clearSsoNonceCookie(reply);
    return reply.redirect(`${this.frontendUrl}/login?error=sso_failed`, 302);
  }

  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signup(@Body(new ZodValidationPipe(signupSchema)) dto: SignupDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.session(reply, await this.auth.signup(dto, meta(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(STRICT)
  async login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.session(reply, await this.auth.login(dto, meta(req)));
  }

  @Public()
  @Post('2fa/authenticate')
  @HttpCode(200)
  @Throttle(STRICT)
  async authenticateTwoFactor(
    @Body(new ZodValidationPipe(twoFactorLoginSchema)) dto: { tempToken: string; code: string },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.session(reply, await this.auth.completeTwoFactorLogin(dto.tempToken, dto.code, meta(req)));
  }

  /** First sign-in when the workspace requires MFA: returns the QR code for the authenticator app. */
  @Public()
  @Post('2fa/enroll/start')
  @HttpCode(200)
  @Throttle(STRICT)
  startRequiredEnrollment(@Body(new ZodValidationPipe(mfaEnrollmentStartSchema)) dto: { enrollmentToken: string }) {
    return this.auth.beginRequiredEnrollment(dto.enrollmentToken);
  }

  @Public()
  @Post('2fa/enroll/complete')
  @HttpCode(200)
  @Throttle(STRICT)
  async completeRequiredEnrollment(
    @Body(new ZodValidationPipe(mfaEnrollmentCompleteSchema)) dto: { enrollmentToken: string; code: string },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.session(reply, await this.auth.completeRequiredEnrollment(dto.enrollmentToken, dto.code, meta(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) dto: { refreshToken?: string },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = dto.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    if (!token) throw new UnauthorizedException('Session expired. Please sign in again.');
    try {
      return this.session(reply, await this.auth.refresh(token, meta(req)));
    } catch (error) {
      clearRefreshCookie(reply, this.secureCookies);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    clearRefreshCookie(reply, this.secureCookies);
    return this.auth.logout(user, meta(req));
  }

  /** Re-authenticate for sensitive actions; the token goes in the `x-step-up-token` header. */
  @ApiBearerAuth()
  @Post('step-up')
  @HttpCode(200)
  @Throttle(STRICT)
  stepUp(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(stepUpSchema)) dto: { code?: string; password?: string }, @Req() req: FastifyRequest) {
    return this.auth.stepUp(user, dto, meta(req));
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeOwnSession(user, id);
  }

  @ApiBearerAuth()
  @Post('sessions/revoke-all')
  @HttpCode(200)
  revokeOtherSessions(@CurrentUser() user: AuthUser) {
    return this.auth.revokeOtherSessions(user);
  }

  @ApiBearerAuth()
  @Post('users/:id/revoke-sessions')
  @Permissions('security.manage')
  @HttpCode(200)
  forceRevokeUserSessions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.forceRevokeUserSessions(user, id);
  }

  @ApiBearerAuth()
  @Post('users/:id/reset-mfa')
  @Permissions('security.manage')
  @RequireStepUp()
  @HttpCode(200)
  resetUserMfa(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.resetUserMfa(user, id);
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
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.session(reply, await this.auth.changePassword(user, dto, meta(req)));
  }

  // ─── Invitations & password reset ──────────────────────────────────────────

  @ApiBearerAuth()
  @Post('invite')
  @Permissions('employees.manage')
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
  requestReset(@Body(new ZodValidationPipe(resetRequestSchema)) dto: ResetRequestDto, @Req() req: FastifyRequest) {
    return this.auth.requestPasswordReset(dto, meta(req));
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

  @ApiBearerAuth()
  @Post('2fa/recovery-codes/regenerate')
  @HttpCode(200)
  @Throttle(STRICT)
  regenerateRecoveryCodes(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(twoFactorCodeSchema)) dto: { code: string }) {
    return this.auth.regenerateRecoveryCodes(user.userId, dto.code);
  }

  // ─── SSO ───────────────────────────────────────────────────────────────────
  // Every SSO start sets an httpOnly nonce cookie whose hash is inside the
  // signed state; callbacks only succeed in the browser that started the flow.

  @Public()
  @Get('sso/providers')
  @Throttle(STRICT)
  ssoProviders(@Query('tenant') tenant: string) {
    return this.oidc.publicProviders(tenant);
  }

  @Public()
  @Get('sso/discovery')
  @Throttle(STRICT)
  ssoDiscovery(@Query('email') email: string) {
    return this.oidc.discoverByEmail(email);
  }

  /** GET /auth/google?tenant=<workspace-slug> */
  @Public()
  @Get('google')
  @Throttle(STRICT)
  async googleAuth(@Query('tenant') tenant: string | undefined, @Res() reply: FastifyReply) {
    try {
      return this.ssoRedirect(reply, await this.oidc.googleAuthorizationUrl(tenant ?? ''));
    } catch {
      return this.ssoFailed(reply);
    }
  }

  @Public()
  @Get('google/callback')
  @Throttle(STRICT)
  async googleCallback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      return this.ssoDone(reply, await this.oidc.googleCallback(code, state, readCookie(req, SSO_NONCE_COOKIE), meta(req)));
    } catch {
      return this.ssoFailed(reply);
    }
  }

  @Public()
  @Post('sso/exchange')
  @HttpCode(200)
  @Throttle(STRICT)
  async exchangeSso(@Body(new ZodValidationPipe(ssoExchangeSchema)) dto: { code: string }, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.session(reply, await this.auth.exchangeSsoCode(dto.code, meta(req)));
  }

  @Public()
  @Get('oidc/start/:providerId')
  @Throttle(STRICT)
  async startOidc(@Param('providerId', ParseUUIDPipe) providerId: string, @Query('tenant') tenant: string, @Res() reply: FastifyReply) {
    try {
      return this.ssoRedirect(reply, await this.oidc.authorizationUrl(tenant, providerId));
    } catch {
      return this.ssoFailed(reply);
    }
  }

  @Public()
  @Get('oidc/callback')
  @Throttle(STRICT)
  async oidcCallback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      return this.ssoDone(reply, await this.oidc.callback(code, state, readCookie(req, SSO_NONCE_COOKIE), meta(req)));
    } catch {
      return this.ssoFailed(reply);
    }
  }

  @Public()
  @Get('saml/metadata/:providerId')
  async samlMetadata(@Param('providerId', ParseUUIDPipe) providerId: string, @Res() reply: FastifyReply) {
    const metadata = await this.saml.metadata(providerId);
    return reply.header('content-type', 'application/xml').send(metadata);
  }

  @Public()
  @Get('saml/start/:providerId')
  @Throttle(STRICT)
  async startSaml(@Param('providerId', ParseUUIDPipe) providerId: string, @Query('tenant') tenant: string, @Res() reply: FastifyReply) {
    try {
      return this.ssoRedirect(reply, await this.saml.authorizationUrl(tenant, providerId));
    } catch {
      return this.ssoFailed(reply);
    }
  }

  @Public()
  @Post('saml/callback/:providerId')
  @Throttle(STRICT)
  async samlCallback(@Param('providerId', ParseUUIDPipe) providerId: string, @Body() body: Record<string, unknown>, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      return this.ssoDone(reply, await this.saml.callback(providerId, body ?? {}, readCookie(req, SSO_NONCE_COOKIE), meta(req)));
    } catch {
      return this.ssoFailed(reply);
    }
  }
}
