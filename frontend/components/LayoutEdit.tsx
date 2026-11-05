"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getLayout, resetLayoutElement, saveLayoutElement, type LayoutAdjustment } from "@/lib/api";

const DEFAULT_ADJUSTMENT: LayoutAdjustment = { dx: 0, dy: 0, scale: 1 };

interface LayoutEditContextValue {
  /** 지금 "배치 편집 모드"가 켜져 있는지. */
  editMode: boolean;
  /** 사장님 기기가 아니면 켤 수 없다 — setEditMode(true)가 조용히 무시된다. */
  setEditMode: (value: boolean) => void;
  /** 이 기기가 편집할 수 있는 기기인지(ownerToken 유무). Movable이 편집 손잡이를
   *  보여줄지 판단하는 데 쓴다. */
  canEdit: boolean;
  get: (id: string) => LayoutAdjustment;
  /** 드래그 중 매 프레임 호출 — 로컬 상태만 갱신하고 서버에는 보내지 않는다. */
  update: (id: string, adjustment: LayoutAdjustment) => void;
  /** 손을 뗐을 때 한 번 호출 — 서버에 저장해 다른 기기에도 반영한다. */
  commit: (id: string, adjustment: LayoutAdjustment) => void;
  /** 이 요소만 원래 자리로 되돌린다. */
  reset: (id: string) => void;
}

// 기본값은 "편집 불가능한 아무 효과 없는" 컨텍스트다 — Provider 없이 쓰는 화면
// (예: /quote가 쓰는 PricingSheet)에서도 useLayoutEdit()을 던지지 않고 안전하게
// 호출할 수 있게 한다. canEdit이 항상 false라 그런 화면에서는 "배치 편집" 진입점
// 자체가 조용히 숨는다.
const noop = () => {};
const DEFAULT_CONTEXT: LayoutEditContextValue = {
  editMode: false,
  setEditMode: noop,
  canEdit: false,
  get: () => DEFAULT_ADJUSTMENT,
  update: noop,
  commit: noop,
  reset: noop,
};

const LayoutEditContext = createContext<LayoutEditContextValue>(DEFAULT_CONTEXT);

/** 첫 화면(현장 등록~견적 화면) UI 요소의 위치·크기를 서버에서 불러와 자식들에게
 *  내려준다. ownerToken이 있는 기기(사장님)만 편집 모드를 켤 수 있고, 조정값
 *  자체는 누구나 받아 — 사장님이 맞춘 배치가 손님 기기에도 똑같이 보인다
 *  (2026-11-05 "서버에 저장 — 모든 기기에 동일하게 적용" 요청). */
export function LayoutEditProvider({
  ownerToken,
  children,
}: {
  ownerToken: string | null;
  children: React.ReactNode;
}) {
  const [editMode, setEditModeState] = useState(false);
  const [elements, setElements] = useState<Record<string, LayoutAdjustment>>({});
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    getLayout()
      .then(setElements)
      .catch(() => {
        /* 못 불러와도 기본 배치로 조용히 시작한다. */
      });
  }, []);

  const get = useCallback((id: string) => elements[id] ?? DEFAULT_ADJUSTMENT, [elements]);

  const update = useCallback((id: string, adjustment: LayoutAdjustment) => {
    setElements((prev) => ({ ...prev, [id]: adjustment }));
  }, []);

  const commit = useCallback(
    (id: string, adjustment: LayoutAdjustment) => {
      setElements((prev) => ({ ...prev, [id]: adjustment }));
      if (!ownerToken) return;
      void saveLayoutElement(id, adjustment, ownerToken).catch(() => {
        /* 네트워크 실패 — 화면은 이미 갱신됐으니 다음 조정 때 다시 시도될 뿐,
           사용자 흐름을 막을 정도의 오류는 아니다. */
      });
    },
    [ownerToken]
  );

  const reset = useCallback(
    (id: string) => {
      setElements((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (!ownerToken) return;
      void resetLayoutElement(id, ownerToken).catch(() => {});
    },
    [ownerToken]
  );

  const setEditMode = useCallback(
    (value: boolean) => {
      if (value && !ownerToken) return;
      setEditModeState(value);
    },
    [ownerToken]
  );

  return (
    <LayoutEditContext.Provider
      value={{ editMode, setEditMode, canEdit: !!ownerToken, get, update, commit, reset }}
    >
      {children}
    </LayoutEditContext.Provider>
  );
}

export function useLayoutEdit(): LayoutEditContextValue {
  return useContext(LayoutEditContext);
}
