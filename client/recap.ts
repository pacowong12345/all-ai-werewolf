import { escapeHtml as esc } from './event-view.js';
export interface RecapEvent {id:number;type:string;phase:string;visibility:string;payload:Record<string, any>}
export interface RecapRound { key:string; title:string; events:RecapEvent[] }
export function recapRounds(events:RecapEvent[], omniscient:boolean):RecapRound[] {
  const rounds=new Map<string,RecapRound>();
  for(const event of events) {
    if(!omniscient && event.visibility!=='public') continue;
    const day=event.phase.match(/第\s*(\d+)\s*[日天夜]/)?.[1];
    const key=day ?? (event.phase==='警长竞选'?'election':undefined);
    if(!key) continue;
    if(!rounds.has(key)) rounds.set(key,{key,title:key==='election'?'警长竞选':`第 ${key} 轮`,events:[]});
    rounds.get(key)!.events.push(event);
  }
  return [...rounds.values()];
}
const seat=(value:unknown)=>value===undefined||value===null?'未记录':`${esc(value)}号`;
function row(icon:string,label:string,value:string,tone='') {return `<div class="recap-action ${tone}"><span class="recap-icon" aria-hidden="true">${icon}</span><span class="recap-label">${label}</span><strong>${value}</strong></div>`;}
function ballot(event:RecapEvent) {
  const votes=Array.isArray(event.payload.votes)?event.payload.votes:[];
  const groups=new Map<number,{total:number;voters:string[]}>();
  for(const vote of votes) {
    if(typeof vote.target!=='number') continue;
    const group=groups.get(vote.target)??{total:0,voters:[]};
    const weight=typeof vote.weight==='number'?vote.weight:1;
    group.total+=weight;group.voters.push(`${seat(vote.seat)}${weight===1.5?' ★':''}`);groups.set(vote.target,group);
  }
  const ranked=[...groups].sort((a,b)=>b[1].total-a[1].total);
  const max=ranked[0]?.[1].total??1;
  return `<div class="recap-vote"><h4>${event.type==='警长投票'?'警长票型':'放逐票型'}</h4>${ranked.map(([target,g])=>`<div class="recap-vote-row"><b>${seat(target)}</b><span class="recap-bar"><span style="width:${Math.round(g.total/max*100)}%"></span></span><strong>${g.total}票</strong><small>← ${g.voters.join('、')}</small></div>`).join('') || '<p class="muted">旧记录未保存逐人票型</p>'}<p class="recap-verdict">${esc(event.payload.result??'结果尚未记录')}</p><small>★ 表示警长的 1.5 票</small></div>`;
}
function roundCard(round:RecapRound, omniscient:boolean) {
  const night:string[]=[], day:string[]=[];
  for(const e of round.events) {const p=e.payload;
    if(e.type==='发言顺序') day.push(row('↻','本轮发言顺序',esc(p.text)));
    if(e.type==='警长报名') day.push(row('★','上警 / 投票资格',esc(p.text)));
    if(e.type==='退水') day.push(row('☆','退水',seat(p.seat)));
    if(e.type==='夜晚死亡' && omniscient) night.push(row('×',`${seat(p.seat)}倒牌`,esc(p.cause),'danger'));
    if(e.type==='狼人密聊') {const target=p.target??(typeof p.text==='string'?p.text.match(/最终夜袭\s*(\d+)\s*号/)?.[1]:undefined);night.push(row('☾','狼人刀口',seat(target),'danger'));}
    if(e.type==='守卫行动') night.push(row('◇',`守卫 ${seat(p.seat)}`,`守护 → ${seat(p.target)}`));
    if(e.type==='验人') night.push(row('◎',`预言家 ${seat(p.seat)}`,`查验 → ${seat(p.target)} · ${esc(p.result)}`));
    if(e.type==='女巫用药') night.push(row('⚗',`女巫 ${seat(p.seat)}`,`${esc(p.action)} → ${seat(p.target)}`));
    if(e.type==='猎人开枪') day.push(row('➶',`猎人 ${seat(p.seat)}`,`开枪 → ${seat(p.target)}`,'danger'));
    if(e.type==='警长') day.push(row('★','警长当选',seat(p.seat)));
    if(e.type==='警徽移交') day.push(row('★','警徽移交',`${seat(p.from)} → ${seat(p.to)}`));
    if(e.type==='撕毁警徽') day.push(row('☆','撕毁警徽',seat(p.seat)));
    if(e.type==='投票'||e.type==='警长投票') day.push(ballot(e));
  }
  const dawn=round.events.find(e=>e.type==='天亮公告');
  const deaths=round.events.filter(e=>e.type==='夜晚死亡').map(e=>e.payload.seat);
  const legacyDawn=round.events.find(e=>e.type==='阶段' && typeof e.payload.detail==='string' && /昨夜/.test(e.payload.detail));
  const result=dawn?.payload.text ?? (deaths.length?`昨夜 ${[...new Set(deaths)].map(seat).join('、')} 倒牌` : legacyDawn?.payload.detail);
  if(result) night.push(row('↳','夜晚结果',esc(result),'result'));
  const isElection=round.key==='election';
  return `<article class="recap-round"><h3>${esc(round.title)}</h3><div class="recap-columns">${isElection?'':`<section><h4>☾ 夜晚行动</h4>${!omniscient?'<p class="recap-lock">夜间目标与神职技能已隐藏，切换上方「全知观战」查看。</p>':''}${night.join('')||'<p class="muted">等待夜晚记录</p>'}</section>`}<section><h4>${isElection?'★ 竞选结果':'☀ 公开结算'}</h4>${day.join('')||'<p class="muted">尚无投票或公开技能记录</p>'}</section></div></article>`;
}
export function renderRecap(events:RecapEvent[],omniscient:boolean,selection='all') {
  const rounds=recapRounds(events,omniscient);
  const selected=rounds.some(r=>r.key===selection)?selection:'all';
  return `<section class="recap-panel" aria-label="结果回放"><header><div><span class="eyebrow">逐轮看结果</span><h2>结果回放</h2></div><span class="recap-mode">${omniscient?'全知回放':'无剧透回放'}</span></header><p class="recap-help">狼刀、技能与票型一眼查看。刀口不等于死亡；放逐投票发生在白天。仅汇总实际记录，不重新调用模型。</p><nav class="recap-nav" aria-label="选择回合"><button data-round="all" aria-pressed="${selected==='all'}">全部</button>${rounds.map(r=>`<button data-round="${esc(r.key)}" aria-pressed="${selected===r.key}">${esc(r.title)}</button>`).join('')}</nav>${rounds.filter(r=>selected==='all'||r.key===selected).map(r=>roundCard(r,omniscient)).join('')||'<p class="muted">本局尚未产生回放记录。</p>'}</section>`;
}
