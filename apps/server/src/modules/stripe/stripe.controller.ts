import { Controller, Post, Get, Body, Req, Headers, UseGuards, Query } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async createCheckoutSession(
    @Req() req: any,
    @Body('priceId') priceId: string,
    @Body('successUrl') successUrl: string,
    @Body('cancelUrl') cancelUrl: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.stripeService.createCheckoutSession(tenantId, priceId, successUrl, cancelUrl);
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async createPortalSession(
    @Req() req: any,
    @Body('returnUrl') returnUrl: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.stripeService.createCustomerPortal(tenantId, returnUrl);
  }

  // Stripe Webhook Endpoint (No Auth Guard)
  @Post('webhook')
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: any,
  ) {
    // Fastify/NestJS raw body
    const rawBody = req.rawBody;
    return this.stripeService.handleWebhook(signature, rawBody);
  }
}
