
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


function sourceHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function titleFromProductUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    return decodeURIComponent(last)
      .replace(/-g-\d+\.html.*$/i, "")
      .replace(/\.html.*$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch { return ""; }
}

function imageFromQuery(url) {
  try {
    const u = new URL(url);
    const img = u.searchParams.get("top_gallery_url");
    if (img && /^https?:\/\//i.test(img)) return img;
  } catch {}
  return "";
}

function isSuspiciousPrice(price, currency, url) {
  const n = Number(String(price || "").replace(/,/g,""));
  if (!n || !isFinite(n)) return true;
  const host = sourceHost(url);
  const cur = String(currency || "").toUpperCase();

  if ((host.includes("temu.") || host.includes("aliexpress.") || host.includes("alibaba.")) &&
      ((cur === "USD" && n <= 2) || (cur === "CNY" && n <= 5))) {
    return true;
  }
  return false;
}

function extractProduct(html, url) {
  const ld = parseJsonLd(html) || {};
  const host = sourceHost(url);

  let title = ld.title ||
    firstMeta(html, ["og:title", "twitter:title"]) ||
    stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");

  if (!title || /^(Temu|Alibaba|AliExpress)$/i.test(title.trim())) {
    title = titleFromProductUrl(url);
  }

  const image = ld.image ||
    firstMeta(html, ["og:image", "twitter:image"]) ||
    imageFromQuery(url);

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

  const marketplace = host.includes("temu.") || host.includes("aliexpress.") || host.includes("alibaba.");
  if (!price && !marketplace) {
    const body = stripTags(html).slice(0, 300000);
    const p = body.match(/(?:US\s*)?\$\s*([0-9]+(?:\.[0-9]{1,2})?)|(?:CN\s*)?¥\s*([0-9]+(?:\.[0-9]{1,2})?)|₩\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*원/);
    if (p) {
      if (p[1]) { price = p[1]; currency = "USD"; }
      else if (p[2]) { price = p[2]; currency = "CNY"; }
      else { price = (p[3] || p[4]).replace(/,/g,""); currency = "KRW"; }
    }
  }

  if (isSuspiciousPrice(price, currency, url)) {
    price = "";
    currency = "";
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
  const out = normalizeProductResult(parseLooseJson(response.output_text || ""), url);
  if (isSuspiciousPrice(out.price, out.currency, url)) {
    out.price = "";
    out.currency = "";
  }
  if (!out.title || /^(Temu|Alibaba|AliExpress)$/i.test(out.title)) {
    out.title = titleFromProductUrl(url);
  }
  if (!out.image) out.image = imageFromQuery(url);
  return out;
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

  const fallback = direct || {title:"",image:"",price:"",currency:"",sourceUrl:url};
  if (!fallback.title) fallback.title = titleFromProductUrl(url);
  if (!fallback.image) fallback.image = imageFromQuery(url);
  if (isSuspiciousPrice(fallback.price, fallback.currency, url)) {
    fallback.price = "";
    fallback.currency = "";
  }
  return { ...fallback, method:"partial" };
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
