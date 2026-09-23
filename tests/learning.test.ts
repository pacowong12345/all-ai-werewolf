import { describe, it, expect, vi } from 'vitest';
import * as model from '../server/model.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../server/store.js';
import { GameEngine } from '../server/game.js';
import { extractExperience, retrieveExperiences, summarizeExperience } from '../server/learning.js';
import type { EventRecord, Settings } from '../server/types.js';

describe('个人学习隔离与持久化', () => {
  it('实际决策提示词检索个人经验；赛后模型只收到安全统计', async () => {
    const store=new LocalStore(mkdtempSync(join(tmpdir(),'werewolf-prompt-')));
    const engine=new GameEngine(store,{roleModels:{}} as Settings,undefined,store.worldAgents(),123);
    const player=engine.game.players.find(p=>p.role==='村民')!;
    store.saveExperience({agentId:player.agentId!,gameId:'prior',role:'村民',won:false,votes:3,correct:0,survived:false,lesson:'counter',sourceEventIds:[7],reviewed:true});
    const spy=vi.spyOn(model,'decide').mockResolvedValue({text:'不保存这个自由文本 SECRET',target:1,confidence:0.5,suspects:[],action:'adapt'});
    try {
      await (engine as any).decideFor(player,[1,2],'投票');
      expect(spy.mock.calls[0][0].prompt).toContain('寻找反证');
      expect(spy.mock.calls[0][0].prompt).toContain(`你是本局${player.seat}号`);
      store.addEvent({gameId:engine.game.id,phase:'夜',type:'狼人密聊',visibility:'wolves',payload:{text:'PRIVATE_CANARY'}});
      engine.game.status='finished'; engine.game.winner='好人';
      spy.mockClear(); await (engine as any).reflectWorld();
      expect(spy).toHaveBeenCalledTimes(12);
      for(const [call] of spy.mock.calls) expect(call.prompt).not.toContain('PRIVATE_CANARY');
      for(const p of engine.game.players) {
        const experiences=store.experiences(p.agentId!);
        expect(experiences.some(x=>x.gameId===engine.game.id && x.reviewed && x.lesson==='adapt')).toBe(true);
        expect(JSON.stringify(experiences)).not.toContain('SECRET');
      }
    } finally { spy.mockRestore(); store.close(); }
  });
  it('胜败双方从公开投票提炼经验，私聊不进入经验；重启读取不重复', () => {
    const dir = mkdtempSync(join(tmpdir(), 'werewolf-learning-'));
    const store = new LocalStore(dir);
    const engine = new GameEngine(store, { roleModels:{} } as Settings, undefined, store.worldAgents(), 123);
    const game = engine.game; game.status='finished'; game.winner='好人';
    const wolf=game.players.find(p=>p.role==='狼人')!;
    const good=game.players.find(p=>p.role==='村民')!;
    const events:EventRecord[]=[{id:1,gameId:game.id,phase:'投票',type:'投票',visibility:'public',payload:{votes:[{seat:good.seat,target:wolf.seat},{seat:wolf.seat,target:good.seat}]},createdAt:''},
      {id:2,gameId:game.id,phase:'夜',type:'狼人密聊',visibility:'wolves',payload:{text:'SECRET_CANARY'},createdAt:''}];
    const a=extractExperience(game,events,good)!; const b=extractExperience(game,events,wolf)!;
    expect(a.won).toBe(true); expect(b.won).toBe(false); expect(a.correct).toBe(1); expect(b.correct).toBe(1);
    expect(JSON.stringify(a)).not.toContain('SECRET_CANARY'); expect(a.sourceEventIds).toEqual([1]);
    store.saveExperience(a); store.saveExperience(a); store.close();
    const reopened=new LocalStore(dir); expect(reopened.experiences(good.agentId!)).toEqual([a]); reopened.close();
    expect(retrieveExperiences([a,b],good.agentId!,'new','女巫','投票')).toEqual([a]);
    expect(retrieveExperiences([a,b],good.agentId!,game.id,'女巫','投票')).toEqual([]);
    expect(retrieveExperiences([b],wolf.agentId!,'new','女巫','投票')).toEqual([]);
    expect(summarizeExperience(a)).not.toContain(`${wolf.seat}号`);
    game.status='running'; expect(extractExperience(game,events,good)).toBeUndefined();
  });
});
