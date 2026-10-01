/**
 * Transactional email templates. Every interpolated value passes through
 * `escapeHtml` — candidate names, job titles etc. are user-controlled and would
 * otherwise let an attacker inject links/markup into mail sent from our domain.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function layout(heading: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(cta.label)}</a></p>
       <p style="font-size:12px;color:#6b7280">If the button does not work, copy this link: ${escapeHtml(cta.url)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${escapeHtml(heading)}</h2>${body}${button}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/><p style="font-size:12px;color:#9ca3af">Sent by HRMS on behalf of your employer.</p>
</body></html>`;
}

function toText(paragraphs: string[], cta?: { label: string; url: string }): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '');
  return [...paragraphs.map(strip), cta ? `${cta.label}: ${cta.url}` : ''].filter(Boolean).join('\n\n');
}

function build(subject: string, heading: string, paragraphs: string[], cta?: { label: string; url: string }): RenderedEmail {
  return { subject, html: layout(heading, paragraphs, cta), text: toText(paragraphs, cta) };
}

export const EmailTemplates = {
  invite: (p: { name: string; companyName: string; link: string }) =>
    build(`You're invited to ${p.companyName} on HRMS`, `Welcome, ${p.name}`, [
      `${escapeHtml(p.companyName)} has invited you to their HR workspace.`,
      'Set your password to activate your account. This link expires in 7 days and can be used once.',
    ], { label: 'Activate account', url: p.link }),

  passwordReset: (p: { name: string; link: string }) =>
    build('Reset your HRMS password', 'Password reset', [
      `Hi ${escapeHtml(p.name)},`,
      'We received a request to reset your password. This link expires in 1 hour and can be used once.',
      'If you did not request this, you can ignore this email — your password is unchanged.',
    ], { label: 'Reset password', url: p.link }),

  applicationReceived: (p: { candidateName: string; jobTitle: string; companyName: string }) =>
    build(`Application received: ${p.jobTitle}`, 'Thanks for applying', [
      `Hi ${escapeHtml(p.candidateName)},`,
      `${escapeHtml(p.companyName)} has received your application for <strong>${escapeHtml(p.jobTitle)}</strong>. The team will be in touch about next steps.`,
    ]),

  applicationStatus: (p: { candidateName: string; jobTitle: string; companyName: string; status: string }) => {
    const messages: Record<string, string> = {
      SCREENING: 'Your application is being reviewed by the hiring team.',
      INTERVIEW: 'We would like to invite you to interview. You will receive the schedule separately.',
      OFFERED: 'Good news — the team would like to make you an offer. They will contact you shortly.',
      HIRED: 'Congratulations and welcome aboard!',
      REJECTED: 'After careful consideration the team has decided not to move forward. Thank you for your interest.',
    };
    return build(`Update on your application: ${p.jobTitle}`, 'Application update', [
      `Hi ${escapeHtml(p.candidateName)},`,
      `Regarding your application for <strong>${escapeHtml(p.jobTitle)}</strong> at ${escapeHtml(p.companyName)}:`,
      escapeHtml(messages[p.status] ?? 'Your application status has changed.'),
    ]);
  },

  interviewScheduled: (p: { recipientName: string; candidateName: string; jobTitle: string; companyName: string; when: string; calendarUrl: string; location?: string }) =>
    build(`Interview scheduled: ${p.jobTitle}`, 'Interview scheduled', [
      `Hi ${escapeHtml(p.recipientName)},`,
      `An interview for <strong>${escapeHtml(p.jobTitle)}</strong> at ${escapeHtml(p.companyName)} with ${escapeHtml(p.candidateName)} is scheduled for <strong>${escapeHtml(p.when)}</strong>.`,
      p.location ? `Location / link: ${escapeHtml(p.location)}` : '',
    ].filter(Boolean), { label: 'Add to Google Calendar', url: p.calendarUrl }),

  interviewRescheduled: (p: { recipientName: string; candidateName: string; jobTitle: string; companyName: string; when: string; calendarUrl: string; location?: string }) =>
    build(`Interview rescheduled: ${p.jobTitle}`, 'Interview rescheduled', [
      `Hi ${escapeHtml(p.recipientName)},`,
      `Your interview for <strong>${escapeHtml(p.jobTitle)}</strong> at ${escapeHtml(p.companyName)} with ${escapeHtml(p.candidateName)} has been <strong>rescheduled</strong>.`,
      `New time: <strong>${escapeHtml(p.when)}</strong>.`,
      p.location ? `Location / link: ${escapeHtml(p.location)}` : '',
    ].filter(Boolean), { label: 'Add to Google Calendar', url: p.calendarUrl }),

  interviewReminder: (p: { recipientName: string; candidateName: string; jobTitle: string; companyName: string; when: string; calendarUrl: string; location?: string }) =>
    build(`Reminder: Interview tomorrow — ${p.jobTitle}`, 'Interview reminder', [
      `Hi ${escapeHtml(p.recipientName)},`,
      `This is a reminder that your interview for <strong>${escapeHtml(p.jobTitle)}</strong> at ${escapeHtml(p.companyName)} with ${escapeHtml(p.candidateName)} is coming up.`,
      `Scheduled: <strong>${escapeHtml(p.when)}</strong>.`,
      p.location ? `Location / link: ${escapeHtml(p.location)}` : '',
    ].filter(Boolean), { label: 'View in Google Calendar', url: p.calendarUrl }),

  leaveDecision: (p: { name: string; status: string; type: string; from: string; to: string; note?: string | null }) =>
    build(`Your ${p.type.toLowerCase()} leave was ${p.status.toLowerCase()}`, `Leave ${p.status.toLowerCase()}`, [
      `Hi ${escapeHtml(p.name)},`,
      `Your ${escapeHtml(p.type)} leave from ${escapeHtml(p.from)} to ${escapeHtml(p.to)} has been <strong>${escapeHtml(p.status.toLowerCase())}</strong>.`,
      p.note ? `Note from approver: ${escapeHtml(p.note)}` : '',
    ].filter(Boolean)),

  /** Admin-composed message. `safeHtml` must already be sanitised (see NotificationsService). */
  announcement: (p: { subject: string; safeHtml: string; companyName: string }) => ({
    subject: p.subject,
    html: layout(p.subject, [p.safeHtml, `— ${escapeHtml(p.companyName)}`]),
    text: toText([p.safeHtml]),
  }),
};
