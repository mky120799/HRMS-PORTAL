import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
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

  async validateUser(tenantId: string, email: string, pass: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    
    if (user && await bcrypt.compare(pass, user.passwordHash)) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id, tenantId: user.tenantId, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
      tokenType: 'Bearer',
      user,
    };
  }

  async registerUser(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: dto.tenantId, email: dto.email } },
    });

    if (existing) {
      return null;
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        tenantId: dto.tenantId,
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: 'ADMIN',
      },
    });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const { passwordHash, ...result } = user;
    return result;
  }

  async inviteEmployee(tenantId: string, email: string, name: string) {
    let user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });

    if (user) {
      throw new ConflictException('User already exists in this tenant');
    }

    const randomPassword = crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        name,
        passwordHash,
        role: 'EMPLOYEE',
      },
    });

    const inviteToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'INVITE' },
      { expiresIn: '7d' } // 7 days to accept invite
    );

    const inviteLink = `https://your-frontend-domain.com/accept-invite?token=${inviteToken}`;
    const body = `
      <h3>Welcome to HRMS!</h3>
      <p>Hi ${name},</p>
      <p>You have been invited to join the HRMS portal.</p>
      <p>Click the link below to set your password and activate your account:</p>
      <a href="${inviteLink}">Activate Account</a>
    `;

    await this.notificationsQueue.add('send-email', {
      to: email,
      subject: 'You are invited to HRMS',
      body,
      tenantId,
    });

    return { message: 'Invitation sent' };
  }

  async resetPasswordRequest(tenantId: string, email: string) {
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });

    if (!user) {
      // Don't leak user existence
      return { message: 'If an account exists, a reset link has been sent.' };
    }

    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'RESET' },
      { expiresIn: '1h' } // 1 hour for reset
    );

    const resetLink = `https://your-frontend-domain.com/reset-password?token=${resetToken}`;
    const body = `
      <h3>Password Reset Request</h3>
      <p>Hi ${user.name},</p>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <a href="${resetLink}">Reset Password</a>
      <p>If you did not request this, please ignore this email.</p>
    `;

    await this.notificationsQueue.add('send-email', {
      to: email,
      subject: 'Password Reset Request',
      body,
      tenantId,
    });

    return { message: 'If an account exists, a reset link has been sent.' };
  }

  async setPasswordWithToken(token: string, newPassword: string, requiredType: 'INVITE' | 'RESET') {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== requiredType) {
        throw new BadRequestException('Invalid token type');
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: { passwordHash },
      });

      return { message: 'Password updated successfully' };
    } catch (error) {
      throw new BadRequestException('Invalid or expired token');
    }
  }
}
