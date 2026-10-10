/**
 * Third-party embed. https only, no referrer. No `sandbox`: most embed providers refuse to play
 * (or break fullscreen/autoplay) inside a sandboxed frame, and sources are curated by admins.
 */
export function EmbedFrame({ url, title }: { url: string; title: string }) {
  let safe = false;
  try {
    safe = new URL(url).protocol === "https:";
  } catch {}
  if (!safe) {
    return (
      <div className="v-player-msg" role="alert">
        <strong>This source cannot be embedded</strong>
        <p className="v-muted">Embeds must be served over HTTPS.</p>
        <a href="#sources" className="v-btn v-btn-primary">Try another source</a>
      </div>
    );
  }
  return (
    <iframe
      src={url}
      title={title}
      allowFullScreen
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  );
}
