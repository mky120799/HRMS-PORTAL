import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  department: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type Employee = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  department?: string;
};

export function EmployeesPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const list = useQuery({ queryKey: ['employees'], queryFn: async () => (await api.get('/employees')).data as Employee[] });
  
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({ 
    resolver: zodResolver(schema) 
  });

  const create = useMutation({
    mutationFn: async (body: FormData) => api.post('/employees', body),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['employees'] });
      showToast('Employee added to the roster', 'success');
    },
    onError: (error) => showToast(getErrorMessage(error), 'error'),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Employee Roster</h2>
          <p className="text-muted-foreground mt-2">Manage your organization's members.</p>
        </div>
        <div className="relative w-full md:w-[300px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search employees..." className="pl-10 bg-white/50 backdrop-blur-sm" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1 bg-white/50 backdrop-blur-xl h-fit">
          <CardHeader>
            <CardTitle>Add New Employee</CardTitle>
            <CardDescription>Invite a new member to your tenant.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input placeholder="John" {...register('firstName')} className="bg-white/50" />
                {errors.firstName && <p className="text-red-500 text-xs">{errors.firstName.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input placeholder="Doe" {...register('lastName')} className="bg-white/50" />
                {errors.lastName && <p className="text-red-500 text-xs">{errors.lastName.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input placeholder="john.doe@company.com" {...register('email')} className="bg-white/50" />
                {errors.email && <p className="text-red-500 text-xs">{errors.email.message}</p>}
              </div>
              <div className="space-y-2 pb-2">
                <Label>Department</Label>
                <Input placeholder="Engineering" {...register('department')} className="bg-white/50" />
              </div>
              <Button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white" disabled={create.isPending || isSubmitting}>
                <Plus size={18} className="mr-2" />
                {create.isPending || isSubmitting ? 'Adding...' : 'Add Employee'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-white/50 backdrop-blur-xl overflow-hidden">
          <CardHeader>
            <CardTitle>All Employees</CardTitle>
            <CardDescription>A list of all employees in your organization.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data?.map((e) => (
                  <TableRow key={e.id} className="hover:bg-slate-50/50">
                    <TableCell className="pl-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-indigo-100 text-indigo-700 font-medium">
                            {e.firstName.charAt(0)}{e.lastName.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{e.firstName} {e.lastName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {e.department ? (
                        <Badge variant="secondary" className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-normal">
                          {e.department}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.email}</TableCell>
                    <TableCell className="text-right pr-6">
                      <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8">
                        <Trash2 size={16} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                
                {list.isLoading && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                      Loading data...
                    </TableCell>
                  </TableRow>
                )}
                
                {!list.isLoading && (list.data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                      No employees found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
