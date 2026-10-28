import React from 'react';
import { createRoot } from 'react-dom/client';
import PlayerImpl from '@/app/(viewer)/_components/player-impl';
import '@/app/(viewer)/styles/tokens.css';
import '@/app/(viewer)/styles/components.css';
const target = { tmdbId: 42, mediaType: 'movie' as const };
const cached = new URLSearchParams(window.location.search).has('seed') ? [{ id: '22222222-2222-4222-8222-222222222222', label: 'Cached older default', language: 'en', format: 'vtt' as const, url: '/english.vtt', score: 1 }] : [];
createRoot(document.getElementById('root')!).render(<div className="viewer" style={{ width: 1000, height: 640, position: 'relative' }}><PlayerImpl title="Subtitle test movie" source={{ id: 'fixture', kind: 'direct', url: '/clip.mp4' }} subtitles={cached} sinhala={target} /></div>);
