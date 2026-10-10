"use client";

import Link from "next/link";

const MORPH_MS = 1000;

/**
 * Card link that names its poster image just before navigating, so the browser morphs it into the
 * detail poster (spec §6.2). Named on click only: the same title can sit in several rows at once,
 * and duplicate view-transition names would cancel the transition.
 */
export function CardLink({ href, morphId, className, children }: { href: string; morphId?: string; className?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={className}
      prefetch={false}
      onClick={(e) => {
        const img = morphId ? e.currentTarget.querySelector<HTMLElement>(".v-card-img") : null;
        if (!img) return;
        img.style.viewTransitionName = `poster-${morphId}`;
        img.style.setProperty("view-transition-class", "v-morph");
        setTimeout(() => {
          img.style.viewTransitionName = "";
          img.style.removeProperty("view-transition-class");
        }, MORPH_MS);
      }}
    >
      {children}
    </Link>
  );
}
