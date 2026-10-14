import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UniCal · 统一工作与生活日历",
  description: "把一段话和抽象目标，变成可执行的日历安排",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" data-theme="sky" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('unical-theme')||'sky';document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
