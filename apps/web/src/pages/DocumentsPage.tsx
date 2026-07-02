import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { File, Upload, Trash2, CalendarDays } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

export function DocumentsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { register, handleSubmit, setValue, reset, formState: { isSubmitting } } = useForm();
  
  const documents = useQuery({
    queryKey: ['documents'],
    queryFn: async () => (await api.get('/documents/me')).data
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: any) => {
      const formData = new FormData();
      formData.append('title', data.title);
      formData.append('type', data.type || 'OTHER');
      formData.append('file', data.file[0]);
      if (data.expiryDate) {
        formData.append('expiryDate', data.expiryDate);
      }
      return api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      showToast('Document uploaded successfully', 'success');
      reset();
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      showToast('Document deleted');
      qc.invalidateQueries({ queryKey: ['documents'] });
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Documents</h2>
        <p className="text-muted-foreground mt-2">Manage your ID proofs, contracts, and company policies.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1 bg-white/50 backdrop-blur-xl h-fit">
          <CardHeader>
            <CardTitle>Upload Document</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((d) => uploadMutation.mutate(d))} className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input placeholder="e.g. Passport Copy" {...register('title', { required: true })} />
              </div>
              
              <div className="space-y-2">
                <Label>Type</Label>
                <Select onValueChange={(val) => setValue('type', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ID">Identity Proof</SelectItem>
                    <SelectItem value="CONTRACT">Contract / Offer</SelectItem>
                    <SelectItem value="POLICY">Policy Acknowledgment</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Expiry Date (Optional)</Label>
                <Input type="date" {...register('expiryDate')} />
              </div>

              <div className="space-y-2">
                <Label>File</Label>
                <Input type="file" {...register('file', { required: true })} />
              </div>

              <Button type="submit" disabled={isSubmitting || uploadMutation.isPending} className="w-full">
                <Upload size={16} className="mr-2" />
                Upload
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>My Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {documents.data?.map((doc: any) => (
                <div key={doc.id} className="border bg-white/60 p-4 rounded-xl flex flex-col justify-between hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <File size={20} />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{doc.title}</div>
                        <div className="text-xs text-muted-foreground">{doc.type}</div>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(doc.id)}>
                      <Trash2 size={16} className="text-red-400" />
                    </Button>
                  </div>
                  
                  {doc.expiryDate && (
                    <div className="text-xs text-amber-600 flex items-center gap-1 mt-2 bg-amber-50 p-1.5 rounded-md w-fit">
                      <CalendarDays size={12} />
                      Expires: {new Date(doc.expiryDate).toLocaleDateString()}
                    </div>
                  )}
                  
                  <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
                    <a href={doc.fileUrl} target="_blank" rel="noreferrer">View File</a>
                  </Button>
                </div>
              ))}

              {documents.data?.length === 0 && (
                <div className="col-span-2 text-center py-12 text-muted-foreground border-2 border-dashed rounded-xl">
                  No documents uploaded yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
