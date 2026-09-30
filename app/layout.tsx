import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BuildLex AI · 건축법령 AI",
  description: "건축법·국토계획법·주차장법 등 건축 관련 법령과 전국 지자체 조례를 조문 근거로 답하는 AI",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#16191d" };

const themeScript = `try{var t=localStorage.getItem("bl-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
