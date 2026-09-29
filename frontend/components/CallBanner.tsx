import { Phone } from "lucide-react";
import { BUSINESS_NAME, BUSINESS_PHONE, BUSINESS_PHONE_TEL_HREF } from "@/lib/businessInfo";

/** 눌렀을 때 바로 전화 연결되는 상담 유도 배너. 시공 후기를 보고 있는 잠재
 *  고객이 글을 다 읽고 나서 바로 문의로 이어지도록 글 위/아래에 배치한다. */
export default function CallBanner() {
  return (
    <a
      href={BUSINESS_PHONE_TEL_HREF}
      className="group flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-7 text-center text-white shadow-md transition-transform hover:scale-[1.01] active:scale-[0.99]"
    >
      <span className="text-xs font-medium text-slate-300">눌러서 바로 전화 상담</span>
      <span className="text-2xl font-extrabold tracking-tight">{BUSINESS_NAME}</span>
      <span className="mt-1 flex items-center gap-1.5 text-xl font-bold text-blue-300 group-hover:text-blue-200">
        <Phone className="h-5 w-5" />
        {BUSINESS_PHONE}
      </span>
    </a>
  );
}
