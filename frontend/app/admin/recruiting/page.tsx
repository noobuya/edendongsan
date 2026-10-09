"use client";

import { useEffect, useState } from "react";
import { Award, Copy, Loader2, PlusCircle } from "lucide-react";
import {
  adminRecruitingApprove,
  adminRecruitingAwardBadge,
  adminRecruitingBadges,
  adminRecruitingCreateBadge,
  adminRecruitingReject,
  adminRecruitingRequests,
  type RecruitingUser,
  type SkillBadge,
} from "@/lib/api";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function makeCodeDraft(): string {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/** 관리자 토큰은 수강생 코드 관리 화면(/admin/students)과 같은 값을 쓴다. */
const TOKEN_KEY = "eden-admin-token";

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeToken(value: string) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

const input =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500";

const ROLE_LABEL: Record<string, string> = { ADMIN: "관리자", EXPERT: "전문가", STUDENT: "수강생" };
const STATUS_LABEL: Record<string, string> = { PENDING: "대기중", APPROVED: "승인됨", REJECTED: "거절됨" };

export default function AdminRecruitingPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [users, setUsers] = useState<RecruitingUser[]>([]);
  const [badges, setBadges] = useState<SkillBadge[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [openApprove, setOpenApprove] = useState<number | null>(null);
  const [codeDraft, setCodeDraft] = useState("");
  const [newBadgeName, setNewBadgeName] = useState("");
  const [newBadgeDesc, setNewBadgeDesc] = useState("");
  // 지급할 뱃지 선택을 유저별로 기억(선택 전엔 빈 값).
  const [awardBadgeId, setAwardBadgeId] = useState<Record<number, number>>({});

  async function load(t: string) {
    setBusy(true);
    setError(null);
    try {
      setUsers(await adminRecruitingRequests(t));
      setBadges(await adminRecruitingBadges(t));
      setToken(t);
      setAuthorized(true);
      writeToken(t);
    } catch (e) {
      setAuthorized(false);
      writeToken("");
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const saved = readToken();
    if (saved) void load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setUsers(await adminRecruitingRequests(token));
  }

  function openApproval(id: number) {
    if (openApprove === id) {
      setOpenApprove(null);
      return;
    }
    setOpenApprove(id);
    setCodeDraft(makeCodeDraft());
    setError(null);
  }

  async function approve(user: RecruitingUser) {
    const codeValue = codeDraft.trim();
    if (!codeValue) return;
    setBusy(true);
    setError(null);
    try {
      await adminRecruitingApprove(token, user.id, codeValue);
      setOpenApprove(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function reject(user: RecruitingUser) {
    if (!window.confirm(`${user.name}님의 요청을 거절할까요?`)) return;
    setBusy(true);
    setError(null);
    try {
      await adminRecruitingReject(token, user.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "거절하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createBadge() {
    const name = newBadgeName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const badge = await adminRecruitingCreateBadge(token, name, newBadgeDesc.trim());
      setBadges((prev) => [...prev, badge]);
      setNewBadgeName("");
      setNewBadgeDesc("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "뱃지를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function award(user: RecruitingUser) {
    const badgeId = awardBadgeId[user.id];
    if (!badgeId) return;
    setBusy(true);
    setError(null);
    try {
      await adminRecruitingAwardBadge(token, user.id, badgeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "뱃지를 지급하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, key: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.");
    }
  }

  if (!authorized) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">관리자 로그인</h1>
        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[14px] text-slate-600">서버에 설정된 관리자 토큰을 입력하세요.</p>
          <input
            type="password"
            className={input}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="관리자 토큰"
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && tokenInput && load(tokenInput.trim())}
          />
          <button
            disabled={busy || !tokenInput.trim()}
            onClick={() => load(tokenInput.trim())}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "들어가기"}
          </button>
          {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
        </section>
      </main>
    );
  }

  const pending = users.filter((u) => u.approval_status === "PENDING");
  const decided = users.filter((u) => u.approval_status !== "PENDING");

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">현장 실습 매칭 관리</h1>
        <button
          onClick={() => {
            writeToken("");
            setAuthorized(false);
            setToken("");
            setUsers([]);
          }}
          className="text-[14px] text-slate-500 underline"
        >
          나가기
        </button>
      </header>

      {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}

      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
          <PlusCircle className="h-4 w-4" /> 스킬 뱃지 만들기
        </h2>
        <input className={input} value={newBadgeName} onChange={(e) => setNewBadgeName(e.target.value)} placeholder="뱃지 이름 (예: 평면 마감 마스터)" />
        <input className={input} value={newBadgeDesc} onChange={(e) => setNewBadgeDesc(e.target.value)} placeholder="설명 (선택)" />
        <button
          disabled={busy || !newBadgeName.trim()}
          onClick={createBadge}
          className="h-12 w-full rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
        >
          만들기
        </button>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {badges.map((b) => (
              <span key={b.id} className="rounded-full bg-indigo-50 px-3 py-1.5 text-[13px] font-semibold text-indigo-700">
                {b.badge_name}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-[15px] font-bold text-slate-700">승인 요청 {pending.length}건</h2>
        {pending.length === 0 && <p className="px-1 text-[14px] text-slate-500">대기 중인 요청이 없어요.</p>}
        {pending.map((u) => (
          <div key={u.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <button onClick={() => openApproval(u.id)} className="flex w-full items-center justify-between text-left">
              <span className="text-[15px] font-bold text-slate-900">
                {u.name} <span className="ml-1 text-[12px] font-normal text-slate-500">{ROLE_LABEL[u.role]}</span>
              </span>
              <span className="text-[12px] tabular-nums text-slate-500">{u.phone_number}</span>
            </button>
            {openApprove === u.id && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <p className="text-[13px] text-slate-600">코드명을 확인하고 승인하면 신청자 기기에서 자동으로 입장합니다.</p>
                <div className="flex gap-2">
                  <input className={input} value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} aria-label="코드명" />
                  <button onClick={() => setCodeDraft(makeCodeDraft())} className="h-12 shrink-0 rounded-xl bg-slate-100 px-3 text-[13px] font-semibold text-slate-700">
                    새로
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy || codeDraft.trim().length < 6}
                    onClick={() => approve(u)}
                    className="h-12 flex-1 rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
                  >
                    승인
                  </button>
                  <button disabled={busy} onClick={() => reject(u)} className="h-12 flex-1 rounded-xl bg-rose-50 text-[15px] font-semibold text-rose-700 disabled:opacity-40">
                    거절
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-[15px] font-bold text-slate-700">처리된 계정 {decided.length}명</h2>
        {decided.length === 0 && <p className="px-1 text-[14px] text-slate-500">아직 처리된 계정이 없어요.</p>}
        {decided.map((u) => (
          <div key={u.id} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-slate-900">
                  {u.name} <span className="ml-1 text-[12px] font-normal text-slate-500">{ROLE_LABEL[u.role]}</span>
                </p>
                <p className="mt-0.5 text-[12.5px] tabular-nums text-slate-500">{u.phone_number} · {STATUS_LABEL[u.approval_status]}</p>
              </div>
              {u.approval_status === "APPROVED" && (
                <button onClick={() => copy(String(u.id), u.id)} aria-label="id 복사" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <Copy className="h-4 w-4" />
                  {copied === u.id && <span className="sr-only">복사됨</span>}
                </button>
              )}
            </div>
            {u.approval_status === "APPROVED" && u.role === "STUDENT" && badges.length > 0 && (
              <div className="flex gap-2 border-t border-slate-100 pt-2">
                <select
                  className="h-10 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[13px]"
                  value={awardBadgeId[u.id] ?? ""}
                  onChange={(e) => setAwardBadgeId((prev) => ({ ...prev, [u.id]: Number(e.target.value) }))}
                >
                  <option value="">뱃지 지급...</option>
                  {badges.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.badge_name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy || !awardBadgeId[u.id]}
                  onClick={() => award(u)}
                  className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  <Award className="h-3.5 w-3.5" /> 지급
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
