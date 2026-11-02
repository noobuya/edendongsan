import type { WorkPhoto } from "@/types";

/** 블로그 본문을 "큰 문구(# ) + 설명" 블록으로 나누고, 블록 사이에 시공 전/후 비교
 *  사진을 끼워 넣는 배치를 정한다.
 *
 *  [왜 한 곳에서 정하는가 — 2026-11-03 "네이버 블로그가 최우선, 사진과 큰 문구로"]
 *  앱 블로그 화면(/blog/post)과 네이버 옮기기 순서표(NaverStepCopyPanel)가 똑같은
 *  순서여야 사장님이 앱에서 본 그대로 네이버에 옮길 수 있다. 블로그 글은
 *  services/blog_writer.py가 "# 큰 문구" 줄로 시작하는 블록을 빈 줄로 띄워 쓴다
 *  (예전 글처럼 "# "가 없으면 문단 하나가 블록 하나가 된다). */
export interface BlogSection {
  headline?: string;
  paragraphs: string[];
}

export function parseBlogSections(content: string): BlogSection[] {
  const sections: BlogSection[] = [];
  for (const block of content.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split("\n");
    const first = lines[0].trim();
    if (first.startsWith("# ")) {
      const rest = lines.slice(1).join("\n").trim();
      sections.push({ headline: first.slice(2).trim(), paragraphs: rest ? [rest] : [] });
    } else {
      sections.push({ paragraphs: [block] });
    }
  }
  return sections;
}

export interface BlogPhotoPlan {
  pairs: { before: WorkPhoto; after: WorkPhoto }[];
  /** 짝이 없는 나머지 사진(작업 중 포함) — 글 끝에 크게 이어 붙인다. */
  rest: WorkPhoto[];
}

export function planBlogPhotos(photos: WorkPhoto[]): BlogPhotoPlan {
  const before = photos.filter((p) => p.stage === "before");
  const progress = photos.filter((p) => p.stage === "progress");
  const after = photos.filter((p) => p.stage === "after");
  const n = Math.min(before.length, after.length);
  return {
    pairs: Array.from({ length: n }, (_, i) => ({ before: before[i], after: after[i] })),
    rest: [...before.slice(n), ...progress, ...after.slice(n)],
  };
}

/** i번째 블록 뒤에 넣을 비교 사진 짝 번호(없으면 null). 블록 수보다 짝이 많으면
 *  남는 짝은 마지막 이야기 블록 뒤에 몰아서 넣는다(lastStoryIndex). */
export function pairsAfterSection(sectionIndex: number, sectionCount: number, pairCount: number): number[] {
  if (pairCount === 0 || sectionCount === 0) return [];
  const slots = Math.min(sectionCount, pairCount);
  if (sectionIndex >= slots) return [];
  if (sectionIndex < slots - 1) return [sectionIndex];
  return Array.from({ length: pairCount - sectionIndex }, (_, k) => sectionIndex + k);
}
