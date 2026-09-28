import { Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { StripeService } from './stripe.service';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PAID_PLANS, type PaidPlan } from '../../common/subscription/subscription-plans';

const checkoutSchema = z.object({ plan: z.enum(PAID_PLANS) });

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly stripe: StripeService) {}

  @Get('plans')
  plans() {
    return this.stripe.plans();
  }

  @Post('checkout')
  @Roles('ADMIN')
  checkout(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(checkoutSchema)) dto: { plan: PaidPlan }) {
    return this.stripe.createCheckout(user, dto.plan);
  }

  @Post('portal')
  @Roles('ADMIN')
  portal(@CurrentUser() user: AuthUser) {
    return this.stripe.createPortal(user);
  }
}

@Controller('stripe')
export class StripeWebhookController {
  constructor(private readonly stripe: StripeService) {}

  /** Authenticated by Stripe's signature, not a JWT. */
  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  webhook(@Headers('stripe-signature') signature: string | undefined, @Req() req: RawBodyRequest<FastifyRequest>) {
    return this.stripe.handleWebhook(signature, req.rawBody);
  }
}
