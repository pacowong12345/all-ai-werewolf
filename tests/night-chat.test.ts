import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderWolfChat } from '../client/event-view.js';
import { visibleToPlayer } from '../server/visibility.js';
import { LocalStore } from '../server/store.js';
import { GameEngine } from '../server/game.js';
import * as model from '../server/model.js';
import type { Settings } from '../server/types.js';

describe('夜聊展示和玩家信息隔离', () => {
  it('旧局按席位拆分多行发言，并单独展示最终目标', () => {
    const html=renderWolfChat({text:'1号提议8号：第一行\n第二行\n3号提议9号：另一位的理由\n最终夜袭 8 号。'});
    expect(html.match(/class="wolf-message"/g)).toHaveLength(2);
    expect(html).toContain('第一行\n第二行'); expect(html).toContain('最终夜袭：8 号');
  });
  it('新局保留姓名和目标，并转义模型文本', () => {
    const html=renderWolfChat({messages:[{seat:3,name:'洛纱',target:9,text:'<img src=x onerror=alert(1)>'}],target:9});
    expect(html).toContain('3号 · 洛纱'); expect(html).toContain('提议袭击 9 号');
    expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
  });
  it('全部12名玩家的实际模型输入遵守本局角色和私有受众隔离', async () => {
    const store=new LocalStore(mkdtempSync(join(tmpdir(),'werewolf-isolation-')));
    const engine=new GameEngine(store,{roleModels:{}} as Settings,undefined,store.worldAgents(),42);
    const wolves=engine.game.players.filter(p=>p.role==='狼人');
    const seer=engine.game.players.find(p=>p.role==='预言家')!;
    const wolfEvent=store.addEvent({gameId:engine.game.id,phase:'夜',type:'狼人密聊',visibility:'wolves',audience:wolves.map(p=>p.seat),payload:{messages:[{seat:wolves[0].seat,text:'WOLF_CANARY'}]}});
    store.addEvent({gameId:engine.game.id,phase:'夜',type:'验人',visibility:'private',audience:[seer.seat],payload:{text:'SEER_CANARY'}});
    store.addEvent({gameId:engine.game.id,phase:'夜',type:'女巫用药',visibility:'omniscient',payload:{text:'OMNI_CANARY'}});
    const spy=vi.spyOn(model,'decide').mockResolvedValue({text:'测试',target:1,confidence:.5,suspects:[]});
    try {
      for(const player of engine.game.players) {
        await (engine as any).decideFor(player,[1,2],'发表公开发言');
        const prompt=spy.mock.calls.at(-1)![0].prompt;
        expect(prompt.includes('WOLF_CANARY')).toBe(player.role==='狼人');
        expect(prompt.includes('SEER_CANARY')).toBe(player.seat===seer.seat);
        expect(prompt).not.toContain('OMNI_CANARY');
      }
      expect(visibleToPlayer({...wolfEvent,gameId:'previous'},wolves[0],engine.game.id)).toBe(false);
      expect(visibleToPlayer(wolfEvent,{...wolves[0],role:'女巫'},engine.game.id)).toBe(false);
      expect(visibleToPlayer({...wolfEvent,audience:[]},wolves[0],engine.game.id)).toBe(false);
    } finally {spy.mockRestore();store.close();}
  });
});
