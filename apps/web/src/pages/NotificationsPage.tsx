import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Inbox, CheckCircle2, XCircle, Clock, Megaphone } from 'lucide-react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { api, type Paged } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { getAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

type Notification = { id: string; channel: string; title: string; body: string; status: string; recipientEmail?: string | null; error?: string | null; createdAt: string };

const STATUS_ICON: Record<string, React.ReactNode> = {
  SENT: <CheckCircle2 size={14} className="text-emerald-500" />,
  READ: <CheckCircle2 size={14} className="text-slate-400" />,
  QUEUED: <Clock size={14} className="text-amber-500" />,
  FAILED: <XCircle size={14} className="text-red-500" />,
};

export function NotificationsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const isAdmin = getAuth()?.user.role === 'ADMIN';
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [mode, setMode] = useState<'announce' | 'direct'>('announce');
  const [draft, setDraft] = useState({ to: '', department: '', subject: '', body: '' });

  const list = useQuery({
    queryKey: ['notifications', scope],
    queryFn: async () => (await api.get<Paged<Notification>>('/notifications', { params: { scope, pageSize: 50 } })).data,
    refetchInterval: 15_000,
  });

  const send = useMutation({
    mutationFn: async () =>
      mode === 'announce'
        ? (await api.post('/notifications/announce', { subject: draft.subject, body: draft.body, department: draft.department || undefined })).data
        : (await api.post('/notifications/compose-email', { to: draft.to, subject: draft.subject, body: draft.body })).data,
    onSuccess: (d: any) => {
      setDraft({ to: '', department: '', subject: '', body: '' });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      showToast(`Queued for ${d.queued} recipient(s)`, 'success');
    },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
        <p className="text-muted-foreground mt-2">{isAdmin ? 'Your inbox, company announcements and the email delivery log.' : 'Messages and updates sent to you.'}</p>
      </div>

      <div className={`grid gap-6 ${isAdmin ? 'lg:grid-cols-5' : ''}`}>
        {isAdmin && (
          <Card className="lg:col-span-2 bg-white/50 backdrop-blur-xl h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone size={18} /> Compose
              </CardTitle>
              <CardDescription>Messages can only be sent to members of your workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button size="sm" variant={mode === 'announce' ? 'default' : 'outline'} onClick={() => setMode('announce')}>Announcement</Button>
                <Button size="sm" variant={mode === 'direct' ? 'default' : 'outline'} onClick={() => setMode('direct')}>To one person</Button>
              </div>
              {mode === 'direct' ? (
                <div className="space-y-1">
                  <Label>Recipient email</Label>
                  <Input type="email" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Department (leave empty for everyone)</Label>
                  <Input value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} />
                </div>
              )}
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Message</Label>
                <ReactQuill theme="snow" value={draft.body} onChange={(v) => setDraft((d) => ({ ...d, body: v }))} className="bg-white" />
              </div>
              <Button
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white"
                disabled={send.isPending || !draft.subject || !draft.body.replace(/<[^>]+>/g, '').trim() || (mode === 'direct' && !draft.to)}
                onClick={() => send.mutate()}
              >
                <Send size={16} className="mr-2" /> Send
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className={`${isAdmin ? 'lg:col-span-3' : ''} bg-white/50 backdrop-blur-xl`}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Inbox size={18} /> {scope === 'mine' ? 'Inbox' : 'Delivery log'}
            </CardTitle>
            {isAdmin && (
              <select className="h-9 rounded-md border bg-white/70 px-2 text-sm" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')}>
                <option value="mine">My inbox</option>
                <option value="all">All deliveries</option>
              </select>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {list.data?.items.map((n) => (
              <div
                key={n.id}
                className={`rounded-lg border p-3 bg-white/40 ${n.channel === 'IN_APP' && n.status !== 'READ' && scope === 'mine' ? 'border-indigo-300' : ''}`}
                onClick={() => n.channel === 'IN_APP' && n.status !== 'READ' && scope === 'mine' && markRead.mutate(n.id)}
              >
                <div className="flex justify-between items-center gap-2">
                  <div className="font-medium truncate">{n.title}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{n.channel === 'IN_APP' ? 'In-app' : 'Email'}</Badge>
                    {STATUS_ICON[n.status]}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {scope === 'all' && n.recipientEmail ? `To ${n.recipientEmail} · ` : ''}
                  {fmtDate(n.createdAt)}
                  {n.error ? ` · ${n.error}` : ''}
                </div>
              </div>
            ))}
            {!list.isLoading && !list.data?.items.length && <div className="text-center text-muted-foreground py-8">Nothing here yet.</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
