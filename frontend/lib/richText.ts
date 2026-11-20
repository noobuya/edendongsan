/** AI가 쓰는 블로그 글은 "**강조할 말**"(볼드+주황색), "==눈에 띄는 문구=="(노란 하이라이트)
 *  두 가지 마크다운 패턴만 아주 제한적으로 쓴다(services/blog_writer.py 프롬프트 참고,
 *  사장님 기존 네이버 글의 실제 색상 — color:#ff5f45 / background-color:#fff8b2 — 을
 *  그대로 반영한 값). 전체 마크다운 파서를 들이는 대신, 이 두 패턴만 텍스트/강조 구간으로
 *  쪼개서 각 렌더링 쪽(React 미리보기, 네이버 복사용 HTML)이 자기 방식대로 색을 입혀
 *  쓰게 한다. */
export type RichTextEmphasis = "none" | "bold" | "highlight";

export interface RichTextSegment {
  text: string;
  emphasis: RichTextEmphasis;
  /** @deprecated emphasis === "bold"와 같다 — 기존 호출부 호환용. */
  bold: boolean;
}

const TOKEN_RE = /(\*\*.+?\*\*|==.+?==)/g;

export function splitBoldSegments(text: string): RichTextSegment[] {
  return text
    .split(TOKEN_RE)
    .filter((part) => part !== "")
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return { text: part.slice(2, -2), emphasis: "bold" as const, bold: true };
      }
      if (part.startsWith("==") && part.endsWith("==")) {
        return { text: part.slice(2, -2), emphasis: "highlight" as const, bold: false };
      }
      return { text: part, emphasis: "none" as const, bold: false };
    });
}
