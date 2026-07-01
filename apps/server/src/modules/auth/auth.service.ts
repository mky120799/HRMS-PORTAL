import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import type { RegisterDto } from './dto/register.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  // ─── Core Auth ───────────────────────────────────────────────────────────────

  async validateUser(tenantId: string, email: string, pass: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (user && await bcrypt.compare(pass, user.passwordHash)) {
      const { passwordHash, refreshToken, ...result } = user;
      return result;
    }
    return null;
  }

  private generateTokens(user: any) {
    const payload = { email: user.email, sub: user.id, tenantId: user.tenantId, role: user.role };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwtService.sign({ sub: user.id }, { expiresIn: '7d' });
    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, refreshToken: string) {
    const hashed = await bcrypt.hash(refreshToken, 10);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed, refreshTokenExpiry: expiry },
    });
  }

  async login(user: any) {
    const { accessToken, refreshToken } = this.generateTokens(user);
    await this.saveRefreshToken(user.id, refreshToken);
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: '15m',
      user,
    };
  }

  async refreshTokens(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.refreshToken || !user.refreshTokenExpiry) {
      throw new UnauthorizedException('Session not found');
    }
    if (new Date() > user.refreshTokenExpiry) {
      throw new UnauthorizedException('Refresh token expired. Please log in again.');
    }
    const tokenMatches = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!tokenMatches) {
      throw new UnauthorizedException('Refresh token mismatch');
    }

    const { passwordHash, refreshToken: _, ...safeUser } = user;
    const tokens = this.generateTokens(safeUser);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    return { ...tokens, tokenType: 'Bearer', expiresIn: '15m' };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, refreshTokenExpiry: null },
    });
    return { message: 'Logged out successfully' };
  }

  // ─── Profile & Registration ───────────────────────────────────────────────────

  async registerUser(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: dto.tenantId, email: dto.email } },
    });
    if (existing) return null;

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: { tenantId: dto.tenantId, email: dto.email, passwordHash, name: dto.name, role: 'ADMIN' },
    });
    const { passwordHash: _, refreshToken: __, ...result } = user;
    return result;
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const { passwordHash, refreshToken, ...result } = user;
    return result;
  }

  // ─── Invite & Password Reset ──────────────────────────────────────────────────

  async inviteEmployee(tenantId: string, email: string, name: string) {
    let user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (user) throw new ConflictException('User already exists in this tenant');

    const randomPassword = crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    user = await this.prisma.user.create({
      data: { tenantId, email, name, passwordHash, role: 'EMPLOYEE' },
    });

    const inviteToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'INVITE' },
      { expiresIn: '7d' }
    );

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const inviteLink = `${frontendUrl}/accept-invite?token=${inviteToken}`;
    await this.notificationsQueue.add('send-email', {
      to: email,
      subject: 'You are invited to HRMS',
      body: `<h3>Welcome to HRMS!</h3><p>Hi ${name},</p><p>You have been invited. <a href="${inviteLink}">Activate Account</a></p>`,
      tenantId,
    });

    return { message: 'Invitation sent' };
  }

  async resetPasswordRequest(tenantId: string, email: string) {
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (!user) return { message: 'If an account exists, a reset link has been sent.' };

    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'RESET' },
      { expiresIn: '1h' }
    );

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
    await this.notificationsQueue.add('send-email', {
      to: email,
      subject: 'Password Reset Request',
      body: `<h3>Password Reset</h3><p>Hi ${user.name},</p><p><a href="${resetLink}">Reset Password</a></p>`,
      tenantId,
    });

    return { message: 'If an account exists, a reset link has been sent.' };
  }

  async setPasswordWithToken(token: string, newPassword: string, requiredType: 'INVITE' | 'RESET') {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== requiredType) throw new BadRequestException('Invalid token type');

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: { passwordHash },
      });
      return { message: 'Password updated successfully' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Invalid or expired token');
    }
  }
}

