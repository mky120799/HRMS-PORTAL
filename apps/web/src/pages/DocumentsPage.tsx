import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { File, Upload, Trash2, Download, AlertTriangle } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { getAuth } from '../lib/auth';
import { fmtDate, fmtDay } from '../lib/format';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';

type Doc = {
  id: string;
  title: string;
  type: string;
  mimeType: string | null;
  sizeBytes: number | null;
  expiryDate: string | null;
  createdAt: string;
  employee?: { firstName: string; lastName: string };
};
type UploadForm = { title: string; type: string; expiryDate?: string; file: FileList };

const TYPES = ['ID', 'CONTRACT', 'CERTIFICATE', 'POLICY', 'OTHER'];
const kb = (n: number | null) => (n == null ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

function DocRow({ d, onDelete, showOwner }: { d: Doc; onDelete?: () => void; showOwner?: boolean }) {
  const { showToast } = useToast();
  const expired = d.expiryDate && new Date(d.expiryDate) < new Date();
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border bg-white/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
          <File size={18} />
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">
            {d.title} <Badge variant="outline" className="ml-1">{d.type}</Badge>
            {expired && <Badge className="ml-1 bg-red-100 text-red-700 border-red-200">Expired</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            {showOwner && d.employee ? `${d.employee.firstName} ${d.employee.lastName} · ` : ''}
            Uploaded {fmtDate(d.createdAt)} · {kb(d.sizeBytes)}
            {d.expiryDate ? ` · Expires ${fmtDay(d.expiryDate)}` : ''}
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" onClick={() => downloadFile(`/documents/${d.id}/download`, d.title).catch((e) => showToast(getErrorMessage(e), 'error'))}>
          <Download size={16} />
        </Button>
        {onDelete && (
          <Button variant="ghost" size="icon" className="text-red-500" onClick={onDelete}>
            <Trash2 size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}

export function DocumentsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const isAdmin = getAuth()?.user.role === 'ADMIN';
  const { register, handleSubmit, reset } = useForm<UploadForm>({ defaultValues: { type: 'OTHER' } });

  const mine = useQuery({ queryKey: ['documents', 'me'], queryFn: async () => (await api.get<Doc[]>('/documents/me')).data, retry: false });
  const expiring = useQuery({ queryKey: ['documents', 'expiring'], enabled: isAdmin, queryFn: async () => (await api.get<Doc[]>('/documents/expiring', { params: { days: 45 } })).data });
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');

  const upload = useMutation({
    mutationFn: async (data: UploadForm) => {
      const file = data.file?.[0];
      if (!file) throw new Error('Choose a file');
      if (file.size > 10 * 1024 * 1024) throw new Error('File must be 10 MB or smaller');
      const form = new FormData();
      // Text fields must precede the file so the server can read them while streaming.
      form.append('title', data.title);
      form.append('type', data.type);
      if (data.expiryDate) form.append('expiryDate', data.expiryDate);
      form.append('file', file);
      return api.post('/documents/upload', form);
    },
    onSuccess: () => {
      showToast('Document uploaded', 'success');
      reset();
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      showToast('Document deleted', 'success');
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Documents</h2>
        <p className="text-muted-foreground mt-2">Stored privately — only you and HR admins can open your files.</p>
      </div>

      {mine.isError && <Card><CardContent className="py-6 text-muted-foreground">{getErrorMessage(mine.error)}</CardContent></Card>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="bg-white/50 backdrop-blur-xl h-fit">
          <CardHeader>
            <CardTitle>Upload</CardTitle>
            <CardDescription>PDF, PNG or JPEG · max 10 MB</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => upload.mutate(v))} className="space-y-3">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input required maxLength={150} {...register('title', { required: true })} />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <select className="w-full h-10 rounded-md border bg-white/70 px-3 text-sm" {...register('type')}>
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Expiry date (optional)</Label>
                <Input type="date" {...register('expiryDate')} />
              </div>
              <div className="space-y-1">
                <Label>File</Label>
                <Input type="file" accept="application/pdf,image/png,image/jpeg" {...register('file', { required: true })} />
              </div>
              <Button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white" disabled={upload.isPending}>
                <Upload size={16} className="mr-2" /> {upload.isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>My documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mine.data?.map((d) => (
              <DocRow key={d.id} d={d} onDelete={() => window.confirm(`Delete "${d.title}"?`) && remove.mutate(d.id)} />
            ))}
            {!mine.isLoading && !mine.isError && !mine.data?.length && (
              <div className="py-8 text-center text-muted-foreground border-2 border-dashed rounded-xl">No documents yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" /> Expiring within 45 days
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {expiring.data?.map((d) => <DocRow key={d.id} d={d} showOwner />)}
            {!expiring.isLoading && !expiring.data?.length && <div className="text-muted-foreground text-sm">Nothing is expiring soon.</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
