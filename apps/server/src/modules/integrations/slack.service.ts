import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly webhookUrl: string | undefined;
  private readonly hiringWebhookUrl: string | undefined;

  constructor(
    private configService: ConfigService,
    @InjectQueue('notifications') private notificationsQueue: Queue,
  ) {
    this.webhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL');
    this.hiringWebhookUrl = this.configService.get<string>('SLACK_HIRING_WEBHOOK_URL') ?? this.webhookUrl;

    if (this.webhookUrl) {
      this.logger.log('Slack integration enabled ✅');
    } else {
      this.logger.warn('SLACK_WEBHOOK_URL not set — Slack notifications disabled.');
    }
  }

  private async postToSlack(webhookUrl: string, payload: object): Promise<void> {
    try {
      await axios.post(webhookUrl, payload, { timeout: 5000 });
    } catch (err: any) {
      this.logger.error(`Failed to post to Slack: ${err.message}`);
    }
  }

  async sendLeaveApprovalNotification(opts: {
    employeeName: string;
    leaveType: string;
    startDate: Date;
    endDate: Date;
    status: 'APPROVED' | 'REJECTED';
    approvedBy: string;
  }): Promise<void> {
    if (!this.webhookUrl) return;

    const emoji = opts.status === 'APPROVED' ? '✅' : '❌';
    const color = opts.status === 'APPROVED' ? '#10b981' : '#ef4444';
    const days = Math.ceil((opts.endDate.getTime() - opts.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    await this.postToSlack(this.webhookUrl, {
      attachments: [{
        color,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *Leave Request ${opts.status}*`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Employee:*\n${opts.employeeName}` },
              { type: 'mrkdwn', text: `*Type:*\n${opts.leaveType}` },
              { type: 'mrkdwn', text: `*Duration:*\n${days} day(s)` },
              { type: 'mrkdwn', text: `*Dates:*\n${opts.startDate.toDateString()} → ${opts.endDate.toDateString()}` },
              { type: 'mrkdwn', text: `*Actioned by:*\n${opts.approvedBy}` },
            ],
          },
        ],
      }],
    });

    this.logger.log(`Slack leave notification sent for ${opts.employeeName}`);
  }

  async sendNewApplicationAlert(opts: {
    jobTitle: string;
    candidateName: string;
    candidateEmail: string;
    aiScore?: number;
    aiReason?: string;
  }): Promise<void> {
    if (!this.hiringWebhookUrl) return;

    const scoreEmoji = opts.aiScore
      ? opts.aiScore >= 75 ? '🟢' : opts.aiScore >= 50 ? '🟡' : '🔴'
      : '⚪';

    await this.postToSlack(this.hiringWebhookUrl, {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📩 *New Job Application Received!*`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Position:*\n${opts.jobTitle}` },
            { type: 'mrkdwn', text: `*Candidate:*\n${opts.candidateName}` },
            { type: 'mrkdwn', text: `*Email:*\n${opts.candidateEmail}` },
            {
              type: 'mrkdwn',
              text: opts.aiScore
                ? `*AI Score:*\n${scoreEmoji} ${opts.aiScore}/100`
                : `*AI Score:*\nPending...`,
            },
          ],
        },
        ...(opts.aiReason ? [{
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `💡 _${opts.aiReason}_` }],
        }] : []),
      ],
    });

    this.logger.log(`Slack hiring alert sent for ${opts.candidateName}`);
  }
}
