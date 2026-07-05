import { Controller, Post, Body, Get, UsePipes, UnauthorizedException, Request, UseGuards, ConflictException, Res, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { TwoFactorAuthService } from './two-factor.service';
import { loginSchema } from './dto/login.dto';
import type { LoginDto } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import type { RegisterDto } from './dto/register.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { inviteSchema, resetRequestSchema, setPasswordSchema } from './dto/auth.dto';
import type { InviteDto, ResetRequestDto, SetPasswordDto } from './dto/auth.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorAuthService: TwoFactorAuthService
  ) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 attempts per minute
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(loginDto.tenantId, loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 registrations per minute
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(@Body() registerDto: RegisterDto) {
    const user = await this.authService.registerUser(registerDto);
    if (!user) {
        throw new ConflictException('User already exists for this tenant');
    }
    return user;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req: any) {
    return this.authService.getUserProfile(req.user.userId);
  }

  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UsePipes(new ZodValidationPipe(inviteSchema))
  async inviteEmployee(@Request() req: any, @Body() dto: InviteDto) {
    return this.authService.inviteEmployee(req.user.tenantId, dto.email, dto.name);
  }

  @Post('reset-password-request')
  @UsePipes(new ZodValidationPipe(resetRequestSchema))
  async requestReset(@Body() dto: ResetRequestDto) {
    return this.authService.resetPasswordRequest(dto.tenantId, dto.email);
  }

  @Post('accept-invite')
  @UsePipes(new ZodValidationPipe(setPasswordSchema))
  async acceptInvite(@Body() dto: SetPasswordDto) {
    return this.authService.setPasswordWithToken(dto.token, dto.password, 'INVITE');
  }

  @Post('reset-password')
  @UsePipes(new ZodValidationPipe(setPasswordSchema))
  async resetPassword(@Body() dto: SetPasswordDto) {
    return this.authService.setPasswordWithToken(dto.token, dto.password, 'RESET');
  }

  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Refresh token required');
    return this.authService.refreshTokens(refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Request() req: any) {
    return this.authService.logout(req.user.sub);
  }

  // ─── 2FA / TOTP ───────────────────────────────────────────────────────────────

  @Post('2fa/generate')
  @UseGuards(JwtAuthGuard)
  async generateTwoFactorAuth(@Request() req: any) {
    const user = await this.authService.getUserProfile(req.user.sub);
    const { otpauthUrl } = await this.twoFactorAuthService.generateTwoFactorAuthenticationSecret(user);
    return {
      qrCodeUrl: await this.twoFactorAuthService.generateQrCodeDataURL(otpauthUrl),
    };
  }

  @Post('2fa/turn-on')
  @UseGuards(JwtAuthGuard)
  async turnOnTwoFactorAuth(@Request() req: any, @Body('code') code: string) {
    const user = await this.authService.getUserProfile(req.user.sub);
    const isValid = await this.twoFactorAuthService.isTwoFactorAuthenticationCodeValid(code, user);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
    await this.twoFactorAuthService.turnOnTwoFactorAuthentication(user.id);
    return { message: '2FA successfully enabled' };
  }

  @Post('2fa/authenticate')
  async authenticateTwoFactor(@Body('tempToken') tempToken: string, @Body('code') code: string) {
    if (!tempToken || !code) {
      throw new BadRequestException('tempToken and code are required');
    }
    return this.authService.finalizeTwoFactorLogin(tempToken, code, this.twoFactorAuthService);
  }

  // ─── Google SSO ───────────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Initiates Google OAuth redirect — handled by PassportStrategy
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Request() req: any, @Res() res: Response) {
    const authData = await this.authService.login(req.user);
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    // Redirect to frontend with tokens as query params
    res.redirect(
      `${frontendUrl}/auth/callback?accessToken=${authData.accessToken}&refreshToken=${authData.refreshToken}`
    );
  }
}
