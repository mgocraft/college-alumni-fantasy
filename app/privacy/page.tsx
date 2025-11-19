import type { Metadata } from "next";

import { siteMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Learn how College Alumni Fantasy handles analytics, advertising partners, and user privacy across the site.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="page">
      <section className="card">
        <h1>Privacy Policy</h1>
        <p>
          We respect your privacy and are committed to explaining how data is used when you visit {siteMetadata.name}.
          This page outlines the analytics, advertising, and affiliate services that help keep the project running.
        </p>
      </section>

      <section className="card">
        <h2>Analytics and cookies</h2>
        <p>
          We use Google Analytics to understand how visitors interact with the site. Google Analytics sets cookies to
          gather aggregated statistics such as page views and session duration. IP anonymization is enabled so the data
          cannot be used to identify you personally. You can opt out of Google Analytics across all sites by installing
          the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noreferrer">Google Analytics
          Opt-out Browser Add-on</a>.
        </p>
      </section>

      <section className="card">
        <h2>Advertising and affiliate links</h2>
        <p>
          When ad placements are active, we may load Google AdSense scripts that personalize ads based on your interests.
          AdSense may set cookies to measure performance and deliver relevant content. You can adjust your Google ad
          personalization preferences at any time in your Google account settings.
        </p>
        <p>
          Some product links are affiliate links, which means we may earn a commission if you choose to make a purchase
          after clicking them. These links do not change the price you pay, and they help support ongoing data updates.
        </p>
      </section>

      <section className="card">
        <h2>Contact</h2>
        <p>
          Have questions about this policy or want to request that your data be removed from our analytics reports?
          Contact us at <a href={`mailto:${siteMetadata.contactEmail}`}>{siteMetadata.contactEmail}</a>.
        </p>
      </section>
    </main>
  );
}
