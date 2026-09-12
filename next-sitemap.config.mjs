/** @type {import('next-sitemap').IConfig} */
export default {
  siteUrl: "https://magick.ly",
  generateRobotsTxt: true,
  exclude: ["/admin", "/temples/admin", "/upload", "/manifest.json"],
};
