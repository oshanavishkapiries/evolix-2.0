import { imageUrl } from "@/lib/images";

/**
 * The one scene every pre-playback state uses (connecting to a stream, preparing a quality, errors), so they
 * all share the app's look: blurred backdrop, flat charcoal card, gold accent, standard buttons as children.
 */
export function PlayerStatus({
  backdropPath,
  kicker,
  title,
  message,
  note,
  progress,
  error = false,
  children,
}: {
  backdropPath?: string | null;
  kicker?: string;
  title: string;
  message?: string;
  note?: string;
  /** 0-100; the bar only shows while a real value is known. */
  progress?: number;
  error?: boolean;
  children?: React.ReactNode;
}) {
  const bg = backdropPath ? imageUrl(backdropPath, "w1280") : null;
  return (
    <div className="v-scene" role={error ? "alert" : "status"} aria-live="polite">
      {bg && <div className="v-scene-bg" style={{ backgroundImage: `url("${bg}")` }} />}
      <div className="v-scene-card">
        {error ? <span className="v-scene-icon" aria-hidden="true">!</span> : <div className="v-scene-spinner" aria-hidden="true" />}
        {kicker && <p className="v-scene-kicker">{kicker}</p>}
        <h3 className="v-scene-title">{title}</h3>
        {message && <p className="v-scene-msg" data-error={error}>{message}</p>}
        {progress !== undefined && progress > 0 && progress < 100 && (
          <div className="v-scene-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        )}
        {note && <p className="v-scene-note">{note}</p>}
        {children && <div className="v-scene-actions">{children}</div>}
      </div>
    </div>
  );
}
