'use client';

import React, { useState, useEffect, useRef } from 'react';

type Channel = 'daangn' | 'soomgo_quote' | 'soomgo_chat' | 'blog' | 'insta';

interface UploadedPhoto {
  file: File;
  previewUrl: string;
}

// [왜 — 2026-11-22 "고객에겐 낮은 가격 먼저, 방문해서 넣을 땐 본래 가격"]
// 채팅으로 먼저 나가는 이 가격들은 고객 마음을 잡는 "낮은 미끼가"이고,
// 방문 실측 후 확정하는 본래 가격(평수별 견적 등 다른 화면)은 그대로
// 둔다 — 이 프리셋만 낮췄다.
const PRESET_ITEMS = [
  { label: '주방+냉장고장 (50만)', name: '30평대 싱크대 상·하부장 + 냉장고장', price: '50만 원' },
  { label: '주방 풀세트+아일랜드 (70만)', name: '싱크대 + 냉장고장 + 아일랜드 식탁', price: '70만 원' },
  { label: '방문 민자 (짝당 15만)', name: '방문 및 문틀 필름 시공 (민자)', price: '15만 원 (짝당)' },
  { label: '방문 알판 (짝당 18만)', name: '방문 및 문틀 필름 시공 (알판)', price: '18만 원 (짝당)' },
  { label: '붙박이장 (짝당 5만)', name: '붙박이장 도어 필름 시공', price: '10만 원 (2도어 기준)' },
  { label: '사각 싱크볼 (25만)', name: '스테인리스 사각 싱크볼 교체 + 실리콘 마감', price: '25만 원' },
  // [콩자갈 바닥 — 2026-11-26] 평당 20만 원 기준. 1.5평 이하 소규모(현관·전실)는
  // 최소 출장·인건비 방어선으로 35만 원 1식 고정, 2평 이상부터 평수×20만 원 산출.
  { label: '현관 콩자갈 (35만)', name: '현관·전실 천연 콩자갈 바닥 시공', price: '35만 원 (1식)' },
  { label: '베란다 콩자갈 (50만)', name: '베란다·다용도실 천연 콩자갈 바닥 시공', price: '50만 원 (평당 20만 원)' },
  { label: '상가 콩자갈 (평당 20만)', name: '상가·카페 천연 콩자갈 바닥 시공', price: '평당 20만 원 (㎡당 약 6만 원)' },
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
  const [cardImageCopied, setCardImageCopied] = useState(false);
  const [cardSaved, setCardSaved] = useState(false);
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

  // [왜 — 2026-11-26 "사진찍고 시공사진이 안나온다"] 안드로이드 WebView에서
  // capture 속성 없는 <input type="file">은 "카메라/갤러리/파일" 전체 선택창을
  // 띄우는데, 거기서 "카메라"로 촬영하면 카메라 앱이 뜬 사이 웹뷰 액티비티가
  // 메모리 정리되면서 돌아왔을 때 사진이 입력창에 전달되지 않고 사라지는 경우가
  // 있다(이미 admin/swatches·admin/swatch-scan에서 capture="environment"로
  // 우회해 둔 것과 같은 문제). 그래서 "갤러리에서 선택"(고객이 보낸 사진)과
  // "바로 촬영"(capture="environment")을 별도 버튼으로 분리한다. 매번 선택한
  // 사진으로 전체를 교체하던 기존 동작도, 촬영을 여러 번 나눠 할 수 있도록
  // 기존 사진에 이어 붙이는 방식으로 바꾼다.
  const addPhotos = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const mapped = Array.from(files).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...mapped].slice(0, 4));
    setAiSummary('');
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPhotos(e.target.files);
    // 같은 파일(특히 카메라로 찍은 임시 파일)을 다시 찍어도 onChange가 다시
    // 발생하도록 입력값을 비워 둔다 — 비우지 않으면 같은 경로의 파일은 "값이
    // 안 바뀌었다"고 보고 두 번째부터 이벤트가 안 일어난다.
    e.target.value = '';
  };

  const handleRemovePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
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
    // [콩자갈 바닥 — 2026-11-26] 시공 품목명에 '콩자갈'이 포함되면 필름 전용
    // 문구(샘플북, 시트지·페인트 제거 등) 대신 바닥 시공 전용 3대 원칙으로 전환한다.
    const isPebble = itemName.includes('콩자갈');

    let text = '';

    if (isPebble) {
      if (channel === 'daangn') {
        text = `안녕하세요, ${nameLabel}! 대구·현풍·테크노폴리스 천연 콩자갈 바닥 시공 전문 [대한인테리어필름]입니다 😊

보내주신 내용 꼼꼼히 확인했습니다.
문의하신 [${itemName}] 시공 예상 견적은 【 ${quotePrice} 】입니다.${noteLine}
(※ 현장 실측과 바닥 상태(수평·면적)에 따라 정확한 최종 금액이 확정됩니다.)

저희는 불필요한 영업사원 수수료와 중간 마진 없는 정직한 직영 견적으로 시공하며, 아래 3가지 원칙을 반드시 지킵니다.

✔ 이음매 없는 무줄눈 마감으로 때 끼임 없이 청소가 편하고 미끄럼 방지 효과 우수
✔ 바닥 연삭(그라인딩) 및 전용 프라이머 정석 밑작업 + 정밀 바인더 배합으로 돌 빠짐·크랙 방지
✔ 불필요한 중간 마진 없는 정직한 직영 견적(평당 20만 원 기준) & 시공 후 1년 무상 A/S 공식 보증제

무료로 방문드려 바닥 상태와 수평을 확인하고, 실제 콩자갈 원석 샘플(화이트·그레이·베이지 등)을 직접 보여드릴 수 있습니다. 편하신 시간대 알려주시면 맞춰서 찾아뵙겠습니다!

${card}`;
      } else if (channel === 'soomgo_quote') {
        text = `안녕하세요, ${nameLabel}! 대구·달성군 천연 콩자갈 바닥 시공 전문 [대한인테리어필름]입니다.

보내드린 【 ${quotePrice} 】 견적은 [${itemName}] 표준 시공 기준(평당 20만 원)이며, 현장 실측 면적과 바닥 상태(수평·기존 마감)에 따라 정확한 최종 견적이 산출됩니다.${noteLine}

[천연 콩자갈 바닥 3가지 책임 시공 기준]
1. 이음매 없는 무줄눈 마감으로 때 끼임 없이 청소가 편하고 미끄럼 방지 효과 우수
2. 바닥 연삭(그라인딩) 및 전용 프라이머 정석 밑작업 + 정밀 바인더 배합으로 돌 빠짐·크랙 방지
3. 불필요한 중간 마진 없는 정직한 직영 견적(평당 20만 원 기준) & 시공 완료 후 '1년 무상 A/S 보증제' 공식 운영

채팅창으로 시공 원하시는 바닥 사진 1장만 보내주시면 거품 없는 정확한 직영 견적을 바로 안내해 드리겠습니다. 감사합니다!`;
      } else if (channel === 'soomgo_chat') {
        text = `${nameLabel}, 반갑습니다! 견적서 확인해 주셔서 감사합니다 😊
정확한 안내를 위해 시공 원하시는 바닥 사진 1~2장만 편하게 올려주시면 바로 확인 후 말씀드리겠습니다.

무료로 방문드려 바닥 상태와 수평을 확인하고, 실제 콩자갈 원석 샘플(화이트·그레이·베이지 등)을 직접 보여드릴 수 있습니다. 급하신 경우 전화나 오픈채팅으로 연락 주셔도 바로 상담 가능합니다!

${card}`;
      } else if (channel === 'blog') {
        text = `안녕하세요, ${nameLabel}! 대한인테리어필름 블로그를 찾아주셔서 진심으로 감사합니다 😊

${photoMention}문의하신 [${itemName}] 시공 예상 견적은 【 ${quotePrice} 】입니다.${noteLine}

천연 콩자갈 바닥은 이음매 없는 무줄눈 마감이라 때 끼임 없이 청소가 편하고 미끄럼 방지 효과도 우수합니다.
대한인테리어필름은 바닥 연삭(그라인딩) 및 전용 프라이머 정석 밑작업과 정밀 바인더 배합으로 돌 빠짐·크랙을 방지하며, 불필요한 중간 마진 없는 정직한 직영 견적(평당 20만 원 기준)으로 시공 후 1년 무상 A/S를 공식 보장합니다.

아래 오픈채팅이나 안심번호로 바닥 사진과 함께 편하게 문의 주시면 무료로 방문드려 바닥 상태와 수평을 확인하고, 실제 콩자갈 원석 샘플(화이트·그레이·베이지 등)을 직접 보여드리겠습니다!

${card}`;
      } else if (channel === 'insta') {
        const instaGreeting = instaHandle.trim()
          ? `대한인테리어필름(@${instaHandle.trim().replace(/^@/, '')})을 찾아주셔서 감사합니다 ✨`
          : `대한인테리어필름을 찾아주셔서 감사합니다 ✨`;
        text = `안녕하세요, ${nameLabel}! ${instaGreeting}

${photoMention}보내주신 [${itemName}] 시공 예상 견적은 【 ${quotePrice} 】입니다.${noteLine}

✔ 이음매 없는 무줄눈 마감으로 청소 편리 & 미끄럼 방지 효과 우수
✔ 바닥 연삭(그라인딩)·전용 프라이머 밑작업 + 정밀 바인더 배합으로 돌 빠짐·크랙 방지
✔ 불필요한 중간 마진 없는 정직한 직영 견적(평당 20만 원 기준) & 시공 후 1년 무상 A/S 공식 보증

무료 방문 실측과 실제 콩자갈 원석 샘플(화이트·그레이·베이지 등)을 보여드릴 수 있으니 언제든 편하게 답장 주세요!

${card}`;
      }
    } else if (channel === 'daangn') {
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

    const grad = ctx.createLinearGradient(0, 0, 720, 420);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 720, 420);

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

    // [왜 — 2026-11-22] 사장님이 "필름 시공 품목"과 "설치 품목(전기·설비)"을
    // 섞어 쓰면 헷갈린다고 두 줄로 분리 요청 — 1줄은 필름 리폼 품목(끝에
    // "필름" 명시), 2줄은 관로·사각싱크볼·다운라이트·실링팬처럼 직접
    // 설치까지 하는 품목을 별도 문구로 안내한다.
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(40, 344, 640, 28);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('싱크대 · 붙박이장 · 방문 · 사각 싱크볼 · 콩자갈 바닥 직영 전문', 54, 363);

    ctx.fillStyle = '#fde68a';
    ctx.fillRect(40, 376, 640, 28);
    ctx.fillStyle = '#78350f';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('관로·사각싱크볼·다운라이트·실링팬 설치도 함께 진행', 54, 395);
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

  // [왜 — 2026-11-22 "명함 이미지 복사가 안 된다"]
  // "명함 이미지 저장"은 다운로드만 하고 클립보드엔 안 넣는다 — 채팅에
  // 바로 붙여넣으려면(Ctrl+V / 길게 눌러 붙여넣기) 이미지 자체가 클립보드에
  // 있어야 해서, Clipboard API로 캔버스를 PNG Blob으로 만들어 바로 복사하는
  // 버튼을 추가했다. 구형 WebView 등 이미지 클립보드를 지원하지 않는
  // 환경에서는 안내 후 "이미지 저장"으로 유도한다.
  const handleCopyCardImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('이미지를 만들지 못했습니다.');
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('unsupported');
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCardImageCopied(true);
      setTimeout(() => setCardImageCopied(false), 2000);
    } catch {
      alert('이 브라우저/앱에서는 이미지 복사가 지원되지 않아요. "명함 이미지 저장"으로 다운로드한 뒤, 채팅에서 사진으로 첨부해 주세요.');
    }
  };

  // [왜 — 2026-11-22 "저장해도 당근 채팅창에 붙여넣기가 안 된다"]
  // 설치된 안드로이드 앱(WebView)에서 <a download>는 "다운로드" 폴더에만
  // 남고 사진 앱(갤러리)에는 뜨지 않는다(메인 견적서 저장 기능에서 이미
  // 한 번 겪은 문제 — PremiumReceipt.tsx의 handleSaveToGallery와 같은
  // 네이티브 플러그인을 재사용한다) — 갤러리에 없으니 당근 채팅의 "사진
  // 첨부" 목록에서 찾을 수가 없었다. 또한 이미지는 원래 "붙여넣기"가
  // 아니라 채팅창의 사진/첨부 아이콘으로 갤러리에서 골라 보내는 것이
  // 맞다 — 앱 대부분이 텍스트 입력창에 이미지 붙여넣기를 지원하지 않는다.
  const handleDownloadCard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fileName = '대한인테리어_공식명함.png';
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { default: GallerySaver } = await import('@/lib/gallerySaver');
        await GallerySaver.saveImage({ data: canvas.toDataURL('image/png'), fileName });
        setCardSaved(true);
        setTimeout(() => setCardSaved(false), 2000);
        return;
      }
    } catch {
      // 네이티브 저장이 실패하면 아래 일반 웹 다운로드로 폴백한다.
    }
    const link = document.createElement('a');
    link.download = fileName;
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
            <label className="flex-1 cursor-pointer bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl py-2.5 px-3 text-center text-xs font-bold text-slate-700">
              🖼 갤러리에서 선택
              <input type="file" accept="image/*" multiple onChange={handlePhotoChange} className="hidden" />
            </label>
            <label className="flex-1 cursor-pointer bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl py-2.5 px-3 text-center text-xs font-bold text-slate-700">
              📷 바로 촬영
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
            </label>
            <button
              type="button"
              onClick={handleAnalyzePhotos}
              disabled={isAnalyzing}
              className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-bold text-xs px-3 rounded-xl shadow-sm shrink-0"
            >
              {isAnalyzing ? '분석 중...' : '⚡ 즉시 견적'}
            </button>
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-4 gap-2 pt-1">
              {photos.map((p, idx) => (
                <div key={idx} className="relative">
                  <img
                    src={p.previewUrl}
                    alt={`현장사진 ${idx + 1}`}
                    className="w-full h-20 object-cover rounded-lg border border-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemovePhoto(idx)}
                    aria-label="사진 삭제"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-slate-900 text-white text-xs rounded-full flex items-center justify-center shadow"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {photos.length >= 4 && (
            <p className="text-[11px] text-slate-400">사진은 최대 4장까지 담을 수 있어요. 더 담으려면 먼저 하나를 지워주세요.</p>
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
              <button
                type="button"
                onClick={() => setPrepNote('무황변 우레탄 바인더 배합 적용 (햇빛 황변 방지 / 평당 +2~3만 원 추가)')}
                className="text-[11px] bg-stone-50 text-stone-700 border border-stone-200 px-2 py-0.5 rounded"
              >
                + 무황변 우레탄 바인더 (평당 +2~3만 원)
              </button>
              <button
                type="button"
                onClick={() => setPrepNote('바닥 연삭(그라인딩) 및 전용 프라이머 정석 밑작업 포함')}
                className="text-[11px] bg-stone-50 text-stone-700 border border-stone-200 px-2 py-0.5 rounded"
              >
                + 바닥 연삭·전용 프라이머 밑작업
              </button>
              <button
                type="button"
                onClick={() => setPrepNote('투톤 곡선·로고 인레이 디자인 작업 (별도 협의)')}
                className="text-[11px] bg-stone-50 text-stone-700 border border-stone-200 px-2 py-0.5 rounded"
              >
                + 투톤 곡선·로고 인레이 (별도 협의)
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
          <span className="block text-xs font-bold text-slate-500">4. 채팅방 첨부용 공식 명함</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={handleCopyCardImage}
              className="text-xs bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-lg"
            >
              {cardImageCopied ? '✓ 이미지 복사됨' : '🖼 명함 이미지 복사'}
            </button>
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
              {cardSaved ? '✓ 갤러리에 저장됨' : '📥 명함 이미지 저장'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            이미지는 채팅창에 <b>붙여넣기가 아니라</b> "명함 이미지 저장" 후, 당근·숨고 채팅창의 사진/첨부 아이콘을 눌러 갤러리에서 "대한인테리어_공식명함"을 골라 보내주세요(대부분의 채팅 앱은 텍스트 입력창에 이미지 붙여넣기를 지원하지 않아요). "이미지 복사"는 카카오톡 PC 등 붙여넣기가 되는 곳에서만 써주세요. 위 "전체 복사하기"는 명함을 <b>텍스트</b>로만 포함해요 — 채팅창이 긴 메시지 뒷부분을 자르면 명함이 안 보일 수 있으니, 그럴 땐 "명함 텍스트만 복사"로 바로 이어서 한 번 더 보내주세요.
          </p>
          <canvas ref={canvasRef} width={720} height={420} className="w-full rounded-xl border border-slate-200" />
        </section>
      </main>
    </div>
  );
}
