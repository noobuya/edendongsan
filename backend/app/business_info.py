"""사장님 업체 정보. 블로그 후기 글 하단 서명과 공개 블로그 배너에 쓰인다.

전화번호처럼 정확해야 하는 값은 AI가 생성하는 본문에 맡기지 않고 여기 고정값을
그대로 붙여넣는다 — LLM이 숫자를 한두 자리 잘못 옮겨 적을 위험을 원천 차단하기
위함이다 (app/services/blog_writer.py의 서명 블록 참고).
"""

BUSINESS_NAME = "에덴동산"
BUSINESS_PHONE = "010-7664-8007"
BUSINESS_SERVICE_AREA = "대구 전지역 및 경북 지역 출장 가능"
BUSINESS_PHONE_TEL_HREF = f"tel:{BUSINESS_PHONE.replace('-', '')}"
