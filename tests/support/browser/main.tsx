import React from 'react';
import { createRoot } from 'react-dom/client';
import { SupportChat } from '@/app/_components/support/chat';
import { SupportInbox } from '@/app/_components/support/inbox';
import { SupportUnreadProvider } from '@/app/_components/support/unread';
import { BottomNav } from '@/app/(viewer)/_components/bottom-nav';
import { AdminNav } from '@/app/admin/_components/admin-nav';
import { AnnouncementsProvider, NotificationBell } from '@/app/(viewer)/_components/announcements';
import '@/app/_components/support/support.css';
import '@/app/(viewer)/styles/tokens.css';
import '@/app/(viewer)/styles/shell.css';
import '@/app/admin/admin.css';

const admin = new URLSearchParams(location.search).has('admin');
const dashboard = new URLSearchParams(location.search).has('dashboard');
const viewer = <div className="viewer"><header className="v-top" style={{ padding: '1rem', justifyContent: 'space-between' }}>Evolix<NotificationBell /></header><aside className="v-side" /><main className="v-main">{dashboard ? <h1>Home</h1> : <div className="support-page"><SupportChat /></div>}</main><BottomNav /></div>;
createRoot(document.getElementById('root')!).render(
  <SupportUnreadProvider admin={admin}>
    {admin ? <div className="adm"><AdminNav /><main className="adm-main"><section className="support-admin-page"><header className="support-admin-heading"><h1>Support</h1><p>Private conversations with your users</p></header><SupportInbox /></section></main></div>
      : dashboard ? <AnnouncementsProvider>{viewer}</AnnouncementsProvider> : viewer}
  </SupportUnreadProvider>,
);
