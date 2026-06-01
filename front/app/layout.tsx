"use client";

import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "./components/Sidebar";
import ContentArea from "./components/ContentArea";
import { ThemeProvider } from "next-themes";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <title>投递牛马 - 配置管理中心</title>
        <meta name="description" content="投递牛马配置管理中心，管理 application.yaml 和环境变量配置" />
        <link
          rel="icon"
          href="/toudi-niuma.svg"
          type="image/svg+xml"
        />
      </head>
      <body suppressHydrationWarning className="bg-[#f7faff] dark:bg-blacksection">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
        >
          <div className="flex min-h-screen">
            <Sidebar />
            <ContentArea>
              {children}
            </ContentArea>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
