import {it,expect,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GameEngine} from '../server/game.js';
import {LocalStore} from '../server/store.js';
import {evidenceLedger} from '../server/evidence.js';
import {extractExperience,summarizeExperience} from '../server/learning.js';
import * as model from '../server/model.js';
import type {Settings} from '../server/types.js';
function setup(){const store=new LocalStore(mkdtempSync(join(tmpdir(),'wolf-debate-')));const engine=new GameEngine(store,{roleModels:{}} as Settings,undefined,store.worldAgents(),123);(engine as any).wait=async()=>{};return {store,engine};}
it('答辩填7号不执行目标动作；真实投票非法目标仍拒绝',()=>{
 const content=JSON.stringify({text:'我怀疑7号',target:7,confidence:.6,suspects:[]});
 expect(model.normalizeDecision(content,[12],true).text).toBe('我怀疑7号');
 expect(model.normalizeDecision(content,[12],true).target).toBe(12);
 expect(()=>model.normalizeDecision(content,[12])).toThrow('不合法');
 expect(model.normalizeDecision(content,[7,8,9]).target).toBe(7);
});
it('答辩显式传递非目标模式，狼队竞选协商只对狼可见',async()=>{
 const {store,engine}=setup();const original=model.decide;let flag=false;
 const spy=vi.spyOn(model,'decide').mockImplementation(async c=>{if(c.prompt.includes('答辩测试')){flag=c.nonTarget===true;return model.normalizeDecision(JSON.stringify({text:'怀疑7号',target:7}),c.candidates,c.nonTarget);}return original(c);});
 try{const p=engine.game.players[11];await (engine as any).decideFor(p,[p.seat],'答辩测试，target 填自己。');expect(flag).toBe(true);await (engine as any).sheriffElection();const es=store.events(engine.game.id);const plans=es.filter(e=>e.type==='狼队竞选协商');expect(plans).toHaveLength(2);expect(plans.every(e=>e.visibility==='wolves')).toBe(true);const villager=engine.game.players.find(p=>p.role==='村民')!;expect(JSON.stringify(evidenceLedger(es,villager,engine.game.id))).not.toContain('狼队竞选协商');expect(es.indexOf(plans[1])).toBeLessThan(es.findIndex(e=>e.type==='警长报名'));}
 finally{spy.mockRestore();store.close();}
});
it('账本保留旧票型、区分主张，拒绝其他局和其他人的秘密',()=>{
 const {store,engine}=setup();const p=engine.game.players.find(p=>p.role==='村民')!;
 const add=(type:string,visibility:any,payload:any,audience?:number[],gameId=engine.game.id)=>store.addEvent({gameId,phase:'第1日讨论',type,visibility,payload,audience});
 try{
  add('投票','public',{votes:[{seat:1,target:2}]});add('发言','public',{seat:2,text:'3号翻狼'});
  for(let i=0;i<40;i++)add('发言','public',{seat:1,text:'新记录'});
  add('狼人提案','wolves',{text:'WOLF_SECRET'},[p.seat]);add('验人','private',{text:'OTHER_CHECK'},[99]);add('发言','public',{text:'OTHER_GAME'},undefined,'elsewhere');
  const ledger=evidenceLedger(store.events(engine.game.id),p,engine.game.id);expect(ledger.facts[0].type).toBe('投票');expect(ledger.claims[0].status).toContain('未经');expect(JSON.stringify(ledger)).not.toMatch(/WOLF_SECRET|OTHER_CHECK|OTHER_GAME/);
 }finally{store.close();}
});
it('狼人最终表决看到全部本夜提案，非狼人不收到提案',async()=>{
 const {store,engine}=setup();const original=model.decide;const prompts:any[]=[];
 const spy=vi.spyOn(model,'decide').mockImplementation(async c=>{prompts.push(c);return original(c);});
 try{await (engine as any).night();const finals=prompts.filter(c=>c.prompt.includes('狼人最终表决：'));expect(finals).toHaveLength(4);for(const c of finals)expect(c.prompt).toContain('狼人提案:');for(const c of prompts.filter(c=>c.player.role!=='狼人'))expect(c.prompt).not.toContain('狼人提案:');expect(store.events(engine.game.id).filter(e=>e.type==='狼人提案'||e.type==='狼人密聊').every(e=>e.visibility==='wolves')).toBe(true);}
 finally{spy.mockRestore();store.close();}
});
it('所有竞选发言完成后才调用退水决定',async()=>{
 const {store,engine}=setup();const original=model.decide;let decisions=0;
 const spy=vi.spyOn(model,'decide').mockImplementation(async c=>{
  if(c.prompt.includes('所有竞选发言已经结束。')){decisions++;expect(store.events(engine.game.id).filter(e=>e.type==='发言')).toHaveLength(3);}
  return original(c);
 });
 try{await (engine as any).sheriffElection();expect(decisions).toBe(3);}finally{spy.mockRestore();store.close();}
});
it('白天只有一次轮流发言，无独立质询答辩，投票后才有出局遗言',async()=>{
 const {store,engine}=setup();const spy=vi.spyOn(model,'decide').mockImplementation(async c=>({text:`${c.player.seat}号发言`,target:c.candidates[0],confidence:.5,suspects:[],action:'skip'}));
 try{await (engine as any).dayDiscussion();const es=store.events(engine.game.id);expect(es.filter(e=>e.type==='发言')).toHaveLength(12);expect(es.some(e=>e.type==='质询'||e.type==='答辩')).toBe(false);expect(es.findIndex(e=>e.type==='投票')).toBeGreaterThan(es.map(e=>e.type).lastIndexOf('发言'));}
 finally{spy.mockRestore();store.close();}
});
it('个人误毒复盘只保留匿名计数，不保存夜间目标、原话或他人技能',()=>{
 const {store,engine}=setup();const witch=engine.game.players.find(p=>p.role==='女巫')!;const good=engine.game.players.find(p=>p.role==='守卫')!;
 try{engine.game.status='finished';engine.game.winner='狼人';store.addEvent({gameId:engine.game.id,phase:'夜',type:'女巫用药',visibility:'private',audience:[witch.seat],payload:{seat:witch.seat,target:good.seat,action:'毒药',text:'NIGHT_SECRET'}});
 const x=extractExperience(engine.game,store.events(engine.game.id),witch)!;expect(x.reviewCases).toContainEqual({kind:'自身毒药误伤好人',count:1,lesson:'skills'});expect(summarizeExperience(x)).not.toMatch(/NIGHT_SECRET|号/);expect(extractExperience(engine.game,store.events(engine.game.id),good)?.reviewCases).toEqual([]);
 }finally{store.close();}
});
it.each(['right_last','left_first'])('警长选择%s后每人只发言一次，前置玩家看不到后置未来发言',async action=>{
 const {store,engine}=setup();engine.game.sheriff=5;const speechCalls:any[]=[];
 const spy=vi.spyOn(model,'decide').mockImplementation(async c=>{
  if(c.prompt.includes('发表本轮唯一一次'))speechCalls.push(c);
  return {text:`独特发言标记_${c.player.seat}_END`,target:c.candidates[0],confidence:.5,suspects:[],action};
 });
 try{await (engine as any).dayDiscussion();const es=store.events(engine.game.id);const order=es.find(e=>e.type==='发言顺序')!.payload.order as number[];
 expect(action.endsWith('first')?order[0]:order.at(-1)).toBe(5);expect(es.filter(e=>e.type==='发言').map(e=>e.payload.seat)).toEqual(order);expect(new Set(order).size).toBe(12);
 expect(speechCalls[0].prompt).not.toContain(`独特发言标记_${order.at(-1)}_END`);expect(speechCalls.at(-1).prompt).toContain(`独特发言标记_${order[0]}_END`);
 }finally{spy.mockRestore();store.close();}
});
