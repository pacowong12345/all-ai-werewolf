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
it('质询先统一发布，被质询者集中答辩，不为每个问题重复调用',async()=>{
 const {store,engine}=setup();const spy=vi.spyOn(model,'decide').mockImplementation(async c=>({text:c.prompt.includes('答辩轮：')?'集中回答':'请解释你的票型',target:c.candidates[0],confidence:.5,suspects:[],action:'ask'}));
 try{await (engine as any).debate();const es=store.events(engine.game.id);expect(es.filter(e=>e.type==='质询')).toHaveLength(12);expect(es.filter(e=>e.type==='答辩')).toHaveLength(2);expect(es.findIndex(e=>e.type==='答辩')).toBeGreaterThan(es.map(e=>e.type).lastIndexOf('质询'));}
 finally{spy.mockRestore();store.close();}
});
it('个人误毒复盘只保留匿名计数，不保存夜间目标、原话或他人技能',()=>{
 const {store,engine}=setup();const witch=engine.game.players.find(p=>p.role==='女巫')!;const good=engine.game.players.find(p=>p.role==='守卫')!;
 try{engine.game.status='finished';engine.game.winner='狼人';store.addEvent({gameId:engine.game.id,phase:'夜',type:'女巫用药',visibility:'private',audience:[witch.seat],payload:{seat:witch.seat,target:good.seat,action:'毒药',text:'NIGHT_SECRET'}});
 const x=extractExperience(engine.game,store.events(engine.game.id),witch)!;expect(x.reviewCases).toContainEqual({kind:'自身毒药误伤好人',count:1,lesson:'skills'});expect(summarizeExperience(x)).not.toMatch(/NIGHT_SECRET|号/);expect(extractExperience(engine.game,store.events(engine.game.id),good)?.reviewCases).toEqual([]);
 }finally{store.close();}
});
