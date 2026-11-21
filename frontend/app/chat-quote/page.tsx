'use client';

import React, { useState, useEffect, useRef } from 'react';

type Channel = 'daangn' | 'soomgo_quote' | 'soomgo_chat' | 'blog' | 'insta';

interface UploadedPhoto {
  file: File;
  previewUrl: string;
}

const PRESET_ITEMS = [
  { label: '주방+냉장고장 (60만)', name: '30평대 싱크대 상·하부장 + 냉장고장', price: '60만 원' },
  { label: '주방 풀세트+아일랜드 (80만)', name: '싱크대 + 냉장고장 + 아일랜드 식탁', price: '80만 원' },
  { label: '방문 민자 (짝당 15만)', name: '방문 및 문틀 필름 시공 (민자)', price: '15만 원 (짝당)' },
  { label: '방문 알판 (짝당 18만)', name: '방문 및 문틀 필름 시공 (알판)', price: '18만 원 (짝당)' },
  { label: '붙박이장 (짝당 5만)', name: '붙박이장 도어 필름 시공', price: '10만 원 (2도어 기준)' },
  { label: '사각 싱크볼 (35만)', name: '스테인리스 사각 싱크볼 교체 + 실리콘 마감', price: '35만 원' },
];

export default function ChatQuotePage() {
  // 고객 및 견적 상태
  const [customerName, setCustomerName] = useState('');
  const [channel, setChannel] = useState<Channel>('daangn');
  const [itemName, setItemName] = useState('싱크대 상·하부장 필름 시공');
  const [quotePrice, setQuotePrice] = useState('50만 원');
  const [prepNote, setPrepNote] = useState('기존 표면 탈지·샌딩·전용 프라이머 밑작업 포함');
  const [instaHandle, setInstaHandle] = useState(''); // 추후 인스타 개설 시 입력

  // 사진 업로드 및 AI 분석 상태
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSummary, setAiSummary] = useState('');

  // 출력 및 UI 피드백
  const [generatedText, setGeneratedText] = useState('');
  const [copied, setCopied] = useState(false);
  const [cardCopied, setCardCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 공식 명함 텍스트 생성
  const getBusinessCardText = () => {
    const instaLine = instaHandle.trim()
      ? `\n· 인스타그램 시공사진 : instagram.com/${instaHandle.trim().replace(/^@/, '')}`
      : '';
    return `━━━━━━━━━━━━━━━
■ 대한인테리어 (대한인테리어필름 본사)
· 직영 상담 및 무료 실측 : 0507-1456-0691
· 카톡 1:1 간편 견적 : https://open.kakao.com/o/sh0JMsXi
· 시공 과정·후기 블로그 : https://blog.naver.com/noobuya12/224484648580${instaLine}
· 본사 위치 : 대구 달성군 현풍읍 테크노북로4길 11
━━━━━━━━━━━━━━━`;
  };

  // 사진 업로드 핸들러
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files).slice(0, 4);
    const mapped = selected.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPhotos(mapped);
    setAiSummary('');
  };

  // 에덴동산 백엔드 AI 사진 견적 호출
  const handleAnalyzePhotos = async () => {
    if (photos.length === 0) {
      alert('고객이 보낸 현장 사진을 먼저 1장 이상 올려주세요.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const formData = new FormData();
      photos.forEach((p) => formData.append('files', p.file));

      // 기존 에덴동산 FastAPI 견적 엔드포인트 연동
      const res = await fetch('/api/estimate', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        // 백엔드 응답 구조에 맞춰 자동 세팅
        if (data.item_summary) setItemName(data.item_summary);
        if (data.total_price_text) {
          setQuotePrice(data.total_price_text);
        } else if (data.total_min && data.total_max) {
          const minMan = Math.round(data.total_min / 10000);
          const maxMan = Math.round(data.total_max / 10000);
          setQuotePrice(minMan === maxMan ? `${minMan}만 원` : `${minMan}만 ~ ${maxMan}만 원`);
        }
        setAiSummary(data.analysis_note || '사진 분석 완료: 밑작업 및 자재 소요량 반영됨');
      } else {
        setAiSummary('사진 확인 완료 (아래 빠른 품목 버튼 또는 금액을 확인해 주세요)');
      }
    } catch {
      setAiSummary('사진 등록 완료 (현장 상태에 맞춰 금액을 확인해 주세요)');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 채널별 인사말 + 사진 견적 + 명함 실시간 조합
  useEffect(() => {
    const nameLabel = customerName.trim() ? `${customerName.trim()}님` : '고객님';
    const card = getBusinessCardText();
    const photoMention = photos.length > 0 ? '보내주신 현장 사진 꼼꼼히 확인했습니다.\n' : '';
    const noteLine = prepNote.trim() ? `\n· 시공 포함 내역 : ${prepNote.trim()}` : '';

    let text = '';

    if (channel === 'daangn') {
      text = `안녕하세요, ${nameLabel}! 대구·현풍·테크노폴리스 인테리어 필름 직영 시공 전문 [대한인테리어필름]입니다 😊

보내주신 내용 꼼꼼히 확인했습니다.
문의하신 [${itemName}] 시공 예상 견적은 【 ${quotePrice} 】입니다.${noteLine}
(※ 현장 실측 및 선택하시는 친환경 프리미엄 필름 자재에 따라 정확한 최종 금액이 확정됩니다.)

저희는 불필요한 영업사원 수수료와 쇼룸 거품을 뺀 정직한 직영 견적으로 시공하며, 아래 3가지 원칙을 반드시 지킵니다.

✔ 보이지 않는 밑작업부터 FM 시공 (기존 불량 시트지·페인트 제거, 퍼티, 탈지, 샌딩, 전용 프라이머 도포)
✔ 하루 물량 치기 없이 1mm 오차도 허용하지 않는 칼각 마감
✔ 시공 후 1년 무상 A/S 공식 보증제 운영

무료로 방문드려 실측하면서 실제 샘플북(화이트, 크림, 조슈아우드 등)을 직접 보여드릴 수 있습니다. 편하신 시간대 알려주시면 맞춰서 찾아뵙겠습니다!

${card}`;
    } else if (channel === 'soomgo_quote') {
      text = `안녕하세요, ${nameLabel}! 대구·달성군 인테리어 필름 직영 시공 전문 [대한인테리어필름]입니다.

보내드린 【 ${quotePrice} 】 견적은 [${itemName}] 표준 시공 기준이며, 현장 실측 사이즈와 도어 형태(민자/알판 몰딩), 선택하시는 브랜드 필름(현대보닥·KCC·영림 등)에 따라 정확한 최종 견적이 산출됩니다.${noteLine}

[대한인테리어필름만의 3가지 책임 시공 기준]
1. 보이지 않는 밑작업부터 정석대로 (기존 시트지·페인트 제거, 퍼티·샌딩·탈지·전용 프라이머)
2. 하루 물량 치기 없는 1mm 정밀 칼각 마감 및 친환경 자재 사용
3. 시공 완료 후 '1년 무상 A/S 보증제' 공식 운영

채팅창으로 시공 원하시는 곳 정면 사진 1장만 보내주시면 거품 없는 정확한 직영 견적을 바로 안내해 드리겠습니다. 감사합니다!`;
    } else if (channel === 'soomgo_chat') {
      // [왜 — 2026-11-22] 숨고는 2단계 흐름(견적서 발송 → 채팅 오픈 직후)이 가장
      // 안전하다고 사장님이 정리함 — 가격은 이미 위 soomgo_quote(견적서 칸)에서
      // 전달했으므로 여기서 또 반복하지 않는다. 명함·링크는 채팅에서만 안전해서
      // 여기 풀버전으로 붙인다.
      text = `${nameLabel}, 반갑습니다! 견적서 확인해 주셔서 감사합니다 😊
정확한 안내를 위해 시공 원하시는 부위 사진 1~2장만 편하게 올려주시면 바로 확인 후 말씀드리겠습니다.

아래 블로그에서 실제 작업 과정과 시공 후기를 미리 보실 수 있으며, 급하신 경우 전화나 오픈채팅으로 연락 주셔도 바로 상담 가능합니다!

${card}`;
    } else if (channel === 'blog') {
      text = `안녕하세요, ${nameLabel}! 대한인테리어필름 블로그를 찾아주셔서 진심으로 감사합니다 😊

${photoMention}문의하신 [${itemName}] 시공 예상 견적은 【 ${quotePrice} 】입니다.${noteLine}

필름 시공은 겉면 시트지보다 보이지 않는 밑작업(기존 불량 시트지·페인트 제거, 퍼티, 탈지, 프라이머)이 수명을 좌우합니다.
대한인테리어필름은 하루 물량 치기 없이 내 집을 고친다는 마음으로 1mm까지 정밀 마감하며, 시공 후 1년 무상 A/S를 공식 보장합니다.

아래 오픈채팅이나 안심번호로 사진과 함께 편하게 문의 주시면 거품 없는 직영 견적으로 상세히 안내해 드리겠습니다!

${card}`;
    } else if (channel === 'insta') {
      const instaGreeting = instaHandle.trim()
        ? `대한인테리어필름(@${instaHandle.trim().replace(/^@/, '')})을 찾아주셔서 감사합니다 ✨`
        : `대한인테리어필름을 찾아주셔서 감사합니다 ✨`;
      text = `안녕하세요, ${nameLabel}! ${instaGreeting}

${photoMention}보내주신 [${itemName}] 시공 예상 견적은 【 ${quotePrice} 】입니다.${noteLine}

✔ 기존 시트지·페인트 제거부터 퍼티·프라이머까지 정석 밑작업
✔ 1mm 오차 없는 칼각 마감 & 트렌드 무광/우드 필름 시공
✔ 시공 후 1년 무상 A/S 공식 보증

샘플 컬러 추천이나 무료 방문 실측이 필요하시면 언제든 편하게 답장 주세요!

${card}`;
    }

    setGeneratedText(text);
  }, [customerName, channel, itemName, quotePrice, prepNote, instaHandle, photos.length]);

  // 디지털 명함 Canvas 렌더링
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 720, 400);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 720, 400);

    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(40, 44, 8, 64);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('대한인테리어 · 대한인테리어필름', 64, 78);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('정석 밑작업 · 1mm 정밀 칼각 마감 · 시공 후 1년 무상 A/S 공식 보증', 64, 110);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(40, 142);
    ctx.lineTo(680, 142);
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('📞 직영 상담 · 무료 방문 실측 : 0507-1456-0691', 44, 190);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '18px sans-serif';
    ctx.fillText('💬 카카오톡 1:1 문의 : open.kakao.com/o/sh0JMsXi', 44, 232);
    ctx.fillText('📝 시공 포트폴리오 : blog.naver.com/noobuya12', 44, 270);

    if (instaHandle.trim()) {
      ctx.fillText(`📸 인스타그램 : @${instaHandle.trim().replace(/^@/, '')}`, 44, 308);
    } else {
      ctx.fillText('📍 본사 위치 : 대구 달성군 현풍읍 테크노북로4길 11', 44, 308);
    }

    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(40, 344, 640, 32);
    ctx.fillStyle = '#0f172a';
    // 품목이 늘어서(다운라이트·실링팬 추가) 15px로는 640px 박스를 넘기므로 12px로 줄였다.
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('싱크대·냉장고장·붙박이장·방문/문틀·현관문·사각싱크볼·다운라이트·실링팬 직영전문', 56, 365);
  }, [instaHandle]);

  // 안드로이드 WebView/Capacitor 호환 클립보드 복사
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const handleCopy = async () => {
    await copyToClipboard(generatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // [왜 — 2026-11-22] "전체 복사해서 붙여넣으면 명함이 안 나온다" 신고 대응.
  // 숨고 견적서(soomgo_quote)는 필터링 회피를 위해 원래 명함을 안 넣고,
  // 다른 채널은 메시지 맨 끝에 명함을 붙이는데 당근·숨고 채팅창이 긴 글을
  // 보낼 때 뒷부분(=명함)을 자르는 경우가 있다 — 그래서 명함 텍스트만 따로
  // 복사해서 바로 뒤이어 한 번 더 보낼 수 있게 분리했다.
  const handleCopyCard = async () => {
    await copyToClipboard(getBusinessCardText());
    setCardCopied(true);
    setTimeout(() => setCardCopied(false), 2000);
  };

  const handleDownloadCard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = '대한인테리어_공식명함.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-24">
      {/* 상단 바 */}
      <header className="bg-slate-900 text-white px-4 py-4 sticky top-0 z-20 shadow">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">대한인테리어 원클릭 견적·상담</h1>
            <p className="text-xs text-slate-400">사진 즉시 견적 + 당근·숨고·블로그·인스타 자동 응대</p>
          </div>
          <a href="/quote" className="text-xs bg-slate-800 border border-slate-600 px-3 py-1.5 rounded-lg">
            평수별 견적 →
          </a>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 space-y-4">
        {/* STEP 1: 고객 사진 업로드 & 즉시 견적 산출 */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">1. 고객 현장 사진 업로드 → 즉시 견적</span>
            {aiSummary && <span className="text-xs font-bold text-emerald-600">{aiSummary}</span>}
          </div>

          <div className="flex gap-2">
            <label className="flex-1 cursor-pointer bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl py-3 px-4 text-center text-sm font-bold text-slate-700">
              📷 고객 사진 선택 (최대 4장)
              <input type="file" accept="image/*" multiple onChange={handlePhotoChange} className="hidden" />
            </label>
            <button
              type="button"
              onClick={handleAnalyzePhotos}
              disabled={isAnalyzing}
              className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-bold text-sm px-4 rounded-xl shadow-sm"
            >
              {isAnalyzing ? '분석 중...' : '⚡ 즉시 견적 내기'}
            </button>
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-4 gap-2 pt-1">
              {photos.map((p, idx) => (
                <img
                  key={idx}
                  src={p.previewUrl}
                  alt={`현장사진 ${idx + 1}`}
                  className="w-full h-20 object-cover rounded-lg border border-slate-200"
                />
              ))}
            </div>
          )}

          {/* 빠른 확정 단가 프리셋 */}
          <div className="pt-1">
            <p className="text-xs font-semibold text-slate-500 mb-1.5">빠른 표준 단가 선택 (클릭 시 즉시 반영)</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ITEMS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setItemName(preset.name);
                    setQuotePrice(preset.price);
                  }}
                  className="text-xs bg-slate-100 hover:bg-amber-100 text-slate-800 font-medium px-2.5 py-1.5 rounded-lg transition"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* STEP 2: 고객명 및 채널 선택 */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
          <span className="block text-xs font-bold text-slate-500">2. 고객명 & 마케팅 채널 선택</span>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">고객명</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="예: 김민지 (비우면 고객님)"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">산출 견적 금액</label>
              <input
                type="text"
                value={quotePrice}
                onChange={(e) => setQuotePrice(e.target.value)}
                placeholder="예: 60만 원"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">시공 품목명</label>
            <input
              type="text"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">밑작업 / 추가 안내 메모</label>
            <div className="flex gap-1.5 mb-1.5">
              <button
                type="button"
                onClick={() => setPrepNote('기존 들뜬 시트지 스크래핑 제거 + 퍼티·프라이머 밑작업 포함')}
                className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded"
              >
                + 기존 시트지 제거
              </button>
              <button
                type="button"
                onClick={() => setPrepNote('기존 페인트 도장면 긁어내기 + 홈 퍼티 평탄화 밑작업 포함')}
                className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded"
              >
                + 페인트 제거
              </button>
            </div>
            <input
              type="text"
              value={prepNote}
              onChange={(e) => setPrepNote(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-slate-900"
            />
          </div>

          {/* 4대 채널 선택 탭 */}
          <div className="pt-1">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">발송 채널 선택 (인사말·명함 자동 전환)</label>
            <div className="grid grid-cols-5 gap-1.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setChannel('daangn')}
                className={`py-2.5 rounded-xl border ${
                  channel === 'daangn'
                    ? 'border-orange-500 bg-orange-50 text-orange-600'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                🥕 당근
              </button>
              <button
                type="button"
                onClick={() => setChannel('soomgo_quote')}
                className={`py-2.5 rounded-xl border ${
                  channel === 'soomgo_quote'
                    ? 'border-purple-600 bg-purple-50 text-purple-700'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                💜 숨고견적
              </button>
              <button
                type="button"
                onClick={() => setChannel('soomgo_chat')}
                className={`py-2.5 rounded-xl border ${
                  channel === 'soomgo_chat'
                    ? 'border-purple-600 bg-purple-50 text-purple-700'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                💬 숨고채팅
              </button>
              <button
                type="button"
                onClick={() => setChannel('blog')}
                className={`py-2.5 rounded-xl border ${
                  channel === 'blog'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                📝 블로그
              </button>
              <button
                type="button"
                onClick={() => setChannel('insta')}
                className={`py-2.5 rounded-xl border ${
                  channel === 'insta'
                    ? 'border-pink-600 bg-pink-50 text-pink-700'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                📸 인스타
              </button>
            </div>
            {channel === 'insta' && (
              <input
                type="text"
                value={instaHandle}
                onChange={(e) => setInstaHandle(e.target.value)}
                placeholder="추후 개설할 인스타 아이디 입력 (예: @daehan_interior_film)"
                className="mt-2 w-full px-3 py-2 border border-pink-200 bg-pink-50/40 rounded-xl text-xs focus:outline-none"
              />
            )}
          </div>
        </section>

        {/* STEP 3: 자동 완성된 채팅 문구 & 복사 */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">3. 채팅 전송용 완성 문구 (명함 포함)</span>
            {copied && (
              <span className="text-xs bg-emerald-100 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full">
                ✓ 복사 완료! 채팅창에 붙여넣으세요
              </span>
            )}
          </div>

          <textarea
            rows={13}
            value={generatedText}
            onChange={(e) => setGeneratedText(e.target.value)}
            className="w-full p-3.5 bg-slate-50 border border-slate-300 rounded-xl text-sm leading-relaxed text-slate-800 focus:outline-none"
          />

          <button
            type="button"
            onClick={handleCopy}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-slate-900 font-black rounded-xl text-base shadow transition"
          >
            📋 인사말 + 사진 견적 + 명함 전체 복사하기
          </button>
        </section>

        {/* STEP 4: 채팅 첨부용 공식 명함 이미지 */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">4. 채팅방 이미지 첨부용 공식 명함</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleCopyCard}
                className="text-xs bg-white border border-slate-300 text-slate-700 font-bold px-3 py-1.5 rounded-lg"
              >
                {cardCopied ? '✓ 복사됨' : '📋 명함 텍스트만 복사'}
              </button>
              <button
                type="button"
                onClick={handleDownloadCard}
                className="text-xs bg-slate-900 text-white font-bold px-3 py-1.5 rounded-lg"
              >
                📥 명함 이미지 저장
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            위 "전체 복사하기"는 이 명함을 <b>텍스트</b>로만 포함해요(아래 이미지는 별도) — 채팅창이 긴 메시지 뒷부분을 자르면 명함이 안 보일 수 있으니, 그럴 땐 "명함 텍스트만 복사"로 바로 이어서 한 번 더 보내거나, "명함 이미지 저장" 후 사진으로 첨부해 주세요.
          </p>
          <canvas ref={canvasRef} width={720} height={400} className="w-full rounded-xl border border-slate-200" />
        </section>
      </main>
    </div>
  );
}
