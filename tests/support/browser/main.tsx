import React from 'react';
import { createRoot } from 'react-dom/client';
import { SupportChat } from '@/app/_components/support/chat';
import { SupportInbox } from '@/app/_components/support/inbox';
import { SupportUnreadProvider } from '@/app/_components/support/unread';
import { BottomNav } from '@/app/(viewer)/_components/bottom-nav';
import '@/app/(viewer)/styles/tokens.css';
import '@/app/(viewer)/styles/shell.css';
import '@/app/_components/support/support.css';

const admin = new URLSearchParams(location.search).has('admin');
createRoot(document.getElementById('root')!).render(
  <div className="viewer" style={{ padding: '1rem', boxSizing: 'border-box', fontFamily: 'system-ui, sans-serif' }}>
    <SupportUnreadProvider admin={admin}>
      <h1>Support</h1><p className="support-intro">Questions, problems, or ideas? Talk to the Evolix team.</p>
      {admin ? <SupportInbox /> : <><SupportChat /><BottomNav /></>}
    </SupportUnreadProvider>
  </div>,
);
