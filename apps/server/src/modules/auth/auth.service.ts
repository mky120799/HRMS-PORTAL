import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import type { Prisma, Tenant, TenantAuthPolicy, TenantIdentityProvider, User, UserSession } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from '../../common/auth/token.service';
import { ReplayGuardService } from '../../common/auth/replay-guard.service';
import { SessionCacheService } from '../../common/auth/session-cache.service';
import { RolePermissionsService } from '../../common/auth/role-permissions.service';
import { RoleAssignmentService } from '../../common/auth/role-assignment.service';
import { AuditService } from '../../common/audit/audit.service';
import { EmailTemplates } from '../../common/email/templates';
import {
  DEFAULT_LEAVE_POLICIES,
  type Role,
} from '../../common/constants/domain';
import { mappedRole, type MappedRole } from './sso-mapping';
import { effectivePlan, employeeLimit } from '../../common/subscription/subscription-plans';
import type { AuthUser } from '../../common/auth/auth-user';
import { TwoFactorAuthService } from './two-factor.service';
import type {
  ChangePasswordDto,
  InviteDto,
  LoginDto,
  ResetRequestDto,
  SignupDto,
} from './dto/auth.dto';
import { NotificationPublisherService } from '../notifications/notification-publisher.service';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 30;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface SsoProfile {
  name?: string;
  /** Group/role values from the IdP, matched against the provider's roleMapping. */
  groups?: string[];
}

export interface SsoFailureContext {
  tenantId?: string;
  providerId?: string;
  method: 'google' | 'oidc' | 'saml';
}

/** Thrown inside the rotation transaction when another request rotated the same token first. */
class RefreshRotationConflict extends Error {}

/** Refresh tokens are high-entropy JWTs, so a fast SHA-256 digest is the right storage hash
 *  (bcrypt would silently truncate them at 72 bytes — the shared JWT header — and match any token). */
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Compared against when the user does not exist, so response time does not reveal valid emails. */
  private readonly dummyHash = bcrypt.hashSync(randomUUID(), BCRYPT_ROUNDS);
  private readonly frontendUrl: string;
  private readonly publicSignupEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationPublisherService,
    private readonly twoFactor: TwoFactorAuthService,
    private readonly replayGuard: ReplayGuardService,
    private readonly sessionCache: SessionCacheService,
    private readonly rolePermissions: RolePermissionsService,
    private readonly roleAssignment: RoleAssignmentService,
    config: ConfigService,
  ) {
    this.frontendUrl = config.get('FRONTEND_URL', 'http://localhost:5173');
    this.publicSignupEnabled = config.get<boolean>('PUBLIC_SIGNUP_ENABLED', true);
  }

  // ─── Tenant resolution ──────────────────────────────────────────────────────

  async resolveTenant(ref: string): Promise<Tenant | null> {
    const value = ref.trim();
    if (UUID_RE.test(value)) {
      const byId = await this.prisma.tenant.findUnique({
        where: { id: value },
      });
      if (byId) return byId;
    }
    return this.prisma.tenant.findUnique({
      where: { slug: value.toLowerCase() },
    });
  }

  // ─── Sign-up ────────────────────────────────────────────────────────────────

  /** Self-serve sign-up: tenant, default leave policies, admin user and their employee profile — atomically. */
  async signup(dto: SignupDto, meta: RequestMeta) {
    if (!this.publicSignupEnabled) {
      throw new ForbiddenException('Public signup is disabled. Ask an administrator for an invitation.');
    }
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const [firstName, ...rest] = dto.name.split(/\s+/);

    const { tenant, user } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          slug: slugify(dto.tenantName),
          subscriptionStatus: 'TRIAL',
          subscriptionPlan: 'FREE',
          trialEndsAt,
        },
      });
      await Promise.all(
        DEFAULT_LEAVE_POLICIES.map(async (defaultPolicy) => {
          const policy = await tx.leavePolicy.create({
            data: { ...defaultPolicy, tenantId: tenant.id },
          });
          await tx.leavePolicyVersion.create({
            data: {
              tenantId: tenant.id,
              leavePolicyId: policy.id,
              version: 1,
              annualQuota: policy.annualQuota,
              isPaid: policy.isPaid,
              accrualMode: policy.accrualMode,
              carryForwardLimit: policy.carryForwardLimit,
              allowNegative: policy.allowNegative,
              effectiveFrom: policy.effectiveFrom,
              effectiveTo: policy.effectiveTo,
            },
          });
        }),
      );
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          passwordHash,
          name: dto.name,
          role: 'ADMIN',
          passwordChangedAt: new Date(),
        },
      });
      await tx.employee.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          email: dto.email,
          firstName,
          lastName: rest.join(' '),
          department: 'Management',
          designation: 'Administrator',
          dateOfJoining: new Date(),
        },
      });
      return { tenant, user };
    });

    await this.audit.log({
      tenantId: tenant.id,
      userId: user.id,
      action: 'SIGNUP',
      resource: 'tenants',
      resourceId: tenant.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    const session = await this.issueSession(user, meta);
    return { ...session, isNewTenant: true };
  }

  // ─── Login ──────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, meta: RequestMeta) {
    const tenant = await this.resolveTenant(dto.tenantId);
    const policy = tenant ? await this.authPolicy(tenant.id) : null;
    // Workspace-level rule, decided before looking at the email so the answer is
    // the same for every address (no account enumeration).
    if (policy && !policy.allowPasswordLogin) {
      await bcrypt.compare(dto.password, this.dummyHash);
      throw new ForbiddenException('Password login is disabled for this workspace');
    }
    const user = tenant
      ? await this.prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
        })
      : null;

    if (!tenant || !policy || !user) {
      await bcrypt.compare(dto.password, this.dummyHash);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (this.isLocked(user)) throw this.lockedError();

    const valid =
      user.passwordHash.length > 0 &&
      (await bcrypt.compare(dto.password, user.passwordHash));
    if (!valid) {
      await this.recordFailedLogin(user, meta);
      throw new UnauthorizedException('Invalid credentials');
    }
    // Checked only after the password so these states are not disclosed to guessers.
    if (!user.isActive)
      throw new UnauthorizedException('This account has been deactivated');
    if (!tenant.isActive)
      throw new ForbiddenException(
        'This workspace is suspended. Contact support.',
      );

    if (this.passwordExpired(policy, user)) {
      throw new ForbiddenException('Password expired. Reset your password before signing in.');
    }

    if (user.isTwoFactorEnabled) {
      // The failure counter is only cleared once the second factor succeeds,
      // otherwise a known password would reset the lockout between TOTP guesses.
      return {
        twoFactorRequired: true,
        tempToken: this.tokens.sign('two_factor', {
          sub: user.id,
          ver: user.tokenVersion,
        }),
      };
    }

    await this.clearFailedLogins(user);
    if (this.policyRequiresMfa(policy, user)) {
      return this.mfaEnrollmentChallenge(user, meta);
    }

    await this.audit.log({
      tenantId: tenant.id,
      userId: user.id,
      action: 'LOGIN',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.issueSession(user, meta);
  }

  private isLocked(user: Pick<User, 'lockedUntil'>) {
    return !!user.lockedUntil && user.lockedUntil > new Date();
  }

  private lockedError() {
    return new UnauthorizedException(
      'Too many failed attempts. Try again in a few minutes or reset your password.',
    );
  }

  private async clearFailedLogins(user: Pick<User, 'id' | 'failedLoginAttempts' | 'lockedUntil'>) {
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }
  }

  /**
   * One counter for password, MFA and step-up failures. The increment is atomic
   * so parallel guesses cannot each read the same old count. Reaching the limit
   * locks the account, tells the user and alerts workspace admins.
   */
  private async recordFailedLogin(
    user: Pick<User, 'id' | 'tenantId' | 'email' | 'name'>,
    meta: RequestMeta,
    failureAction: 'LOGIN_FAILED' | 'MFA_CHALLENGE_FAILED' | 'STEP_UP_FAILED' = 'LOGIN_FAILED',
  ) {
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    const lock = failedLoginAttempts >= MAX_FAILED_LOGINS;
    if (lock) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
        },
      });
    }
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: failureAction,
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    if (!lock) return;
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'ACCOUNT_LOCKED',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { trigger: failureAction, minutes: LOCKOUT_MINUTES },
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.publishSecurityNotice(tx, {
          user,
          meta,
          eventType: 'AUTH_ACCOUNT_LOCKED',
          title: 'Your HRMS account was temporarily locked',
          body: `Too many failed sign-in attempts. The account is locked for ${LOCKOUT_MINUTES} minutes. If this was not you, reset your password.`,
        });
        await this.publishAdminSecurityAlert(tx, {
          tenantId: user.tenantId,
          actorUserId: user.id,
          eventType: 'AUTH_SUSPICIOUS_ACTIVITY',
          title: 'Account locked after repeated failures',
          body: `${user.email} was locked for ${LOCKOUT_MINUTES} minutes after repeated failed ${failureAction === 'LOGIN_FAILED' ? 'password' : 'MFA'} attempts.`,
          meta,
        });
      });
    } catch (error) {
      this.logger.error(`Could not queue lockout notifications: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** MFA is required by policy but the user has not enrolled: allow enrolment only. */
  private async mfaEnrollmentChallenge(user: User, meta: RequestMeta) {
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'MFA_ENROLLMENT_REQUIRED',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      mfaEnrollmentRequired: true,
      enrollmentToken: this.tokens.sign('mfa_enroll', { sub: user.id, ver: user.tokenVersion }),
    };
  }

  async beginRequiredEnrollment(enrollmentToken: string) {
    const user = await this.userForEnrollment(enrollmentToken);
    return this.twoFactor.beginEnrollment(user);
  }

  /** Finishes first-login MFA enrolment and signs the user in. Recovery codes are shown once. */
  async completeRequiredEnrollment(enrollmentToken: string, code: string, meta: RequestMeta) {
    const user = await this.userForEnrollment(enrollmentToken);
    if (this.isLocked(user)) throw this.lockedError();
    try {
      await this.twoFactor.enable(user, code);
    } catch (error) {
      await this.recordFailedLogin(user, meta, 'MFA_CHALLENGE_FAILED');
      throw error;
    }
    const recoveryCodes = await this.twoFactor.generateRecoveryCodes(user);
    await this.prisma.$transaction(async (tx) => {
      await this.publishSecurityNotice(tx, {
        user,
        meta,
        eventType: 'AUTH_MFA_ENABLED',
        title: 'Two-factor authentication enabled',
        body: 'Two-factor authentication was set up for your HRMS account during sign-in.',
      });
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: '2FA_ENABLED',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { via: 'required_enrollment' },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'LOGIN',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { method: 'mfa_enrollment' },
    });
    const enrolled = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const session = await this.issueSession(enrolled, meta);
    return { ...session, recoveryCodes };
  }

  private async userForEnrollment(enrollmentToken: string) {
    const payload = this.tokens.verify<{ ver: number }>('mfa_enroll', enrollmentToken);
    const user = await this.activeUserWithVersion(payload.sub, payload.ver);
    if (user.isTwoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is already enabled. Sign in again.');
    }
    return user;
  }

  async completeTwoFactorLogin(
    tempToken: string,
    code: string,
    meta: RequestMeta,
  ) {
    const payload = this.tokens.verify<{ ver: number }>(
      'two_factor',
      tempToken,
    );
    const user = await this.activeUserWithVersion(payload.sub, payload.ver);
    if (this.isLocked(user)) throw this.lockedError();
    const validTotp = await this.twoFactor.consumeCode(user, code);
    const validRecoveryCode = validTotp ? false : await this.twoFactor.useRecoveryCode(user.id, code);
    if (!validTotp && !validRecoveryCode) {
      await this.recordFailedLogin(user, meta, 'MFA_CHALLENGE_FAILED');
      throw new UnauthorizedException('Invalid 2FA code');
    }
    await this.clearFailedLogins(user);
    if (validTotp) await this.twoFactor.upgradeLegacySecret(user.id, user.twoFactorSecret);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: validRecoveryCode ? 'MFA_RECOVERY_CODE_USED' : 'LOGIN',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { method: validRecoveryCode ? 'recovery_code' : '2fa' },
    });
    if (validRecoveryCode) {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'LOGIN',
        resource: 'auth',
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        newValues: { method: '2fa_recovery_code' },
      });
      await this.prisma.$transaction(async (tx) => {
        await this.publishSecurityNotice(tx, {
          user,
          meta,
          eventType: 'AUTH_MFA_RECOVERY_CODE_USED',
          title: 'MFA recovery code used',
          body: 'A recovery code was used to sign in to your HRMS account.',
        });
      });
    }
    return this.issueSession(user, meta);
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────

  /**
   * Issues a 15-minute access token and a 7-day refresh token for one device
   * session. Refresh tokens are hashed per session and rotated on every use.
   */
  async issueSession(user: User, meta: RequestMeta = {}) {
    const sessionId = randomUUID();
    return this.issueTokensForSession(user, sessionId, meta, 'login');
  }

  private async issueTokensForSession(
    user: User,
    sessionId: string,
    meta: RequestMeta,
    mode: 'login' | 'refresh',
    existingSession?: Pick<UserSession, 'createdAt' | 'refreshTokenHash'>,
  ) {
    const [employee, tenant, policy] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { userId: user.id },
        select: { id: true },
      }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { id: true, slug: true, name: true },
      }),
      this.authPolicy(user.tenantId),
    ]);
    const accessToken = this.tokens.sign('access', {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
      employeeId: employee?.id ?? null,
      sid: sessionId,
      ...(user.customRoleId ? { crid: user.customRoleId } : {}),
    });
    const refreshToken = this.tokens.sign('refresh', {
      sub: user.id,
      ver: user.tokenVersion,
      sid: sessionId,
      jti: randomUUID(),
    });
    const sessionTtlMs = Math.min(
      REFRESH_TTL_MS,
      policy.sessionAbsoluteHours * 60 * 60 * 1000,
    );
    const sessionStartedAt = existingSession?.createdAt ?? new Date();
    const absoluteExpiresAt = new Date(sessionStartedAt.getTime() + sessionTtlMs);
    const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const expiresAt = new Date(
      Math.min(absoluteExpiresAt.getTime(), refreshTokenExpiresAt.getTime()),
    );
    if (expiresAt <= new Date()) {
      await this.prisma.userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'SESSION_EXPIRED' },
      });
      this.sessionCache.forget(sessionId);
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    await this.prisma.$transaction(async (tx) => {
      if (mode === 'login') {
        await tx.userSession.create({
          data: {
            id: sessionId,
            tenantId: user.tenantId,
            userId: user.id,
            refreshTokenHash: sha256(refreshToken),
            expiresAt,
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
          },
        });
      } else {
        // Compare-and-swap on the presented token's hash: if two requests race
        // with the same refresh token, exactly one rotates; the other is a reuse.
        const rotated = await tx.userSession.updateMany({
          where: { id: sessionId, refreshTokenHash: existingSession?.refreshTokenHash ?? '', revokedAt: null },
          data: {
            refreshTokenHash: sha256(refreshToken),
            expiresAt,
            lastUsedAt: new Date(),
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
          },
        });
        if (rotated.count !== 1) throw new RefreshRotationConflict();
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          refreshToken: null,
          refreshTokenExpiry: null,
        },
      });
      if (mode === 'login') {
        await this.publishSecurityNotice(tx, {
          user,
          meta,
          eventType: 'AUTH_NEW_SESSION',
          title: 'New sign-in to your HRMS account',
          body: 'A new session was created for your account.',
        });
      }
    });

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
      tokenType: 'Bearer',
      expiresIn: 15 * 60,
      user: { ...(await this.publicUser(user)), employeeId: employee?.id ?? null },
      tenant,
      sessionId,
    };
  }

  async refresh(refreshToken: string, meta: RequestMeta = {}) {
    const payload = this.tokens.verify<{ ver: number; sid?: string }>(
      'refresh',
      refreshToken,
    );
    const user = await this.activeUserWithVersion(payload.sub, payload.ver);

    if (!payload.sid) return this.refreshLegacySession(user, refreshToken, meta);

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
    });
    if (!session || session.userId !== user.id || session.tenantId !== user.tenantId) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    const presented = Buffer.from(sha256(refreshToken));
    const stored = Buffer.from(session.refreshTokenHash);
    const matches =
      stored.length === presented.length && timingSafeEqual(stored, presented);
    const now = new Date();
    if (!matches || session.revokedAt || session.expiresAt < now) {
      if (!matches && !session.revokedAt) await this.handleRefreshReuse(session, user, meta);
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    const policy = await this.authPolicy(user.tenantId);
    if (
      policy.sessionIdleMinutes &&
      session.lastUsedAt.getTime() + policy.sessionIdleMinutes * 60_000 < now.getTime()
    ) {
      await this.revokeSession(session, 'SESSION_IDLE_TIMEOUT');
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'SESSION_IDLE_TIMEOUT',
        resource: 'auth',
        resourceId: session.id,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Session timed out. Please sign in again.');
    }

    try {
      return await this.issueTokensForSession(user, session.id, meta, 'refresh', session);
    } catch (error) {
      if (!(error instanceof RefreshRotationConflict)) throw error;
      await this.handleRefreshReuse(session, user, meta);
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
  }

  /** A validly signed but already-rotated refresh token was presented: revoke that session and alert. */
  private async handleRefreshReuse(session: UserSession, user: User, meta: RequestMeta) {
    await this.revokeSession(session, 'REFRESH_TOKEN_REUSE');
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'REFRESH_TOKEN_REUSE',
      resource: 'auth',
      resourceId: session.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    this.logger.warn(
      `Refresh token reuse detected for user ${user.id}; session ${session.id} revoked`,
    );
    await this.prisma.$transaction(async (tx) => {
      await this.publishSecurityNotice(tx, {
        user,
        meta,
        eventType: 'AUTH_REFRESH_REUSE',
        title: 'Suspicious session activity blocked',
        body: 'A previously rotated refresh token was reused, so that session was revoked.',
      });
      await this.publishAdminSecurityAlert(tx, {
        tenantId: user.tenantId,
        actorUserId: user.id,
        eventType: 'AUTH_SUSPICIOUS_ACTIVITY',
        title: 'Suspicious authentication activity',
        body: `Refresh-token reuse was detected for ${user.email}. The affected session was revoked.`,
        meta,
      });
    });
  }

  private async refreshLegacySession(
    user: User,
    refreshToken: string,
    meta: RequestMeta,
  ) {
    const presented = Buffer.from(sha256(refreshToken));
    const stored = Buffer.from(user.refreshToken ?? '');
    const matches =
      stored.length === presented.length && timingSafeEqual(stored, presented);
    if (
      !matches ||
      !user.refreshTokenExpiry ||
      user.refreshTokenExpiry < new Date()
    ) {
      if (!matches && user.refreshToken) {
        // A validly-signed but already-rotated legacy token was replayed.
        await this.prisma.user.update({
          where: { id: user.id },
          data: { refreshToken: null, refreshTokenExpiry: null },
        });
        await this.audit.log({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'REFRESH_TOKEN_REUSE',
          resource: 'auth',
        });
        this.logger.warn(
          `Refresh token reuse detected for user ${user.id}; legacy session revoked`,
        );
      }
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    return this.issueSession(user, meta);
  }

  async logout(user: AuthUser, meta: RequestMeta = {}) {
    if (user.sessionId) {
      await this.prisma.userSession.updateMany({
        where: { id: user.sessionId, userId: user.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
      this.sessionCache.forget(user.sessionId);
    } else {
      await this.revokeAllUserSessions(user.userId, 'LOGOUT');
    }
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'LOGOUT',
      resource: 'auth',
      resourceId: user.sessionId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return { message: 'Logged out' };
  }

  async listSessions(user: AuthUser) {
    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId: user.userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        revokedReason: true,
      },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.id === user.sessionId,
      active: !session.revokedAt,
    }));
  }

  async revokeOwnSession(user: AuthUser, sessionId: string) {
    if (sessionId === user.sessionId) {
      throw new BadRequestException('Use logout to revoke the current session');
    }
    const result = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_REVOKED' },
    });
    if (!result.count) throw new NotFoundException('Session not found');
    this.sessionCache.forget(sessionId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'SESSION_REVOKED',
      resource: 'auth',
      resourceId: sessionId,
    });
    return { message: 'Session revoked' };
  }

  async revokeOtherSessions(user: AuthUser) {
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId: user.userId,
        revokedAt: null,
        ...(user.sessionId ? { id: { not: user.sessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: 'USER_REVOKED_ALL' },
    });
    this.sessionCache.forgetUser(user.userId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'SESSIONS_REVOKED',
      resource: 'auth',
      newValues: { count: result.count },
    });
    return { message: 'Other sessions revoked', count: result.count };
  }

  private async publishSecurityNotice(
    tx: Parameters<NotificationPublisherService['publish']>[0],
    input: {
      user: Pick<User, 'id' | 'tenantId' | 'email' | 'name'>;
      eventType: string;
      title: string;
      body: string;
      meta?: RequestMeta;
      actorUserId?: string | null;
    },
  ) {
    await this.notifications.publish(tx, {
      tenantId: input.user.tenantId,
      eventKey: `${input.eventType.toLowerCase()}:${input.user.id}:${randomUUID()}`,
      eventType: input.eventType,
      category: 'SECURITY',
      actorUserId: input.actorUserId ?? null,
      data: {
        userId: input.user.id,
        ip: input.meta?.ip ?? null,
        userAgent: input.meta?.userAgent ?? null,
      },
      recipients: [{ userId: input.user.id, email: input.user.email }],
      channels: ['IN_APP', 'EMAIL'],
      title: input.title,
      body: input.body,
      email: EmailTemplates.securityNotice({
        name: input.user.name,
        title: input.title,
        body: input.body,
      }),
      mandatory: true,
      sensitive: true,
    });
  }

  private async publishAdminSecurityAlert(
    tx: Parameters<NotificationPublisherService['publish']>[0],
    input: {
      tenantId: string;
      actorUserId?: string | null;
      eventType: string;
      title: string;
      body: string;
      meta?: RequestMeta;
    },
  ) {
    const admins = await tx.user.findMany({
      where: { tenantId: input.tenantId, role: 'ADMIN', isActive: true },
      select: { id: true, email: true },
    });
    if (!admins.length) return;
    await this.notifications.publish(tx, {
      tenantId: input.tenantId,
      eventKey: `${input.eventType.toLowerCase()}:${randomUUID()}`,
      eventType: input.eventType,
      category: 'SECURITY',
      actorUserId: input.actorUserId ?? null,
      data: {
        ip: input.meta?.ip ?? null,
        userAgent: input.meta?.userAgent ?? null,
      },
      recipients: admins.map((admin) => ({ userId: admin.id, email: admin.email })),
      channels: ['IN_APP', 'EMAIL'],
      title: input.title,
      body: input.body,
      email: EmailTemplates.securityNotice({
        name: 'Administrator',
        title: input.title,
        body: input.body,
      }),
      mandatory: true,
      sensitive: true,
    });
  }

  async forceRevokeUserSessions(admin: AuthUser, targetUserId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId: admin.tenantId },
      select: { id: true, tenantId: true, email: true, name: true },
    });
    if (!target) throw new NotFoundException('User not found');
    const result = await this.prisma.userSession.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ADMIN_FORCE_LOGOUT' },
    });
    this.sessionCache.forgetUser(target.id);
    await this.prisma.user.update({
      where: { id: target.id },
      data: { refreshToken: null, refreshTokenExpiry: null },
    });
    await this.audit.log({
      tenantId: admin.tenantId,
      userId: admin.userId,
      action: 'ADMIN_FORCE_LOGOUT',
      resource: 'auth',
      resourceId: target.id,
      newValues: { count: result.count },
    });
    return { message: 'User sessions revoked', count: result.count };
  }

  async resetUserMfa(admin: AuthUser, targetUserId: string) {
    if (admin.userId === targetUserId) {
      throw new BadRequestException('Use your own Security page to disable MFA');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId: admin.tenantId },
      select: { id: true, tenantId: true, email: true, name: true },
    });
    if (!target) throw new NotFoundException('User not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          isTwoFactorEnabled: false,
          twoFactorSecret: null,
          lastTotpStep: null,
          tokenVersion: { increment: 1 },
          refreshToken: null,
          refreshTokenExpiry: null,
        },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: target.id } });
      await tx.userSession.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ADMIN_MFA_RESET' },
      });
      await this.publishSecurityNotice(tx, {
        user: target,
        actorUserId: admin.userId,
        eventType: 'AUTH_MFA_ADMIN_RESET',
        title: 'Your MFA was reset by an administrator',
        body: 'An administrator reset multi-factor authentication for your HRMS account. You must enroll again.',
      });
    });
    await this.audit.log({
      tenantId: admin.tenantId,
      userId: admin.userId,
      action: 'ADMIN_MFA_RESET',
      resource: 'auth',
      resourceId: target.id,
    });
    this.sessionCache.forgetUser(target.id);
    return { message: 'MFA reset and user sessions revoked' };
  }

  private async revokeSession(session: UserSession, reason: string) {
    await this.prisma.userSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    this.sessionCache.forget(session.id);
  }

  private async revokeAllUserSessions(userId: string, reason: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, refreshTokenExpiry: null },
    });
    this.sessionCache.forgetUser(userId);
  }

  /** Loads a user for a stateful token and checks it has not been revoked by a version bump. */
  private async activeUserWithVersion(userId: string, version: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: { select: { isActive: true } } },
    });
    if (
      !user ||
      !user.isActive ||
      !user.tenant.isActive ||
      user.tokenVersion !== version
    ) {
      throw new UnauthorizedException(
        'Session is no longer valid. Please sign in again.',
      );
    }
    return user;
  }

  private authPolicy(tenantId: string) {
    return this.prisma.tenantAuthPolicy.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
  }

  private policyRequiresMfa(policy: TenantAuthPolicy, user: User) {
    return policy.requireMfaForAll || (policy.requireMfaForAdmins && user.role === 'ADMIN');
  }

  // ─── Profile ────────────────────────────────────────────────────────────────

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            department: true,
            designation: true,
            dateOfJoining: true,
            managerId: true,
          },
        },
        tenant: {
          select: { id: true, name: true, slug: true, timezone: true },
        },
      },
    });
    if (!user) throw new UnauthorizedException();
    return {
      ...(await this.publicUser(user)),
      employee: user.employee,
      tenant: user.tenant,
      recoveryCodeCount: user.isTwoFactorEnabled ? await this.twoFactor.unusedRecoveryCodeCount(user.id) : 0,
    };
  }

  /** Profile returned to the web app, including effective permissions so menus match the API. */
  private async publicUser(user: User) {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      customRoleId: user.customRoleId,
      permissions: await this.rolePermissions.effective(user.role as Role, user.customRoleId, user.tenantId),
      isTwoFactorEnabled: user.isTwoFactorEnabled,
    };
  }

  // ─── Invitations & passwords ────────────────────────────────────────────────

  /**
   * Admin invites a person. Links to an existing employee record with the same
   * email, or creates one. The user cannot sign in until they accept the invite.
   */
  async invite(admin: AuthUser, dto: InviteDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: admin.tenantId },
    });
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
    });
    if (existing)
      throw new ConflictException(
        'A user with this email already exists in your workspace',
      );

    // Same no-escalation rules as a role change: e.g. an HR manager cannot invite an ADMIN.
    const granted = await this.roleAssignment.grantable(
      admin,
      dto.customRoleId ? { customRoleId: dto.customRoleId } : { role: dto.role },
    );

    const [firstName, ...rest] = dto.name.split(/\s+/);
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          name: dto.name,
          passwordHash: '',
          role: granted.role,
          customRoleId: granted.customRoleId,
        },
      });
      const employee = await tx.employee.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
      });
      if (employee) {
        if (employee.userId)
          throw new ConflictException(
            'This employee is already linked to a user',
          );
        await tx.employee.update({
          where: { id: employee.id },
          data: { userId: user.id },
        });
      } else {
        await tx.employee.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            email: dto.email,
            firstName,
            lastName: rest.join(' '),
          },
        });
      }
      const token = this.tokens.sign('invite', {
        sub: user.id,
        ver: user.tokenVersion,
      });
      await this.notifications.publish(tx, {
        tenantId: tenant.id,
        eventKey: `user-invite:${user.id}:${user.tokenVersion}`,
        eventType: 'USER_INVITED',
        category: 'SECURITY',
        actorUserId: admin.userId,
        data: { invitedUserId: user.id, role: granted.role },
        recipients: [{ userId: user.id, email: user.email }],
        channels: ['EMAIL'],
        title: 'HRMS account invitation',
        body: 'You have been invited to activate your HRMS account.',
        email: EmailTemplates.invite({
          name: user.name,
          companyName: tenant.name,
          link: `${this.frontendUrl}/accept-invite?token=${encodeURIComponent(token)}`,
        }),
        mandatory: true,
        sensitive: true,
      });
      return user;
    });

    await this.audit.log({
      tenantId: tenant.id,
      userId: admin.userId,
      action: 'INVITE',
      resource: 'users',
      resourceId: user.id,
      newValues: { email: dto.email, role: granted.role, customRoleId: granted.customRoleId, customRoleName: granted.customRoleName },
    });
    return { message: 'Invitation sent', userId: user.id };
  }

  /** Always returns the same response, so it cannot be used to discover which emails have accounts. */
  async requestPasswordReset(dto: ResetRequestDto, meta: RequestMeta = {}) {
    const response = {
      message:
        'If an account exists for that email, a reset link has been sent.',
    };
    const tenant = await this.resolveTenant(dto.tenantId);
    if (!tenant) return response;
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
    });
    if (!user || !user.isActive) return response;
    await this.audit.log({
      tenantId: tenant.id,
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const token = this.tokens.sign('reset', {
      sub: user.id,
      ver: user.tokenVersion,
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.notifications.publish(tx, {
          tenantId: tenant.id,
          eventKey: `password-reset:${user.id}:${Math.floor(Date.now() / 300_000)}`,
          eventType: 'PASSWORD_RESET_REQUESTED',
          category: 'SECURITY',
          data: { userId: user.id },
          recipients: [{ userId: user.id, email: user.email }],
          channels: ['EMAIL'],
          title: 'Reset your HRMS password',
          body: 'A password reset was requested for your HRMS account.',
          email: EmailTemplates.passwordReset({
            name: user.name,
            link: `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`,
          }),
          mandatory: true,
          sensitive: true,
        });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not queue password reset email: ${message}`);
    }
    return response;
  }

  /**
   * Consumes an invite or reset token. Bumping tokenVersion makes the link
   * single-use and signs out every existing session for the account.
   */
  async setPasswordWithToken(
    purpose: 'invite' | 'reset',
    token: string,
    newPassword: string,
  ) {
    const payload = this.tokens.verify<{ ver: number }>(purpose, token);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive || user.tokenVersion !== payload.ver) {
      throw new BadRequestException(
        'This link is invalid or has already been used',
      );
    }
    const policy = await this.assertPasswordMeetsPolicy(user.tenantId, newPassword, user.id);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 },
          refreshToken: null,
          refreshTokenExpiry: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: purpose === 'invite' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET',
        },
      });
      await this.recordPreviousPassword(tx, user, policy.passwordHistoryCount);
      await this.publishSecurityNotice(tx, {
        user,
        eventType: purpose === 'invite' ? 'AUTH_INVITE_ACCEPTED' : 'AUTH_PASSWORD_RESET',
        title: purpose === 'invite' ? 'Your HRMS account was activated' : 'Your HRMS password was reset',
        body: purpose === 'invite' ? 'Your HRMS invite was accepted and password was set.' : 'Your HRMS password was reset and existing sessions were revoked.',
      });
    });
    this.sessionCache.forgetUser(user.id);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: purpose === 'invite' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET',
      resource: 'auth',
    });
    return { message: 'Password set. You can now sign in.' };
  }

  async changePassword(auth: AuthUser, dto: ChangePasswordDto, meta: RequestMeta = {}) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
    });
    const valid =
      user.passwordHash.length > 0 &&
      (await bcrypt.compare(dto.currentPassword, user.passwordHash));
    if (!valid) throw new BadRequestException('Current password is incorrect');
    const policy = await this.assertPasswordMeetsPolicy(user.tenantId, dto.newPassword, user.id);
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 },
          refreshToken: null,
          refreshTokenExpiry: null,
        },
      });
      await this.recordPreviousPassword(tx, user, policy.passwordHistoryCount);
      await tx.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      });
      await this.publishSecurityNotice(tx, {
        user: updated,
        meta,
        eventType: 'AUTH_PASSWORD_CHANGED',
        title: 'Your HRMS password was changed',
        body: 'Your password was changed and other sessions were revoked.',
      });
      return updated;
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      resource: 'auth',
    });
    this.sessionCache.forgetUser(user.id);
    return this.issueSession(updated, meta); // other devices are signed out; this device receives a fresh session
  }

  // ─── Two-factor management ──────────────────────────────────────────────────

  async beginTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return this.twoFactor.beginEnrollment(user);
  }

  async enableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await this.twoFactor.enable(user, code);
    const recoveryCodes = await this.twoFactor.generateRecoveryCodes(user);
    await this.prisma.$transaction(async (tx) => {
      await this.publishSecurityNotice(tx, {
        user,
        eventType: 'AUTH_MFA_ENABLED',
        title: 'Two-factor authentication enabled',
        body: 'Two-factor authentication was enabled for your HRMS account.',
      });
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId,
      action: '2FA_ENABLED',
      resource: 'auth',
    });
    return { message: 'Two-factor authentication enabled', recoveryCodes };
  }

  async disableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (this.policyRequiresMfa(await this.authPolicy(user.tenantId), user)) {
      throw new BadRequestException(
        'Your workspace requires two-factor authentication, so it cannot be turned off. Regenerate recovery codes or ask an administrator to reset MFA if you changed devices.',
      );
    }
    await this.twoFactor.disable(user, code);
    await this.prisma.$transaction(async (tx) => {
      await this.publishSecurityNotice(tx, {
        user,
        eventType: 'AUTH_MFA_DISABLED',
        title: 'Two-factor authentication disabled',
        body: 'Two-factor authentication was disabled for your HRMS account.',
      });
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId,
      action: '2FA_DISABLED',
      resource: 'auth',
    });
    return { message: 'Two-factor authentication disabled' };
  }

  async regenerateRecoveryCodes(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!user.isTwoFactorEnabled) throw new BadRequestException('Two-factor authentication is not enabled');
    if (!(await this.twoFactor.consumeCode(user, code))) throw new BadRequestException('Invalid 2FA code');
    const recoveryCodes = await this.twoFactor.generateRecoveryCodes(user);
    await this.prisma.$transaction(async (tx) => {
      await this.publishSecurityNotice(tx, {
        user,
        eventType: 'AUTH_MFA_RECOVERY_CODES_REGENERATED',
        title: 'MFA recovery codes regenerated',
        body: 'New recovery codes were generated for your HRMS account.',
      });
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId,
      action: 'MFA_RECOVERY_CODES_REGENERATED',
      resource: 'auth',
    });
    return { recoveryCodes };
  }

  // ─── Step-up (re-authentication for sensitive actions) ─────────────────────

  /**
   * Issues a 5-minute step-up token bound to this user and session. Users with
   * MFA confirm with an authenticator or recovery code; users without MFA
   * confirm their password. Failures count towards the account lockout.
   * Errors are 400 (not 401) so the web app does not treat them as an expired session.
   */
  async stepUp(auth: AuthUser, dto: { code?: string; password?: string }, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (this.isLocked(user)) {
      throw new BadRequestException('Too many failed attempts. Try again in a few minutes.');
    }
    let method: 'totp' | 'recovery_code' | 'password';
    if (user.isTwoFactorEnabled) {
      const code = dto.code?.trim() ?? '';
      if (await this.twoFactor.consumeCode(user, code)) method = 'totp';
      else if (code && (await this.twoFactor.useRecoveryCode(user.id, code))) method = 'recovery_code';
      else {
        await this.recordFailedLogin(user, meta, 'STEP_UP_FAILED');
        throw new BadRequestException('Invalid authentication code');
      }
    } else {
      if (!user.passwordHash) {
        throw new BadRequestException('Set up two-factor authentication on the Security page to perform this action.');
      }
      if (!dto.password || !(await bcrypt.compare(dto.password, user.passwordHash))) {
        await this.recordFailedLogin(user, meta, 'STEP_UP_FAILED');
        throw new BadRequestException('Incorrect password');
      }
      method = 'password';
    }
    await this.clearFailedLogins(user);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'STEP_UP',
      resource: 'auth',
      resourceId: auth.sessionId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { method },
    });
    return {
      stepUpToken: this.tokens.sign('step_up', { sub: user.id, tenantId: user.tenantId, sid: auth.sessionId }),
      expiresIn: 5 * 60,
      method: user.isTwoFactorEnabled ? 'mfa' : 'password',
    };
  }

  // ─── SSO (Google, OIDC, SAML) ───────────────────────────────────────────────

  /**
   * Google sign-in only admits people who already have an account in the
   * workspace named in the signed state — it never auto-provisions. Returns a
   * 60-second single-use code; the SPA exchanges it for tokens, so tokens never
   * appear in URLs.
   */
  async ssoLogin(tenantId: string, googleEmail: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    const user = tenant
      ? await this.prisma.user.findUnique({
          where: {
            tenantId_email: {
              tenantId: tenant.id,
              email: googleEmail.toLowerCase(),
            },
          },
        })
      : null;
    if (!tenant || !tenant.isActive || !user || !user.isActive) {
      throw new UnauthorizedException(
        'No active account for this Google address in that workspace',
      );
    }
    const policy = await this.authPolicy(tenant.id);
    if (!policy.allowGoogleLogin) {
      throw new ForbiddenException('Google login is disabled for this workspace');
    }
    return this.ssoExchangeCode(user, { method: 'google' });
  }

  private ssoExchangeCode(user: Pick<User, 'id' | 'tokenVersion'>, claims: Record<string, unknown>) {
    return this.tokens.sign('sso_exchange', {
      ...claims,
      sub: user.id,
      ver: user.tokenVersion,
      jti: randomUUID(),
    });
  }

  /**
   * Exchanges the one-time SSO code for a session. The code's `jti` is recorded
   * so it works exactly once, even across API instances. MFA still applies:
   * enrolled users get the 2FA step, and users a policy requires to enrol get
   * the enrolment step.
   */
  async exchangeSsoCode(code: string, meta: RequestMeta) {
    const payload = this.tokens.verify<{
      ver: number;
      jti?: string;
      exp?: number;
      method?: string;
      providerId?: string;
    }>('sso_exchange', code);
    const expiresAt = new Date((payload.exp ?? Math.floor(Date.now() / 1000) + 60) * 1000);
    if (!payload.jti || !(await this.replayGuard.consume(`sso_exchange:${payload.jti}`, expiresAt))) {
      throw new UnauthorizedException('This sign-in link has already been used. Please sign in again.');
    }
    const user = await this.activeUserWithVersion(payload.sub, payload.ver);
    if (user.isTwoFactorEnabled) {
      return {
        twoFactorRequired: true,
        tempToken: this.tokens.sign('two_factor', {
          sub: user.id,
          ver: user.tokenVersion,
        }),
      };
    }
    if (this.policyRequiresMfa(await this.authPolicy(user.tenantId), user)) {
      return this.mfaEnrollmentChallenge(user, meta);
    }
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'LOGIN',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { method: payload.method ?? 'sso', providerId: payload.providerId },
    });
    return this.issueSession(user, meta);
  }

  async enterpriseSsoLogin(
    provider: Pick<TenantIdentityProvider, 'id' | 'tenantId' | 'name' | 'allowedDomains' | 'jitProvisioning' | 'roleMapping'>,
    email: string,
    method: 'oidc' | 'saml',
    meta: RequestMeta,
    profile: SsoProfile = {},
  ) {
    const normalizedEmail = email.toLowerCase();
    const domain = normalizedEmail.split('@').at(-1);
    if (
      provider.allowedDomains.length &&
      (!domain || !provider.allowedDomains.map((value) => value.toLowerCase()).includes(domain))
    ) {
      throw new ForbiddenException('This email domain is not allowed for the identity provider');
    }
    // Just-in-time provisioning trusts the IdP to vouch for new people, so it is
    // only allowed when the provider is limited to the company's own domains.
    const canProvision = provider.jitProvisioning && provider.allowedDomains.length > 0;
    const mapped = mappedRole(provider.roleMapping, profile.groups ?? []);
    let user = await this.prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: provider.tenantId,
          email: normalizedEmail,
        },
      },
      include: { tenant: { select: { isActive: true } } },
    });
    if (!user && canProvision) {
      user = await this.provisionSsoUser(provider, normalizedEmail, profile, meta);
    }
    if (!user || !user.isActive || !user.tenant.isActive) {
      throw new UnauthorizedException('No active account for this SSO identity in that workspace');
    }
    // Group-mapped roles go through the same rules as manual changes. Workspace
    // ADMINs are managed in HRMS only, never by IdP group membership.
    if (mapped && (await this.applyIdpRole(user.tenantId, user.id, mapped, provider.id))) {
      user = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { tenant: { select: { isActive: true } } },
      });
    }
    return this.ssoExchangeCode(user, {
      method,
      providerId: provider.id,
      providerName: provider.name,
    });
  }

  /** A broken mapping (e.g. a deactivated custom role) must not block sign-in; the role is left unchanged. */
  private async applyIdpRole(tenantId: string, userId: string, mapped: MappedRole, providerId: string) {
    try {
      return await this.roleAssignment.assign(tenantId, userId, mapped, { kind: 'idp', providerId, via: 'sso' });
    } catch (error) {
      this.logger.warn(`IdP role mapping for provider ${providerId} not applied: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * SSO callbacks redirect to the login page on any error, so failures are
   * recorded here. Only messages of expected (HTTP) errors are stored; internal
   * errors are reduced to a generic reason so secrets never reach the audit log.
   */
  async recordSsoFailure(ctx: SsoFailureContext, error: unknown, meta: RequestMeta) {
    const reason = error instanceof HttpException ? error.message : 'unexpected_error';
    if (!ctx.tenantId) {
      this.logger.warn(`SSO ${ctx.method} failure before the workspace was known: ${reason}`);
      return;
    }
    await this.audit.log({
      tenantId: ctx.tenantId,
      action: 'SSO_LOGIN_FAILED',
      resource: 'auth',
      resourceId: ctx.providerId ?? null,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { method: ctx.method, reason },
    });
  }

  private async provisionSsoUser(
    provider: Pick<TenantIdentityProvider, 'id' | 'tenantId' | 'name'>,
    email: string,
    profile: SsoProfile,
    meta: RequestMeta,
  ) {
    await this.assertSeatAvailable(provider.tenantId);
    const displayName = profile.name?.trim() || email.split('@')[0];
    const [firstName, ...rest] = displayName.split(/\s+/);
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: provider.tenantId,
          email,
          name: displayName,
          passwordHash: '',
          role: 'EMPLOYEE',
          isActive: true,
        },
      });
      await tx.employee.create({
        data: {
          tenantId: provider.tenantId,
          userId: user.id,
          email,
          firstName,
          lastName: rest.join(' '),
          status: 'ACTIVE',
        },
      });
      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { tenant: { select: { isActive: true } } },
      });
    });
    await this.audit.log({
      tenantId: provider.tenantId,
      userId: user.id,
      action: 'SSO_USER_PROVISIONED',
      resource: 'users',
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { email, providerId: provider.id, providerName: provider.name },
    });
    return user;
  }

  private async assertSeatAvailable(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const limit = employeeLimit(tenant);
    if (limit === Infinity) return;
    const activeEmployees = await this.prisma.employee.count({
      where: { tenantId, status: { not: 'EXITED' } },
    });
    if (activeEmployees >= limit) {
      throw new ForbiddenException(
        `Your ${effectivePlan(tenant)} plan allows ${limit} active employees. Upgrade to add more.`,
      );
    }
  }

  private passwordExpired(policy: TenantAuthPolicy, user: User) {
    if (!policy.passwordExpiresDays) return false;
    const changedAt = user.passwordChangedAt ?? user.createdAt;
    return changedAt.getTime() + policy.passwordExpiresDays * 86_400_000 < Date.now();
  }

  private async assertPasswordMeetsPolicy(
    tenantId: string,
    password: string,
    userId?: string,
  ) {
    const policy = await this.authPolicy(tenantId);
    if (password.length < policy.passwordMinLength) {
      throw new BadRequestException(`Password must be at least ${policy.passwordMinLength} characters`);
    }
    if (userId && policy.passwordHistoryCount > 0) {
      const [currentUser, history] = await Promise.all([
        this.prisma.user.findFirst({
          where: { id: userId, tenantId },
          select: { passwordHash: true },
        }),
        this.prisma.userPasswordHistory.findMany({
          where: { userId, tenantId },
          orderBy: { createdAt: 'desc' },
          take: policy.passwordHistoryCount,
          select: { passwordHash: true },
        }),
      ]);
      const hashes = [
        ...(currentUser?.passwordHash ? [currentUser.passwordHash] : []),
        ...history.map((entry) => entry.passwordHash),
      ].filter((hash) => hash.startsWith('$2'));
      for (const previousHash of hashes) {
        if (await bcrypt.compare(password, previousHash)) {
          throw new BadRequestException(
            `Password cannot match your current password or last ${policy.passwordHistoryCount} password(s)`,
          );
        }
      }
    }
    return policy;
  }

  private async recordPreviousPassword(
    tx: Prisma.TransactionClient,
    user: Pick<User, 'id' | 'tenantId' | 'passwordHash'>,
    keep: number,
  ) {
    if (keep <= 0 || !user.passwordHash.startsWith('$2')) return;
    await tx.userPasswordHistory.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        passwordHash: user.passwordHash,
      },
    });
    const stale = await tx.userPasswordHistory.findMany({
      where: { userId: user.id, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      skip: keep,
      select: { id: true },
    });
    if (stale.length) {
      await tx.userPasswordHistory.deleteMany({
        where: { id: { in: stale.map((entry) => entry.id) } },
      });
    }
  }
}
