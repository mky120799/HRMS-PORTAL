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

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

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
  SENT:    <CheckCircle2 size={14} className="text-emerald-500" />,
  PENDING: <Clock       size={14} className="text-amber-500" />,
  FAILED:  <XCircle     size={14} className="text-red-500" />,
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
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Notifications & Email</h2>
        <p className="text-muted-foreground mt-2">Send emails and track system notifications.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Compose Email */}
        <Card className="lg:col-span-2 bg-white/50 backdrop-blur-xl h-fit">
          <CardHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-indigo-500/10 rounded-lg">
                <Mail size={20} className="text-indigo-500" />
              </div>
              <CardTitle>Compose Email</CardTitle>
            </div>
            <CardDescription>Send email via SMTP or Ethereal test account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => sendEmail.mutate(v))} className="space-y-4">
              <div className="space-y-2">
                <Label>To</Label>
                <Input type="email" placeholder="recipient@company.com" {...register('to')} className="bg-white/50" />
                {errors.to && <p className="text-red-500 text-xs">{errors.to.message}</p>}
              </div>
              
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input placeholder="Email subject..." {...register('subject')} className="bg-white/50" />
                {errors.subject && <p className="text-red-500 text-xs">{errors.subject.message}</p>}
              </div>
              
              <div className="space-y-2">
                <Label>Message</Label>
                <div className="bg-white rounded-md border border-input overflow-hidden">
                  <ReactQuill 
                    theme="snow" 
                    value={watch('body')} 
                    onChange={(val) => setValue('body', val, { shouldValidate: true })}
                    className="h-[200px] mb-10"
                  />
                </div>
                {errors.body && <p className="text-red-500 text-xs mt-1">{errors.body.message}</p>}
              </div>

              <Button type="submit" disabled={isSubmitting || sendEmail.isPending} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white">
                <Send size={16} className="mr-2" />
                {sendEmail.isPending ? 'Sending...' : 'Send Email'}
              </Button>

              <div className="mt-4 p-3 bg-indigo-50/50 rounded-lg text-xs text-muted-foreground border border-indigo-100">
                💡 No SMTP configured? Emails are captured by <a href="https://ethereal.email" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Ethereal.email</a>. Check the terminal for the preview link.
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Sent Emails Log */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="bg-white/50 backdrop-blur-xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/50">
              <div className="flex items-center gap-2">
                <Inbox size={18} className="text-indigo-500" />
                <CardTitle className="text-lg">Email History</CardTitle>
              </div>
              <Badge variant="secondary" className="bg-indigo-50 text-indigo-600 font-medium">
                {emailLogs.length}
              </Badge>
            </CardHeader>
            <div className="max-h-[340px] overflow-y-auto divide-y divide-border/50">
              {emailLogs.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">No emails sent yet.</div>
              )}
              {emailLogs.map((n) => (
                <div key={n.id} className="p-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">{n.subject ?? n.title}</span>
                    <div className="flex items-center gap-1.5 text-xs">
                      {STATUS_ICON[n.status]}
                      <span className={`font-medium ${
                        n.status === 'SENT' ? 'text-emerald-500' : 
                        n.status === 'FAILED' ? 'text-red-500' : 'text-amber-500'
                      }`}>
                        {n.status}
                      </span>
                    </div>
                  </div>
                  {n.recipientEmail && (
                    <div className="text-xs text-muted-foreground mb-1">To: {n.recipientEmail}</div>
                  )}
                  <div className="text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* In-App & SMS Notifications */}
          <Card className="bg-white/50 backdrop-blur-xl overflow-hidden">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="text-lg">Other Notifications</CardTitle>
            </CardHeader>
            <div className="max-h-[260px] overflow-y-auto divide-y divide-border/50">
              {inAppLogs.length === 0 && (
                <div className="p-6 text-center text-muted-foreground">None yet.</div>
              )}
              {inAppLogs.map((n) => (
                <div key={n.id} className="p-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm">{n.title}</span>
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                      {n.channel}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {n.body.slice(0, 80)}{n.body.length > 80 ? '...' : ''}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
