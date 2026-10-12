/** AI가 쓰는 블로그 글은 "**강조할 말**"처럼 마크다운 볼드체만 아주 제한적으로
 *  쓴다(services/blog_writer.py 프롬프트 참고) — 전체 마크다운 파서를 들이는 대신,
 *  이 한 가지 패턴만 텍스트/강조 구간으로 쪼개서 각 렌더링 쪽(React 미리보기,
 *  네이버 복사용 HTML)이 자기 방식대로 <strong>으로 바꿔 쓰게 한다. */
export interface RichTextSegment {
  text: string;
  bold: boolean;
}

export function splitBoldSegments(text: string): RichTextSegment[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  // split에 캡처 그룹이 있으면 [평문, 강조, 평문, 강조, ...] 순서로 홀수 인덱스가
  // 강조문이 된다 — 빈 문자열(예: 볼드로 시작하는 경우의 맨 앞 "")을 먼저 걸러내면
  // 이 홀짝 순서가 어긋나므로, 반드시 원래 인덱스로 bold 여부를 정한 "다음"에 거른다.
  return parts.map((part, i) => ({ text: part, bold: i % 2 === 1 })).filter((seg) => seg.text !== "");
}
