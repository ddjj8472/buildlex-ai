import type { Metadata } from "next";
import BimDashboard from "@/components/bim/BimDashboard";

export const metadata: Metadata = {
  title: "BIM 법규검토 · BuildLex AI",
  description: "Revit에서 내보낸 IFC 모델을 웹에서 3D로 보고, 건축법·피난방화규칙·주차장법 등 국내 법령과 조례로 요소 단위 자동 검토합니다.",
};

export default function Page() {
  return <BimDashboard />;
}
