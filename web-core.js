/* Eurojackpot AI WEB – samostatná aplikace, statistický hybrid dle Python předlohy. */
(()=>{'use strict';
const nativeFetch=window.fetch.bind(window), KEY='euro_web_v1',DIRTY='euro_web_dirty_v1',CFG='euro_github_config';
const csv=(s,sep=';')=>s.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(x=>x.split(sep));
const date=x=>{let s=String(x||'').trim(),m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:s.slice(0,10)};
const parseNums=x=>(Array.isArray(x)?x:String(x||'').split(',')).map(Number);
const valid=x=>{let a=parseNums(x);return a.length===7&&new Set(a.slice(0,5)).size===5&&new Set(a.slice(5)).size===2&&a.slice(0,5).every(n=>Number.isInteger(n)&&n>=1&&n<=50)&&a.slice(5).every(n=>Number.isInteger(n)&&n>=1&&n<=12)?[...a.slice(0,5).sort((a,b)=>a-b),...a.slice(5).sort((a,b)=>a-b)]:null};
const def=()=>({history:[],bets:[],predictions:[],version:1});
let data;try{data=JSON.parse(localStorage.getItem(KEY)||'null')||def()}catch{data=def()}
let cfg;try{cfg=JSON.parse(sessionStorage.getItem(CFG)||localStorage.getItem(CFG)||'{}')}catch{cfg={}}
 cfg={owner:cfg.owner||'jerry00769',repo:cfg.repo||'Eurojackpot',token:sessionStorage.getItem('euro_gh_token')||'',path:'euro-data.json'};
 // Remove legacy persistent credentials; tokens live in this tab only.
 localStorage.removeItem(CFG);sessionStorage.removeItem(CFG);
let sha=null,dirty=localStorage.getItem(DIRTY)==='1',saving=false,saveTimer=null,conflict=false;
 let retryTimer=null, polling=false, revision=0, lastPublicDataRefresh=0;
 const RETRY_MS=60000, POLL_MS=60000;
// Local CSV mirror: Edge requires explicit user-selected directory permission.
let localCsvDirectory=null,localCsvQueue=Promise.resolve();
function localCsvStatus(message){const el=document.getElementById('euro-local-csv-status');if(el)el.textContent=message}
async function localCsvWrite(name,content){
 const file=await localCsvDirectory.getFileHandle(name,{create:true});
 const writer=await file.createWritable();
 try{await writer.write(content);await writer.close()}catch(e){try{await writer.abort()}catch{}throw e}
}
function queueLocalCsvWrite(){
 // The local launcher exposes a same-origin, narrowly scoped CSV writer.
 if(location.protocol==='http:' && location.hostname==='127.0.0.1' && location.port==='8765'){
  const bets=fmtBets(),predictions=fmtPredictions();
  localCsvQueue=localCsvQueue.catch(()=>{}).then(async()=>{
   const res=await nativeFetch('/__euro_csv_write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bets,predictions})});
   if(!res.ok)throw Error('Lokální server odmítl zápis ('+res.status+').');
   localCsvStatus('Místní CSV: oba soubory byly uloženy automaticky.');
  }).catch(e=>{localCsvStatus('Místní CSV: zápis selhal – '+e.message);console.error('Local CSV:',e)});
  return;
 }
 if(!localCsvDirectory)return;
 // Snapshot the current state at the time the change was made.
 const bets=fmtBets(),predictions=fmtPredictions();
 localCsvQueue=localCsvQueue.catch(()=>{}).then(async()=>{
  if((await localCsvDirectory.queryPermission({mode:'readwrite'}))!=='granted')throw Error('Přístup ke složce byl odebrán.');
  await localCsvWrite('vsazene_kombinace.csv',bets);
  await localCsvWrite('euro_predikce.csv',predictions);
  localCsvStatus('Místní CSV: oba soubory byly uloženy.');
 }).catch(e=>{localCsvStatus('Místní CSV: zápis selhal – '+e.message);console.error('Local CSV:',e)});
}
async function selectLocalCsvDirectory(){
 if(typeof window.showDirectoryPicker!=='function')throw Error('Tento prohlížeč nepodporuje přímý zápis do složky. Použij aktuální Edge přes localhost nebo HTTPS.');
 const dir=await window.showDirectoryPicker({id:'eurojackpot-csv',mode:'readwrite'});
 const names=new Set();for await(const [name,handle] of dir.entries())if(handle.kind==='file')names.add(name);
 if(!names.has('euro_predikce.csv')||!names.has('vsazene_kombinace.csv')){
  if(!confirm('Vybraná složka neobsahuje oba CSV soubory. Chceš je zde vytvořit?'))return;
 }else if(!confirm('Povolit WEB2 aktualizovat oba CSV soubory ve vybrané složce podle aktuálních dat aplikace?'))return;
 localCsvDirectory=dir;
 localCsvStatus('Místní CSV: složka připojena, ukládám…');
 queueLocalCsvWrite();await localCsvQueue;
}
const localSave=()=>localStorage.setItem(KEY,JSON.stringify(data));
const persist=()=>{revision++;dirty=true;localStorage.setItem(DIRTY,'1');localSave();queueLocalCsvWrite();syncStatus(config()?'místní změny čekají na odeslání':'místní změny · veřejné čtení GitHub aktivní · zápis bez tokenu vypnutý',config()?'info':'error');if(config()){clearTimeout(saveTimer);saveTimer=setTimeout(()=>autoSave().catch(e=>warn(e.message)),1400)}};
const syncStatus=(m,kind='info')=>{
 const color=kind==='error'?'#ffbf69':kind==='ok'?'#9be3a5':'#8bb7f0';
 let el=document.getElementById('euro-sync-status');
 if(el){el.textContent='GitHub: '+m;el.style.color=color}
 let badge=document.getElementById('euro-sync-indicator');
 if(!badge&&document.body){
  badge=document.createElement('button');badge.id='euro-sync-indicator';badge.type='button';
  badge.title='Kliknutím otevřít nastavení synchronizace';
  badge.setAttribute('aria-label','Stav synchronizace GitHubu – otevřít nastavení');
  badge.style.cssText='position:fixed;bottom:12px;left:12px;z-index:950;background:#1a2a43;border:1px solid #334e6e;border-radius:8px;padding:8px 12px;color:#eef2f5;font:500 12px Montserrat,Arial,sans-serif;box-shadow:0 3px 10px #0006;max-width:min(350px,calc(100vw - 24px));white-space:normal;text-align:left;cursor:pointer;';
  badge.onclick=()=>{const panel=document.querySelector('.renta-settings');if(panel)panel.open=true};
  document.body.appendChild(badge);
 }
 if(badge){badge.textContent=(kind==='ok'?'✓ ':kind==='error'?'⚠ ':'↻ ')+m;badge.style.color=color;badge.title='GitHub: '+m+' · Kliknutím otevřít nastavení'}
};
 const warn=m=>{let el=document.getElementById('renta-sync-warning');if(el)el.textContent='⚠ '+m;syncStatus(m,'error');console.warn(m)};
const config=()=>cfg.owner&&cfg.repo&&cfg.token;
const publicConfig=()=>cfg.owner&&cfg.repo;
const sortedBets=()=>[...data.bets].sort((a,b)=>date(b.Datum_sazky).localeCompare(date(a.Datum_sazky))||(+a.Poradi||0)-(+b.Poradi||0));
const drawMap=()=>new Map(data.history.map(h=>[date(h.date),h.numbers]));
function parseHistory(s){let rows=csv(s);if(rows[0]?.[0]?.toLowerCase()!=='datum')throw Error('Neplatná hlavička eurojackpot.csv');let out=[];for(let r of rows.slice(1)){if(r.length<9)continue;let n=valid(r.slice(2,9));if(!n)throw Error('Neplatný historický tah: '+r[0]);out.push({date:date(r[0]),numbers:n})}return [...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date))}
function parseBets(s){let rows=csv(s),head=rows.shift().map(x=>x.toLowerCase().trim());return rows.filter(r=>r.length>=3).map((r,i)=>{let obj=Object.fromEntries(head.map((h,j)=>[h,r[j]||''])),n=valid([...parseNums(obj.kombinace),...parseNums(obj.euro)]);if(!n)return null;return {Datum_sazky:date(obj.datum),Kombinace:n.join(','),Cena:obj.castka||'0',Vyhodnoceni:obj.vysledek||'Nevyhodnoceno',Shodna_cisla:[obj.shoda_hlavni||'',obj.shoda_euro||''].filter(Boolean).join(' | '),Poradi:i+1,Metoda:obj.metoda||''}}).filter(Boolean)}
async function seed(){
  // První spuštění musí fungovat i z file://, kde fetch místních CSV bývá zakázaný.
  // Existující uložené sázky nikdy nepřepisujeme počátečním balíčkem.
  if(data.history.length)return;
  try{
    if(window.EURO_INITIAL_DATA){
      data.history=parseHistory(window.EURO_INITIAL_DATA.history);
      if(!data.bets.length)data.bets=parseBets(window.EURO_INITIAL_DATA.bets);
      localSave();return;
    }
    if(location.protocol==='file:')throw Error('Chybí initial-data.js vedle index.html');
    let h=await nativeFetch('./eurojackpot.csv');if(h.ok)data.history=parseHistory(await h.text());
    let b=await nativeFetch('./vsazene_kombinace.csv');if(b.ok&&!data.bets.length)data.bets=parseBets(await b.text());
    localSave();
  }catch(e){warn('Načtení počátečních dat: '+e.message)}
}
function mergeHistory(rows){let map=new Map(data.history.map(h=>[h.date,h]));let before=map.size;for(let h of rows)map.set(h.date,h);data.history=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));if(map.size!==before)localSave();return map.size-before}
async function refreshHistory(){
 // GitHub Pages reads the CSV shipped with the site. Local file:// reads the same
 // public repository without requiring a personal access token.
 const local='./eurojackpot.csv?t='+Date.now();
 const owner=(cfg.owner||'jerry00769').trim(),repo=(cfg.repo||'Eurojackpot').trim();
 const remoteCsv='https://raw.githubusercontent.com/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo)+'/main/eurojackpot.csv?t='+Date.now();
 const urls=location.protocol==='file:'?[remoteCsv]:[local,remoteCsv];
 let lastError;
 for(const url of urls){try{
  const r=await nativeFetch(url,{cache:'no-store'});
  if(!r.ok)throw Error('HTTP '+r.status);
  return mergeHistory(parseHistory(await r.text()));
 }catch(e){lastError=e}}
 if(location.protocol==='file:'){console.warn('Aktualizace z GitHubu nedostupná; zachována místní historie.',lastError);return 0}
 throw Error('Historie CSV nedostupná: '+(lastError?.message||'neznámá chyba'));
}
const poolSize=d=>d<'2014-10-10'?8:d<'2022-03-25'?10:12;
const k2=(a,b)=>a<b?`${a},${b}`:`${b},${a}`;
function normalize(counter,keys){let vals=keys.map(k=>Math.log1p(counter.get(k)||0)),lo=Math.min(...vals),hi=Math.max(...vals),m=new Map();keys.forEach((k,i)=>m.set(k,hi>lo?(vals[i]-lo)/(hi-lo):.5));return m}
function buildStats(){let main=new Map(),euro=new Map(),pairs=new Map(),triples=new Map(),exposure=Array(13).fill(0),expected=Array(13).fill(0),learnM=Array(51).fill(0),learnE=Array(13).fill(0),rewardM=Array(51).fill(0),penM=Array(51).fill(0),rewardE=Array(13).fill(0),penE=Array(13).fill(0),pairLearn=new Map(),pairReward=new Map(),ePairLearn=new Map();
for(let h of data.history){let a=h.numbers.slice(0,5),e=h.numbers.slice(5),size=poolSize(h.date);for(let n of a)main.set(n,(main.get(n)||0)+1);for(let n of e)euro.set(n,(euro.get(n)||0)+1);for(let n=1;n<=size;n++){exposure[n]++;expected[n]+=2/size}for(let i=0;i<5;i++)for(let j=i+1;j<5;j++){let p=k2(a[i],a[j]);pairs.set(p,(pairs.get(p)||0)+1);for(let k=j+1;k<5;k++){let t=`${a[i]},${a[j]},${a[k]}`;triples.set(t,(triples.get(t)||0)+1)}}}
let map=drawMap(),checked=0;for(let b of data.bets){let actual=map.get(date(b.Datum_sazky)),ticket=valid(b.Kombinace);if(!actual||!ticket)continue;checked++;let hitsM=new Set(ticket.slice(0,5).filter(n=>actual.slice(0,5).includes(n))),hitsE=new Set(ticket.slice(5).filter(n=>actual.slice(5).includes(n))),exp=2/poolSize(date(b.Datum_sazky));for(let n of ticket.slice(0,5)){learnM[n]+=(hitsM.has(n)?1:0)-.1;if(hitsM.has(n))rewardM[n]++;else penM[n]++}for(let n of ticket.slice(5)){learnE[n]+=(hitsE.has(n)?1:0)-exp;if(hitsE.has(n))rewardE[n]++;else penE[n]++}let a=ticket.slice(0,5);for(let i=0;i<5;i++)for(let j=i+1;j<5;j++){let p=k2(a[i],a[j]),hits=(hitsM.has(a[i])?1:0)+(hitsM.has(a[j])?1:0);pairLearn.set(p,(pairLearn.get(p)||0)+hits/2-.1);if(hits===2)pairReward.set(p,(pairReward.get(p)||0)+1)}let ep=k2(...ticket.slice(5));ePairLearn.set(ep,(ePairLearn.get(ep)||0)+hitsE.size/2-exp)}
let adj=new Map();for(let n=1;n<=12;n++){let prior=exposure[n]?expected[n]/exposure[n]:2/12;adj.set(n,1000*((euro.get(n)||0)+40*prior)/(exposure[n]+40))}
let mk=(from,to)=>Array.from({length:to-from+1},(_,i)=>i+from),allPairs=[],allTriples=[];for(let i=1;i<=50;i++)for(let j=i+1;j<=50;j++){allPairs.push(`${i},${j}`);for(let k=j+1;k<=50;k++)allTriples.push(`${i},${j},${k}`)}let allEP=[];for(let i=1;i<=12;i++)for(let j=i+1;j<=12;j++)allEP.push(`${i},${j}`);
const center=(v,scale)=>Math.max(-1,Math.min(1,v/Math.max(1,scale)));let mScale=Math.max(1,...learnM.map(Math.abs)),eScale=Math.max(1,...learnE.map(Math.abs)),pScale=Math.max(1,...Array.from(pairLearn.values(),Math.abs)),epScale=Math.max(1,...Array.from(ePairLearn.values(),Math.abs));return {main,adj,mainNorm:normalize(main,mk(1,50)),euroNorm:normalize(adj,mk(1,12)),pairNorm:normalize(pairs,allPairs),tripleNorm:normalize(triples,allTriples),learnM,learnE,pairLearn,ePairLearn,rewardM,penM,rewardE,penE,pairReward,mScale,eScale,pScale,epScale,checked}}
function scoreLine(a,e,s){let score=0;for(let n of a)score+=(s.mainNorm.get(n)||0)*28+(s.rewardM[n]-.1*s.penM[n])*.65+s.learnM[n]/s.mScale*2.5;for(let i=0;i<5;i++)for(let j=i+1;j<5;j++){let p=k2(a[i],a[j]);score+=(s.pairNorm.get(p)||0)*13+(s.pairReward.get(p)||0)*.45+(s.pairLearn.get(p)||0)/s.pScale*1.5;for(let k=j+1;k<5;k++)score+=(s.tripleNorm.get(`${a[i]},${a[j]},${a[k]}`)||0)*2.5}for(let n of e)score+=(s.euroNorm.get(n)||0)*8+(s.rewardE[n]-s.penE[n]/6)*.35+s.learnE[n]/s.eScale*1.5;score+=(s.ePairLearn.get(k2(...e))||0)/s.epScale*.8;
let low=a.filter(n=>n<=25).length,span=(a[4]-a[0])/45,buckets=new Set(a.map(n=>Math.floor((n-1)/10))).size,spread=(1-Math.abs(low-(5-low))/5)*.45+Math.min(1,span)*.30+Math.min(1,buckets/5)*.25,gaps=a.slice(1).map((n,i)=>n-a[i]),avg=gaps.reduce((x,y)=>x+y,0)/4,dev=Math.sqrt(gaps.reduce((x,y)=>x+(y-avg)**2,0)/4),longest=1,run=1;for(let i=1;i<5;i++){run=a[i]===a[i-1]+1?run+1:1;longest=Math.max(longest,run)}return score+spread*6+Math.min(1,dev/8)*2.5-(longest<=2?0:longest===3?1.5:longest===4?3:5)}
function pick(freq,count,max,exp){let nums=Array.from({length:max},(_,i)=>i+1),weights=nums.map(n=>((freq.get(n)||0)+1)**exp),out=new Set();while(out.size<count){let sum=weights.reduce((a,b)=>a+b,0),r=Math.random()*sum;for(let i=0;i<max;i++){r-=weights[i];if(r<=0){out.add(nums[i]);break}}}return [...out].sort((a,b)=>a-b)}
/* WEB Eurojackpot2: rychlý experimentální adaptivní generátor.
   Historické vzory nejsou důkazem predikce; váhy jsou záměrně tlumené. */
// WEB2 SMART v3: multiple candidate models, chronological selection + independent holdout.
// An honest fallback to uniform sampling is intentional when no predictive signal survives.
let smartCache=null;
function smartModel(){
 const draws=[...data.history].sort((a,b)=>a.date.localeCompare(b.date));
 const signature=draws.length+'|'+(draws.at(-1)?.date||'')+'|'+(draws.at(-1)?.numbers.join(',')||'');
 if(smartCache?.signature===signature)return smartCache;
 const options=[{name:'náhoda',window:120,mode:'uniform'},
  ...[40,120,300].flatMap(window=>['četnost','opačná četnost','nedávné tahy'].map(mode=>({name:mode+' '+window,window,mode})))];
 const start=Math.max(300,draws.length-160),cut=Math.min(draws.length,Math.max(start,draws.length-60));
 function weights(end,opt,kind){
  const max=kind==='main'?50:12,arr=Array(max+1).fill(1);
  if(opt.mode==='uniform')return arr;
  const counts=Array(max+1).fill(0),first=Math.max(0,end-opt.window);
  let total=0;
  for(let i=first;i<end;i++){
   const h=draws[i];if(kind==='euro'&&poolSize(h.date)!==12)continue;
   const factor=opt.mode==='nedávné tahy' ? .25+.75*(i-first+1)/(end-first) : 1;
   for(const n of h.numbers.slice(kind==='main'?0:5,kind==='main'?5:7))counts[n]+=factor;
   total+=factor;
  }
  const expected=total*(kind==='main'?.1:1/6);
  for(let n=1;n<=max;n++){
   let delta=(counts[n]-expected)/(expected+15);
   if(opt.mode==='opačná četnost')delta=-delta;
   arr[n]=Math.max(.80,Math.min(1.20,1+.20*delta));
  }
  return arr;
 }
 function score(opt,kind,from,to){
  const max=kind==='main'?50:12,k=kind==='main'?5:2;
  let logGain=0,used=0;
  for(let i=from;i<to;i++){
   if(i<300||(kind==='euro'&&poolSize(draws[i].date)!==12))continue;
   const w=weights(i,opt,kind),sum=w.slice(1).reduce((a,b)=>a+b,0);
   for(const n of draws[i].numbers.slice(kind==='main'?0:5,kind==='main'?5:7))logGain+=Math.log(w[n]*max/sum);
   used++;
  }
  return {logGain,used,average:used?logGain/used:0};
 }
 function select(kind){
  const ranked=options.map(o=>({...o,train:score(o,kind,start,cut)})).sort((a,b)=>b.train.logGain-a.train.logGain);
  const candidate=ranked[0],hold=score(candidate,kind,cut,draws.length);
  // Holdout is not used to tune weights; it is only a conservative go/no-go gate.
  // Multiple candidate comparisons can still produce false positives: not a proof of advantage.
  const accepted=candidate.mode!=='uniform'&&candidate.train.logGain>1.5&&hold.logGain>1.5&&hold.used>=30;
  const chosen=accepted?candidate:options[0];
  return {name:chosen.name,mode:chosen.mode,window:chosen.window,strength:accepted?.20:0,
   weights:weights(draws.length,chosen,kind),train:candidate.train,hold,tested:hold.used,
   candidate:candidate.name,accepted};
 }
 const main=select('main'),euro=select('euro');
 smartCache={signature,main,euro,checked:data.bets.filter(b=>draws.some(h=>h.date===date(b.Datum_sazky))&&valid(b.Kombinace)).length};
 return smartCache;
}
// SMART v4: optimize the *portfolio* of six tickets, not an unproven draw prediction.
// Weighted random ordering respects accepted models; when rejected it is uniform.
// No main/euro number repeats across the six tickets: 30/50 and 12/12 coverage.
function smartGenerate(){
 if(!data.history.length)throw Error('Chybí historie Eurojackpotu.');
 const model=smartModel();
 function weightedOrder(max,w){
  const items=[];
  for(let n=1;n<=max;n++){
   // Exponential race: random permutation, weighted without replacement.
   const weight=Math.max(0.000001,Number(w[n])||1);
   items.push({n,key:-Math.log(Math.max(Number.MIN_VALUE,Math.random()))/weight});
  }
  items.sort((a,b)=>a.key-b.key);
  return items.map(x=>x.n);
 }
 const main=weightedOrder(50,model.main.weights).slice(0,30);
 const euro=weightedOrder(12,model.euro.weights);
 // Randomize group membership as well as ordering; every line gets 5+2.
 const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 shuffle(main);shuffle(euro);
 const final=[];
 for(let i=0;i<6;i++){
  const a=main.slice(i*5,i*5+5).sort((x,y)=>x-y);
  const e=euro.slice(i*2,i*2+2).sort((x,y)=>x-y);
  final.push([...a,...e]);
 }
 // Defensive validation before overwriting predictions or marking data dirty.
 if(final.length!==6||new Set(final.flatMap(x=>x.slice(0,5))).size!==30||new Set(final.flatMap(x=>x.slice(5))).size!==12)
  throw Error('Kontrola rozložení šesti sloupců selhala.');
 data.predictions=final;persist();
 return {checked:model.checked,main:model.main,euro:model.euro,mainCoverage:30,euroCoverage:12};
}

function generate(){if(!data.history.length)throw Error('Chybí historie Eurojackpotu.');let s=buildStats(),candidates=[],seen=new Set();for(let i=0;i<30000;i++){let a=pick(s.main,5,50,.25),e=pick(s.adj,2,12,.20),key=[...a,...e].join(',');if(seen.has(key))continue;seen.add(key);candidates.push({a,e,score:scoreLine(a,e,s)})}candidates.sort((a,b)=>b.score-a.score);candidates=candidates.slice(0,6000);let final=[],usage=Array(51).fill(0),eu=Array(13).fill(0),ep=new Set();for(let round=0;round<6;round++){let best=null,bestScore=-Infinity;for(let c of candidates){if(c.a.some(n=>usage[n]>=3)||c.e.some(n=>eu[n]>=3)||ep.has(k2(...c.e)))continue;if(final.some(f=>c.a.filter(n=>f.slice(0,5).includes(n)).length>2))continue;let overlap=final.length?final.reduce((z,f)=>z+c.a.filter(n=>f.slice(0,5).includes(n)).length,0)/final.length:0;let repeated=c.a.reduce((z,n)=>z+usage[n],0),er=c.e.reduce((z,n)=>z+eu[n],0),bonus=final.length?Math.max(0,5-repeated)+(overlap<=1?7:overlap<=1.5?4:overlap<=2?1:-4)+Math.max(0,2-er*.5):0,score=c.score+bonus;if(score>bestScore){bestScore=score;best=c}}if(!best)throw Error('Nelze sestavit všech šest sloupců při zadaných omezeních.');final.push([...best.a,...best.e]);best.a.forEach(n=>usage[n]++);best.e.forEach(n=>eu[n]++);ep.add(k2(...best.e))}data.predictions=final;persist();return s}
const PRIZES={'5,2':1,'5,1':2,'5,0':3,'4,2':4,'4,1':5,'3,2':6,'4,0':7,'2,2':8,'3,1':9,'3,0':10,'1,2':11,'2,1':12};

// Veřejný otevřený archiv (CC BY 4.0); výplaty v EUR, nikoliv Kč.
// Cache zůstává oddělená od sázek i GitHub synchronizace.
const EURO_OPEN_SOURCE='https://lottochaos.com/draws_q.json';
const EURO_CACHE_KEY='euro_open_payout_cache_v1';
const EURO_CHECK_KEY='euro_open_payout_checked_v1';
const EURO_DIAG_KEY='euro_smart_diagnostics_v1', EURO_FINANCE_KEY='euro_finance_snapshot_v1';
const EURO_CZ_KEY='euro_cz_payout_cache_v2', EURO_CZ_CHECK='euro_cz_payout_checked_v2';
let euroCzStatus='dosud neověřeno',euroCzLastSuccess=0;
let euroFinanceBusy=null;
let euroOpenRows=null, euroOpenStatus='dosud nenačteno';
function euroCachedRows(){
 if(euroOpenRows)return euroOpenRows;
 try{let obj=JSON.parse(localStorage.getItem(EURO_CACHE_KEY)||'null');
  if(obj&&typeof obj==='object'&&!Array.isArray(obj))euroOpenRows=obj;
 }catch(e){console.warn('Euro cache:',e)}
 return euroOpenRows||{};
}
async function updateEuroArchive(force=false){
 const previous=euroCachedRows();
 const last=Number(localStorage.getItem(EURO_CHECK_KEY)||0);
 if(!force&&Date.now()-last<24*3600*1000){euroOpenStatus=Object.keys(previous).length?'místní cache':'neověřeno';return 0}
 if(!navigator.onLine){euroOpenStatus='offline – používá se cache';return 0}
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  let r;
  try{r=await nativeFetch(EURO_OPEN_SOURCE,{cache:'no-cache',signal:controller.signal})}finally{clearTimeout(timer)}
  if(!r.ok)throw Error('HTTP '+r.status);
  const rows=await r.json();if(!Array.isArray(rows)||rows.length<30)throw Error('Neplatný archiv');
  const next={...previous};let changed=0;
  for(const row of rows){
   if(!Array.isArray(row)||row.length<4||!/^\d{4}-\d{2}-\d{2}$/.test(row[0]))continue;
   const [d,m,e,prizes]=row;
   if(!Array.isArray(m)||!Array.isArray(e)||!Array.isArray(prizes)||m.length!==5||e.length!==2||prizes.length!==12||!prizes.every(v=>v===null||(Number.isFinite(v)&&v>=0)))continue;
   if(!valid([...m,...e]))continue;
   if(JSON.stringify(next[d])!==JSON.stringify({numbers:valid([...m,...e]),eur:prizes})){changed++;next[d]={numbers:valid([...m,...e]),eur:prizes}}
  }
  if(Object.keys(next).length<30)throw Error('Nedostatek platných záznamů');
  localStorage.setItem(EURO_CACHE_KEY,JSON.stringify(next));localStorage.setItem(EURO_CHECK_KEY,String(Date.now()));
  euroOpenRows=next;euroOpenStatus='aktualizováno z veřejného archivu';
  // Pouze doplnění chybějících tahů. Nezasahovat do existující historie ani do sázek.
  const existing=new Set(data.history.map(h=>date(h.date)));
  const added=Object.entries(next).filter(([d])=>!existing.has(d)).map(([d,v])=>({date:d,numbers:v.numbers}));
  if(added.length){data.history.push(...added);data.history.sort((a,b)=>a.date.localeCompare(b.date));localSave();}
  return changed;
 }catch(e){euroOpenStatus='zdroj nedostupný – používá se cache';console.warn('Eurojackpot archiv:',e.message);return 0}
}
// České výplaty: oddělená cache. Při otevření file:// může CORS blokovat přímé
// stažení; v takovém případě zůstanou pouze ověřené zabalené částky.
function euroCzPayouts(){
 let saved={};try{saved=JSON.parse(localStorage.getItem(EURO_CZ_KEY)||'{}')||{}}catch{}
 // Published verified values take precedence over older browser cache.
 const published=window.EURO_PAYOUTS||{};
 for(const [day,row] of Object.entries(saved)){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Array.isArray(row?.prizes)||row.prizes.length!==12||!row.prizes.every(x=>x===null||(Number.isFinite(x)&&x>=0)))delete saved[day];
  else if(published[day]&&JSON.stringify(published[day].prizes)!==JSON.stringify(row.prizes))delete saved[day];
 }
 return {...saved,...published};
}
function euroCzParseHtml(html){
 const doc=new DOMParser().parseFromString(html,'text/html');
 // Čteme jen explicitně označené řádky pořadí, ne jackpot či reklamní ceny.
 const result={};let active=null,prizes={};
 const flush=()=>{if(active&&Object.keys(prizes).length===12){
   let arr=Array.from({length:12},(_,i)=>prizes[i+1]);
   if(arr.every(v=>v===null||(Number.isFinite(v)&&v>=0)))result[active]={prizes:arr,source:'https://vyhraj.cz/loterie/eurojackpot/archiv-vysledku/'};
 }};
 const month={ledna:1,února:2,března:3,dubna:4,května:5,června:6,července:7,srpna:8,září:9,října:10,listopadu:11,prosince:12};
 // Textové uzly procházíme v pořadí dokumentu; datum vždy resetuje tabulku.
 const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode())){
  const t=(node.textContent||'').replace(/\s+/g,' ').trim();if(!t)continue;
  const d=t.match(/(?:pondělí|úterý|středa|čtvrtek|pátek|sobota|neděle)\s+(\d{1,2})\.\s*([a-zá-ž]+),?\s*(20\d{2})/i);
  if(d&&month[d[2].toLowerCase()]){flush();active=d[3]+'-'+String(month[d[2].toLowerCase()]).padStart(2,'0')+'-'+d[1].padStart(2,'0');prizes={};continue}
  // Parsování po řádcích tabulky (nikdy nepoužívat libovolné částky z celé stránky).
  const tr=node.parentElement?.closest('tr');if(!tr||!active)continue;
  const cells=[...tr.querySelectorAll('th,td')].map(x=>x.textContent.replace(/\s+/g,' ').trim());
  if(cells.length<2)continue;
  const rank=cells[0].match(/^(\d{1,2})\.\s*pořadí/i);if(!rank)continue;
  const idx=Number(rank[1]);if(idx<1||idx>12)continue;
  const m=cells[1].match(/^(?:([\d\s\u00a0]+)\s*Kč|[-–]\s*\/)/i);
  if(!m)continue;
  prizes[idx]=m[1]?Number(m[1].replace(/\s/g,'')):null;
 }
 flush();return result;
}
async function refreshPublishedCzPayouts(){
 if(!navigator.onLine)return 0;
 const url=location.protocol==='file:'
  ? `https://raw.githubusercontent.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/main/euro-vyhry.js?t=${Date.now()}`
  : `./euro-vyhry.js?t=${Date.now()}`;
 try{
  const response=await nativeFetch(url,{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
  const text=await response.text();const match=text.match(/window\.EURO_PAYOUTS\s*=\s*([\s\S]*?)\s*;\s*$/);
  if(!match)throw Error('Neznámý formát výplat');const rows=JSON.parse(match[1]);
  let previous=window.EURO_PAYOUTS||{},changed=0;
  for(const [day,entry] of Object.entries(rows)){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Array.isArray(entry?.prizes)||entry.prizes.length!==12)continue;
   if(!entry.prizes.every(x=>x===null||(Number.isFinite(x)&&x>=0)))continue;
   if(!previous[day]){previous[day]=entry;changed++}else if(JSON.stringify(previous[day].prizes)!==JSON.stringify(entry.prizes)){console.warn('Rozpor v ověřených Kč pro '+day+' – původní částky zachovány.')}
  }
  window.EURO_PAYOUTS=previous;
  if(changed){try{localStorage.setItem(EURO_CZ_CHECK,String(Date.now()))}catch(e){console.warn(e)}}
  return changed;
 }catch(e){console.warn('Publikované výhry Kč:',e.message);return 0}
}
async function updateEuroCzPayouts(){
 // A static site (GitHub Pages) and file:// cannot reliably fetch third-party
 // Czech HTML because of CORS. GitHub Actions fetches it server-side instead.
 // Always rely on verified euro-vyhry.js; never show a misleading CORS failure
 // when the verified published cache is available.
 if(location.protocol==='file:' || location.hostname.endsWith('github.io')){
  const n=Object.keys(euroCzPayouts()).length;
  euroCzStatus=n?`ověřené publikované Kč (${n} losování); aktualizace přes GitHub Actions`:'čeká na publikované výhry Kč z GitHub Actions';
  return;
 }
 const last=Number(localStorage.getItem(EURO_CZ_CHECK)||0);
 if(Date.now()-last<24*3600*1000){euroCzStatus='místní cache / zabalené Kč';return}
 if(!navigator.onLine){euroCzStatus='offline – místní Kč';return}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
 try{
  const r=await nativeFetch('https://vyhraj.cz/loterie/eurojackpot/archiv-vysledku/',{signal:controller.signal,cache:'no-cache'});
  if(!r.ok)throw Error('HTTP '+r.status);
  const rows=euroCzParseHtml(await r.text());
  if(Object.keys(rows).length<2)throw Error('Struktura českého archivu není rozpoznána');
  let saved={};try{saved=JSON.parse(localStorage.getItem(EURO_CZ_KEY)||'{}')||{}}catch{}
  // Nepřepisovat existující výplaty odlišnými částkami bez ověření.
  const bundled=window.EURO_PAYOUTS||{};
  for(const [d,v] of Object.entries(rows)){
   if(bundled[d]&&JSON.stringify(bundled[d].prizes)!==JSON.stringify(v.prizes))continue;
   saved[d]=v;
  }
  localStorage.setItem(EURO_CZ_KEY,JSON.stringify(saved));localStorage.setItem(EURO_CZ_CHECK,String(Date.now()));
  euroCzLastSuccess=Date.now();euroCzStatus='český archiv načten ('+Object.keys(rows).length+' losování)';
 }catch(e){euroCzStatus='český zdroj nedostupný / CORS – místní Kč';console.warn('CZ výplaty:',e.message)}
 finally{clearTimeout(timer)}
}
// SMART Finance: payout data live in separate euro-vyhry.js (not in bets or GitHub JSON).
// Six columns of the same draw are one 400 Kč ticket. No Extra 6 payout is inferred.
function smartFinancialAudit(){
 const draws=drawMap(),ranks=Array(13).fill(0),tickets=new Map();
 let evaluated=0,unknown=0,payoutKnown=0,payoutMissing=0,payoutTotal=0;
 const payoutData=euroCzPayouts();
 const archive=euroCachedRows();let eurOnly=0,eurCount=0,missingDates=new Set();
 for(const b of data.bets){
  const d=date(b.Datum_sazky),actual=draws.get(d),a=valid(b.Kombinace);
  if(!a){unknown++;continue}
  if(!tickets.has(d))tickets.set(d,{count:0,wins:0,missing:0});
  const ticket=tickets.get(d);ticket.count++;
  if(!actual){unknown++;continue}
  evaluated++;
  const m=a.slice(0,5).filter(n=>actual.slice(0,5).includes(n)).length;
  const e=a.slice(5).filter(n=>actual.slice(5).includes(n)).length;
  const rank=PRIZES[`${m},${e}`]||0;
  if(rank){
   ranks[rank]++;ticket.wins++;
   const amount=payoutData[d]?.prizes?.[rank-1];
   if(Number.isFinite(amount)&&amount>0){payoutKnown++;payoutTotal+=amount}
   else{payoutMissing++;ticket.missing++;missingDates.add(d);const eur=archive[d]?.eur?.[rank-1];if(Number.isFinite(eur)&&eur>0){eurOnly+=eur;eurCount++}}
  }
 }
 const fmt=n=>n.toLocaleString('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' Kč';
 // Počítat každou kompletní šestici samostatně, i při více sázenkách v jeden den.
 // U neúplných šestic je počet fyzických tiketů pouze odhad.
 const ticketCount=[...tickets.values()].reduce((n,t)=>n+Math.ceil(t.count/6),0),cost=ticketCount*400;
 const incomplete=[...tickets].filter(([d,t])=>t.count%6!==0).map(([d,t])=>d+' ('+t.count+' sl.)');
 const rankLines=ranks.map((n,i)=>i&&n?`${i}. pořadí: ${n}×`:null).filter(Boolean);
 const lines=[
  `Vyhodnoceno ${evaluated} sloupců; ${incomplete.length?'odhad':'evidováno'} ${ticketCount} sázenek; bez výsledku ${unknown}.`,
  `Výherní sloupce: ${ranks.slice(1).reduce((a,b)=>a+b,0)}. ${rankLines.join(' · ')||'Žádná výhra'}.`,
  `Náklady: ${fmt(cost)} (400 Kč za každých 6 sloupců na datum).`,
  `Ověřené výhry Eurojackpot: ${fmt(payoutTotal)} (${payoutKnown} výher); neověřené částky: ${payoutMissing}.`,
  payoutMissing||unknown?`Zatím doložené výhry minus evidované náklady: ${fmt(payoutTotal-cost)} (NEJDE o konečnou bilanci; ${payoutMissing?'chybí částky výher; ':''}${unknown?'některé tahy dosud nemají výsledek.':''})`:`Čistá bilance: ${fmt(payoutTotal-cost)}. Návratnost: ${cost?(100*payoutTotal/cost).toFixed(1).replace('.',','):'0'} %.`,
  `Archiv EUR: ${euroOpenStatus}. České výplaty: ${euroCzStatus}. Další známé výhry pouze v EUR: ${eurCount} (${eurOnly.toFixed(2)} EUR); nejsou přičteny do Kč.`,
  missingDates.size?`Bez českých výplatních částek pro: ${[...missingDates].sort().join(', ')}.`:'U všech vyhodnocených výher je částka v Kč.',
  'České částky: euro-vyhry.js a místní cache; veřejný archiv EUR: lottochaos.com (CC BY 4.0). Přímé načtení českého webu z file:// může být zablokováno CORS. Sázky ani GitHub data se nemění.',
  incomplete.length?'Pozor: neúplné šestice ('+incomplete.join(', ')+') – náklady jsou odhad.':'Všechna evidovaná data mají kompletní šestice sloupců.',
  'Extra 6 výhry nejsou započteny. Bez ověřeného zdroje Kč nelze zaručit automatické doplnění nových výplat.'
 ];
 return lines.join('\n');
}

// Tichá automatická aktualizace bez dialogu, bez ručního klikání.
// Ukládá pouze odvozený přehled; neznámé výplaty se nikdy nedopočítávají.
function showFinanceDialog(report){
 let old=document.getElementById('euro-finance-dialog');if(old)old.remove();
 const shade=document.createElement('div');shade.id='euro-finance-dialog';shade.style.cssText='position:fixed;inset:0;background:#0009;z-index:10020;display:flex;align-items:center;justify-content:center;padding:16px';
 const panel=document.createElement('div');panel.style.cssText='background:#1a2842;color:#e6efff;border:1px solid #52709a;border-radius:12px;max-width:680px;width:100%;max-height:85vh;overflow:auto;padding:20px;box-shadow:0 16px 60px #0009';
 const heading=document.createElement('h2');heading.textContent='Automatická bilance sázek';heading.style.cssText='color:#8bb7f0;margin:0 0 16px';
 const lines=report.split('\n');
 const summary=document.createElement('div');summary.style.cssText='display:grid;gap:10px;font:14px/1.5 Arial,sans-serif';
 // Show the useful result first. Keep the complete original audit available below.
 for(const i of [0,1,2,3,4]){if(!lines[i])continue;const item=document.createElement('div');item.textContent=lines[i];item.style.cssText='padding:9px 12px;border:1px solid #3a5277;border-radius:7px;background:#202f4c';if(i===4)item.style.fontWeight='700';summary.append(item)}
 const note=document.createElement('p');note.textContent=lines[6]||'';note.style.cssText='color:#b8cbe8;font:13px/1.5 Arial,sans-serif';
 const details=document.createElement('details');details.style.cssText='margin:14px 0';
 const toggle=document.createElement('summary');toggle.textContent='Podrobnosti, zdroje a diagnostika';toggle.style.cssText='cursor:pointer;color:#8bb7f0;font:13px Arial,sans-serif';
 const body=document.createElement('pre');body.textContent=lines.slice(5).join('\n');body.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 Arial,sans-serif';
 details.append(toggle,body);
 const close=document.createElement('button');close.textContent='Zavřít';close.style.cssText='background:#4358aa;color:white;border:0;border-radius:7px;padding:10px 22px;cursor:pointer';
 close.onclick=()=>shade.remove();shade.onclick=e=>{if(e.target===shade)shade.remove()};
 shade.addEventListener('keydown',e=>{if(e.key==='Escape')shade.remove()});
 panel.append(heading,summary,note,details,close);shade.append(panel);document.body.append(shade);close.focus();
}
function storeEuroFinanceSnapshot(){
 const report=smartFinancialAudit();
 try{localStorage.setItem(EURO_FINANCE_KEY,JSON.stringify({updatedAt:new Date().toISOString(),report}))}catch(e){console.warn('Finance cache:',e)}
 const status=document.getElementById('euro-finance-auto-status');
 if(status)status.textContent='Bilance přepočítána · '+new Date().toLocaleString('cs-CZ')+' · Kč: '+euroCzStatus+' · EUR: '+euroOpenStatus;
 return report;
}
async function refreshEuroFinanceAuto(){
 if(euroFinanceBusy)return euroFinanceBusy;
 euroFinanceBusy=(async()=>{
  await ready;
  await refreshPublishedCzPayouts();
  await Promise.all([updateEuroArchive(),updateEuroCzPayouts()]);
  const changed=evaluate(true);
  if(changed&&typeof loadStakedHistory==='function')try{await loadStakedHistory()}catch(e){console.warn(e)}
  storeEuroFinanceSnapshot();
 })().catch(e=>console.warn('Automatická bilance:',e)).finally(()=>{euroFinanceBusy=null});
 return euroFinanceBusy;
}
function evaluate(silent=false){let draws=drawMap(),n=0;for(let b of data.bets){let actual=draws.get(date(b.Datum_sazky)),a=valid(b.Kombinace);if(!actual||!a)continue;let mh=a.slice(0,5).filter(x=>actual.slice(0,5).includes(x)),eh=a.slice(5).filter(x=>actual.slice(5).includes(x)),rank=PRIZES[`${mh.length},${eh.length}`];let result=rank?`Výhra (${rank}. pořadí)`:'Prohra',match=`${mh.join(',')} | ${eh.join(',')}`;if(b.Vyhodnoceni!==result||b.Shodna_cisla!==match){b.Vyhodnoceni=result;b.Shodna_cisla=match;n++}}if(n){if(silent)localSave();else persist()}return n}
const encode=s=>btoa(Array.from(new TextEncoder().encode(s),c=>String.fromCharCode(c)).join(''));
const decode=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0)));
// CSV mirror: shared JSON is the transactional source; the two legacy CSVs
// remain readable and writable in the same GitHub repository.
function parsePredictionsCSV(content){return String(content||'').replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>valid(x.trim())).filter(Boolean).slice(0,6)}
const fmtPredictions=()=>data.predictions.map(a=>(valid(a)||[]).join(',')).filter(Boolean).join('\r\n')+(data.predictions.length?'\r\n':'');
async function remoteFile(path,method='GET',payload){
 if(method!=='GET'&&!config())throw Error('Pro zápis CSV je nutný GitHub token.');
 const url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encodeURIComponent(path)}`;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const r=await nativeFetch(url,{method,signal:controller.signal,headers:{...(cfg.token?{Authorization:`Bearer ${cfg.token}`} : {}),Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  const j=await r.json();
  if(r.status===404&&method==='GET')return null;
  if(!r.ok){const e=new Error(`CSV ${path}: ${j.message||r.status}`);e.githubConflict=r.status===409||r.status===422;throw e}
  return j;
 }catch(e){if(e.name==='AbortError')throw Error(`GitHub CSV ${path}: časový limit`);throw e}
 finally{clearTimeout(timer)}
}
async function readCsvMirror(){
 const [betsFile,predFile]=await Promise.all([remoteFile('vsazene_kombinace.csv'),remoteFile('euro_predikce.csv')]);
 const bets=betsFile?parseBets(decode(betsFile.content)):[];
 const predictions=predFile?parsePredictionsCSV(decode(predFile.content)):[];
 return {bets,predictions};
}
async function writeCsvMirror(){
 for(const [path,content] of [['vsazene_kombinace.csv',fmtBets()],['euro_predikce.csv',fmtPredictions()]]){
  for(let attempt=0;attempt<3;attempt++){
   const old=await remoteFile(path);
   if(old&&decode(old.content).replace(/\r\n/g,'\n').trim()===content.replace(/\r\n/g,'\n').trim())break;
   try{await remoteFile(path,'PUT',{message:`Eurojackpot AI: aktualizace ${path}`,content:encode(content),...(old?{sha:old.sha}:{})});break}
   catch(e){if(!e.githubConflict||attempt===2)throw e}
  }
 }
}
async function remote(method='GET',payload){if(method!=='GET'&&!config())throw Error('Pro zápis je potřeba přístupový token. Veřejné čtení funguje bez něj.');let path=cfg.path||'euro-data.json',url=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;let controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000),r;try{r=await nativeFetch(url,{method,signal:controller.signal,headers:{...(cfg.token?{Authorization:`Bearer ${cfg.token}`} : {}),Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})})}catch(e){if(e.name==='AbortError')throw Error('GitHub neodpověděl do 10 sekund; místní data zůstala zachována.');throw e}finally{clearTimeout(timeout)}let j=await r.json();if(!r.ok){if(r.status===404&&method==='GET')return null;if(r.status===409||r.status===422){const err=new Error('GitHub konflikt při souběžném zápisu.');err.githubConflict=true;throw err;}throw Error(j.message||`GitHub HTTP ${r.status}`)}return j}
function validateData(d){if(!d||!Array.isArray(d.history)||!Array.isArray(d.bets)||!Array.isArray(d.predictions))throw Error('Neplatný JSON společných dat')}
// Deletions are persisted as tombstones. A stale CSV or another browser's
// local cache must never resurrect a ticket removed from shared JSON.
const betKey=b=>date(b.Datum_sazky)+'|'+(valid(b.Kombinace)||parseNums(b.Kombinace)).join(',');
// Explicit restoration overrides old deletion markers only for the imported bets.
// Never reset deletion markers during ordinary background synchronization.
function restoreImportedBets(rows){
 const restored=rows.map((b,i)=>({...b,Poradi:b.Poradi||i+1,_savedAt:Date.now()+1000+i}));
 const removed={...(data.deletedBets||{})};
 for(const b of restored)delete removed[betKey(b)];
 data.deletedBets=removed;
 data.bets=restored;
}
function markDeleted(bets){
 const removed={...(data.deletedBets||{})},now=Date.now();
 for(const b of bets)removed[betKey(b)]=Math.max(Number(removed[betKey(b)])||0,now);
 data.deletedBets=removed;
}
function mergeShared(remoteData, localData){
 validateData(remoteData);validateData(localData);
 const deletedBets={...(remoteData.deletedBets||{})};
 for(const [key,stamp] of Object.entries(localData.deletedBets||{}))
  deletedBets[key]=Math.max(Number(deletedBets[key])||0,Number(stamp)||0);
 const bets=new Map();
 for(const b of remoteData.bets)bets.set(betKey(b),b);
 for(const b of localData.bets){
  const key=betKey(b),old=bets.get(key);
  if(!old||Number(b._savedAt||0)>=Number(old._savedAt||0))bets.set(key,b);
 }
 for(const [key,b] of bets){
  if((Number(deletedBets[key])||0)>=Number(b._savedAt||0))bets.delete(key);
 }
 const draws=new Map();
 for(const h of remoteData.history)draws.set(date(h.date),h);
 for(const h of localData.history)draws.set(date(h.date),h);
 const predictions=localData.predictions.length?localData.predictions:remoteData.predictions;
 return {...remoteData,...localData,deletedBets,bets:[...bets.values()],history:[...draws.values()].sort((a,b)=>a.date.localeCompare(b.date)),predictions};
}
function readOnlyMerge(d){
 validateData(d);
 // Public reading must never silently publish private bets.
 data=mergeShared(d,data);evaluate(true);localSave();storeEuroFinanceSnapshot();
 syncStatus('veřejná data načtena · osobní sázky zůstávají místní','ok');
}
async function pull(force=false){
 let j=await remote();if(!j){sha=null;return false}
 let d=JSON.parse(decode(j.content));validateData(d);
 try{const csvMirror=await readCsvMirror();d=mergeShared({...def(),bets:csvMirror.bets,predictions:csvMirror.predictions},d)}catch(e){console.warn('CSV záloha nebyla načtena:',e)}
 if(!config()){readOnlyMerge(d);sha=j.sha;return true}
 // A connected device must not lose bets recorded before the token was entered.
 const combined=mergeShared(d,data);
 const changed=JSON.stringify(combined)!==JSON.stringify(d);
 data=combined;sha=j.sha;evaluate(true);localSave();storeEuroFinanceSnapshot();
 dirty=changed;localStorage[changed?'setItem':'removeItem'](DIRTY,'1');
 syncStatus(changed?'sázky sloučeny · čekají na uložení':'data synchronizována','ok');
 if(changed)setTimeout(()=>autoSave().catch(e=>warn(e.message)),100);
 return true;
}
async function push(){
 if(!config())throw Error('Zápis vyžaduje GitHub token.');
 const startRevision=revision;
 // Optimistic concurrency: retry a race by reading the newest SHA and merging again.
 // A failed request never replaces localStorage or clears the dirty flag.
 for(let attempt=0;attempt<3;attempt++){
  const latest=await remote();
  const remoteData=latest?JSON.parse(decode(latest.content)):def();
  validateData(remoteData);
  const combined=mergeShared(remoteData,data);
  const snapshot=JSON.stringify(combined,null,2);
  if(latest&&JSON.stringify(remoteData)===JSON.stringify(combined)){
   data=mergeShared(combined,data);sha=latest.sha;
   await writeCsvMirror();
   if(revision===startRevision){dirty=false;localStorage.removeItem(DIRTY)}
   localSave();syncStatus('data synchronizována','ok');return;
  }
  try{
   const j=await remote('PUT',{message:'Eurojackpot AI: synchronizace sázek',content:encode(snapshot),...(latest?{sha:latest.sha}:{})});
   sha=j.content.sha;data=mergeShared(combined,data);evaluate(true);localSave();conflict=false;await writeCsvMirror();
   if(revision===startRevision){dirty=false;localStorage.removeItem(DIRTY);syncStatus('sázky bezpečně sloučeny a uloženy','ok')}
   else{dirty=true;localStorage.setItem(DIRTY,'1');clearTimeout(saveTimer);saveTimer=setTimeout(()=>autoSave().catch(e=>warn(e.message)),1400)}
   return;
  }catch(e){if(!e.githubConflict||attempt===2)throw e}
 }
}
async function autoSave(){
 if(!config()||saving||!dirty||conflict||!navigator.onLine)return;
 saving=true;syncStatus('slučuji a odesílám změny…');
 try{await push()}catch(e){if(e.githubConflict)syncStatus('souběžná změna na GitHubu · zkusím znovu','error');throw e}
 finally{saving=false}
}
async function periodicSync(){
 if(polling||!publicConfig()||!navigator.onLine)return;
 polling=true;syncStatus('kontroluji společná data…');
 try{
  if(dirty&&config()){if(!conflict)await autoSave();return}
  let latest=await remote();
  if(!latest)return;
  if(latest.sha===sha){syncStatus(config()?'data synchronizována':'veřejná data aktuální · sázky místní','ok');return;}
  // Nikdy nepřepisovat pracovní změny; stav se znovu kontroluje po síťovém požadavku.
  if(dirty&&config())return;
  let d=JSON.parse(decode(latest.content));validateData(d);
  try{const csvMirror=await readCsvMirror();d=mergeShared({...def(),bets:csvMirror.bets,predictions:csvMirror.predictions},d)}catch(e){console.warn('CSV záloha nebyla načtena:',e)}
  if(dirty&&config())return;
  // Keep newer public draw history fetched from GitHub CSV; shared JSON can lag.
  const publicHistory=data.history;
  if(!config()){readOnlyMerge(d);sha=latest.sha;return;}
  data=mergeShared(d,data);sha=latest.sha;
  mergeHistory(publicHistory);
  const evaluated=evaluate(true);
  localSave();storeEuroFinanceSnapshot();
  syncStatus(evaluated?'společná data načtena a sázky vyhodnoceny':'načteny změny z GitHubu','ok');
  if(typeof loadPredictions==='function')await loadPredictions();
  if(typeof loadStakedHistory==='function')await loadStakedHistory();
  if(typeof checkEvaluationStatus==='function')checkEvaluationStatus();
 }catch(e){warn('Synchronizace: '+e.message)}finally{polling=false}
}

function response(o,status=200){return Promise.resolve(new Response(JSON.stringify(o),{status,headers:{'Content-Type':'application/json'}}))}
async function handle(url,opt={}){await ready;let path='/app/'+String(url).split('/app/').pop().split(/[?#]/)[0],body=opt.body?JSON.parse(opt.body):{};try{let result={status:'ok'};switch(path){case '/app/update_prediction':{let i=Number(body.index),m=body.main,e=body.euro;if(!Number.isInteger(i)||i<0||i>=data.predictions.length||!Array.isArray(m)||!Array.isArray(e)||m.length>5||e.length>2||new Set(m).size!==m.length||new Set(e).size!==e.length||!m.every(n=>Number.isInteger(n)&&n>=1&&n<=50)||!e.every(n=>Number.isInteger(n)&&n>=1&&n<=12))throw Error('Neplatná úprava čísel.');data.predictions[i]=[...m.sort((a,b)=>a-b),...e.sort((a,b)=>a-b)];persist();result={status:'ok'};break}case '/app/get_latest_predictions':result={predictions:data.predictions};break;case '/app/get_staked_history':result={status:'ok',history:sortedBets().map(({Poradi,...b})=>b)};break;case '/app/get_staked_status':result={needs_evaluation:data.bets.some(b=>drawMap().has(date(b.Datum_sazky))&&(!b.Vyhodnoceni||b.Vyhodnoceni.toLowerCase()==='nevyhodnoceno'))?'True':'False'};break;case '/app/generate_new_predictions':{let s=smartGenerate();result={status:'ok',message:localStorage.getItem(EURO_DIAG_KEY)==='1'?`SMART: 6 kombinací (30/50 + 12/12). Hlavní: ${s.main.accepted?s.main.name:"bez prokázané výhody"}; euro: ${s.euro.accepted?s.euro.name:"bez prokázané výhody"}. Kontrola: ${s.main.tested} tahů.`:"SMART: Vygenerováno 6 kombinací (30/50 + 12/12)."};break}case '/app/save_staked':{
let d=date(body.date),lines=body.combinations||[];
if(!d||![2,5].includes(new Date(d+'T12:00:00').getDay())||!lines.length)throw Error('Vyber úterý nebo pátek a platné kombinace.');
// Kanonický klíč: hlavních 5 a Euro 2 se řadí zvlášť. Pořadí čísel nehraje roli.
const key=a=>valid(a)?.join(',');
const oldForDate=data.bets.filter(b=>date(b.Datum_sazky)===d);
const elsewhere=new Set(data.bets.filter(b=>date(b.Datum_sazky)!==d).map(b=>key(b.Kombinace)).filter(Boolean));
const current=new Set();let accepted=[],rejected=0;
for(let c of lines){let a=valid(c);if(!a)throw Error('Neplatná kombinace. Žádné sázky nebyly změněny.');let k=a.join(',');if(elsewhere.has(k)||current.has(k)){rejected++;continue}current.add(k);accepted.push(a)}
// Pokud byly všechny kombinace duplicitní, nesmažeme dřívější sázky daného dne.
if(!accepted.length){result={status:'ok',message:`Nic neuloženo: všech ${rejected} kombinací už bylo vsazeno nebo se opakují.`};break}
// Uložení pro stejné datum je nahrazení původních sloupců, jako v Rentě.
markDeleted(data.bets.filter(b=>date(b.Datum_sazky)===d));
data.bets=data.bets.filter(b=>date(b.Datum_sazky)!==d);
for(let [i,a] of accepted.entries())data.bets.push({Datum_sazky:d,Kombinace:a.join(','),Cena:String(body.amount||0),Vyhodnoceni:'Nevyhodnoceno',Shodna_cisla:'',Poradi:i+1,_savedAt:Date.now()+1});
persist();storeEuroFinanceSnapshot();result={status:'ok',message:`Uloženo ${accepted.length} sázek pro ${d}.`+(rejected?` Odmítnuto ${rejected} duplicitních kombinací.`:'')};break}
case '/app/evaluate_staked':{let n=evaluate();storeEuroFinanceSnapshot();result={status:'ok',message:n?`Vyhodnoceno ${n} sázek.`:'Žádné nové výsledky k vyhodnocení.'};break}case '/app/delete_staked':{let before=data.bets.length;markDeleted(data.bets.filter(b=>date(b.Datum_sazky)===date(body.date)));data.bets=data.bets.filter(b=>date(b.Datum_sazky)!==date(body.date));persist();storeEuroFinanceSnapshot();result={status:'ok',message:`Smazáno ${before-data.bets.length} sázek.`};break}case '/app/restore_staked_history':markDeleted(data.bets);data.bets=(body.history_data||[]).map((b,i)=>({...b,Poradi:b.Poradi||i+1,_savedAt:Date.now()+1}));persist();storeEuroFinanceSnapshot();result={status:'ok',message:'Historie obnovena.'};break;case '/app/smart_financial_audit':result={status:'ok',message:smartFinancialAudit()};break;case '/app/run_kontrola':{let wins=data.bets.filter(b=>String(b.Vyhodnoceni).startsWith('Výhra'));result={status:'ok',message:`Přehled: ${wins.length} výherních sázek z ${data.bets.length}.`};break}default:throw Error('Neznámá funkce '+path)}return response(result)}catch(e){return response({status:'error',message:e.message},400)}}
const ready=seed();window.fetch=(url,opt)=>String(url).includes('/app/')?handle(url,opt):nativeFetch(url,opt);
function download(name,content){let a=document.createElement('a'),blob=new Blob([content],{type:'text/plain;charset=utf-8'});a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
const fmtHistory=()=>['datum;rok;1;2;3;4;5;euro1;euro2',...data.history.slice().reverse().map(h=>[h.date.split('-').reverse().join('.'),h.date.slice(0,4),...h.numbers].join(';'))].join('\r\n')+'\r\n';
const fmtBets=()=>['datum;kombinace;euro;castka;metoda;vysledek;shoda_hlavni;shoda_euro',...sortedBets().map(b=>{let a=valid(b.Kombinace)||[];return [date(b.Datum_sazky).split('-').reverse().join('.'),a.slice(0,5).join(','),a.slice(5).join(','),b.Cena||0,b.Metoda||'Eurojackpot AI WEB',String(b.Vyhodnoceni||'').startsWith('Výhra')?'vyhra':String(b.Vyhodnoceni||'').toLowerCase()==='prohra'?'prohra':'',...(b.Shodna_cisla||'').split(' | ').concat(['','']).slice(0,2)].join(';')})].join('\r\n')+'\r\n';
function setup(){let sec=document.createElement('details');sec.className='section renta-settings';sec.innerHTML=`<summary style="cursor:pointer;color:#8bb7f0;font-weight:700">⚙ Nastavení · GitHub · import / export</summary><div class="section-header"><span class="section-title">Eurojackpot – synchronizace a data</span></div><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><input id="gh-owner" placeholder="GitHub uživatel" style="width:160px"><input id="gh-repo" placeholder="Repozitář" style="width:160px"><input id="gh-token" type="password" placeholder="GitHub token" style="width:220px"><button class="blue" id="gh-connect">Nastavit přístup</button><button class="blue" id="gh-pull">Načíst společnou</button><button class="green" id="gh-push">Uložit společnou</button><button class="red" id="gh-disconnect">Odpojit klíč</button></div><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:center"><label>Import historie <input id="import-history" type="file" accept=".csv"></label><label>Import sázek <input id="import-bets" type="file" accept=".csv"></label><button class="blue" id="export-history">Export historie CSV</button><button class="blue" id="export-bets">Export sázek CSV</button><button class="blue" id="export-predictions">Export predikcí CSV</button><button class="green" id="local-csv-folder">Připojit místní CSV složku</button><span id="euro-local-csv-status" style="font-size:12px;color:#8bb7f0">Místní CSV: nepřipojeno (po otevření WEB2 je nutné povolení znovu).</span><button class="blue" id="export-json">Záloha JSON</button><button class="blue" id="smart-audit">Bilance sázek</button><label style="display:flex;align-items:center;gap:6px;color:#8bb7f0;font-size:13px"><input type="checkbox" id="euro-smart-diagnostics"> Podrobný test SMART</label><label>Obnovit JSON <input id="import-json" type="file" accept=".json"></label></div><p style="font-size:12px;color:#8bb7f0">Společný JSON i oba CSV se čtou z GitHubu; při zápisu s tokenem se oba CSV aktualizují. Na novém zařízení se nejprve načte společná verze. Při rozdílech se sázky sloučí; souběžný zápis se bezpečně opakuje. Veřejná data se čtou bez tokenu. Token pro zápis zůstává pouze v aktuální kartě (sessionStorage); na veřejném zařízení jej nezadávej.</p><p id="euro-finance-auto-status" role="status" aria-live="polite" style="color:#8bb7f0;font-size:12px">Bilance se aktualizuje automaticky na pozadí.</p><p id="euro-sync-status" role="status" aria-live="polite" style="color:#8bb7f0;font-size:13px"></p><p id="renta-sync-warning" style="color:#ffbf69;font-size:13px"></p>`;document.querySelector('.content-sections')?.prepend(sec);document.getElementById('euro-smart-diagnostics').checked=localStorage.getItem(EURO_DIAG_KEY)==='1';document.getElementById('euro-smart-diagnostics').onchange=e=>localStorage.setItem(EURO_DIAG_KEY,e.target.checked?'1':'0');document.getElementById('smart-audit').onclick=async()=>{const btn=document.getElementById('smart-audit');btn.disabled=true;try{await refreshEuroFinanceAuto();showFinanceDialog(smartFinancialAudit())}finally{btn.disabled=false}};document.getElementById('gh-owner').value=cfg.owner||'';document.getElementById('gh-repo').value=cfg.repo||'';syncStatus(config()?(dirty?'místní změny čekají na synchronizaci':'čtení a zápis GitHub'):('veřejné čtení GitHub · zápis bez tokenu vypnutý'),'info');const notice=(m,t='success')=>typeof displayStatusMessage==='function'?displayStatusMessage(m,t):alert(m);const action=(id,fn)=>document.getElementById(id).onclick=async()=>{try{await fn()}catch(e){notice(e.message,'error')}};
action('gh-connect',async()=>{let owner=document.getElementById('gh-owner').value.trim(),repo=document.getElementById('gh-repo').value.trim(),entered=document.getElementById('gh-token').value.trim();cfg={owner,repo,token:entered||(owner===cfg.owner&&repo===cfg.repo?cfg.token:''),path:'euro-data.json'};if(!owner||!repo)throw Error('Vyplň GitHub uživatele a repozitář.');sessionStorage.setItem('euro_gh_token',cfg.token);syncStatus('připojuji se…');sha=null;conflict=false;if(dirty){notice('Přístup nastaven. Místní sázky budou bezpečně sloučeny s GitHubem.','success')}let ok=await pull();if(ok)location.reload();else notice('Přístup nastaven. Společný JSON zatím neexistuje.')});
action('gh-pull',async()=>{if(!confirm('Načíst a sloučit společná data z GitHubu bez smazání místních sázek?'))return;let ok=await pull(true);conflict=false;if(!ok)throw Error('euro-data.json neexistuje.');location.reload()});
action('gh-push',async()=>{if(sha===null){let latest=await remote();if(latest)throw Error('Společný JSON už existuje. Nejdříve načti společnou verzi.')}await push();notice('Společná data uložena.')});
action('gh-disconnect',async()=>{cfg={owner:'jerry00769',repo:'Eurojackpot',path:'euro-data.json'};sha=null;conflict=false;sessionStorage.removeItem('euro_gh_token');localStorage.removeItem(CFG);document.getElementById('gh-token').value='';syncStatus('odpojeno');notice('GitHub přístup odpojen.')});
for(let [id,parser,field] of [['import-history',parseHistory,'history'],['import-bets',parseBets,'bets']])document.getElementById(id).onchange=async e=>{try{let file=e.target.files[0];if(!file)return;let rows=parser(await file.text());if(confirm(`Nahradit ${field==='history'?'historii losování':'sázky'} (${rows.length} záznamů)?`)){if(field==='bets')restoreImportedBets(rows);else data[field]=rows;persist();location.reload()}}catch(err){notice(err.message,'error')}};
if(location.protocol==='http:' && location.hostname==='127.0.0.1' && location.port==='8765'){
 document.getElementById('local-csv-folder').style.display='none';
 localCsvStatus('Místní CSV: automatický zápis přes lokální server zapnut.');
}else if(location.protocol==='file:'){
 localCsvStatus('Místní CSV: pro automatický zápis spusť SPUSTIT_WEB2.cmd (neotvírej index.html přímo).');
}
action('local-csv-folder',selectLocalCsvDirectory);action('export-history',()=>download('eurojackpot.csv',fmtHistory()));action('export-bets',()=>download('vsazene_kombinace.csv',fmtBets()));action('export-predictions',()=>download('euro_predikce.csv',fmtPredictions()));action('export-json',()=>download('euro-zaloha.json',JSON.stringify(data,null,2)));document.getElementById('import-json').onchange=async e=>{try{let d=JSON.parse(await e.target.files[0].text());validateData(d);if(confirm('Přepsat místní data zálohou?')){data={...d,deletedBets:{...(data.deletedBets||{}),...(d.deletedBets||{})}};restoreImportedBets(d.bets);persist();location.reload()}}catch(err){notice(err.message,'error')}}}
document.addEventListener('DOMContentLoaded',async()=>{setup();await ready;try{let n=await refreshHistory();if(n)console.info('Nových tahů:',n)}catch(e){warn(e.message)}if(publicConfig()){try{let ok=await pull();if(ok){await refreshHistory().catch(()=>0);if(typeof loadPredictions==='function')loadPredictions();if(typeof loadStakedHistory==='function')loadStakedHistory()}}catch(e){warn(e.message)}}
 // Automatická bilance při spuštění bez nutnosti otevřít Nastavení.
 refreshEuroFinanceAuto();
 // Opakování po výpadku, včetně neodeslaných změn z předchozí relace.
 retryTimer=setInterval(()=>{if(publicConfig()&&navigator.onLine){
  if(dirty&&config()&&!conflict)autoSave().catch(e=>warn(e.message));else if(!dirty||!config())periodicSync();
  // GitHub Actions may publish a new draw/payout while the page stays open.
  // Refresh public data at most once every 15 minutes; do not modify bets.
  if(Date.now()-lastPublicDataRefresh>=15*60*1000){
   lastPublicDataRefresh=Date.now();
   refreshHistory().then(n=>{if(n)console.info('Nové tahy:',n)}).catch(e=>console.warn('Historie:',e));
   refreshEuroFinanceAuto().catch(e=>console.warn('Bilance:',e));
  }
 }},RETRY_MS);
 window.addEventListener('online',()=>{refreshEuroFinanceAuto();if(dirty&&!conflict)autoSave().catch(e=>warn(e.message));else periodicSync()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){periodicSync();refreshEuroFinanceAuto()}});
 if(dirty&&config()&&!conflict)autoSave().catch(e=>warn(e.message));
});
})();
