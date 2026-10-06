// 사장님 업체 정보. 백엔드 app/business_info.py와 값을 반드시 동일하게 유지한다
// (전화번호는 백엔드가 블로그 본문 서명에도 그대로 박아 넣으므로, 여기서 값이
// 어긋나면 화면에 보이는 번호와 실제 글에 붙는 번호가 달라진다).
export const BUSINESS_NAME = "대한인테리어필름";
export const BUSINESS_PHONE = "010-7664-8007";
export const BUSINESS_SERVICE_AREA = "대구 전지역 및 경북 지역 출장 가능";
export const BUSINESS_PHONE_TEL_HREF = `tel:${BUSINESS_PHONE.replace(/-/g, "")}`;
