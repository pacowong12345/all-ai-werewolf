import {it,expect,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nightDeaths,victory,RULE_VERSION} from '../server/rules.js';
import {GameEngine} from '../server/game.js';
import {LocalStore} from '../server/store.js';
import * as model from '../server/model.js';
import type {Settings,Role} from '../server/types.js';
const living=(...roles:Role[])=>roles.map(role=>({role,alive:true}));
function setup(){const store=new LocalStore(mkdtempSync(join(tmpdir(),'wolf-formal-')));const engine=new GameEngine(store,{roleModels:{}} as Settings,undefined,undefined,20260923);(engine as any).wait=async()=>{};return {store,engine};}
it.each([
 [undefined,false,'狼人袭击'],[1,false,undefined],[undefined,true,undefined],[1,true,'同守同救'],
] as const)('刀口守护=%s、解药=%s 的结算', (guard,save,cause)=>{
 expect(nightDeaths(1,guard,save)).toEqual(cause?[{seat:1,cause}]:[]);
});
it('毒药不受守救影响，刀毒同中以毒为死因；不重复死亡',()=>{
 expect(nightDeaths(1,1,true,1)).toEqual([{seat:1,cause:'女巫毒杀'}]);
 expect(nightDeaths(1,1,false,2)).toEqual([{seat:2,cause:'女巫毒杀'}]);
});
it('真实引擎同守同救造成死亡且公开公告不泄露死因',async()=>{
 const {store,engine}=setup();const victim=engine.game.players.find(p=>p.role==='村民')!;
 const spy=vi.spyOn(model,'decide').mockImplementation(async c=>({text:'独立行动',target:c.candidates.length===1?c.candidates[0]:c.player.role==='狼人'||c.player.role==='守卫'||c.player.role==='女巫'?victim.seat:c.candidates[0],action:c.player.role==='女巫'?'save':'skip',confidence:.5,suspects:[]}));
 try{await (engine as any).night();const events=store.events(engine.game.id);expect(victim.alive).toBe(false);expect(events.find(e=>e.type==='夜晚死亡')?.payload.cause).toBe('同守同救');expect(events.find(e=>e.type==='天亮公告')?.payload.seats).toEqual([victim.seat]);expect(JSON.stringify(events.filter(e=>e.visibility==='public'))).not.toContain('"cause"');}
 finally{spy.mockRestore();store.close();}
});
it('屠神、屠民、人数压制、全灭狼及非终局',()=>{
 expect(victory(living('狼人','村民','村民'))?.reason).toContain('屠神');
 expect(victory(living('狼人','女巫','守卫'))?.reason).toContain('屠民');
 expect(victory(living('狼人','狼人','村民','女巫'))?.reason).toContain('人数压制');
 expect(victory(living('村民'))?.winner).toBe('好人');
 expect(victory(living('狼人','村民','女巫','守卫'))).toBeUndefined();
});
it('上警与退水者不能投警长；警下票均为1，首轮平票后PK',async()=>{
 const {store,engine}=setup();let ballotCalls=0;
 const spy=vi.spyOn(model,'decide').mockImplementation(async c=>{
  const nomination=c.prompt.includes('警长报名：action');const speech=c.prompt.includes('action 为 continue');const vote=c.prompt.includes('投票选出警长，');
  if(vote) ballotCalls++;
  return {text:'独立决定',target:vote?(c.player.seat<9?1:2):c.candidates[0],confidence:.5,suspects:[],planAction:c.player.seat<=4?'run':'stay',action:nomination?(c.player.seat<=4?'run':'stay'):speech?(c.player.seat<=2?'continue':'withdraw'):'skip'};
 });
 try {await (engine as any).sheriffElection();const events=store.events(engine.game.id);const ballots=events.filter(e=>e.type==='警长投票');expect(ballots).toHaveLength(2);expect(ballotCalls).toBe(16);expect(engine.game.sheriff).toBeUndefined();for(const e of ballots){expect((e.payload.votes as any[]).map(v=>v.seat)).toEqual([5,6,7,8,9,10,11,12]);expect((e.payload.votes as any[]).every(v=>v.weight===1)).toBe(true);}}
 finally{spy.mockRestore();store.close();}
});
it.each(['run','stay'])('全部%s时无警长且不产生投票调用',async action=>{
 const {store,engine}=setup();const spy=vi.spyOn(model,'decide').mockImplementation(async c=>({text:'选择',target:c.candidates[0],confidence:.5,suspects:[],planAction:action as 'run'|'stay',action:c.prompt.includes('警长报名：action')?action:'continue'}));
 try{await (engine as any).sheriffElection();expect(engine.game.sheriff).toBeUndefined();expect(spy.mock.calls.some(([c])=>c.prompt.includes('投票选出警长，'))).toBe(false);}finally{spy.mockRestore();store.close();}
});
it('首夜先行动再竞选再公布死亡；完整假模型局使用新版规则且能够结束',async()=>{
 const {store,engine}=setup();
 try{
  await engine.step();const events=store.events(engine.game.id);
  expect(engine.game.ruleVersion).toBe(RULE_VERSION);
  expect(events.findIndex(e=>e.type==='验人')).toBeLessThan(events.findIndex(e=>e.type==='警长报名'));
  expect(events.findIndex(e=>e.type==='警长报名')).toBeLessThan(events.findIndex(e=>e.type==='天亮公告'));
  for(let n=0;n<40&&engine.game.status!=='finished'&&engine.game.status!=='error';n++)await engine.step();
  expect(engine.game.status).toBe('finished');expect(engine.game.winReason).toBeTruthy();
  expect(store.events(engine.game.id).find(e=>e.type==='结局公告')?.payload.reason).toBe(engine.game.winReason);
 }finally{store.close();}
});
