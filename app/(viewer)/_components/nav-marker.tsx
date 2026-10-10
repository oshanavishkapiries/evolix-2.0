import type { NavKey } from "./nav-items";

/** Hidden marker; CSS `:has()` uses it to highlight the active link and hide the nav on watch pages. */
export const NavMarker = ({ active }: { active: NavKey }) => <span data-nav={active} hidden />;
