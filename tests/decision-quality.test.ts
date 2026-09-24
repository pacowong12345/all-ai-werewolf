import {it,expect,vi} from 'vitest';
import * as model from '../server/model.js';
import {GameEngine} from '../server/game.js';
import {LocalStore} from '../server/store.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Settings} from '../server/types.js';
import {normalizeDecision} from '../server/model.js';
import {validateActionText,currentTaskRules} from '../server/decision-quality.js';
it('长发言要求重新压缩，不再默默截断；短发言原样保留',()=>{
 expect(()=>normalizeDecision(JSON.stringify({text:'长'.repeat(501),target:1}),[1])).toThrow('发言超长');
 expect(normalizeDecision(JSON.stringify({text:'我改变计划，选择退水。',target:1}),[1]).text).toBe('我改变计划，选择退水。');
});
it('只拒绝明确行动矛盾，不禁止历史叙述和身份诈唬',()=>{
 expect(()=>validateActionText('withdraw','我1号不退水。')).toThrow('行动与发言矛盾');
 expect(()=>validateActionText('withdraw','我1号，猎人，不退水。所以我退水。')).toThrow('行动与发言矛盾');
 expect(()=>validateActionText('run','我留警下。')).toThrow();
 expect(()=>validateActionText('withdraw','我之前说不退水，现在决定退水。')).not.toThrow();
 expect(()=>validateActionText('continue','我是预言家。')).not.toThrow();
});
it('保留计划与变更理由字段；竞选任务突出退水无票权',()=>{
 const d=normalizeDecision(JSON.stringify({text:'我选择上警，回应查杀压力。',target:1,plan:'留警下',planAction:'stay',revisionReason:'出现查杀，改变计划'}),[1]);
 expect(d.planAction).toBe('stay');expect(d.revisionReason).toContain('改变');expect(currentTaskRules('竞选')).toContain('退水也不能恢复');
});
it('计划只给本人且不跨局；改计划必须说明原因并允许通过',async()=>{
 const store=new LocalStore(mkdtempSync(join(tmpdir(),'wolf-plan-')));const engine=new GameEngine(store,{roleModels:{}} as Settings);const p=engine.game.players[0];
 const response={text:'我选择留警下。',target:p.seat,confidence:.5,suspects:[],plan:'私人计划标记',planAction:'stay' as const};
 const spy=vi.spyOn(model,'decide').mockResolvedValue(response);
 try{
  await (engine as any).decideFor(p,[p.seat],'狼队竞选协商，target 填自己。');
  spy.mockResolvedValueOnce({...response,action:'run',text:'我选择上警。'}).mockResolvedValueOnce({...response,action:'run',text:'我选择上警。',revisionReason:'决定主动争取发言权'});
  expect((await (engine as any).decideFor(p,[p.seat],'警长报名：target 填自己。',['run','stay'])).revisionReason).toBeTruthy();
  expect(spy.mock.calls[1][0].prompt).toContain('私人计划标记');
  const other=engine.game.players[1];spy.mockResolvedValue({...response,target:other.seat,plan:undefined});
  await (engine as any).decideFor(other,[other.seat],'发言 target 填自己。');expect(spy.mock.lastCall![0].prompt).not.toContain('私人计划标记');
  const next=new GameEngine(store,{roleModels:{}} as Settings);const nextP=next.game.players[0];spy.mockResolvedValue({...response,plan:undefined});await (next as any).decideFor(nextP,[nextP.seat],'发言 target 填自己。');expect(spy.mock.lastCall![0].prompt).not.toContain('私人计划标记');
 }finally{spy.mockRestore();store.close();}
});
