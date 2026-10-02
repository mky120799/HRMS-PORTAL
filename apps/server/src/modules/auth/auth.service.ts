import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import type { Tenant, User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from '../../common/auth/token.service';
import { AuditService } from '../../common/audit/audit.service';
import { EmailTemplates } from '../../common/email/templates';
import {
  DEFAULT_LEAVE_POLICIES,
  type Role,
} from '../../common/constants/domain';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationPublisherService,
    private readonly twoFactor: TwoFactorAuthService,
    config: ConfigService,
  ) {
    this.frontendUrl = config.get('FRONTEND_URL', 'http://localhost:5173');
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
    const session = await this.issueSession(user);
    return { ...session, isNewTenant: true };
  }

  // ─── Login ──────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, meta: RequestMeta) {
    const tenant = await this.resolveTenant(dto.tenantId);
    const user = tenant
      ? await this.prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
        })
      : null;

    if (!tenant || !user) {
      await bcrypt.compare(dto.password, this.dummyHash);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Too many failed attempts. Try again in a few minutes or reset your password.',
      );
    }

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

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    if (user.isTwoFactorEnabled) {
      return {
        twoFactorRequired: true,
        tempToken: this.tokens.sign('two_factor', {
          sub: user.id,
          ver: user.tokenVersion,
        }),
      };
    }

    await this.audit.log({
      tenantId: tenant.id,
      userId: user.id,
      action: 'LOGIN',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.issueSession(user);
  }

  private async recordFailedLogin(user: User, meta: RequestMeta) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : user.lockedUntil,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
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
    if (!this.twoFactor.verifyCode(code, user.twoFactorSecret)) {
      await this.recordFailedLogin(user, meta);
      throw new UnauthorizedException('Invalid 2FA code');
    }
    await this.twoFactor.upgradeLegacySecret(user.id, user.twoFactorSecret);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'LOGIN',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { method: '2fa' },
    });
    return this.issueSession(user);
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────

  /**
   * Issues a 15-minute access token and a 7-day refresh token. One active
   * refresh token per user is stored (hashed); rotating it on every refresh
   * means a stolen token stops working as soon as the real user refreshes.
   */
  async issueSession(user: User) {
    const [employee, tenant] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { userId: user.id },
        select: { id: true },
      }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { id: true, slug: true, name: true },
      }),
    ]);
    const accessToken = this.tokens.sign('access', {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
      employeeId: employee?.id ?? null,
    });
    const refreshToken = this.tokens.sign('refresh', {
      sub: user.id,
      ver: user.tokenVersion,
      jti: randomUUID(),
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken: sha256(refreshToken),
        refreshTokenExpiry: new Date(Date.now() + REFRESH_TTL_MS),
        lastLoginAt: new Date(),
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 15 * 60,
      user: { ...this.publicUser(user), employeeId: employee?.id ?? null },
      tenant,
    };
  }

  async refresh(refreshToken: string) {
    const payload = this.tokens.verify<{ ver: number }>(
      'refresh',
      refreshToken,
    );
    const user = await this.activeUserWithVersion(payload.sub, payload.ver);

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
        // A validly-signed but already-rotated token was replayed: assume theft and end the session.
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
          `Refresh token reuse detected for user ${user.id}; session revoked`,
        );
      }
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    return this.issueSession(user);
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, refreshTokenExpiry: null },
    });
    return { message: 'Logged out' };
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
      ...this.publicUser(user),
      employee: user.employee,
      tenant: user.tenant,
    };
  }

  private publicUser(user: User) {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role as Role,
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

    const [firstName, ...rest] = dto.name.split(/\s+/);
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          name: dto.name,
          passwordHash: '',
          role: dto.role,
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
        data: { invitedUserId: user.id, role: dto.role },
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
      newValues: { email: dto.email, role: dto.role },
    });
    return { message: 'Invitation sent', userId: user.id };
  }

  /** Always returns the same response, so it cannot be used to discover which emails have accounts. */
  async requestPasswordReset(dto: ResetRequestDto) {
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
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        tokenVersion: { increment: 1 },
        refreshToken: null,
        refreshTokenExpiry: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: purpose === 'invite' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET',
      resource: 'auth',
    });
    return { message: 'Password set. You can now sign in.' };
  }

  async changePassword(auth: AuthUser, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
    });
    const valid =
      user.passwordHash.length > 0 &&
      (await bcrypt.compare(dto.currentPassword, user.passwordHash));
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
        tokenVersion: { increment: 1 },
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      resource: 'auth',
    });
    return this.issueSession(updated); // other devices are signed out; this one continues
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
    await this.audit.log({
      tenantId: user.tenantId,
      userId,
      action: '2FA_ENABLED',
      resource: 'auth',
    });
    return { message: 'Two-factor authentication enabled' };
  }

  async disableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await this.twoFactor.disable(user, code);
    await this.audit.log({
      tenantId: user.tenantId,
      userId,
      action: '2FA_DISABLED',
      resource: 'auth',
    });
    return { message: 'Two-factor authentication disabled' };
  }

  // ─── Google SSO ─────────────────────────────────────────────────────────────

  /** OAuth `state` carries the workspace slug; signed so it cannot be tampered with in transit. */
  createSsoState(tenantSlug: string) {
    return this.tokens.sign('sso_state', {
      sub: 'sso',
      tenant: tenantSlug.toLowerCase(),
    });
  }

  readSsoState(state: string | undefined): string {
    if (!state) throw new UnauthorizedException('Missing SSO state');
    return this.tokens.verify<{ tenant: string }>('sso_state', state).tenant;
  }

  /**
   * SSO only signs in people who already have an account in the chosen
   * workspace — it never auto-provisions users. Returns a 60-second one-time
   * code; the SPA exchanges it for tokens, so tokens never appear in URLs.
   */
  async ssoLogin(tenantSlug: string, googleEmail: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
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
    return this.tokens.sign('sso_exchange', {
      sub: user.id,
      ver: user.tokenVersion,
    });
  }

  async exchangeSsoCode(code: string, meta: RequestMeta) {
    const payload = this.tokens.verify<{ ver: number }>('sso_exchange', code);
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
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'LOGIN',
      resource: 'auth',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      newValues: { method: 'google' },
    });
    return this.issueSession(user);
  }
}
