export type AffiliateAd =
  | {
      id: string;
      href: string;
      label: string;
      cta: string;
      disclaimer: string;
      variant: "prime";
    }
  | {
      id: string;
      href: string;
      label: string;
      cta: string;
      disclaimer: string;
      variant: "banner";
      image: {
        src: string;
        alt: string;
        width: number;
        height: number;
      };
    };

export const affiliateAds: AffiliateAd[] = [
  {
    id: "prime-video-tnf",
    href: "https://amzn.to/4quo92n",
    label: "Prime Video",
    cta: "Stream the NFL on Thursday nights",
    disclaimer: "Affiliate link — watch the game on Prime",
    variant: "prime",
  },
  {
    id: "fire-tv-stick-4k",
    href: "https://amzn.to/47aOwkK",
    label: "Fire TV Stick 4K",
    cta: "Plug in and catch every TNF snap",
    disclaimer: "Affiliate link — Prime Video membership required",
    variant: "banner",
    image: {
      src: "https://m.media-amazon.com/images/G/01/primevideo/seo/2023/Sports/TNF_2023_Remote_675x1020.jpg",
      alt: "Fire TV Stick 4K streaming Thursday Night Football on Prime Video",
      width: 675,
      height: 1020,
    },
  },
  {
    id: "tnf-fan-shop",
    href: "https://amzn.to/497eWGL",
    label: "TNF Fan Shop",
    cta: "Gear up for your primetime squad",
    disclaimer: "Affiliate link — selection varies by availability",
    variant: "banner",
    image: {
      src: "https://m.media-amazon.com/images/G/01/digital/video/merch/2023/Other/TNF_2023_Generic_En_Multi_Channel-Tile_675x1020.jpg",
      alt: "Prime Video Thursday Night Football fan gear display",
      width: 675,
      height: 1020,
    },
  },
];
