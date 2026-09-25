import {it,expect,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GameEngine} from '../server/game.js';
import {LocalStore} from '../server/store.js';
import * as model from '../server/model.js';
import type {Settings} from '../server/types.js';

it('守卫失败后从当前行动恢复，不重复狼刀，不泄露公开错误，不代选目标',async()=>{
 const store=new LocalStore(mkdtempSync(join(tmpdir(),'wolf-retry-')));
 const engine=new GameEngine(store,{roleModels:{}} as Settings,undefined,store.worldAgents(),123);
 const guard=engine.game.players.find(p=>p.role==='守卫')!;
 guard.lastGuardedSeat=9;
 (engine as any).elected=true;
 let guardCalls=0; const prompts:string[]=[];const original=model.decide;
 const spy=vi.spyOn(model,'decide').mockImplementation(async c=>{
   if(c.prompt.includes('选择今夜守护对象')){
     guardCalls++;prompts.push(c.prompt);
     if(guardCalls<=3)throw new Error('target=9不合法。');
   }
   return original(c);
 });
 try {
   const phase=engine.step();
   await vi.waitFor(()=>expect(engine.game.status).toBe('error'));
   const before=store.events(engine.game.id);
   const wolfEvents=before.filter(e=>e.type==='狼人密聊');expect(wolfEvents).toHaveLength(1);
   expect(before.filter(e=>e.type==='守卫行动')).toHaveLength(0);
   expect(before.filter(e=>e.type==='行动重试')).toHaveLength(3);
   expect(before.find(e=>e.type==='行动重试')!.payload.reason).toContain('不可连守');
   expect(JSON.stringify(before.filter(e=>e.type==='错误'))).not.toContain('target=9');
   expect(prompts[1].slice(0,400)).toContain('上次输出被拒绝');
   engine.play();engine.pause(); await phase;
   const after=store.events(engine.game.id);
   expect(guardCalls).toBe(4);
   expect(after.filter(e=>e.type==='狼人密聊').map(e=>e.id)).toEqual(wolfEvents.map(e=>e.id));
   expect(after.filter(e=>e.type==='守卫行动')).toHaveLength(1);
   expect(after.find(e=>e.type==='守卫行动')!.payload.target).not.toBe(9);
   expect(engine.game.error).toBeUndefined();
 }finally{spy.mockRestore();store.close();}
});
