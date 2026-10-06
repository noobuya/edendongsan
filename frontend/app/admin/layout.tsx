import type { Metadata } from "next";

// 관리자 화면은 주소를 아는 사람만 쓰는 곳이라 검색 엔진에 노출하지 않는다.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
