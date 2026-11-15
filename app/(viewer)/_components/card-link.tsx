import Link from "next/link";

/** Default Link prefetching; a single layout listener names the clicked poster. */
export function CardLink({ href, morphId, className, children }: { href: string; morphId?: string; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={className} data-card-morph={morphId}>{children}</Link>;
}
