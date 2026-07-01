import { useQuery } from '@tanstack/react-query';
import { User, Mail, Shield, Building2, Calendar, MapPin } from 'lucide-react';
import { api } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';

export function ProfilePage() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data
  });

  if (isLoading) {
    return <div className="text-muted-foreground p-8 text-center">Loading profile...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">My Profile</h2>
        <p className="text-muted-foreground mt-2">Manage your personal information and account settings.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left Column (Identity) */}
        <Card className="md:col-span-1 bg-white/50 backdrop-blur-xl h-fit">
          <CardContent className="pt-8 flex flex-col items-center text-center">
            <Avatar className="h-24 w-24 mb-4 border-4 border-background shadow-sm">
              <AvatarFallback className="bg-indigo-100 text-indigo-700 text-3xl font-semibold">
                {user?.name?.charAt(0)}
              </AvatarFallback>
            </Avatar>
            
            <h3 className="text-xl font-bold">{user?.name}</h3>
            <div className="text-indigo-600 font-medium text-sm mb-6">{user?.role}</div>
            
            <div className="w-full space-y-4 pt-6 border-t border-border/50 text-left">
              <div className="flex items-center gap-3 text-sm">
                <Mail size={16} className="text-muted-foreground" />
                <span className="font-medium text-slate-700">{user?.email}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Building2 size={16} className="text-muted-foreground" />
                <span className="font-medium text-slate-700">{user?.tenantId}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Column (Details) */}
        <Card className="md:col-span-2 bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex gap-4 items-start">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                <Shield size={20} />
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">Security Role</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  You are currently logged in as an <strong className="text-slate-700">{user?.role}</strong>. This gives you 
                  access to {user?.role === 'ADMIN' ? 'all administrative features and reporting.' : 'your basic attendance and employee records.'}
                </div>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0">
                <MapPin size={20} />
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">Location & Region</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  Primary office: HQ (Global Operations)
                </div>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="p-2 bg-amber-50 text-amber-600 rounded-lg shrink-0">
                <Calendar size={20} />
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">Member Since</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  April 2026
                </div>
              </div>
            </div>
            
            <Separator className="my-4" />
            
            <div>
              <Button className="bg-indigo-500 hover:bg-indigo-600 text-white px-8">
                Edit Profile
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
