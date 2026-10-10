import { ViewTransition } from "react";

/**
 * Route-level motion (spec §6.1): the page fades out quickly and the next one fades up.
 * Lives in each page (not the layout) because layouts persist and never enter/exit.
 */
export function PageMotion({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="v-page-in" exit="v-page-out" default="none">
      {children}
    </ViewTransition>
  );
}

/** Suspense reveal (spec §6.3): wrap the fallback in <SkeletonOut> and the content in <Reveal>. */
export function Reveal({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="v-reveal" default="none">
      {children}
    </ViewTransition>
  );
}

export function SkeletonOut({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition exit="v-skel-out" default="none">
      {children}
    </ViewTransition>
  );
}

/** Same-route content swap (season switch, spec §6.12): keyed crossfade. */
export function Swap({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <ViewTransition key={k} enter="v-swap-in" exit="v-swap-out" default="none">
      {children}
    </ViewTransition>
  );
}
