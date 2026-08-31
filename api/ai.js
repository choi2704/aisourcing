
import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  cors(res);
  res.status(status).json(data);
}

function stripTags(s = "") {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function firstMeta(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i")
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return stripTags(m[1]);
    }
  }
  return "";
}

function parseJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (types.includes("Product")) {
          let offers = item.offers;
          if (Array.isArray(offers)) offers = offers[0];
          return {
            title: item.name || "",
            image: Array.isArray(item.image) ? item.image[0] : (item.image?.url || item.image || ""),
            price: offers?.price || offers?.lowPrice || "",
            currency: offers?.priceCurrency || ""
          };
        }
      }
    } catch {}
  }
  return null;
}

function extractProduct(html, url) {
  const ld = parseJsonLd(html) || {};
  const title = ld.title ||
    firstMeta(html, ["og:title", "twitter:title"]) ||
    stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");

  const image = ld.image ||
    firstMeta(html, ["og:image", "twitter:image"]);

  let price = ld.price || firstMeta(html, [
    "product:price:amount",
    "og:price:amount",
    "price"
  ]);
  let currency = ld.currency || firstMeta(html, [
    "product:price:currency",
    "og:price:currency",
    "priceCurrency"
  ]);

  if (!price) {
    const body = stripTags(html).slice(0, 300000);
    const p = body.match(/(?:US\s*)?\$\s*([0-9]+(?:\.[0-9]{1,2})?)|(?:CN\s*)?¥\s*([0-9]+(?:\.[0-9]{1,2})?)|₩\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*원/);
    if (p) {
      if (p[1]) { price = p[1]; currency = "USD"; }
      else if (p[2]) { price = p[2]; currency = "CNY"; }
      else { price = (p[3] || p[4]).replace(/,/g,""); currency = "KRW"; }
    }
  }

  return {
    title: title.replace(/\s*[-|]\s*(Temu|Alibaba|AliExpress).*$/i, "").trim(),
    image,
    price: String(price || "").replace(/,/g, ""),
    currency: currency || "",
    sourceUrl: url
  };
}

function normalizeProductResult(x, url) {
  return {
    title: String(x?.title || "").trim(),
    image: String(x?.image || "").trim(),
    price: x?.price == null ? "" : String(x.price).replace(/,/g, "").trim(),
    currency: String(x?.currency || "").toUpperCase().trim(),
    sourceUrl: url
  };
}

function parseLooseJson(text = "") {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(cleaned.slice(a, b + 1)); } catch {}
  }
  throw new Error("AI JSON 응답 파싱 실패");
}

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function aiProductFallback(url) {
  const client = getClient();
  if (!client) return null;

  const response = await client.responses.create({
    model: MODEL,
    tools: [{ type: "web_search_preview" }],
    input: `다음 해외 쇼핑 상품 URL을 조사해 현재 공개 웹에서 확인 가능한 상품 정보를 찾아라.
URL: ${url}

반드시 JSON 객체 하나만 출력:
{
  "title": "정확한 상품명 또는 빈 문자열",
  "price": "숫자만, 모르면 빈 문자열",
  "currency": "USD/CNY/KRW 중 하나 또는 빈 문자열",
  "image": "직접 확인 가능한 상품 이미지 URL 또는 빈 문자열"
}
추측 가격은 만들지 말고, 확인 못 하면 빈 문자열로 둬라.`
  });
  return normalizeProductResult(parseLooseJson(response.output_text || ""), url);
}

async function readProduct(url) {
  let direct = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const r = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"
      }
    });
    clearTimeout(timer);
    if (r.ok) {
      const html = await r.text();
      direct = normalizeProductResult(extractProduct(html, url), url);
    }
  } catch {}

  if (direct?.title && direct?.price) return { ...direct, method: "direct" };

  const ai = await aiProductFallback(url);
  if (ai && (ai.title || ai.price)) {
    return {
      title: ai.title || direct?.title || "",
      image: ai.image || direct?.image || "",
      price: ai.price || direct?.price || "",
      currency: ai.currency || direct?.currency || "",
      sourceUrl: url,
      method: "ai-web"
    };
  }

  return { ...(direct || {title:"",image:"",price:"",currency:"",sourceUrl:url}), method:"partial" };
}

async function compareDomestic(productName) {
  const client = getClient();
  if (!client) throw new Error("OPENAI_API_KEY가 Vercel에 설정되지 않았습니다.");

  const response = await client.responses.create({
    model: MODEL,
    tools: [{ type: "web_search_preview" }],
    input: `한국 온라인 판매 시장을 조사해라.
상품: ${productName}

네이버쇼핑, 쿠팡 및 한국 온라인 판매 결과 중 실제로 확인 가능한 유사상품 가격을 찾아 비교하라.
완전히 다른 제품은 제외하고, 같은 용도/형태 중심으로 최대 8개만 추려라.
가격을 확인할 수 없으면 임의로 만들지 마라.

반드시 JSON 객체 하나만 출력:
{
  "keyword": "검색에 사용한 핵심 한국어 키워드",
  "items": [
    {"shop":"네이버쇼핑 또는 쿠팡 또는 기타","title":"상품명","price":29900,"url":"출처 URL"}
  ],
  "summary":"경쟁상황 한 줄"
}`
  });

  const data = parseLooseJson(response.output_text || "");
  const items = Array.isArray(data.items) ? data.items
    .map(x => ({
      shop: String(x.shop || ""),
      title: String(x.title || ""),
      price: Number(String(x.price || "").replace(/,/g,"")) || 0,
      url: String(x.url || "")
    }))
    .filter(x => x.price > 0)
    .slice(0, 8) : [];

  return { keyword: data.keyword || productName, items, summary: data.summary || "" };
}



async function estimateLogistics(payload) {
  const client = getClient();
  if (!client) throw new Error("OPENAI_API_KEY가 Vercel에 설정되지 않았습니다.");

  const response = await client.responses.create({
    model: MODEL,
    input: `너는 중국/해외상품 한국 수입 원가 계산 보조 담당자다.
아래 정보로 국제운송비와 통관·기타비를 '검토용 추정치'로 계산하라.
정확한 운임 견적이 아니라 소싱 판단용 예상값이며, 모르면 보수적으로 잡아라.

${JSON.stringify(payload, null, 2)}

반드시 JSON 객체 하나만 출력:
{
  "internationalShippingTotal": 30000,
  "customsEtcTotal": 12000,
  "basis":"계산 근거 한 줄",
  "warning":"실제 발주 전 확인할 내용"
}

관세율을 확정적으로 단정하지 말고, 품목분류에 따라 달라질 수 있음을 반영하라.`
  });
  return parseLooseJson(response.output_text || "");
}

async function researchImages(payload) {
  const client = getClient();
  if (!client) throw new Error("OPENAI_API_KEY가 Vercel에 설정되지 않았습니다.");

  const response = await client.responses.create({
    model: MODEL,
    tools: [{ type: "web_search_preview" }],
    input: `너는 온라인 쇼핑몰 상세페이지용 자료수집 담당자다.
상품:
${JSON.stringify(payload, null, 2)}

공개 웹에서 이 상품 또는 매우 유사한 상품의 정보를 조사해 상세페이지에 필요한 이미지/자료 구성을 정리해라.
가능하면 실제 이미지 URL을 사용하되, 확인되지 않은 URL은 만들지 마라.
대표이미지, 사용장면, 디테일, 사이즈/구성, 소재/기능 설명에 적합한 자료 순서를 생각해라.

반드시 JSON 객체 하나만 출력:
{
  "images":[
    {"url":"직접 확인 가능한 이미지 URL","role":"대표|사용장면|디테일|사이즈|구성|기타","note":"이 이미지를 어디에 쓰면 좋은지"}
  ],
  "points":["상세페이지에서 강조할 핵심 포인트1","포인트2","포인트3"],
  "layout":"추천 상세페이지 이미지 구성 순서 한 줄",
  "status":"자료 충분|일부 부족|자료 부족"
}
이미지 URL을 확인 못 하면 images에 넣지 마라.`
  });

  return parseLooseJson(response.output_text || "");
}



async function auditSourcing(payload) {
  const client = getClient();
  if (!client) throw new Error("OPENAI_API_KEY가 Vercel에 설정되지 않았습니다.");

  const response = await client.responses.create({
    model: MODEL,
    tools: [{ type: "web_search_preview" }],
    input: `너는 해외상품 소싱팀의 독립 감사 담당자다.
다른 AI 직원이 낸 결과를 그대로 믿지 말고 반드시 다시 검토한다.

감사 대상:
${JSON.stringify(payload, null, 2)}

검사 원칙:
1. 상품/국내가격: 제공된 원본 링크와 경쟁상품 링크가 실제 근거인지 점검한다.
2. 인증·규제: 한국 공식기관 자료를 최우선으로 찾는다. 가능한 경우 제품안전정보센터, 관세청, 식약처, 국립전파연구원 등 공식 출처를 우선한다.
3. 공식 근거가 부족하면 "확인됨"이라고 하지 말고 "재확인 필요"로 둔다.
4. 국제운송·통관비는 실제 포워더 견적이 아니므로 원칙적으로 "추정값"으로 표시한다.
5. 존재하지 않는 URL이나 확인하지 못한 사실을 만들지 않는다.
6. 상품 카테고리가 애매하면 인증 필요/불필요를 단정하지 않는다.

반드시 JSON 객체 하나만 출력:
{
  "productEvidence":{
    "status":"verified|review|blocked",
    "summary":"상품명/매입가 근거 점검 결과",
    "sources":[{"title":"출처명","url":"https://..."}]
  },
  "marketEvidence":{
    "status":"verified|review|blocked",
    "summary":"국내 경쟁상품 가격 근거 점검 결과",
    "sources":[{"title":"출처명","url":"https://..."}]
  },
  "regulatoryEvidence":{
    "status":"verified|review|blocked",
    "summary":"한국 인증/규제 점검 결과. 모르면 확인 필요라고 명시",
    "sources":[{"title":"공식 근거","url":"https://..."}]
  },
  "conflicts":["서로 충돌하거나 의심되는 정보"],
  "warnings":["최종 발주 전 확인할 사항"]
}`
  });

  return parseLooseJson(response.output_text || "");
}

async function createMarketing(payload) {
  const client = getClient();
  if (!client) throw new Error("OPENAI_API_KEY가 Vercel에 설정되지 않았습니다.");

  const response = await client.responses.create({
    model: MODEL,
    input: `너는 한국 온라인 쇼핑몰 실무 마케터다.
상품 분석 결과를 바탕으로 실제 판매에 쓸 마케팅 방향을 만든다.
확인되지 않은 성능, 과장광고, 허위 비교우위는 쓰지 마라.

${JSON.stringify(payload, null, 2)}

반드시 JSON 객체 하나만 출력:
{
  "sellingPoints":["판매포인트1","판매포인트2","판매포인트3"],
  "headlines":["광고 헤드라인1","광고 헤드라인2","광고 헤드라인3"],
  "contentIdeas":["숏폼/블로그/상세페이지 아이디어1","아이디어2","아이디어3"],
  "cta":"짧은 구매유도 문구"
}`
  });
  return parseLooseJson(response.output_text || "");
}

async function designDetail(payload) {
  const client = getClient();
  if (!client) throw new Error("OPENAI_API_KEY가 Vercel에 설정되지 않았습니다.");

  const response = await client.responses.create({
    model: MODEL,
    input: `너는 한국 온라인 쇼핑몰 상세페이지 전문 기획자다.
고객에게 노출하면 안 되는 내부 원가, 순이익, 마진율은 절대 상세페이지 카피에 넣지 마라.

상품 정보:
${JSON.stringify(payload, null, 2)}

반드시 JSON 객체 하나만 출력:
{
  "headline":"짧고 강한 메인 헤드라인",
  "subheadline":"상품을 한 문장으로 설명",
  "benefits":[
    {"title":"장점1","description":"고객 관점 설명"},
    {"title":"장점2","description":"고객 관점 설명"},
    {"title":"장점3","description":"고객 관점 설명"}
  ],
  "targets":["추천 고객1","추천 고객2","추천 고객3"],
  "cautions":["구매 전 확인1","구매 전 확인2","구매 전 확인3"],
  "sections":[
    {"title":"상세 섹션 제목","body":"실제 상세페이지에 넣을 문구"}
  ],
  "cta":"마지막 구매 유도 문구"
}
과장광고, 확인되지 않은 성능 주장, 인증 완료 단정은 하지 마라.`
  });

  return parseLooseJson(response.output_text || "");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { ok:false, error:"POST만 지원합니다." });

  try {
    const { action, ...body } = req.body || {};

    if (action === "health") {
      return json(res, 200, { ok:true, model:MODEL, openaiConfigured:!!process.env.OPENAI_API_KEY });
    }

    if (action === "product") {
      const url = String(body.url || "");
      if (!/^https?:\/\//i.test(url)) return json(res, 400, {ok:false,error:"올바른 상품 URL이 필요합니다."});
      const product = await readProduct(url);
      return json(res, 200, { ok:true, product });
    }

    if (action === "compare") {
      const productName = String(body.productName || "").trim();
      if (!productName) return json(res,400,{ok:false,error:"상품명이 필요합니다."});
      const result = await compareDomestic(productName);
      return json(res, 200, { ok:true, ...result });
    }

    if (action === "logistics") {
      const result = await estimateLogistics(body);
      return json(res, 200, { ok:true, logistics: result });
    }

    if (action === "audit") {
      const result = await auditSourcing(body);
      return json(res, 200, { ok:true, audit: result });
    }

    if (action === "marketing") {
      const result = await createMarketing(body);
      return json(res, 200, { ok:true, marketing: result });
    }

    if (action === "images") {
      const result = await researchImages(body);
      return json(res, 200, { ok:true, materials: result });
    }

    if (action === "design") {
      const result = await designDetail(body);
      return json(res, 200, { ok:true, detail: result });
    }

    return json(res, 400, { ok:false, error:"지원하지 않는 action입니다." });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok:false, error:e?.message || "서버 오류" });
  }
}
