"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2, RotateCcw } from "lucide-react";
import type { PricingField } from "@/types";
import BottomSheet from "@/components/ui/BottomSheet";
import { getPricing, savePricing } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 시트 제목·설명. 기본값은 메인(AI 시뮬레이션) 견적의 단가 설정 문구다. */
  title?: string;
  description?: string;
  /** 기본 단가 API(/api/pricing)는 사장님 기기에서만 보고 고칠 수 있어서 이 토큰이
   *  필요하다. getFields/saveFields를 직접 넘기는 화면(빠른 견적)은 거기서 알아서
   *  처리하므로 이 prop을 안 써도 된다. */
  ownerToken?: string | null;
  /** 무엇의 단가를 읽고 쓸지. 기본값은 메인 견적(AI 시뮬레이션)의 /api/pricing이고,
   *  빠른 견적(estimator_app)처럼 다른 단가표를 쓰는 화면은 이 두 함수만 바꿔 끼우면
   *  같은 시트를 그대로 재사용할 수 있다. */
  getFields?: () => Promise<PricingField[]>;
  saveFields?: (values: Record<string, number>) => Promise<PricingField[]>;
}

// 이 순서대로 먼저 보여주고, 목록에 없는 새 그룹은 뒤에 그대로 이어 붙인다.
// 서버 단가표에 새 시공 항목이 생겨도 화면을 고치지 않아도 되게 하기 위한 것이다.
const PREFERRED_GROUP_ORDER = ["오야 방어 로직", "공임", "재료비", "요율", "품 산출", "필름 시공", "전기·조명", "설비"];

/** 단가 설정(개발자 모드) — 대한인테리어필름 배너를 3초간 누르면 열린다.
 *
 *  현장 단가는 지역·시기·거래처에 따라 계속 달라지는데, 그때마다 프로그램을 새로
 *  배포할 수는 없다. 여기서 바꾼 값은 서버에 저장되어 이후 모든 견적에 바로 반영된다. */
export default function PricingSheet({
  open,
  onClose,
  title = "단가 설정",
  description = "여기서 바꾼 단가는 이후 모든 견적에 바로 반영됩니다",
  ownerToken = null,
  getFields = () => getPricing(ownerToken),
  saveFields = (values) => savePricing(values, ownerToken),
}: Props) {
  const [fields, setFields] = useState<PricingField[]>([]);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSavedAt(false);
    getFields()
      .then((list) => {
        setFields(list);
        setEdits({});
      })
      .catch((err) => setError(err instanceof Error ? err.message : "단가를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getFields는 호출부에서 상수로 넘긴다
  }, [open]);

  const changedCount = Object.keys(edits).length;

  async function handleSave() {
    if (changedCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await saveFields(edits);
      setFields(updated);
      setEdits({});
      setSavedAt(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "단가 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // 그룹 목록을 화면에 박아두지 않고 서버가 준 데이터에서 뽑는다.
  // (예전에는 하드코딩한 4개만 그려서, 백엔드에 새 항목을 추가해도 관리자 화면에
  //  나타나지 않아 단가를 고칠 방법이 없었다.)
  const groups = [
    ...PREFERRED_GROUP_ORDER.filter((g) => fields.some((f) => f.group === g)),
    ...Array.from(new Set(fields.map((f) => f.group))).filter(
      (g) => !PREFERRED_GROUP_ORDER.includes(g)
    ),
  ];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="단가 설정"
      description="여기서 바꾼 단가는 이후 모든 견적에 바로 반영됩니다"
      footer={
        <button
          type="button"
          onClick={handleSave}
          disabled={changedCount === 0 || saving}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-indigo-600 text-[15px] font-semibold text-white shadow-[0_10px_40px_rgba(79,70,229,0.45)] transition-transform active:scale-[0.98] disabled:bg-slate-900/[0.06] disabled:text-slate-400 disabled:shadow-none"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "저장 중..." : changedCount > 0 ? `${changedCount}개 항목 저장` : "변경한 항목 없음"}
        </button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-[13px] font-light text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          단가를 불러오는 중...
        </div>
      ) : (
        <div className="space-y-7">
          {/* 관리자 전용 입구 — 수강생 코드 만들기·삭제 화면으로 간다(같은 길게 누르기로 열린 시트에서만 보인다). */}
          <Link
            href="/admin/students"
            onClick={onClose}
            className="flex h-14 items-center justify-between rounded-2xl bg-slate-100 px-4 text-[15px] font-semibold text-slate-800 transition-transform active:scale-[0.98]"
          >
            <span className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              수강생 코드 관리
            </span>
            <span className="text-slate-400">→</span>
          </Link>

          {error && (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-[13px] font-light text-red-700">{error}</p>
          )}
          {savedAt && !error && (
            <p className="text-center text-[13px] font-medium text-green-600">저장했습니다</p>
          )}

          {groups.map((group) => (
            <div key={group}>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {group}
              </p>
              <div className="space-y-4">
                {fields
                  .filter((f) => f.group === group)
                  .map((field) => {
                    const value = edits[field.key] ?? field.value;
                    const isChanged = edits[field.key] !== undefined;
                    const isCustom = field.value !== field.default;
                    return (
                      <label key={field.key} className="block">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-[13px] font-medium text-slate-700">{field.label}</span>
                          {(isChanged || isCustom) && (
                            <button
                              type="button"
                              onClick={() =>
                                setEdits((prev) => ({ ...prev, [field.key]: field.default }))
                              }
                              className="flex items-center gap-1 text-[11px] font-medium text-slate-400"
                            >
                              <RotateCcw className="h-3 w-3" />
                              기본값 {field.default.toLocaleString("ko-KR")}
                            </button>
                          )}
                        </span>
                        <span
                          className={`mt-1 flex items-baseline gap-1.5 border-b transition-colors ${
                            isChanged ? "border-indigo-500" : "border-slate-900/10"
                          }`}
                        >
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={value}
                            onChange={(e) =>
                              setEdits((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))
                            }
                            onFocus={(e) => e.target.select()}
                            className="w-full min-w-0 border-0 bg-transparent px-0 pb-2.5 pt-1.5 text-[17px] font-normal tabular-nums text-slate-900 outline-none focus:ring-0"
                          />
                          <span className="shrink-0 text-[13px] font-light text-slate-400">
                            {field.unit}
                          </span>
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
