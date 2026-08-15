import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "念念AI视频工作台 - 视频生成基础能力",
  description: "上传人物、关键资产、场景和可选视频参考，创建、跟踪并下载念念AI视频生成任务。",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
      </head>
      <body>{children}</body>
    </html>
  );
}
