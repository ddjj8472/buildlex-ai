import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "건축법규 AI 검색 | BuildLex AI",
  description: "현행 건축 관련 법령과 지역 조례를 검색해 근거 중심으로 답하는 교육용 AI 데모",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
