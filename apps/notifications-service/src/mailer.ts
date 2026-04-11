import nodemailer from 'nodemailer';
import { env } from './env';

let _transporter: nodemailer.Transporter | null = null;

export async function getTransporter(): Promise<nodemailer.Transporter> {
  if (_transporter) return _transporter;

  if (env.smtpHost && env.smtpUser && env.smtpPass) {
    // Use real configured SMTP
    _transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
    console.log(`📧 Mailer: using real SMTP → ${env.smtpHost}:${env.smtpPort}`);
  } else {
    // Auto-create a free Ethereal.email test account for development
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('📧 Mailer: No SMTP configured — using Ethereal test account');
    console.log(`   Inbox: https://ethereal.email/login`);
    console.log(`   User:  ${testAccount.user}`);
    console.log(`   Pass:  ${testAccount.pass}`);
  }

  return _transporter;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  const transport = await getTransporter();
  const info = await transport.sendMail({
    from: env.smtpFrom,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? `<p>${opts.text.replace(/\n/g, '<br>')}</p>`,
  });

  console.log(`📧 Email sent → ${opts.to} | Subject: "${opts.subject}"`);
  // For Ethereal, log the preview URL
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) console.log(`   Preview: ${previewUrl}`);

  return info;
}
