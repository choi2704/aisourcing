
const $ = id => document.getElementById(id);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const num = id => Number($(id).value || 0);
const won = n => Math.round(n||0).toLocaleString('ko-KR') + '원';

const workers = [
  {id:'discover', name:'상품발굴 직원', run:(r)=>`용도와 구매 포인트를 정리했습니다. ${r.product ? `"${r.product}" 상품성을 1차 확인했습니다.`:'상품명을 확인했습니다.'}`},
  {id:'market', name:'국내시장 직원', run:(r)=>r.comp==='high'?'경쟁이 높은 상품입니다. 가격 외 차별화가 필요합니다.':r.comp==='low'?'경쟁강도가 낮은 편입니다. 테스트 가치가 있습니다.':'경쟁강도는 보통입니다. 구성·배송 차별화가 필요합니다.'},
  {id:'cost', name:'원가계산 직원', run:(r)=>`예상 입고원가를 개당 ${won(r.landed)}으로 계산했습니다.`},
  {id:'risk', name:'인증검수 직원', run:(r)=>r.risk==='high'?'인증·규제 위험이 높아 발주 보류가 필요합니다.':r.risk==='low'?'현재 입력 기준 위험은 낮습니다. 실제 수입 전 품목별 확인은 필요합니다.':'인증·통관 조건 추가 확인이 필요합니다.'},
  {id:'profit', name:'수익성 직원', run:(r)=>`예상 순이익 ${won(r.profit)}, 마진율 ${r.margin.toFixed(1)}%입니다.`},
  {id:'reviews', name:'리뷰분석 직원', run:(r)=>r.comp==='high'?'경쟁상품 후기에서 배송·포장·설명 부족 같은 불만을 차별점으로 잡는 전략을 추천합니다.':'리뷰 차별화 포인트는 포장, 한글 안내, 빠른배송을 우선 검토하세요.'},
  {id:'chief', name:'총괄팀장', run:(r)=>`${r.decision}으로 최종 판정했습니다.`}
];

function calc(){
  const qty=Math.max(1,num('qty')), buy=num('buyPrice');
  const intl=num('intlShipping')/qty, customs=num('customsEtc')/qty;
  const landed=buy+intl+customs, sale=num('salePrice');
  const fee=sale*num('platformFee')/100;
  const ship=num('domesticShipping')+num('packing');
  const ads=sale*num('adRate')/100;
  const returns=sale*num('returnRate')/100;
  const profit=sale-landed-fee-ship-ads-returns;
  const margin=sale?profit/sale*100:0;
  const comp=$('competition').value, risk=$('certRisk').value;
  let score=50;
  if(margin>=40)score+=25; else if(margin>=30)score+=18; else if(margin>=20)score+=8; else if(margin>=10)score-=8; else score-=20;
  score+=comp==='low'?12:comp==='mid'?0:-14;
  score+=risk==='low'?10:risk==='mid'?-4:-28;
  if(sale>0&&landed>0&&sale>=landed*2.2)score+=5;
  if(qty<=20)score+=3;
  score=Math.max(0,Math.min(100,Math.round(score)));

  let decision, action;
  if(risk==='high'){decision='🔴 사입 보류';action='인증·규제 여부를 먼저 확인하세요. 확인 전 발주는 권장하지 않습니다.';}
  else if(score>=75){decision='🟢 샘플 구매 추천';action='샘플 1~3개를 먼저 주문해 품질·포장·실제 크기를 확인하세요.';}
  else if(score>=55){decision='🟡 소량 테스트';action='대량 발주보다 5~20개 정도의 소량 테스트가 적합합니다.';}
  else {decision='🔴 사입 비추천';action='마진·경쟁도·위험요소 중 최소 한 가지를 개선할 때만 다시 검토하세요.';}

  const market = comp==='low'
    ? '경쟁강도가 낮은 편입니다. 빠른 국내배송과 포장 차별화를 더하면 테스트 가치가 있습니다.'
    : comp==='mid'
    ? '경쟁강도는 보통입니다. 단순 최저가보다 구성·상세페이지·배송 차별화가 중요합니다.'
    : '경쟁이 높은 상품입니다. 강한 판매자와 리뷰 집중 여부를 추가 확인해야 합니다.';

  const riskText = risk==='low'
    ? '현재 입력 기준 규제 위험은 낮습니다. 다만 실제 수입 전 품목별 KC·전파·상표권·통관 조건을 다시 확인하세요.'
    : risk==='mid'
    ? '인증 또는 수입 규정 확인이 필요합니다. KC·전파·어린이제품·생활화학 해당 여부를 먼저 확인하세요.'
    : '규제 위험이 높습니다. 확인 전 발주를 중단하는 것이 안전합니다.';

  return {product:$('productName').value.trim(), landed,sale,profit,margin,score,decision,action,market,riskText,comp,risk};
}

function setWorker(id,state,note='',progress=0){
  const card=document.querySelector(`[data-worker="${id}"]`);
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
  $('activityLog').innerHTML='<div class="log"><span>시스템</span><b>소싱팀이 대기중입니다.</b></div>';
  $('teamStatus').textContent='대기중';
  $('report').classList.add('hidden');
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
  const r=calc();
  $('startBtn').disabled=true;
  $('startBtn').textContent='분석중...';
  $('teamStatus').textContent='작업중';
  $('activityLog').innerHTML='';
  workers.forEach(w=>setWorker(w.id,'wait','업무 대기중',0));
  $('report').classList.add('hidden');

  for(const w of workers){
    setWorker(w.id,'work','검토를 시작했습니다.',25);
    log(w.name,'업무를 시작했습니다.');
    await wait(450);
    setWorker(w.id,'work','자료를 정리중입니다.',65);
    await wait(450);
    const note=w.run(r);
    setWorker(w.id,'done',note,100);
    log(w.name,note);
    await wait(250);
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

$('startBtn').addEventListener('click',runTeam);
$('resetBtn').addEventListener('click',resetTeam);
$('toggleInputs').addEventListener('click',()=>{
  $('inputPanel').classList.toggle('hidden');
  $('toggleInputs').textContent=$('inputPanel').classList.contains('hidden')?'가격 입력 열기':'가격 입력 닫기';
});
$('sampleBtn').addEventListener('click',()=>{
  $('productName').value='전동공구 벽걸이 정리랙';
  $('productUrl').value='https://example.com/product';
  $('buyPrice').value=8700; $('qty').value=20; $('intlShipping').value=90000; $('customsEtc').value=42000;
  $('salePrice').value=39900; $('platformFee').value=8; $('domesticShipping').value=3500; $('packing').value=500;
  $('adRate').value=4; $('returnRate').value=2; $('competition').value='mid'; $('certRisk').value='low';
  $('inputPanel').classList.remove('hidden');
  $('toggleInputs').textContent='가격 입력 닫기';
});
$('newBtn').addEventListener('click',()=>{
  resetTeam(); $('productName').value=''; $('productUrl').value=''; window.scrollTo({top:0,behavior:'smooth'});
});

function getSaved(){return JSON.parse(localStorage.getItem('aiSourcingV3')||'[]')}
function setSaved(v){localStorage.setItem('aiSourcingV3',JSON.stringify(v));renderSaved()}
$('saveBtn').addEventListener('click',()=>{
  const r=calc();
  if(!r.product){alert('상품명을 입력해주세요.');return;}
  const arr=getSaved();
  arr.unshift({
    id:Date.now(), name:r.product, url:$('productUrl').value, sale:r.sale, profit:r.profit,
    margin:r.margin, score:r.score, decision:r.decision, date:new Date().toLocaleString('ko-KR')
  });
  setSaved(arr.slice(0,100));
});

function renderSaved(){
  const q=$('searchInput').value.trim().toLowerCase();
  const items=getSaved().filter(x=>x.name.toLowerCase().includes(q));
  if(!items.length){$('savedList').innerHTML='<div class="empty">저장된 상품이 없습니다.</div>';return;}
  $('savedList').innerHTML=items.map(x=>`
    <div class="saved-item">
      <div><div class="nm">${escapeHtml(x.name)}</div><small>${x.date}</small></div>
      <div><small>판매가</small><b>${won(x.sale)}</b></div>
      <div><small>순이익</small><b>${won(x.profit)}</b></div>
      <div><small>마진율</small><b>${Number(x.margin).toFixed(1)}%</b></div>
      <div class="tag">${x.decision}</div>
      <button class="ghost small" onclick="delOne(${x.id})">삭제</button>
    </div>`).join('');
}
window.delOne=id=>setSaved(getSaved().filter(x=>x.id!==id));
$('searchInput').addEventListener('input',renderSaved);
$('clearBtn').addEventListener('click',()=>{if(confirm('저장된 상품을 모두 삭제할까요?'))setSaved([])});
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

$('helpBtn').addEventListener('click',()=>$('helpModal').classList.remove('hidden'));
$('closeHelp').addEventListener('click',()=>$('helpModal').classList.add('hidden'));
$('helpModal').addEventListener('click',e=>{if(e.target.id==='helpModal')$('helpModal').classList.add('hidden')});

resetTeam(); renderSaved();
