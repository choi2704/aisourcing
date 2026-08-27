
const $ = id => document.getElementById(id);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const num = id => Number($(id)?.value || 0);
const won = n => Math.round(n||0).toLocaleString('ko-KR') + '원';

const currencyToKRWApprox = {
  'USD':1350, '$':1350,
  'CNY':188, '¥':188, 'CN¥':188,
  'KRW':1, '₩':1
};

function normalizeUrl(u){
  let url=(u||'').trim();
  if(!url) return '';
  if(!/^https?:\/\//i.test(url)) url='https://'+url;
  return url;
}

function sourceNameFromUrl(url){
  try{
    const h=new URL(url).hostname.toLowerCase();
    if(h.includes('alibaba')) return 'Alibaba';
    if(h.includes('aliexpress')) return 'AliExpress';
    if(h.includes('temu')) return 'Temu';
    return h.replace(/^www\./,'');
  }catch(e){ return '외부 상품'; }
}

function jinaReaderUrl(url){
  // Jina Reader can convert many public pages into readable text without exposing API keys.
  return 'https://r.jina.ai/http://' + url.replace(/^https?:\/\//i,'');
}

function cleanTitle(s){
  return (s||'')
    .replace(/\s+/g,' ')
    .replace(/\|\s*(Alibaba|AliExpress|Temu).*$/i,'')
    .replace(/-\s*(Alibaba|AliExpress|Temu).*$/i,'')
    .trim()
    .slice(0,180);
}

function parseTitle(text){
  const lines=(text||'').split('\n').map(x=>x.trim()).filter(Boolean);
  for(const line of lines.slice(0,40)){
    let m=line.match(/^Title:\s*(.+)$/i);
    if(m) return cleanTitle(m[1]);
  }
  for(const line of lines.slice(0,60)){
    if(/^#\s+/.test(line)) return cleanTitle(line.replace(/^#\s+/,''));
  }
  for(const line of lines.slice(0,60)){
    if(line.length>=8 && line.length<=180 && !/^[-*#\[\]()]/.test(line)) return cleanTitle(line);
  }
  return '';
}

function parseImage(text){
  const md=[...(text||'').matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)];
  const banned=['logo','icon','avatar','sprite','flag','favicon'];
  for(const m of md){
    const u=m[1];
    if(!banned.some(x=>u.toLowerCase().includes(x))) return u;
  }
  const raw=(text||'').match(/https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i);
  return raw ? raw[0] : '';
}

function priceCandidates(text){
  const out=[];
  const patterns=[
    /(?:US\s*)?\$\s*([0-9]+(?:[.,][0-9]+)?)/gi,
    /(?:CN\s*)?¥\s*([0-9]+(?:[.,][0-9]+)?)/gi,
    /CNY\s*([0-9]+(?:[.,][0-9]+)?)/gi,
    /KRW\s*([0-9][0-9,]*)/gi,
    /₩\s*([0-9][0-9,]*)/gi,
    /([0-9][0-9,]*)\s*원/g
  ];
  for(const p of patterns){
    let m;
    while((m=p.exec(text||'')) && out.length<50){
      const raw=m[0], value=Number(m[1].replace(/,/g,'.').replace(/\.(?=.*\.)/g,''));
      if(!isFinite(value)||value<=0) continue;
      let cur='KRW';
      if(raw.includes('$')) cur='USD';
      else if(raw.includes('¥')||/CNY/i.test(raw)) cur='CNY';
      out.push({raw, value, cur});
    }
  }
  return out;
}

function choosePrice(text){
  const c=priceCandidates(text);
  if(!c.length) return null;
  // Ignore obviously tiny UI values and huge totals. Favor first plausible product price.
  const plausible=c.filter(x=>{
    const krw=x.value*(currencyToKRWApprox[x.cur]||1);
    return krw>=300 && krw<=3000000;
  });
  return plausible[0] || c[0];
}

function priceToKRW(p){
  if(!p) return 0;
  return Math.round(p.value*(currencyToKRWApprox[p.cur]||1));
}

async function readProductUrl(){
  const input=$('productUrl');
  const raw=normalizeUrl(input?.value);
  if(!raw){alert('상품 링크를 먼저 입력해주세요.');return;}
  input.value=raw;
  $('urlPreview').classList.remove('hidden');
  $('readStatusBadge').className='work';
  $('readStatusBadge').textContent='읽는중';
  $('readStatusText').textContent='상품 페이지를 읽고 있습니다. 사이트에 따라 몇 초 걸릴 수 있습니다.';
  $('analyzeUrlBtn').disabled=true;
  $('analyzeUrlBtn').textContent='읽는중...';

  try{
    const res=await fetch(jinaReaderUrl(raw), {headers:{'Accept':'text/plain'}});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const text=await res.text();
    if(!text || text.length<40) throw new Error('상품 페이지 내용을 읽지 못했습니다.');

    const title=parseTitle(text);
    const image=parseImage(text);
    const price=choosePrice(text);
    const krw=priceToKRW(price);
    const source=sourceNameFromUrl(raw);

    if(title){
      $('productName').value=title;
      applyAutoCategory(true);
    }
    if(krw>0 && $('buyPrice')){
      $('buyPrice').value=krw;
    }

    $('previewTitle').textContent=title || '상품명 자동감지 실패';
    $('previewSource').textContent=source + ' · 링크에서 자동 읽음';
    $('previewPrice').textContent=price ? `${price.raw}  ≈  ${won(krw)}` : '가격 자동감지 실패';

    const img=$('productImage'), no=$('noImage');
    if(image){
      img.src=image;
      img.style.display='block';
      no.style.display='none';
      img.onerror=()=>{img.style.display='none';no.style.display='flex';};
    }else{
      img.removeAttribute('src'); img.style.display='none'; no.style.display='flex';
    }

    $('readStatusBadge').className='ok';
    $('readStatusBadge').textContent='자동읽기 완료';

    const missing=[];
    if(!title) missing.push('상품명');
    if(!price) missing.push('가격');
    if(!image) missing.push('이미지');
    $('readStatusText').textContent = missing.length
      ? `일부 정보(${missing.join(', ')})는 사이트 차단 또는 페이지 구조 때문에 못 읽었습니다. 필요한 값만 직접 입력하면 분석할 수 있습니다.`
      : '상품명·가격·이미지를 읽었습니다. 가격은 환율 근사값이므로 실제 발주 전 확인하세요.';

    if($('inputPanel')) $('inputPanel').classList.remove('hidden');
    if($('toggleInputs')) $('toggleInputs').textContent='가격 입력 닫기';

  }catch(err){
    console.error(err);
    $('readStatusBadge').className='fail';
    $('readStatusBadge').textContent='자동읽기 실패';
    $('readStatusText').textContent='이 사이트가 외부 읽기를 막고 있습니다. 상품명과 가격만 직접 넣으면 나머지 AI 분석은 그대로 사용할 수 있습니다.';
    $('previewTitle').textContent=$('productName').value || '직접 입력 필요';
    $('previewSource').textContent=sourceNameFromUrl(raw);
    $('previewPrice').textContent='직접 입력 필요';
  }finally{
    $('analyzeUrlBtn').disabled=false;
    $('analyzeUrlBtn').textContent='🔗 링크 자동읽기';
  }
}


const categoryRules = [
  {
    name:'식품·식품기기',
    keywords:['식품','푸드','food','프린터','먹는','식용','주방기기','조리기기'],
    risk:'high', comp:'mid',
    point:'식품접촉·전기·위생·표시사항 확인',
    advice:'식품과 직접 접촉하거나 식품에 사용하는 기기는 인증·위생·표시 규정을 우선 확인하세요.',
    marginAdj:-6
  },
  {
    name:'어린이·완구',
    keywords:['말랑이','슬라임','장난감','완구','키즈','어린이','아동','toy','피규어'],
    risk:'high', comp:'high',
    point:'어린이제품 KC·재질·유해물질 확인',
    advice:'어린이제품 가능성이 높아 KC 및 유해물질 기준을 먼저 확인하는 것이 안전합니다.',
    marginAdj:-8
  },
  {
    name:'전기·전자',
    keywords:['충전','전동','전기','전자','usb','led','배터리','블루투스','wifi','스피커','카메라'],
    risk:'mid', comp:'high',
    point:'KC·전파·배터리·어댑터 확인',
    advice:'전기·전자제품은 KC, 전파, 배터리 및 어댑터 규격 확인이 필요합니다.',
    marginAdj:-4
  },
  {
    name:'차량용품',
    keywords:['차량','자동차','카','car','차박','트렁크','시트','거치대'],
    risk:'mid', comp:'high',
    point:'차종 호환·안전성·반품률 확인',
    advice:'차량용품은 호환성 이슈와 반품률이 높을 수 있어 차종·사이즈 표기가 중요합니다.',
    marginAdj:-3
  },
  {
    name:'반려동물용품',
    keywords:['강아지','고양이','반려','펫','pet','하네스','리드줄','급수기'],
    risk:'low', comp:'mid',
    point:'사이즈·재질·세탁성·후기 불만 확인',
    advice:'반려동물용품은 사이즈 미스와 재질 불만이 잦아 상세 치수와 소재 안내가 중요합니다.',
    marginAdj:1
  },
  {
    name:'공구·작업용품',
    keywords:['공구','툴','tool','드릴','렌치','정리랙','작업대','작업용','공장','선반'],
    risk:'low', comp:'mid',
    point:'내구성·하중·부피·배송비 확인',
    advice:'공구·작업용품은 인증 부담이 비교적 낮고, 부피·하중·배송비가 핵심입니다.',
    marginAdj:4
  },
  {
    name:'수납·생활용품',
    keywords:['수납','정리','선반','서랍','바구니','행거','생활','주방','욕실','정원'],
    risk:'low', comp:'high',
    point:'부피·파손·묶음판매·차별화 확인',
    advice:'생활용품은 경쟁이 강한 편이라 구성·묶음·빠른배송 차별화가 중요합니다.',
    marginAdj:0
  },
  {
    name:'캠핑·야외용품',
    keywords:['캠핑','텐트','야외','아웃도어','폴딩','의자','테이블'],
    risk:'low', comp:'mid',
    point:'부피·계절성·파손·배송비 확인',
    advice:'캠핑용품은 계절성과 부피 배송비를 함께 봐야 합니다.',
    marginAdj:2
  }
];

function detectCategory(name){
  const t=(name||'').toLowerCase().replace(/\s+/g,'');
  let best=null, bestScore=0;
  for(const r of categoryRules){
    let score=0;
    for(const k of r.keywords){
      const key=k.toLowerCase().replace(/\s+/g,'');
      if(t.includes(key)){
        // 길고 구체적인 키워드일수록 더 높은 점수
        score += key.length >= 4 ? 3 : key.length >= 2 ? 2 : 1;
      }
    }
    if(score>bestScore){ best=r; bestScore=score; }
  }
  if(best) return best;
  return {
    name:'기타 일반상품', risk:'mid', comp:'mid',
    point:'인증·경쟁도·배송비 직접 확인',
    advice:'카테고리 자동판별이 어려운 상품입니다. 기본 위험도로 분석합니다.',
    marginAdj:0
  };
}

function riskLabel(v){return v==='low'?'낮음':v==='mid'?'확인 필요':'높음'}
function compLabel(v){return v==='low'?'낮음':v==='mid'?'보통':'높음'}

function applyAutoCategory(force=false){
  const name=$('productName')?.value.trim()||'';
  if(!name){
    if($('autoBadge')) $('autoBadge').textContent='대기중';
    return detectCategory('');
  }
  const r=detectCategory(name);
  if($('autoCategory')) $('autoCategory').textContent=r.name;
  if($('autoRisk')) $('autoRisk').textContent=riskLabel(r.risk);
  if($('autoCompetition')) $('autoCompetition').textContent=compLabel(r.comp);
  if($('autoPoint')) $('autoPoint').textContent=r.point;
  if($('autoBadge')){ $('autoBadge').textContent='자동판별 완료'; $('autoBadge').classList.add('active'); }
  if($('autoCategoryHidden')) $('autoCategoryHidden').value=r.name;

  // 자동판별 시 기본값만 제안. 사용자가 수동 변경한 뒤에는 분석 시작 시 덮어쓰지 않음.
  if(force){
    if($('competition')) $('competition').value=r.comp;
    if($('certRisk')) $('certRisk').value=r.risk;
  }
  return r;
}


function parseSearchPrices(text, shopLabel){
  const lines=(text||'').split('\n').map(x=>x.trim()).filter(Boolean);
  const results=[];
  const priceRegex=/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})\s*원/g;
  for(let i=0;i<lines.length;i++){
    let m;
    while((m=priceRegex.exec(lines[i]))){
      const price=Number(m[1].replace(/,/g,''));
      if(price<500 || price>10000000) continue;
      const title=(lines[i-1]||lines[i]).replace(/[#*_\[\]()]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
      results.push({shop:shopLabel,title:title||'검색 결과',price});
      if(results.length>=8) break;
    }
    if(results.length>=8) break;
  }
  return results;
}

async function fetchSearchResults(query){
  const q=encodeURIComponent(query);
  const urls=[
    {shop:'네이버 검색',url:`https://r.jina.ai/http://www.google.com/search?q=${q}+네이버쇼핑`},
    {shop:'쿠팡 검색',url:`https://r.jina.ai/http://www.google.com/search?q=${q}+쿠팡`}
  ];
  let all=[];
  for(const s of urls){
    try{
      const res=await fetch(s.url,{headers:{'Accept':'text/plain'}});
      if(!res.ok) continue;
      const text=await res.text();
      all=all.concat(parseSearchPrices(text,s.shop));
    }catch(e){console.warn('search failed',s.shop,e)}
  }
  // dedupe rough duplicates
  const seen=new Set();
  return all.filter(x=>{
    const k=x.shop+'|'+x.title+'|'+x.price;
    if(seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0,10);
}

async function runComparison(r){
  const query=(r.product||'').trim();
  if(!query) return {results:[],min:0,avg:0};
  $('comparePanel').classList.remove('hidden');
  $('compareKeyword').textContent=query;
  $('compareList').innerHTML='<div class="empty">국내 가격을 검색중입니다...</div>';
  const results=await fetchSearchResults(query);
  let min=0,avg=0;
  if(results.length){
    const ps=results.map(x=>x.price);
    min=Math.min(...ps);
    avg=Math.round(ps.reduce((a,b)=>a+b,0)/ps.length);
    $('compareList').innerHTML=results.map(x=>`
      <div class="compare-item">
        <div class="shop">${escapeHtml(x.shop)}</div>
        <div class="title">${escapeHtml(x.title)}</div>
        <div class="price">${won(x.price)}</div>
      </div>`).join('');
  }else{
    $('compareList').innerHTML='<div class="empty">자동 검색에서 가격을 충분히 읽지 못했습니다. 실제 네이버/쿠팡 검색으로 한 번 더 확인해주세요.</div>';
  }
  $('compareMin').textContent=min?won(min):'-';
  $('compareAvg').textContent=avg?won(avg):'-';
  let pos='비교자료 부족';
  if(avg && r.sale){
    if(r.sale <= avg*0.9) pos='경쟁력 있음';
    else if(r.sale <= avg*1.1) pos='시장가 수준';
    else pos='다소 높음';
  }
  $('comparePosition').textContent=pos;
  return {results,min,avg,pos};
}

function categoryDetailData(cat){
  const map={
    '식품·식품기기':{
      benefits:['간편한 사용','전문적인 결과','반복 작업 절감'],
      targets:['카페·베이커리·소형 매장','식품 데코레이션 작업이 많은 분','차별화 상품을 만들고 싶은 사업자'],
      cautions:['식품 접촉 부위와 소재 확인','전기·위생 관련 인증 여부 확인','소모품과 잉크 성분 확인']
    },
    '어린이·완구':{
      benefits:['눈에 띄는 재미','선물용 구성','콘텐츠 친화적'],
      targets:['어린이 선물용 제품을 찾는 분','SNS·숏폼용 재미있는 제품을 찾는 분','소형 잡화몰 운영자'],
      cautions:['어린이제품 KC 확인','재질·유해물질 기준 확인','연령표시 및 주의사항 확인']
    },
    '공구·작업용품':{
      benefits:['작업공간 정리','보관 효율 향상','튼튼한 실사용형'],
      targets:['공구가 많은 작업자','공장·차고·창고 운영자','DIY 작업공간을 정리하려는 분'],
      cautions:['하중·재질 확인','설치 방식 확인','부피 배송비 확인']
    },
    '반려동물용품':{
      benefits:['편안한 사용','관리 편의성','귀여운 디자인'],
      targets:['반려동물과 생활하는 가정','선물용 펫용품을 찾는 분','반려동물 온라인몰 운영자'],
      cautions:['실측 사이즈 확인','재질·세탁방법 확인','개체별 착용감 차이 안내']
    },
    '차량용품':{
      benefits:['차량 공간 활용','편리한 사용','간단한 설치'],
      targets:['차량 정리·편의성을 높이고 싶은 분','운전을 자주 하는 분','차량용품 온라인몰 운영자'],
      cautions:['차종 호환 확인','설치 위치 확인','안전운전에 방해되지 않는지 확인']
    },
    '캠핑·야외용품':{
      benefits:['휴대와 보관 편의','야외 활용성','공간 효율'],
      targets:['캠핑을 자주 즐기는 분','차박·피크닉 사용자','야외 수납을 간편하게 하고 싶은 분'],
      cautions:['접었을 때 크기 확인','하중·내구성 확인','계절 수요와 배송부피 확인']
    },
    '수납·생활용품':{
      benefits:['깔끔한 정리','공간 절약','누구나 쉬운 사용'],
      targets:['집안 정리가 필요한 분','작은 공간을 효율적으로 쓰고 싶은 분','생활용품 판매자'],
      cautions:['실측 사이즈 확인','설치방법 확인','유사상품과 차별화 포인트 확인']
    }
  };
  return map[cat]||{
    benefits:['사용 편의성','실용적인 구성','쉬운 이해'],
    targets:['실용적인 상품을 찾는 고객','온라인 구매를 선호하는 고객','새로운 상품을 찾는 판매자'],
    cautions:['사이즈·재질 확인','인증·표시사항 확인','배송 및 반품조건 확인']
  };
}

function makeDetailPage(r, compare){
  const d=categoryDetailData(r.category.name);
  $('designPanel').classList.remove('hidden');
  $('detailTitle').textContent=r.product;
  $('detailSubtitle').textContent=`${r.category.name} · 고객이 이해하기 쉽게 정리한 판매용 상세페이지 초안`;
  $('detailBenefits').innerHTML=d.benefits.map((x,i)=>`<div class="benefit-card"><b>${['①','②','③'][i]} ${escapeHtml(x)}</b><span>${escapeHtml(r.category.point)}</span></div>`).join('');
  $('detailTargets').innerHTML='<div class="detail-bullets">'+d.targets.map(x=>`<div class="detail-bullet">✓ ${escapeHtml(x)}</div>`).join('')+'</div>';
  $('detailCautions').innerHTML='<div class="detail-bullets">'+d.cautions.map(x=>`<div class="detail-bullet">⚠ ${escapeHtml(x)}</div>`).join('')+'</div>';
  const marketText=compare?.avg ? won(compare.avg) : '자동비교 결과 확인';
  $('detailFacts').innerHTML=`<div class="detail-facts">
    <div class="detail-fact"><span>예상 판매가</span><b>${won(r.sale)}</b></div>
    <div class="detail-fact"><span>예상 순이익</span><b>${won(r.profit)}</b></div>
    <div class="detail-fact"><span>예상 마진율</span><b>${r.margin.toFixed(1)}%</b></div>
    <div class="detail-fact"><span>국내 시장가</span><b>${marketText}</b></div>
    <div class="detail-fact"><span>인증 위험</span><b>${riskLabel(r.risk)}</b></div>
    <div class="detail-fact"><span>최종판정</span><b>${r.decision}</b></div>
  </div>`;
  $('detailCTA').textContent=`${r.product} — 구매 전 옵션과 사이즈를 확인해주세요`;
}

function detailPlainText(){
  return document.getElementById('detailPreview').innerText;
}

function downloadDetailHtml(){
  const title=$('productName').value.trim()||'상품 상세페이지';
  const body=document.getElementById('detailPreview').outerHTML;
  const styles=`body{font-family:Arial,'Malgun Gothic',sans-serif;background:#fff;color:#222;margin:0;padding:30px}.detail-preview{max-width:900px;margin:auto;border:1px solid #ddd;border-radius:18px;overflow:hidden}.detail-hero{padding:50px 30px;text-align:center;background:linear-gradient(135deg,#eef5ff,#fff7e6)}.detail-badge{background:#1f6feb;color:#fff;border-radius:999px;padding:7px 12px;font-weight:bold}.detail-benefits{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:24px}.benefit-card{border:1px solid #ddd;border-radius:14px;padding:18px;text-align:center}.benefit-card b,.benefit-card span{display:block}.detail-section{padding:26px 30px;border-top:1px solid #eee}.detail-bullet{padding:12px;margin:8px 0;background:#f7f9fc;border-radius:10px}.detail-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.detail-fact{display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #eee}.detail-cta{padding:28px;text-align:center;background:#17315c;color:#fff;font-size:22px}`;
  const full=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${styles}</style><body>${body}</body></html>`;
  const blob=new Blob([full],{type:'text/html;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=title.replace(/[\\/:*?"<>|]/g,'_')+'_상세페이지.html';
  a.click();
  URL.revokeObjectURL(a.href);
}

const workers = [
  {id:'discover', name:'상품발굴 직원', run:(r)=>`${r.category.name} 카테고리로 판단했습니다. ${r.category.point}`},
  {id:'market', name:'국내시장 직원', run:(r)=>r.comp==='high'?'경쟁이 높은 상품입니다. 가격 외 차별화가 필요합니다.':r.comp==='low'?'경쟁강도가 낮은 편입니다. 테스트 가치가 있습니다.':'경쟁강도는 보통입니다. 구성·배송 차별화가 필요합니다.'},
  {id:'cost', name:'원가계산 직원', run:(r)=>`예상 입고원가를 개당 ${won(r.landed)}으로 계산했습니다.`},
  {id:'risk', name:'인증검수 직원', run:(r)=>`${r.category.advice} 현재 위험등급은 ${riskLabel(r.risk)}입니다.`},
  {id:'profit', name:'수익성 직원', run:(r)=>`예상 순이익 ${won(r.profit)}, 마진율 ${r.margin.toFixed(1)}%입니다.`},
  {id:'reviews', name:'리뷰분석 직원', run:(r)=>`${r.category.point}. 후기 분석 시 이 항목을 우선 확인하세요.`},
  {id:'compare', name:'자동비교 직원', async:true},
  {id:'design', name:'디자인 직원', async:true},
  {id:'chief', name:'총괄팀장', run:(r)=>`${r.decision}으로 최종 판정했습니다.`}
];

function calc(){
  const category=detectCategory($('productName')?.value||'');
  const qty=Math.max(1,num('qty')), buy=num('buyPrice');
  const intl=num('intlShipping')/qty, customs=num('customsEtc')/qty;
  const landed=buy+intl+customs, sale=num('salePrice');
  const fee=sale*num('platformFee')/100;
  const ship=num('domesticShipping')+num('packing');
  const ads=sale*num('adRate')/100;
  const returns=sale*num('returnRate')/100;
  const profit=sale-landed-fee-ship-ads-returns;
  const rawMargin=sale?profit/sale*100:0;
  const margin=rawMargin + category.marginAdj;

  const comp=$('competition')?.value || category.comp;
  const risk=$('certRisk')?.value || category.risk;

  let score=50;
  if(margin>=40)score+=25; else if(margin>=30)score+=18; else if(margin>=20)score+=8; else if(margin>=10)score-=8; else score-=20;
  score+=comp==='low'?12:comp==='mid'?0:-14;
  score+=risk==='low'?10:risk==='mid'?-4:-28;

  // 카테고리별 추가 감점/가점
  if(category.name==='어린이·완구') score-=10;
  if(category.name==='식품·식품기기') score-=12;
  if(category.name==='공구·작업용품') score+=5;
  if(category.name==='캠핑·야외용품') score+=2;

  if(sale>0&&landed>0&&sale>=landed*2.2)score+=5;
  if(qty<=20)score+=3;
  score=Math.max(0,Math.min(100,Math.round(score)));

  let decision, action;
  if(risk==='high' || ['어린이·완구','식품·식품기기'].includes(category.name)){
    if(score>=72 && risk!=='high'){
      decision='🟡 인증 확인 후 샘플';
      action='수익성은 가능성이 있지만 인증·규제 확인이 선행되어야 합니다.';
    } else {
      decision='🔴 사입 보류';
      action='인증·규제 여부를 먼저 확인하세요. 확인 전 발주는 권장하지 않습니다.';
    }
  } else if(score>=75){
    decision='🟢 샘플 구매 추천';
    action='샘플 1~3개를 먼저 주문해 품질·포장·실제 크기를 확인하세요.';
  } else if(score>=55){
    decision='🟡 소량 테스트';
    action='대량 발주보다 5~20개 정도의 소량 테스트가 적합합니다.';
  } else {
    decision='🔴 사입 비추천';
    action='마진·경쟁도·위험요소 중 최소 한 가지를 개선할 때만 다시 검토하세요.';
  }

  const market = `${category.name} 기준으로 경쟁강도는 ${compLabel(comp)}입니다. ${category.advice}`;
  const riskText = `자동판별 카테고리: ${category.name}. 인증 위험은 ${riskLabel(risk)}입니다. ${category.point}`;

  return {
    product:$('productName')?.value.trim()||'',
    category, landed,sale,profit,margin,rawMargin,score,decision,action,market,riskText,comp,risk
  };
}

function setWorker(id,state,note='',progress=0){
  const card=document.querySelector(`[data-worker="${id}"]`);
  if(!card) return;
  const status=card.querySelector('.status');
  const bar=card.querySelector('.progress i');
  const text=card.querySelector('.worker-note');
  card.classList.remove('working','done');
  status.className='status '+state;
  if(state==='work'){card.classList.add('working');status.textContent='작업중';}
  else if(state==='done'){card.classList.add('done');status.textContent='완료';}
  else status.textContent='대기중';
  bar.style.width=progress+'%';
  if(note) text.textContent=note;
}

function resetTeam(){
  workers.forEach(w=>setWorker(w.id,'wait','대기중',0));
  if($('activityLog')) $('activityLog').innerHTML='<div class="log"><span>시스템</span><b>소싱팀이 대기중입니다.</b></div>';
  if($('teamStatus')) $('teamStatus').textContent='대기중';
  if($('report')) $('report').classList.add('hidden');
}

function log(name,msg){
  const row=document.createElement('div');
  row.className='log';
  row.innerHTML=`<span>${name}</span><b>${msg}</b>`;
  $('activityLog').appendChild(row);
  $('activityLog').scrollTop=$('activityLog').scrollHeight;
}

async function runTeam(){
  if(!$('productName').value.trim()){ alert('상품명을 입력해주세요.'); return; }

  // 분석 시작 시 카테고리별 기본 위험도/경쟁도 자동 적용
  applyAutoCategory(true);
  const r=calc();

  $('startBtn').disabled=true;
  $('startBtn').textContent='분석중...';
  $('teamStatus').textContent='작업중';
  $('activityLog').innerHTML='';
  workers.forEach(w=>setWorker(w.id,'wait','업무 대기중',0));
  $('report').classList.add('hidden');

  log('시스템',`${r.category.name} 카테고리로 자동 분류했습니다.`);

  let compareData=null;
  for(const w of workers){
    setWorker(w.id,'work','검토를 시작했습니다.',25);
    log(w.name,'업무를 시작했습니다.');

    if(w.id==='compare'){
      setWorker(w.id,'work','네이버·쿠팡 가격 검색중입니다.',60);
      compareData=await runComparison(r);
      const note=compareData.avg
        ? `국내 감지 평균가는 ${won(compareData.avg)}, 최저가는 ${won(compareData.min)}입니다.`
        : '자동 검색에서 충분한 가격정보를 읽지 못했습니다.';
      setWorker(w.id,'done',note,100); log(w.name,note); await wait(220); continue;
    }

    if(w.id==='design'){
      setWorker(w.id,'work','상세페이지 구성과 카피를 만드는 중입니다.',65);
      await wait(350);
      makeDetailPage(r,compareData);
      const note='상품 분석 결과를 바탕으로 상세페이지 초안을 만들었습니다.';
      setWorker(w.id,'done',note,100); log(w.name,note); await wait(220); continue;
    }

    await wait(420);
    setWorker(w.id,'work','자료를 정리중입니다.',65);
    await wait(420);
    const note=w.run(r);
    setWorker(w.id,'done',note,100);
    log(w.name,note);
    await wait(220);
  }
  renderReport(r);
  $('teamStatus').textContent='분석 완료';
  $('startBtn').disabled=false;
  $('startBtn').textContent='🚀 소싱팀 출근!';
}

function renderReport(r){
  $('report').classList.remove('hidden');
  $('reportName').textContent=(r.product||'상품')+' 분석 결과';
  $('decision').textContent=r.decision;
  $('mLanded').textContent=won(r.landed);
  $('mSale').textContent=won(r.sale);
  $('mProfit').textContent=won(r.profit);
  $('mMargin').textContent=r.margin.toFixed(1)+'%';
  $('score').textContent=r.score;
  $('scoreBar').style.width=r.score+'%';
  $('marketText').textContent=r.market;
  $('riskText').textContent=r.riskText;
  $('actionText').textContent=r.action;
  $('report').scrollIntoView({behavior:'smooth',block:'start'});
}

if($('productName')){
  $('productName').addEventListener('input',()=>applyAutoCategory(false));
}
if($('startBtn')) $('startBtn').addEventListener('click',runTeam);
if($('resetBtn')) $('resetBtn').addEventListener('click',resetTeam);
if($('toggleInputs')) $('toggleInputs').addEventListener('click',()=>{
  $('inputPanel').classList.toggle('hidden');
  $('toggleInputs').textContent=$('inputPanel').classList.contains('hidden')?'가격 입력 열기':'가격 입력 닫기';
});
if($('sampleBtn')) $('sampleBtn').addEventListener('click',()=>{
  $('productName').value='전동공구 벽걸이 정리랙';
  $('productUrl').value='https://www.alibaba.com/';
  $('buyPrice').value=8700; $('qty').value=20; $('intlShipping').value=90000; $('customsEtc').value=42000;
  $('salePrice').value=39900; $('platformFee').value=8; $('domesticShipping').value=3500; $('packing').value=500;
  $('adRate').value=4; $('returnRate').value=2;
  applyAutoCategory(true);
  $('inputPanel').classList.remove('hidden');
  $('toggleInputs').textContent='가격 입력 닫기';
});
if($('newBtn')) $('newBtn').addEventListener('click',()=>{
  resetTeam(); $('productName').value=''; $('productUrl').value=''; applyAutoCategory(false); window.scrollTo({top:0,behavior:'smooth'});
});

function getSaved(){return JSON.parse(localStorage.getItem('aiSourcingV5')||'[]')}
function setSaved(v){localStorage.setItem('aiSourcingV5',JSON.stringify(v));renderSaved()}
if($('saveBtn')) $('saveBtn').addEventListener('click',()=>{
  const r=calc();
  if(!r.product){alert('상품명을 입력해주세요.');return;}
  const arr=getSaved();
  arr.unshift({
    id:Date.now(), name:r.product, category:r.category.name, url:$('productUrl').value, sale:r.sale, profit:r.profit,
    margin:r.margin, score:r.score, decision:r.decision, date:new Date().toLocaleString('ko-KR')
  });
  setSaved(arr.slice(0,100));
});

function renderSaved(){
  const q=$('searchInput')?.value.trim().toLowerCase()||'';
  const items=getSaved().filter(x=>x.name.toLowerCase().includes(q));
  if(!$('savedList')) return;
  if(!items.length){$('savedList').innerHTML='<div class="empty">저장된 상품이 없습니다.</div>';return;}
  $('savedList').innerHTML=items.map(x=>`
    <div class="saved-item">
      <div><div class="nm">${escapeHtml(x.name)}</div><small>${escapeHtml(x.category||'기타')} · ${x.date}</small></div>
      <div><small>판매가</small><b>${won(x.sale)}</b></div>
      <div><small>순이익</small><b>${won(x.profit)}</b></div>
      <div><small>마진율</small><b>${Number(x.margin).toFixed(1)}%</b></div>
      <div class="tag">${x.decision}</div>
      <button class="ghost small" onclick="delOne(${x.id})">삭제</button>
    </div>`).join('');
}
window.delOne=id=>setSaved(getSaved().filter(x=>x.id!==id));
if($('searchInput')) $('searchInput').addEventListener('input',renderSaved);
if($('clearBtn')) $('clearBtn').addEventListener('click',()=>{if(confirm('저장된 상품을 모두 삭제할까요?'))setSaved([])});
function escapeHtml(s){return (s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

if($('helpBtn')) $('helpBtn').addEventListener('click',()=>$('helpModal').classList.remove('hidden'));
if($('closeHelp')) $('closeHelp').addEventListener('click',()=>$('helpModal').classList.add('hidden'));
if($('helpModal')) $('helpModal').addEventListener('click',e=>{if(e.target.id==='helpModal')$('helpModal').classList.add('hidden')});

resetTeam();
renderSaved();
applyAutoCategory(false);

if($('analyzeUrlBtn')) $('analyzeUrlBtn').addEventListener('click',readProductUrl);


if($('rerunCompare')) $('rerunCompare').addEventListener('click',async()=>{
  const r=calc();
  const c=await runComparison(r);
  makeDetailPage(r,c);
});
if($('copyDetail')) $('copyDetail').addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText(detailPlainText());
    alert('상세페이지 문구를 복사했습니다.');
  }catch(e){ alert('복사 권한이 없어 자동 복사하지 못했습니다.'); }
});
if($('downloadDetail')) $('downloadDetail').addEventListener('click',downloadDetailHtml);
