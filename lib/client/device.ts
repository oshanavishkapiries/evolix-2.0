export type DeviceType = "phone" | "tablet" | "desktop";

/**
 * Tablets that ask for the desktop site (Chrome on large Android tablets, iPadOS Safari) carry a
 * desktop user agent, so also check the input: touch is the primary pointer and nothing hovers.
 * Windows and ChromeOS are excluded so touch laptops and Surface desktops stay unaffected.
 */
function touchFirst(ua: string) {
  return (
    !/Windows|CrOS/i.test(ua) &&
    navigator.maxTouchPoints > 0 &&
    matchMedia("(pointer: coarse)").matches &&
    matchMedia("(hover: none)").matches
  );
}

/**
 * Classifies the current browser. iPadOS 13+ reports itself as a Mac, so a Mac with a touch
 * screen counts as a tablet. Keep in sync with GATE_SCRIPT below, which runs before hydration.
 */
export function detectDevice(): DeviceType {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const android = /Android/i.test(ua);
  const ipad = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ipad || /Tablet|PlayBook|Silk|Kindle/i.test(ua) || (android && !/Mobile/i.test(ua)) || touchFirst(ua)) return "tablet";
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (/iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (android && /Mobile/i.test(ua)) || uaData?.mobile) return "phone";
  return "desktop";
}

/** True when running as an installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const modes = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];
  return modes.some((m) => window.matchMedia(`(display-mode: ${m})`).matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Pages that stay usable in a normal browser tab. */
export const GATE_EXEMPT = ["/admin"];
export const gateExempt = (path: string) => GATE_EXEMPT.some((p) => path === p || path.startsWith(`${p}/`));

export const GATE_ATTR = "data-install-gate";

/**
 * Inline script that flags <html> before first paint, so a phone or tablet in a normal browser
 * tab never flashes the site before the install screen appears.
 */
export const GATE_SCRIPT = `(function(){try{
var d=document.documentElement,n=navigator,u=n.userAgent,a=/Android/i.test(u);
var tab=/iPad/i.test(u)||(n.platform==="MacIntel"&&n.maxTouchPoints>1)||/Tablet|PlayBook|Silk|Kindle/i.test(u)||(a&&!/Mobile/i.test(u))||(!/Windows|CrOS/i.test(u)&&n.maxTouchPoints>0&&matchMedia("(pointer: coarse)").matches&&matchMedia("(hover: none)").matches);
var ph=/iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(u)||(a&&/Mobile/i.test(u))||(n.userAgentData&&n.userAgentData.mobile);
var inst=["standalone","fullscreen","minimal-ui","window-controls-overlay"].some(function(m){return matchMedia("(display-mode: "+m+")").matches})||n.standalone===true;
var p=location.pathname;
if((tab||ph)&&!inst&&p!=="/admin"&&p.indexOf("/admin/")!==0)d.setAttribute("${GATE_ATTR}","");
}catch(e){}})();`;
