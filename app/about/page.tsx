import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — College Alumni Fantasy",
  description: "Learn about the College Alumni Fantasy project and how to get in touch.",
};

export default function AboutPage() {
  return (
    <main className="page">
      <section className="card">
        <h1>About College Alumni Fantasy</h1>
        <p>
          College Alumni Fantasy tracks how every school would fare if it fielded a fantasy roster built entirely
          from its NFL alumni. We compile weekly scoring data, simulate matchups, and surface the stories that make
          alumni pride so much fun to follow.
        </p>
        <p>
          Have an idea for new features, spotted a data hiccup, or just want to say hi? Reach us directly at
          {" "}
          <a href="mailto:contact@alumniff.com">contact@alumniff.com</a>.
        </p>
      </section>

      <section className="card">
        <h2>How we keep the lights on</h2>
        <p>
          To keep the project sustainable we occasionally share gear and book recommendations through Amazon affiliate
          links. If you choose to make a purchase after clicking one of those links we may earn a small commission at
          no extra cost to you. It is a simple way to support continued stat crunching and site improvements.
        </p>
        <p>
          Want to browse the latest picks? Visit our
          {" "}
          <a href="https://www.amazon.com/?tag=alumniff-20" target="_blank" rel="noreferrer">
            Amazon storefront
          </a>
          .
        </p>
      </section>
    </main>
  );
}
