import { Controller, Post, Body, Get, UsePipes, UnauthorizedException, Request, UseGuards, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
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
  constructor(private readonly authService: AuthService) {}

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
}
