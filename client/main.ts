// @ts-nocheck
import "./style.css";
import "./learning.css";
import "./wolf-chat.css";
import { renderWolfChat, escapeHtml } from "./event-view";
import { applyGameEvent } from "./game-events";
import { renderRecap } from "./recap";
import "./recap.css";
import { RULES, RULE_VERSION } from '../server/rules';
function rulesPanel(rules=RULES, version=RULE_VERSION) { return `<details class="recap-panel"><summary>本局规则 · ${escapeHtml(version)}</summary><ul>${rules.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul></details>`; }
let recapSelection='all', gameView='recap';
const remoteDemo=window.__REMOTE_DEMO__===true;
const remoteHeaders=()=>remoteDemo?{'X-Remote-Action':'1'}:{};
function mountRecap() {
 const main=document.querySelector('main.game'); if(!main)return;
 main.setAttribute('data-view',gameView);
 const board=main.querySelector('.board')!;
 const speaking=events.filter(e=>e.type==='发言顺序').at(-1);
 if(speaking) board.insertAdjacentHTML('beforebegin',`<p class="recap-verdict">${escapeHtml(speaking.phase)} · ${escapeHtml(speaking.payload.text)}</p>`);
 main.querySelector('header h1')?.insertAdjacentHTML('afterend',`<p class="eyebrow" title="${escapeHtml(game.id)}">局号 #${escapeHtml(game.id.slice(0,8).toUpperCase())}</p>`);
 board.insertAdjacentHTML('beforebegin',game.rules ? rulesPanel(game.rules,game.ruleVersion) : '<p class="muted">旧版对局：保留原规则与历史结算，不套用新版屠边规则。</p>');
 if(game.winReason) board.insertAdjacentHTML('beforebegin',`<p class="recap-verdict">胜负原因：${escapeHtml(game.winReason)}</p>`);
 board.insertAdjacentHTML('beforebegin',`<div class="recap-view-tabs"><button id="view-recap" class="${gameView==='recap'?'primary':'ghost'}">结果回放</button><button id="view-discussion" class="${gameView==='discussion'?'primary':'ghost'}">完整发言</button></div>${renderRecap(events,omniscient,recapSelection)}`);
 document.querySelector('#view-recap')!.addEventListener('click',()=>{gameView='recap';renderGame();});
 document.querySelector('#view-discussion')!.addEventListener('click',()=>{gameView='discussion';renderGame();});
 main.querySelectorAll<HTMLButtonElement>('[data-round]').forEach(button=>button.addEventListener('click',()=>{recapSelection=button.dataset.round!;renderGame();}));
}

const learningEscape = escapeHtml;
async function renderLearning() {
  stream?.close();
  app.innerHTML = '<main><p>正在读取个人经验库…</p></main>';
  try {
    const agents = await api<any[]>('/api/learning');
    app.innerHTML = `<main><header><button id="learning-back" class="ghost">← 返回</button><h1>个人经验库</h1></header><p class="learning-intro">每局无论胜败都会积累经验。按当前身份与任务检索相关经验，供 AI 判断参考。这里显示公开票型统计与改进原则；“模型复盘”表示人物模型已选定改进重点，“统计提炼”表示来自可验证战绩。经验不等于事实，不保证胜率持续提高。</p><section class="learning-grid">${agents.map(agent => `<article class="learning-card"><h2>${learningEscape(agent.name)}</h2><small>${agent.experiences.length} 份经验 · ${agent.experiences.filter(x=>x.reviewed).length} 份模型复盘</small>${agent.experiences.length ? agent.experiences.slice(0,3).map(x=>`<p>${learningEscape(x.summary)}</p><small>${x.reviewed?'模型复盘':'统计提炼'} · 来源对局 ${learningEscape(x.gameId.slice(0,8))} · ${x.sourceEventIds.length} 条公开票型</small>`).join('') : '<p>尚无已结束对局经验，参赛后自动积累。</p>'}</article>`).join('')}</section></main>`;
    document.querySelector('#learning-back')!.addEventListener('click',renderHome);
  } catch { app.innerHTML='<main><p>经验库读取失败，请刷新重试。</p><button id="learning-back">返回</button></main>'; document.querySelector('#learning-back')!.addEventListener('click',renderHome); }
}
new MutationObserver(() => {
  const header = document.querySelector('main.home header');
  if (header && !header.querySelector('#learning-link')) {
    header.closest('main').querySelector('.hero').insertAdjacentHTML('afterend',rulesPanel());
    const button = document.createElement('button'); button.id='learning-link'; button.className='ghost'; button.textContent='个人经验库'; button.onclick=()=>void renderLearning(); header.append(button);
  }
}).observe(document.documentElement,{childList:true,subtree:true});

type Event = { id:number; type:string; phase:string; payload:Record<string, unknown>; visibility:string; createdAt:string };
type Game = { id:string; day:number; phase:string; status:string; sheriff?:number; winner?:string; speed:number; players:Array<{seat:number; role:string; alive:boolean; persona:{name:string}}> };
let game: Game | null = null, events: Event[] = [], omniscient = false, stream: EventSource | null = null;
const api = async <T>(url:string, init?:RequestInit) => { const r = await fetch(url, {...init,headers:{...remoteHeaders(),...init?.headers}}); if (!r.ok) {const body=await r.json().catch(()=>({}));throw new Error(body.error??'服务请求失败');} return r.json() as Promise<T>; };
const app = document.querySelector<HTMLDivElement>("#app")!;
if(remoteDemo){
 const style=document.createElement('style');style.textContent='#settings,#agent-form>.primary{display:none!important}';document.head.append(style);
 const banner=document.createElement('p');banner.className='recap-verdict';banner.textContent='平板远程展示 · 约2.5秒更新 · 配置仅能在电脑修改 · 新开局可能产生API费用';document.body.prepend(banner);
}

function renderHome() { app.innerHTML = `<main class="home"><header><span class="moon">☾</span><div><h1>月下议会</h1><p>12 人 AI 狼人杀观战台</p></div><button id="settings" class="ghost">模型设置</button></header><section class="hero"><div><span class="eyebrow">标准 12 人玩家版型</span><h2>让 12 个独立人格，在谎言与推理中彼此博弈。</h2><p>4 狼人 · 预言家 · 女巫 · 猎人 · 守卫 · 4 村民</p><button id="start" class="primary">开始本局</button><small>默认使用离线演示模型；可在设置中接入 API。</small></div><aside><h3>本局规则</h3><ul><li>警长竞选与 1.5 票</li><li>遗言、狼人夜间密聊</li><li>守卫不可连守；女巫不可自救</li><li>无剧透与全知观战可切换</li></ul></aside></section><section id="history"><h3>历史对局</h3><div class="muted">正在读取记录…</div></section></main>`; document.querySelector("#start")!.addEventListener("click", start); document.querySelector("#settings")!.addEventListener("click", renderSettings); void loadHistory(); }
async function loadHistory() { const items = await api<Game[]>("/api/games"); const el = document.querySelector("#history"); if(!el)return; el.innerHTML = `<h3>历史对局</h3>${items.length ? items.map(x => `<button class="history" data-id="${x.id}" title="${escapeHtml(x.id)}"><b>局号 #${x.id.slice(0,8).toUpperCase()}</b><span>${x.winner ? `${x.winner}胜利` : x.status} · 第${x.day}天</span></button>`).join("") : "<div class=\"muted\">暂无已保存对局</div>"}`; el.querySelectorAll<HTMLButtonElement>("[data-id]").forEach(b => b.addEventListener("click", () => void openGame(b.dataset.id!))); }
let starting=false;
async function start() { if(starting)return; if(remoteDemo&&!confirm('开始真实对局会使用电脑上配置的模型，可能产生API费用。每次启动远程入口最多开3局，此限制不是费用预算。确定开始？'))return; starting=true; try { game = await api<Game>("/api/games", {method:"POST"}); events=[]; renderGame(); connect(); } catch(error) {alert(error.message??'开局失败，请检查本地服务。');} finally {starting=false;} }
async function openGame(id:string) { stream?.close(); if(game?.id!==id)recapSelection='all'; game=await api<Game>(`/api/games/${id}`); events=await api<Event[]>(`/api/games/${id}/events?mode=${omniscient?"omniscient":"public"}`); renderGame(); if (game.status === "running") connect(); }
function connect() {
 stream?.close(); if (!game) return;
 if(remoteDemo){
  const id=game.id,mode=omniscient?'omniscient':'public';let closed=false,timer;
  const subscription={close(){closed=true;clearTimeout(timer);}};stream=subscription;
  const poll=async()=>{
   try{
    const incoming=await api<Event[]>(`/api/games/${id}/events?mode=${mode}&after=${events.at(-1)?.id??0}`);
    if(closed||stream!==subscription||game?.id!==id)return;
    const seen=new Set(events.map(e=>e.id));
    for(const event of incoming)if(!seen.has(event.id)){seen.add(event.id);events.push(event);game=applyGameEvent(game,event);}
    if(incoming.length)renderGame();
   }catch{if(!closed){const status=document.querySelector('.status');if(status)status.textContent='连接暂时中断，正在重试…';}}
   finally{if(!closed&&game?.status!=='finished')timer=setTimeout(poll,2500);}
  };void poll();return;
 }
 const id=game.id, seen=new Set(events.map(e=>e.id));
 const after=events.at(-1)?.id??0;
 const source=new EventSource(`/api/games/${id}/stream?mode=${omniscient?"omniscient":"public"}&after=${after}`); stream=source;
 let pending=false;
 source.onmessage=e=>{
   if(stream!==source||game?.id!==id)return;
   const event=JSON.parse(e.data) as Event;
   if(seen.has(event.id))return;
   seen.add(event.id);events.push(event);game=applyGameEvent(game,event);
   if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;if(stream===source&&document.querySelector('main.game'))renderGame();});}
 };
}
function details(e:Event) {
 const p=e.payload;
 if(e.type==="公开状态") return `第${escapeHtml(p.day)}天 · ${escapeHtml(p.status)} · ${p.sheriff ? `警长 ${escapeHtml(p.sheriff)}号` : "无警长"}`;
 if(e.type==="天亮公告") return escapeHtml(p.text);
 if(e.type==="猎人开枪") return `${escapeHtml(p.seat)}号猎人开枪，带走${escapeHtml(p.target)}号。`;
 if(e.type==="狼人密聊"||e.type==="狼人提案"||e.type==="狼队竞选协商") return renderWolfChat(p);
 if(e.type==="发言"||e.type==="遗言"||e.type==="质询"||e.type==="答辩") return `<b>${escapeHtml(p.seat)}号${e.type==='质询'?` → ${escapeHtml(p.target)}号`:''}</b> ${escapeHtml(p.text)}`;
 if(e.type==="投票"||e.type==="警长投票") { const votes = Array.isArray(p.votes) ? p.votes.map((vote:any) => `${escapeHtml(vote.seat)}号 → ${escapeHtml(vote.target ?? "弃权")}号${vote.weight === 1.5 ? "（警长1.5票）" : ""}`).join("<br>") : "票型记录不可用"; return `<b>${escapeHtml(p.result)}</b><br><span style="display:block;margin-top:8px;color:#c9c4df;line-height:1.7">${votes}</span>`; }
 if(e.type==="阶段") return `<b>${escapeHtml(p.title)}</b><br><span>${escapeHtml(p.detail)}</span>`;
 if(e.type==="结局"||e.type==="结局公告") return `<b class="win">${escapeHtml(p.winner)}阵营胜利</b><br><span>${escapeHtml(p.text ?? "可切换全知模式查看身份揭示。")}</span>`;
 return Object.entries(p).map(([k,v])=>`${escapeHtml(k)}: ${escapeHtml(typeof v === "object" ? JSON.stringify(v) : v)}`).join(" · ");
}
function renderGame() { if(!game) return; const visibleEvents = events.slice(-80).reverse(); app.innerHTML = `<main class="game"><header><button id="back" class="ghost">← 返回</button><div><span class="eyebrow">${game.phase}</span><h1>${game.winner ? `${game.winner}阵营胜利` : "游戏进行中"}</h1></div><label class="toggle"><input id="mode" type="checkbox" ${omniscient?"checked":""}/> 全知观战</label></header><section class="controls"><button id="play" class="primary">${game.status === "running" ? "暂停" : "继续"}</button><button id="step" class="ghost">单步</button><label>速度 <select id="speed">${[0.5,1,2,3,5].map(s=>`<option ${game!.speed===s?"selected":""}>${s}</option>`).join("")}</select>×</label><span class="status">${game.status}${game.sheriff?` · 警长 ${game.sheriff} 号`:" · 本局无警长"}</span></section><section class="board"><div class="seats">${game.players.map(p=>`<article class="seat ${p.alive?"":"dead"} ${p.seat===game!.sheriff?"sheriff-seat":""} ${omniscient?"reveal":""}"><b>${p.seat}号 ${p.seat===game!.sheriff?"<strong class=badge>警长</strong>":""}</b><span>${p.persona.name}</span>${omniscient?`<em>${p.role}</em>`:""}<i>${p.alive?"存活":"出局"}</i></article>`).join("")}</div><div class="feed"><h2>对局实录 <span>${omniscient?"全知":"无剧透"}</span></h2>${visibleEvents.length?visibleEvents.map(e=>`<article class="event ${e.type}"><small>${e.phase} · ${e.type}</small><p>${details(e)}</p></article>`).join(""):"<p class=muted>等待主持人推进流程…</p>"}</div></section></main>`;
 mountRecap();
 if(game.status==='error') {
   document.querySelector('#play')!.textContent='重试失败行动';
   (document.querySelector('#step') as HTMLButtonElement).disabled=true;
   const notice=document.createElement('p'); notice.className='recap-verdict';
   notice.textContent='行动校验失败：全知模式可查看具体原因。重试不会代选目标或重做已完成行动；旧版本或服务重启后的记录不能续跑。';
   document.querySelector('.controls')!.after(notice);
 }
 document.querySelector("#back")!.addEventListener("click",()=>{stream?.close();renderHome();}); document.querySelector("#mode")!.addEventListener("change", e=>{omniscient=(e.target as HTMLInputElement).checked; if(game) void openGame(game.id);}); document.querySelector("#play")!.addEventListener("click",()=>void control(game!.status==="running"?"pause":"play")); document.querySelector("#step")!.addEventListener("click",()=>void control("step")); document.querySelector("#speed")!.addEventListener("change",e=>void control("speed", Number((e.target as HTMLSelectElement).value))); }
async function control(action:string,speed?:number) { if(!game)return; try { const response=await fetch(`/api/games/${game.id}/control`,{method:"POST",headers:{"Content-Type":"application/json",...remoteHeaders()},body:JSON.stringify({action,speed})}); const body=await response.json(); if(!response.ok)throw new Error(body.error??'控制失败'); game=body; renderGame(); if(action==='play'||action==='step')connect(); } catch(error) { alert(error instanceof Error?error.message:'控制失败'); } }
function renderWorld() { void api<{season:{name:string};guilds:Array<{id:string;name:string;motto:string;score:number;color:string}>;agents:Array<{id:string;name:string;guildId:string;elo:number;reputation:number;games:number;wins:number;titles:string[]}>;chronicles:Array<{title:string;summary:string;highlights:string[]}>}>("/api/world").then(world => {
  app.innerHTML = `<main class="world"><header><button id="back" class="ghost">← 返回</button><div><span class="eyebrow">${world.season.name}</span><h1>月下议会 · 势力档案</h1></div></header><section class="guilds">${world.guilds.map(g=>`<article style="--guild:${g.color}"><b>${g.name}</b><span>${g.motto}</span><em>议席 ${g.score}</em></article>`).join("")}</section><section class="world-grid"><div><h2>议会榜</h2><table><thead><tr><th>排名</th><th>行者</th><th>公会</th><th>Elo</th><th>胜率</th></tr></thead><tbody>${world.agents.slice(0,18).map((a,i)=>`<tr data-agent="${a.id}"><td>${i+1}</td><td>${a.name}${a.titles.length?` · ${a.titles[0]}`:""}</td><td>${world.guilds.find(g=>g.id===a.guildId)?.name}</td><td>${a.elo}</td><td>${a.games?Math.round(a.wins/a.games*100):0}%</td></tr>`).join("")}</tbody></table></div><div><h2>审判编年</h2>${world.chronicles.length?world.chronicles.slice(0,6).map(c=>`<article class="chronicle"><b>${c.title}</b><p>${c.summary}</p><small>${c.highlights.join(" · ")}</small></article>`).join(""):"<p class=muted>首场审判结束后，这里将留下不泄密的章节战报。</p>"}</div></section></main>`;
  document.querySelector("#back")!.addEventListener("click", renderHome); document.querySelectorAll<HTMLElement>("[data-agent]").forEach(row=>row.addEventListener("click",()=>void showAgent(row.dataset.agent!)));
 }); }
function showAgent(id:string) { void api<{agent:{id:string;name:string;biography:string;elo:number;reputation:number;titles:string[];persona:{name:string;style:string;risk:string;trust:string;bluff:string};strategy:{risk:number;trust:number;initiative:number;deception:number}};memories:string[]}>(`/api/world/agents/${id}`).then(({agent,memories})=>{ app.innerHTML=`<main class="settings"><button id="back" class="ghost">← 返回世界</button><h1>${escapeHtml(agent.name)} · 人物档案</h1><p>Elo ${agent.elo} · 声望 ${agent.reputation} · ${agent.titles.join("、")||"暂无称号"}</p><form id="agent-form"><div class="model-grid"><label>角色名<input name="name" value="${escapeHtml(agent.name)}"/></label><label>人物称号<input name="personaName" value="${escapeHtml(agent.persona.name)}"/></label><label>风险偏好<input name="risk" value="${escapeHtml(agent.persona.risk)}"/></label><label>信任方式<input name="trust" value="${escapeHtml(agent.persona.trust)}"/></label><label>诈唬风格<input name="bluff" value="${escapeHtml(agent.persona.bluff)}"/></label><label>表达风格<input name="style" value="${escapeHtml(agent.persona.style)}"/></label><label>策略风险 (0.1–0.9)<input name="strategyRisk" type="number" min="0.1" max="0.9" step="0.05" value="${agent.strategy.risk}"/></label><label>策略信任 (0.1–0.9)<input name="strategyTrust" type="number" min="0.1" max="0.9" step="0.05" value="${agent.strategy.trust}"/></label><label>发言主动性<input name="initiative" type="number" min="0.1" max="0.9" step="0.05" value="${agent.strategy.initiative}"/></label></div><label>公开履历<textarea class="form-text" name="biography">${escapeHtml(agent.biography)}</textarea></label><p class="muted">安全长期记忆：${memories.join("；")||"尚未参与审判"}</p><button class="primary">保存人物设定</button></form></main>`; document.querySelector("#back")!.addEventListener("click",renderWorld); document.querySelector("#agent-form")!.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target as HTMLFormElement);await api(`/api/world/agents/${agent.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:f.get("name"),biography:f.get("biography"),persona:{name:f.get("personaName"),style:f.get("style"),risk:f.get("risk"),trust:f.get("trust"),bluff:f.get("bluff")},strategy:{risk:Number(f.get("strategyRisk")),trust:Number(f.get("strategyTrust")),initiative:Number(f.get("initiative")),deception:agent.strategy.deception}})});renderWorld();}); }); }
new MutationObserver(() => { const header = document.querySelector(".home header"); if (header && !header.querySelector("[data-world]")) { const button = document.createElement("button"); button.dataset.world = "true"; button.className = "ghost"; button.textContent = "世界档案"; button.addEventListener("click", renderWorld); header.append(button); } }).observe(app, { childList: true, subtree: true });
renderHome();

function editProfile(agentId:string) { void Promise.all([api<{agent:{name:string;persona:{name:string}}}>(`/api/world/agents/${agentId}`),api<Array<{id:string;name:string;hint:string}>>("/api/providers"),api<Array<{agentId:string;provider:string;model:string;baseUrl?:string;enabled:boolean;timeoutMs:number;maxRetries:number;costLimit:number}>>("/api/agent-model-profiles")]).then(([detail,providers,profiles])=>{const current=profiles.find(p=>p.agentId===agentId)??{provider:"mock",model:"offline-demo",enabled:true,timeoutMs:30000,maxRetries:2,costLimit:0}; app.innerHTML=`<main class="settings"><button id="back" class="ghost">← 返回模型档案</button><h1>${escapeHtml(detail.agent.name)} · ${escapeHtml(detail.agent.persona.name)}</h1><p>此模型档案只属于该人物；本局身份变化不会改变模型。</p><form id="profile-form"><div class="model-grid"><label>供应商<select name="provider">${providers.map(p=>`<option value="${p.id}" ${p.id===current.provider?"selected":""}>${p.name}</option>`).join("")}</select></label><label>模型名<input name="model" value="${escapeHtml(current.model)}"/></label><label>自定义 API 地址<input name="baseUrl" value="${escapeHtml(current.baseUrl??"")}"/></label><label>API Key<input name="apiKey" type="password" placeholder="留空则保留已有密钥"/></label><label>超时毫秒<input name="timeoutMs" type="number" value="${current.timeoutMs}"/></label><label>重试次数<input name="maxRetries" type="number" value="${current.maxRetries}"/></label><label>费用上限（尚未执行，请勿依赖）<input name="costLimit" type="number" disabled step="0.01" value="${current.costLimit}"/></label></div><label class="form-check"><input class="form-check-input" name="enabled" type="checkbox" ${current.enabled?"checked":""}/> 启用此人物模型</label><button class="primary">保存人物模型</button><button id="test" type="button" class="ghost">测试配置</button></form></main>`; document.querySelector("#back")!.addEventListener("click",renderProfiles); document.querySelector("#profile-form")!.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target as HTMLFormElement);const body={provider:f.get("provider"),model:f.get("model"),baseUrl:f.get("baseUrl")||undefined,apiKey:f.get("apiKey")||undefined,enabled:f.get("enabled")=== "on",timeoutMs:Number(f.get("timeoutMs")),maxRetries:Number(f.get("maxRetries")),costLimit:Number(f.get("costLimit"))};await api(`/api/agent-model-profiles/${agentId}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});renderProfiles();}); document.querySelector("#test")!.addEventListener("click",async()=>{const r=await api<{message:string}>(`/api/agent-model-profiles/${agentId}/test`,{method:"POST"});alert(r.message);});}); }

function renderSettings() { renderProfiles(); }
function renderProfiles() { void Promise.all([api<any>("/api/world"), api<any>("/api/agent-model-profiles")]).then(([world, profiles]) => {
  const profileByAgent = new Map(profiles.map(profile => [profile.agentId, profile]));
  app.innerHTML = `<main class="profiles-page"><style>.profiles-page{max-width:1240px}.profiles-head{display:flex;align-items:flex-start;gap:16px;margin-bottom:26px}.profiles-head>div{flex:1}.profiles-head h1{margin:5px 0 7px}.profiles-summary{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.profiles-summary span{background:#22243a;border:1px solid #41435c;border-radius:999px;padding:7px 11px;color:#c9c8d3;font-size:13px}.profiles-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:22px}.profiles-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.profile-card{background:#1a1c2c;border:1px solid #363951;border-radius:14px;padding:15px;display:flex;flex-direction:column;gap:11px;min-height:170px}.profile-card:hover{border-color:#d6aa48}.profile-card-top{display:flex;justify-content:space-between;gap:8px}.profile-card h3{font-size:18px;margin:0}.profile-card p{font-size:13px;color:#aaa;margin:3px 0 0}.profile-meta{display:grid;gap:5px;font-size:12px;color:#c8c7d0}.profile-meta b{color:#efcf82;font-weight:500}.profile-chip{align-self:flex-start;border-radius:999px;padding:4px 8px;font-size:11px;background:#263a30;color:#9ed1aa}.profile-chip.demo{background:#303044;color:#c9c8db}.profile-card button{margin-top:auto;align-self:flex-start}.profile-tools{background:#191b2a;border:1px solid #363951;border-radius:14px;padding:18px;height:max-content}.profile-tools h2{font-size:18px;margin:0 0 8px}.profile-tools p{font-size:13px;color:#aaa;line-height:1.55}.profile-tools textarea{width:100%;min-height:140px;background:#111321;color:#eee;border:1px solid #41435c;border-radius:8px;padding:9px;margin:12px 0;font-family:ui-monospace,monospace;font-size:12px}.profile-tools .ghost,.profile-tools .primary{width:100%;margin-top:8px}@media(max-width:800px){.profiles-layout{grid-template-columns:1fr}.profiles-grid{grid-template-columns:1fr}}</style><header class="profiles-head"><button id="back" class="ghost">← 返回</button><div><span class="eyebrow">36 位常驻 AI</span><h1>人物模型档案</h1><p class="muted">每个人物拥有独立模型；随机身份不会改变它的 API。</p></div></header><section class="profiles-summary"><span>36 位常驻人物</span><span>${profiles.filter(p=>p.enabled).length} 个已启用档案</span><span>${profiles.filter(p=>p.apiKey).length} 个已配置密钥</span></section><section class="profiles-layout"><div class="profiles-grid">${world.agents.map(agent=>{const profile=profileByAgent.get(agent.id);const ready=Boolean(profile?.apiKey);return `<article class="profile-card"><div class="profile-card-top"><div><h3>${escapeHtml(agent.name)}</h3><p>${escapeHtml(agent.persona.name)}</p></div><span class="profile-chip ${ready?"":"demo"}">${ready?"已配置":"演示模型"}</span></div><div class="profile-meta"><span>供应商 <b>${escapeHtml(profile?.provider??"mock")}</b></span><span>模型 <b>${escapeHtml(profile?.model??"offline-demo")}</b></span></div><button class="ghost" data-profile="${agent.id}">配置模型</button></article>`}).join("")}</div><aside class="profile-tools"><h2>批量配置</h2><p>导出安全 JSON 模板，填写后再导入。导出不会包含 API Key。</p><button id="export" class="ghost">复制安全 JSON</button><textarea id="profile-import" placeholder='粘贴 {"profiles":[...]}'></textarea><button id="import" class="primary">导入档案</button></aside></section></main>`;
  document.querySelector("#back")!.addEventListener("click", renderHome); document.querySelectorAll<HTMLElement>("[data-profile]").forEach(card => card.addEventListener("click", () => void editProfile(card.dataset.profile!)));
  document.querySelector("#export")!.addEventListener("click", async () => { const data = await api("/api/agent-model-profiles/export"); await navigator.clipboard.writeText(JSON.stringify({ profiles: data }, null, 2)); alert("安全 JSON 已复制，不含 API Key。"); });
  document.querySelector("#import")!.addEventListener("click", async () => { try { const payload = JSON.parse((document.querySelector("#profile-import") as HTMLTextAreaElement).value); await api("/api/agent-model-profiles/import", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) }); renderProfiles(); } catch { alert("导入格式无效。"); } });
 }); }
