"use client";

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
        <title>投递牛马 - 投递牛马工作台</title>
        <meta name="description" content="投递牛马本地求职助手，集中查看平台状态、待确认岗位和投递记录" />
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
