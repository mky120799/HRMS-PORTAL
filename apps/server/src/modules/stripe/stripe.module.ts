import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { BillingController, StripeWebhookController } from './stripe.controller';

@Module({
  controllers: [BillingController, StripeWebhookController],
  providers: [StripeService],
})
export class BillingModule {}
