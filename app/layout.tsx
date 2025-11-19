
import "./../styles/globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";

import { siteMetadata } from "@/lib/siteMetadata";
import { GoogleAdSense } from "@/utils/GoogleAdSense";
import { GoogleAnalytics } from "@/utils/GoogleAnalytics";

export const metadata: Metadata = {
  metadataBase: new URL(siteMetadata.siteUrl),
  title: {
    default: siteMetadata.name,
    template: siteMetadata.titleTemplate,
  },
  description: siteMetadata.description,
  keywords: siteMetadata.keywords,
  applicationName: siteMetadata.name,
  alternates: {
    canonical: siteMetadata.siteUrl,
  },
  openGraph: {
    title: siteMetadata.name,
    description: siteMetadata.description,
    url: siteMetadata.siteUrl,
    siteName: siteMetadata.name,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: siteMetadata.name,
    description: siteMetadata.description,
  },
  category: "sports",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Script id="site-schema" type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: siteMetadata.name,
            url: siteMetadata.siteUrl,
            description: siteMetadata.description,
            inLanguage: "en-US",
          })}
        </Script>
        <GoogleAnalytics />
        <GoogleAdSense />
        <div className="container">
          {children}
          <footer className="site-footer">
            <p className="site-footer__links">
              <Link href="/about">About</Link>
              <span aria-hidden="true">•</span>
              <Link href="/privacy">Privacy</Link>
              <span aria-hidden="true">•</span>
              <a
                href={`mailto:${siteMetadata.contactEmail}`}
                className="site-footer__contact"
              >
                {siteMetadata.contactEmail}
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
