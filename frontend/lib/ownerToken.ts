/** 사장님 기기 표시. 관리자 토큰을 이 기기 브라우저에만 저장해 두고, 있을 때만
 *  일러스트 입력을 연다. 저장이 막힌 기기(사생활 보호 모드 등)에서는 조용히 없는 것으로 본다. */
const KEY = "eden_owner_token";

export function readOwnerToken(): string | null {
  try {
    return window.localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function saveOwnerToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token.trim());
  } catch {
    // 저장이 막힌 기기에서는 이번 화면에서만 쓰이고 새로고침하면 사라진다.
  }
}

export function clearOwnerToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 지울 것이 없으면 그대로 둔다.
  }
}
