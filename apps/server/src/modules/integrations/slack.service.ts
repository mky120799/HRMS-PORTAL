import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

/** Slack mrkdwn control characters must be escaped in user-provided text. */
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Per-tenant Slack notifications. Each workspace configures its own
 * (encrypted) incoming-webhook URL — one customer's events can never reach
 * another customer's channel. Delivery is best-effort: failures are logged and
 * never break the business operation that triggered them.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async webhookFor(tenantId: string, channel: 'general' | 'hiring'): Promise<string | null> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slackWebhookUrlEnc: true, slackHiringWebhookEnc: true } });
    const enc = channel === 'hiring' ? (t?.slackHiringWebhookEnc ?? t?.slackWebhookUrlEnc) : t?.slackWebhookUrlEnc;
    return this.crypto.decryptOptional(enc);
  }

  private async post(tenantId: string, channel: 'general' | 'hiring', payload: object) {
    try {
      const url = await this.webhookFor(tenantId, channel);
      if (!url) return;
      await axios.post(url, payload, { timeout: 5000, maxRedirects: 0 });
    } catch (err: any) {
      this.logger.warn(`Slack notification failed for tenant ${tenantId}: ${err.message}`);
    }
  }

  leaveDecision(tenantId: string, p: { employeeName: string; type: string; from: string; to: string; days: number; status: string; approvedBy: string }) {
    const icon = p.status === 'APPROVED' ? ':white_check_mark:' : ':x:';
    return this.post(tenantId, 'general', {
      text: `${icon} Leave ${p.status.toLowerCase()}: ${esc(p.employeeName)}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `${icon} *Leave ${esc(p.status)}*` } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Employee:*\n${esc(p.employeeName)}` },
            { type: 'mrkdwn', text: `*Type:*\n${esc(p.type)}` },
            { type: 'mrkdwn', text: `*Dates:*\n${esc(p.from)} → ${esc(p.to)} (${p.days} working day(s))` },
            { type: 'mrkdwn', text: `*Actioned by:*\n${esc(p.approvedBy)}` },
          ],
        },
      ],
    });
  }

  /** Candidate emails are deliberately left out — Slack is not a system of record for applicant PII. */
  newApplication(tenantId: string, p: { jobTitle: string; candidateName: string }) {
    return this.post(tenantId, 'hiring', {
      text: `New application for ${esc(p.jobTitle)}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `:inbox_tray: *New application* for *${esc(p.jobTitle)}* from ${esc(p.candidateName)}` } }],
    });
  }
}
