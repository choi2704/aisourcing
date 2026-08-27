# AI 소싱팀 v8 — GitHub Pages + Vercel 백엔드

이번 버전부터 브라우저가 Temu/Alibaba/Coupang/Naver를 직접 읽지 않습니다.
저번 블로그 생성기처럼:

GitHub Pages = 화면
Vercel = 실제 서버 + OpenAI 웹검색/AI 분석

구조입니다.

## 1. GitHub에 올리기
현재 aisourcing 저장소에 이 ZIP의 파일 전체를 업로드해도 됩니다.

중요:
`config.js`의 Vercel 주소는 Vercel 배포가 끝난 뒤 수정합니다.

## 2. Vercel 배포
같은 GitHub 저장소를 Vercel에 Import 해도 됩니다.

Vercel은 루트 `/api/ai.js`를 Node.js Function으로 자동 배포합니다.

Vercel Project Settings → Environment Variables에서 추가:

OPENAI_API_KEY = 본인의 OpenAI API 키

선택:
OPENAI_MODEL = gpt-5.4-mini
ALLOWED_ORIGIN = https://choi2704.github.io

저장 후 Redeploy 합니다.

## 3. Vercel 주소 확인
예:
https://aisourcing-api.vercel.app

`config.js` 열어서:

window.AI_SOURCING_API_BASE = "https://aisourcing-api.vercel.app";

로 수정하고 GitHub에 다시 업로드합니다.

## 4. 정상 연결 확인
GitHub Pages를 열면 오른쪽 상단에:

`Vercel + AI 연결됨`

이라고 표시되어야 합니다.

## v8 기능
### 상품 링크 직원
- 상품 페이지 서버에서 직접 읽기
- 상품명 / 가격 / 이미지 추출
- 직접 읽기 실패 시 OpenAI 웹검색으로 보완
- 못 찾은 가격은 만들지 않음

### 국내 자동비교 직원
- OpenAI 웹검색 사용
- 네이버쇼핑 / 쿠팡 / 한국 온라인 가격 후보 조사
- 실제 확인 가능한 결과만 사용
- 평균가 / 최저가 / 시장 포지션 계산

### 디자인 직원
- 실제 상품명 + 카테고리 + 국내 경쟁정보를 OpenAI에 전달
- 고객용 상세페이지 문구 생성
- 내부 매입가 / 순이익 / 마진율은 상세페이지에 노출하지 않음

## 꼭 알아둘 점
Temu/Alibaba/AliExpress 사이트는 자동화 차단이 강합니다.
v8은 직접 페이지 읽기 + AI 웹검색 fallback을 같이 사용하지만,
모든 상품의 옵션별 가격을 100% 자동으로 읽는 것은 보장할 수 없습니다.

가격이 확인되지 않으면 프로그램은 임의 가격으로 계산하지 않고 직접입력을 요청합니다.

## OpenAI API 비용
ChatGPT Plus와 OpenAI API 결제는 별개입니다.
Vercel에 넣는 OPENAI_API_KEY는 API Platform에 결제수단/크레딧이 있어야 작동합니다.
