export type DemoPlatform = "iphone" | "ipad" | "android";

const Share = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);
const AddSquare = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" />
  </svg>
);

const ROWS: Record<DemoPlatform, [string, string, string]> = {
  iphone: ["Copy", "Add Bookmark", "Add to Home Screen"],
  ipad: ["Copy", "Add Bookmark", "Add to Home Screen"],
  android: ["New tab", "Bookmarks", "Install app"],
};

/**
 * Looping, silent walkthrough of installing Evolix, drawn with HTML and CSS (no video or GIF):
 * tap Share or the menu, pick the install entry, then the Evolix icon lands on the home screen.
 * The three phases share one 8s timeline with the numbered steps next to it (see pwa-gate.css).
 */
export function InstallDemo({ platform }: { platform: DemoPlatform }) {
  const [a, b, c] = ROWS[platform];
  const sheet = platform === "iphone";
  return (
    <div className="d-phone" data-platform={platform} aria-hidden="true">
      <div className="d-screen">
        <div className="d-page">
          <div className="d-bar">
            <span className="d-url">evolix</span>
            {platform === "ipad" && <span className="d-t1 d-ico"><Share /></span>}
            {platform === "android" && <span className="d-t1 d-ico d-dots">⋮</span>}
          </div>
          <div className="d-content">
            <span className="d-hero" />
            <span className="d-row"><i /><i /><i /></span>
            <span className="d-row"><i /><i /><i /></span>
          </div>
          {sheet && (
            <div className="d-toolbar">
              <i>‹</i><i>›</i><span className="d-t1 d-ico"><Share /></span><i>▢</i><i>⧉</i>
            </div>
          )}
        </div>

        <div className={sheet ? "d-sheet" : "d-menu"}>
          {sheet && <span className="d-grip" />}
          <span className="d-item">{a}</span>
          <span className="d-item">{b}</span>
          <span className="d-item d-t2">{platform !== "android" && <AddSquare />}{c}</span>
        </div>

        <div className="d-home">
          <span className="d-grid">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>
          <span className="d-app">
            {/* eslint-disable-next-line @next/next/no-img-element -- local icon */}
            <img src="/icons/icon-192.png" alt="" width={40} height={40} />
            <small>Evolix</small>
          </span>
        </div>

        <span className="d-finger" />
      </div>
    </div>
  );
}
