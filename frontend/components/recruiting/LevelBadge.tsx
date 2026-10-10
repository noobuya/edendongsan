const LEVEL_TONE: Record<number, string> = {
  1: "bg-slate-100 text-slate-600",
  2: "bg-sky-50 text-sky-700",
  3: "bg-indigo-50 text-indigo-700",
  4: "bg-violet-50 text-violet-700",
  5: "bg-amber-50 text-amber-700",
};

/** 유저 이름 옆에 항상 따라다니는 레벨 칭호 — "Lv.3 · 뱃지 5개". 레벨은 서버
 *  (User.level, backend/app/models.py)가 계산해 내려준 값을 그대로 보여주기만
 *  한다 — 클라이언트가 직접 계산하면 위변조 여지가 생긴다.
 *
 *  badgeCount를 생략하면 "Lv.3"만 보여준다 — 커뮤니티 글/댓글 응답
 *  (CommunityPostRead/CommunityCommentRead)은 목록을 가볍게 하려고
 *  author_level만 내려주고 뱃지 개수는 안 담기 때문이다. */
export default function LevelBadge({
  level,
  badgeCount,
  className = "",
}: {
  level: number;
  badgeCount?: number;
  className?: string;
}) {
  const tone = LEVEL_TONE[level] ?? LEVEL_TONE[1];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums ${tone} ${className}`}>
      Lv.{level}
      {badgeCount !== undefined && ` · 뱃지 ${badgeCount}개`}
    </span>
  );
}
