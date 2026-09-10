import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // These libraries are Node-only and must not be bundled by webpack;
  // they are loaded at runtime from node_modules (App Router route handlers).
  serverExternalPackages: ["pdfjs-dist", "pdf-parse", "tesseract.js", "@napi-rs/canvas"],
  // 固定 Turbopack 工作区根目录，避免扫描到同级项目的 lockfile 导致根目录推断错误
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
