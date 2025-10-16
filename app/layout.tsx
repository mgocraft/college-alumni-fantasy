
import "./../styles/globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "College Alumni Fantasy",
  description: "Weekly fantasy points by college alumni.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          {children}
          <footer className="site-footer">
            <p className="site-footer__links">
              <Link href="/about">About</Link>
              <span aria-hidden="true">•</span>
              <a
                href="mailto:contact@alumniff.com"
                className="site-footer__contact"
              >
                contact@alumniff.com
              </a>
            </p>
            <p className="site-footer__affiliate">
              As an Amazon Associate we earn from qualifying purchases.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
