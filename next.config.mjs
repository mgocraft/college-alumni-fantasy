/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "m.media-amazon.com",
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externalId = "parquetjs-lite";
      if (Array.isArray(config.externals)) {
        const alreadyHandled = config.externals.some((external) => {
          if (typeof external === "string") {
            return external === externalId || external === `commonjs ${externalId}`;
          }
          if (typeof external === "object" && external) {
            return externalId in external;
          }
          return false;
        });
        if (!alreadyHandled) {
          config.externals.push(externalId);
        }
      } else if (config.externals) {
        config.externals = [config.externals, externalId];
      } else {
        config.externals = [externalId];
      }
    }
    return config;
  },
};

export default nextConfig;
