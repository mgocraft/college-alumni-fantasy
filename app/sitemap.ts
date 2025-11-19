import type { MetadataRoute } from "next";

import { siteMetadata } from "@/lib/siteMetadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteMetadata.siteUrl.replace(/\/$/, "");
  const routes = ["/", "/about", "/matchups", "/rankings", "/standings", "/schools", "/privacy"];

  return routes.map((route) => ({
    url: `${baseUrl}${route === "/" ? "" : route}`,
    lastModified: new Date(),
  }));
}
