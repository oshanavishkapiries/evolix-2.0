import React from 'react';
import { createRoot } from 'react-dom/client';
import { EvoPlayer } from '@/app/(viewer)/_components/evo-player';
import '@/app/(viewer)/styles/tokens.css';
import '@/app/(viewer)/styles/components.css';

createRoot(document.getElementById('root')!).render(
  <div className="viewer" style={{ width: 1000, height: 640, position: 'relative' }}>
    <EvoPlayer tmdbId={603} title="Busy Movie" backHref="/back" subtitles={[]} />
  </div>,
);
