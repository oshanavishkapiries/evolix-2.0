import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MediaPlayer, MediaProvider, Track, type MediaPlayerInstance } from '@vidstack/react';
import { DualSubtitles, type SubtitleSelection } from '@/app/(viewer)/_components/dual-subtitles';
import { DEFAULT_STYLE } from '@/app/(viewer)/_components/subtitle-style';
import '@/app/(viewer)/styles/tokens.css';
import '@/app/(viewer)/styles/components.css';

/** The real DualSubtitles inside a real player; the test reaches the player through window.__player. */
function App() {
  const player = useRef<MediaPlayerInstance>(null);
  const [selection, setSelection] = useState<SubtitleSelection>(['t1', null]);
  useEffect(() => { (window as unknown as { __player: unknown }).__player = player.current; });
  return (
    <div className="viewer" style={{ width: 640, height: 360, position: 'relative' }}>
      <button onClick={() => setSelection([null, null])}>Subtitles off</button>
      <MediaPlayer ref={player} title="Sync test" src="/clip.mp4" playsInline>
        <MediaProvider><Track id="t1" src="/english.vtt" kind="subtitles" label="English" lang="en" type="vtt" /></MediaProvider>
        <DualSubtitles selection={selection} styles={[DEFAULT_STYLE, DEFAULT_STYLE]} mediaKey="sync" />
      </MediaPlayer>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
