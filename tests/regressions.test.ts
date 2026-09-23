import {it,expect,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalStore} from '../server/store.js';
import {GameEngine} from '../server/game.js';
import * as model from '../server/model.js';
import {applyGameEvent} from '../client/game-events.js';
import type {Settings} from '../server/types.js';
function setup(){const store=new LocalStore(mkdtempSync(join(tmpdir(),'wolf-regression-')));return {store,engine:new GameEngine(store,{roleModels:{}} as Settings)};}
it('预言家投已验好人会重试，改投由模型选择',async()=>{
 const {store,engine}=setup(); const seer=engine.game.players.find(p=>p.role==='预言家')!;
 store.addEvent({gameId:engine.game.id,phase:'夜',type:'验人',visibility:'private',audience:[seer.seat],payload:{target:2,result:'好人'}});
 const spy=vi.spyOn(model,'decide').mockResolvedValueOnce({text:'错投',target:2,confidence:.5,suspects:[]}).mockResolvedValueOnce({text:'修正',target:3,confidence:.7,suspects:[]});
 try {expect((await (engine as any).decideFor(seer,[2,3],'投票放逐')).target).toBe(3);expect(spy).toHaveBeenCalledTimes(2);expect(spy.mock.calls[1][0].prompt).toContain('验明的好人');}finally{spy.mockRestore();store.close();}
});
it('夜晚双死全部公开且先死亡再移交；刀毒同中猎人不能开枪',async()=>{
 const {store,engine}=setup();const hunter=engine.game.players.find(p=>p.role==='猎人')!;const villager=engine.game.players.find(p=>p.role==='村民')!;engine.game.sheriff=hunter.seat;
 const spy=vi.spyOn(model,'decide').mockImplementation(async call=>({text:'测试',target:call.candidates.length===1?call.candidates[0]:call.player.role==='女巫'?hunter.seat:call.player.role==='狼人'?hunter.seat:call.candidates.find(s=>s!==hunter.seat)!,confidence:.5,suspects:[],action:call.prompt.includes('transfer 或 destroy')?'destroy':call.player.role==='女巫'?'poison':'skip'}));
 try {await (engine as any).night();const events=store.events(engine.game.id);expect(events.find(e=>e.type==='夜晚死亡')?.payload.cause).toBe('女巫毒杀');expect(events.some(e=>e.type==='猎人开枪')).toBe(false);expect(events.find(e=>e.type==='天亮公告')?.payload.seats).toContain(hunter.seat);
 }finally{spy.mockRestore();store.close();}
});
it('女巫解药已用后提示不含刀口，不可再次救人',async()=>{
 const {store,engine}=setup();const witch=engine.game.players.find(p=>p.role==='女巫')!;witch.antidoteUsed=true;
 const spy=vi.spyOn(model,'decide').mockImplementation(async call=>({text:'测试',target:call.candidates[0],confidence:.5,suspects:[],action:'skip'}));
 try {await (engine as any).night();const prompt=spy.mock.calls.find(([call])=>call.player.role==='女巫')![0].prompt;expect(prompt).toContain('剩余解药0瓶');expect(prompt).not.toMatch(/今晚刀口\d/);expect(prompt).not.toContain('action只能为skip、poison、save');}finally{spy.mockRestore();store.close();}
});
it('多死公告包含全部死者，开枪公开',async()=>{
 const {store,engine}=setup();const hunter=engine.game.players.find(p=>p.role==='猎人')!;const villagers=engine.game.players.filter(p=>p.role==='村民');
 const spy=vi.spyOn(model,'decide').mockImplementation(async call=>({text:'测试',target:call.candidates.length===1?call.candidates[0]:call.player.role==='女巫'?villagers[1].seat:call.player.role==='狼人'?villagers[0].seat:call.player.role==='猎人'?villagers[2].seat:call.candidates.find(s=>s!==villagers[0].seat)!,confidence:.5,suspects:[],action:call.player.role==='女巫'?'poison':'shoot'}));
 try {await (engine as any).night();expect(store.events(engine.game.id).find(e=>e.type==='天亮公告')?.payload.seats).toEqual([villagers[0].seat,villagers[1].seat]);hunter.alive=false;await (engine as any).resolveHunterShot(hunter,'放逐');expect(store.events(engine.game.id).find(e=>e.type==='猎人开枪')?.visibility).toBe('public');}finally{spy.mockRestore();store.close();}
});
it('界面跟随公开事件刷新死亡、警徽和结束状态',()=>{
 let g:any={players:[{seat:1,alive:true},{seat:2,alive:true}],status:'running'};
 g=applyGameEvent(g,{type:'警长',phase:'竞选',payload:{seat:1}});expect(g.sheriff).toBe(1);
 g=applyGameEvent(g,{type:'天亮公告',phase:'夜',payload:{seats:[1]}});expect(g.players[0].alive).toBe(false);
 g=applyGameEvent(g,{type:'警徽移交',phase:'夜',payload:{from:1,to:2}});expect(g.sheriff).toBe(2);
 g=applyGameEvent(g,{type:'撕毁警徽',phase:'夜',payload:{seat:2}});expect(g.sheriff).toBeUndefined();
 g=applyGameEvent(g,{type:'结局公告',phase:'结束',payload:{winner:'好人'}});expect(g.status).toBe('finished');
});
