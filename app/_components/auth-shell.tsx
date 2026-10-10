import Link from "next/link";
import { Noto_Sans } from "next/font/google";
import "./auth-shell.css";

const font = Noto_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], display: "swap" });

/** Shared frame for the signed-out pages: dark backdrop, logo, white card with a title. */
export function AuthShell({
  title,
  subtitle,
  links,
  children,
}: {
  title: string;
  subtitle?: string;
  links?: { href: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className={`a-screen ${font.className}`}>
      <Link href="/" className="a-logo" aria-label="Evolix home">
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
        <img src="/svg/evolix.svg" alt="Evolix" width={150} height={44} />
      </Link>
      <main className="a-card">
        <h1>{title}</h1>
        {subtitle && <p className="a-sub">{subtitle}</p>}
        {children}
        {links && (
          <nav className="a-links" aria-label="Other options">
            {links.map((l) => (
              <a key={l.href} href={l.href}>{l.label}</a>
            ))}
          </nav>
        )}
      </main>
    </div>
  );
}
