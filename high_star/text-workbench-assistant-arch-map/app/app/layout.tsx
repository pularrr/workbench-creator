import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KnowMap Knowledge Graph",
  description: "可生成、可审查的 AI 原生知识图谱",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
