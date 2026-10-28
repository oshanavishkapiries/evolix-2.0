import React from 'react';

/** Stand-in for next/link in the Vite harness. */
export default function Link({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={href} {...rest}>{children}</a>;
}
