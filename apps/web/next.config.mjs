/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@caching/shared", "@caching/ee-adaptive"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
