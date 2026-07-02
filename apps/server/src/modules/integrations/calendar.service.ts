import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private calendar: any = null;

  constructor(private configService: ConfigService) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const refreshToken = this.configService.get<string>('GOOGLE_CALENDAR_REFRESH_TOKEN');

    if (clientId && clientSecret && refreshToken) {
      const auth = new google.auth.OAuth2(clientId, clientSecret);
      auth.setCredentials({ refresh_token: refreshToken });
      this.calendar = google.calendar({ version: 'v3', auth });
      this.logger.log('Google Calendar integration enabled ✅');
    } else {
      this.logger.warn('GOOGLE_CALENDAR_REFRESH_TOKEN not set — Calendar integration will return mock links.');
    }
  }

  async createInterviewEvent(opts: {
    jobTitle: string;
    candidateName: string;
    candidateEmail: string;
    interviewerEmail?: string;
  }): Promise<{ eventLink: string; meetLink: string | null }> {
    const startTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week from now
    const endTime = new Date(startTime.getTime() + 45 * 60 * 1000); // 45 min duration

    if (!this.calendar) {
      // Graceful fallback — return a placeholder
      return {
        eventLink: `https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent(`Interview: ${opts.candidateName} for ${opts.jobTitle}`)}&dates=${this.formatDate(startTime)}/${this.formatDate(endTime)}&add=${encodeURIComponent(opts.candidateEmail)}`,
        meetLink: null,
      };
    }

    try {
      const attendees = [
        { email: opts.candidateEmail },
        ...(opts.interviewerEmail ? [{ email: opts.interviewerEmail }] : []),
      ];

      const event = await this.calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: 1,
        sendUpdates: 'all',
        resource: {
          summary: `Interview: ${opts.candidateName} — ${opts.jobTitle}`,
          description: `Interview for the ${opts.jobTitle} position.\n\nCandidate: ${opts.candidateName} (${opts.candidateEmail})`,
          start: { dateTime: startTime.toISOString(), timeZone: 'UTC' },
          end: { dateTime: endTime.toISOString(), timeZone: 'UTC' },
          attendees,
          conferenceData: {
            createRequest: {
              requestId: `hrms-${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 60 },
              { method: 'popup', minutes: 15 },
            ],
          },
        },
      });

      const meetLink = event.data.conferenceData?.entryPoints?.find(
        (e: any) => e.entryPointType === 'video',
      )?.uri ?? null;

      return {
        eventLink: event.data.htmlLink ?? '',
        meetLink,
      };
    } catch (err: any) {
      this.logger.error(`Failed to create calendar event: ${err.message}`);
      return {
        eventLink: '',
        meetLink: null,
      };
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }
}
