import React, { Activity, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PlayerImpl from '@/app/(viewer)/_components/player-impl';
import { WatchPlayer } from '@/app/(viewer)/_components/watch-player';
import '@/app/(viewer)/styles/tokens.css';
import '@/app/(viewer)/styles/components.css';

// ?raw=1 renders the player without the WatchPlayer wrapper: the control that shows what the wrapper protects against.
const raw = new URLSearchParams(window.location.search).has('raw');
const source = { id: 'fixture', kind: 'direct' as const, url: '/clip.mp4' };

function App() {
  const [visible, setVisible] = useState(true);
  return (
    <div className="viewer" style={{ width: 1000, height: 640, position: 'relative' }}>
      <button onClick={() => setVisible((v) => !v)}>Toggle page</button>
      {/* A cached page is kept alive by <Activity> while hidden, exactly like cacheComponents does. */}
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <div style={{ width: 1000, height: 600, position: 'relative' }}>
          {raw ? <PlayerImpl title="Lifecycle movie" source={source} subtitles={[]} /> : <WatchPlayer title="Lifecycle movie" source={source} subtitles={[]} />}
        </div>
      </Activity>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
