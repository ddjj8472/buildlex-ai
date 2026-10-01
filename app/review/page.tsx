import type { Metadata } from "next";
import ReviewDashboard from "@/components/review/ReviewDashboard";

export const metadata: Metadata = {
  title: "도면 법규검토 · BuildLex AI",
  description: "건축허가 도서(PDF)를 시트별로 판독하고 국가 법령·지자체 조례 기준으로 검토해 보완요구서 초안을 만듭니다.",
};

export default function Page() {
  return <ReviewDashboard />;
}
