import type { StaticImageData } from "next/image";

import streamImage from "@/img/stream.png";
import pumpkinImage from "@/img/pumpkin.jpg";
import ghostFlagImage from "@/img/ghostflag.jpg";

export type AffiliateAd = {
  id: string;
  href: string;
  label: string;
  cta: string;
  disclaimer: string;
  image: {
    src: StaticImageData;
    alt: string;
  };
};

export const affiliateAds: AffiliateAd[] = [
  {
    id: "prime-video-tnf",
    href: "https://amzn.to/4quo92n",
    label: "Prime Video",
    cta: "Stream the NFL on Thursday nights",
    disclaimer: "",
    image: {
      src: streamImage,
      alt: "Prime Video app ready to stream Thursday Night Football",
    },
  },
  {
    id: "fire-tv-stick-4k",
    href: "https://amzn.to/47aOwkK",
    label: "College Football Halloween Decor",
    cta: "Find college football Halloween decor on Amazon",
    disclaimer: "Affiliate link",
    image: {
      src: pumpkinImage,
      alt: "Fire TV remote resting next to a festive pumpkin display",
    },
  },
  {
    id: "tnf-fan-shop",
    href: "https://amzn.to/497eWGL",
    label: "Spooky Game Day Finds",
    cta: "Discover spooky fan decor for game day on Amazon",
    disclaimer: "Affiliate link",
    image: {
      src: ghostFlagImage,
      alt: "Team spirit flag waving beside glowing ghost decor",
    },
  },
];
