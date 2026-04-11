import { useQuery } from '@tanstack/react-query';
import { Bell, Mail, Info, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { api } from '../lib/api';

type Notification = {
  id: string;
  title: string;
  body: string;
  channel: string;
  status: string;
  createdAt: string;
};

export function NotificationsPage() {
  const list = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data as Notification[] });

  const getIcon = (channel: string) => {
    switch (channel) {
      case 'EMAIL': return <Mail size={18} color="#6366f1" />;
      case 'SYSTEM': return <Info size={18} color="#3b82f6" />;
      case 'URGENT': return <AlertTriangle size={18} color="#ef4444" />;
      default: return <Bell size={18} color="#94a3b8" />;
    }
  };

  return (
    <div className="notifications-page">
      <div className="topbar">
        <h2>Notifications Center</h2>
        <div className="row gap">
          <button style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid rgba(0,0,0,0.1)' }}>
            Mark all as read
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
          <div className="row gap">
            <Bell size={20} color="var(--primary)" />
            <h3 style={{ margin: 0 }}>Recent Updates</h3>
          </div>
        </div>

        <div style={{ display: 'grid' }}>
          {list.data?.map((n) => (
            <div key={n.id} style={{ 
              padding: '20px 24px', 
              borderBottom: '1px solid rgba(0,0,0,0.05)',
              display: 'flex',
              gap: 20,
              transition: 'background 0.2s'
            }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.02)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <div style={{ 
                background: 'rgba(0,0,0,0.03)', 
                width: 44, 
                height: 44, 
                borderRadius: 12, 
                display: 'grid', 
                placeItems: 'center',
                flexShrink: 0
              }}>
                {getIcon(n.channel)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 16 }}>{n.title}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} />
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, minHeight: 'auto' }}>{n.body}</p>
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: n.status === 'SENT' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: n.status === 'SENT' ? '#10b981' : '#f59e0b' }}>
                    {n.status}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.05)', color: 'var(--text-muted)' }}>
                    {n.channel}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {list.isLoading && (
            <div style={{ padding: 60, textAlign: 'center' }} className="muted">Fetching notifications...</div>
          )}
          {!list.isLoading && (list.data?.length ?? 0) === 0 && (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <div style={{ marginBottom: 16 }}><CheckCircle size={48} color="#10b981" style={{ opacity: 0.3 }} /></div>
              <div className="muted" style={{ fontSize: 16 }}>You're all caught up!</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
