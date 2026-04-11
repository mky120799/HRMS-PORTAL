import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Mail, Send, Inbox, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

const composeSchema = z.object({
  to: z.string().email('Enter a valid email address'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
});

type ComposeForm = z.infer<typeof composeSchema>;

type Notification = {
  id: string;
  channel: string;
  title: string;
  body: string;
  status: string;
  recipientEmail?: string;
  subject?: string;
  createdAt: string;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  SENT:    <CheckCircle2 size={14} color="#10b981" />,
  PENDING: <Clock       size={14} color="#f59e0b" />,
  FAILED:  <XCircle     size={14} color="#ef4444" />,
};

export function NotificationsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();

  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data as Notification[],
    refetchInterval: 5000,
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<ComposeForm>({
    resolver: zodResolver(composeSchema),
    defaultValues: { body: '' }
  });

  const sendEmail = useMutation({
    mutationFn: async (body: ComposeForm) => api.post('/notifications/compose-email', body),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['notifications'] });
      showToast('✅ Email sent successfully! Check the terminal for the Ethereal preview link.');
    },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  const emailLogs = list.data?.filter(n => n.channel === 'EMAIL') ?? [];
  const inAppLogs = list.data?.filter(n => n.channel !== 'EMAIL') ?? [];

  return (
    <div>
      <div className="topbar">
        <h2>Notifications & Email</h2>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: '1fr 1.5fr' }}>

        {/* ── Compose Email ── */}
        <div className="card">
          <div className="row gap" style={{ marginBottom: 20 }}>
            <div style={{ background: 'rgba(99,102,241,0.1)', padding: 10, borderRadius: 10 }}>
              <Mail size={20} color="var(--primary)" />
            </div>
            <div>
              <h3 style={{ margin: 0 }}>Compose Email</h3>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Send email via SMTP or Ethereal test account</div>
            </div>
          </div>

          <form onSubmit={handleSubmit((v) => sendEmail.mutate(v))}>
            <div style={{ marginBottom: 14 }}>
              <label>To</label>
              <input type="email" placeholder="recipient@company.com" {...register('to')} />
              {errors.to && <p className="error-text">{errors.to.message}</p>}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label>Subject</label>
              <input placeholder="Email subject..." {...register('subject')} />
              {errors.subject && <p className="error-text">{errors.subject.message}</p>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <label>Message</label>
              <div style={{ background: 'white', borderRadius: 8, overflow: 'hidden' }}>
                <ReactQuill 
                  theme="snow" 
                  value={watch('body')} 
                  onChange={(val) => setValue('body', val, { shouldValidate: true })}
                  style={{ height: 200, marginBottom: 40 }}
                />
              </div>
              {errors.body && <p className="error-text" style={{ marginTop: 8 }}>{errors.body.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting || sendEmail.isPending} style={{ width: '100%' }}>
              <Send size={16} style={{ marginRight: 8 }} />
              {sendEmail.isPending ? 'Sending...' : 'Send Email'}
            </button>

            <div style={{ marginTop: 12, padding: 12, background: 'rgba(99,102,241,0.05)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              💡 No SMTP configured? Emails are captured by <a href="https://ethereal.email" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>Ethereal.email</a>. Check the terminal for the preview link.
            </div>
          </form>
        </div>

        {/* ── Sent Emails Log ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div className="row gap">
                <Inbox size={18} color="var(--primary)" />
                <h3 style={{ margin: 0 }}>Email History</h3>
                <span className="muted" style={{ fontSize: 12 }}>({emailLogs.length})</span>
              </div>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {emailLogs.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 32 }}>No emails sent yet.</p>}
              {emailLogs.map((n) => (
                <div key={n.id} style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{n.subject ?? n.title}</span>
                    <div className="row gap" style={{ gap: 4, fontSize: 12 }}>
                      {STATUS_ICON[n.status]}
                      <span style={{ color: n.status === 'SENT' ? '#10b981' : n.status === 'FAILED' ? '#ef4444' : '#f59e0b' }}>{n.status}</span>
                    </div>
                  </div>
                  {n.recipientEmail && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>To: {n.recipientEmail}</div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── In-App & SMS Notifications ── */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: 0 }}>Other Notifications</h3>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {inAppLogs.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>None yet.</p>}
              {inAppLogs.map((n) => (
                <div key={n.id} style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</span>
                    <span style={{ fontSize: 11, background: 'rgba(0,0,0,0.05)', padding: '2px 8px', borderRadius: 4 }}>{n.channel}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{n.body.slice(0, 80)}{n.body.length > 80 ? '...' : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
