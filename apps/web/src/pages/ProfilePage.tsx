import { useQuery } from '@tanstack/react-query';
import { User, Mail, Shield, Building2, Calendar, MapPin } from 'lucide-react';
import { api } from '../lib/api';

export function ProfilePage() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data
  });

  if (isLoading) {
    return <div className="muted p-4">Loading profile...</div>;
  }

  return (
    <div className="profile">
      <div className="topbar">
        <h2>My Profile</h2>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: '1fr 2fr' }}>
        <div className="card text-center">
          <div style={{ 
            background: 'var(--primary)', 
            color: 'white', 
            width: 80, 
            height: 80, 
            borderRadius: '50%', 
            display: 'grid', 
            placeItems: 'center', 
            fontSize: 32, 
            fontWeight: 700,
            margin: '0 auto 16px'
          }}>
            {user?.name?.charAt(0)}
          </div>
          <h3 style={{ marginBottom: 4 }}>{user?.name}</h3>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>{user?.role}</div>
          
          <div style={{ textAlign: 'left', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 16 }}>
             <div className="row gap" style={{ marginBottom: 12, fontSize: 14 }}>
                <Mail size={16} color="var(--text-muted)" />
                <span>{user?.email}</span>
             </div>
             <div className="row gap" style={{ marginBottom: 12, fontSize: 14 }}>
                <Building2 size={16} color="var(--text-muted)" />
                <span>{user?.tenantId}</span>
             </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 20 }}>Account Details</h3>
          <div style={{ display: 'grid', gap: 24 }}>
            <div className="row gap" style={{ alignItems: 'flex-start' }}>
              <Shield size={20} style={{ marginTop: 2 }} color="var(--primary)" />
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Security Role</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  You are currently logged in as an <strong>{user?.role}</strong>. This gives you 
                  access to {user?.role === 'ADMIN' ? 'all administrative features and reporting.' : 'your basic attendance and employee records.'}
                </div>
              </div>
            </div>

            <div className="row gap" style={{ alignItems: 'flex-start' }}>
              <MapPin size={20} style={{ marginTop: 2 }} color="var(--primary)" />
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Location & Region</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  Primary office: HQ (Global Operations)
                </div>
              </div>
            </div>

            <div className="row gap" style={{ alignItems: 'flex-start' }}>
                <Calendar size={20} style={{ marginTop: 2 }} color="var(--primary)" />
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Member Since</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                    April 2026
                  </div>
                </div>
              </div>
          </div>

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid rgba(0,0,0,0.05)' }}>
             <button style={{ padding: '8px 24px' }}>Edit Profile</button>
          </div>
        </div>
      </div>
    </div>
  );
}
