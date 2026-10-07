/** 수강생 승인 코드와 승인 요청 번호를 이 기기에 저장한다.
 *  자동화 화면(/automation)과 같은 키를 써서, 한 번 입장하면 두 화면 모두 들어간다.
 *  저장이 막힌 기기(사생활 보호 모드 등)에서는 조용히 없는 것으로 본다. */
const CODE_KEY = "eden-automation-code";
const REQUEST_KEY = "eden-automation-request";

export function readStudentCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveStudentCode(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {}
}

export function readRequestId(): string {
  try {
    return localStorage.getItem(REQUEST_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeRequestId(id: string) {
  try {
    if (id) localStorage.setItem(REQUEST_KEY, id);
    else localStorage.removeItem(REQUEST_KEY);
  } catch {}
}
