"use client";

import { useEffect, useState } from "react";
import { fetchAssetObjectUrl } from "@/lib/api";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string };

/** 백엔드 사진을 보여주는 <img> 대체 컴포넌트. 왜 그냥 <img src>를 쓰면 안 되는지는
 *  lib/api.ts의 fetchAssetObjectUrl() 주석 참고. src에는 "/static/..." 같은 상대
 *  경로와 절대 URL 둘 다 넣을 수 있다. */
export default function AssetImage({ src, className, alt = "", ...imgProps }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    setObjectUrl(null);
    setFailed(false);

    fetchAssetObjectUrl(src)
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setObjectUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  if (!objectUrl) {
    return (
      <div
        className={`${className ?? ""} flex items-center justify-center bg-slate-100 ${
          failed ? "" : "animate-pulse"
        }`}
      >
        {failed && <span className="text-[10px] text-slate-400">사진을 불러오지 못했습니다</span>}
      </div>
    );
  }

  return <img {...imgProps} src={objectUrl} alt={alt} className={className} />;
}
