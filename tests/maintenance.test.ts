import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalStore} from '../server/store.js';
import {eventCursor,eventFrame} from '../server/event-stream.js';
import {decide} from '../server/model.js';
import {PERSONAS} from '../server/personas.js';
import type {AgentModelProfile,Settings} from '../server/types.js';

it('人物档案留空或占位符保留加密密钥，安全导出再导入不损坏密钥',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wolf-maint-')),store=new LocalStore(dir);
 const p:AgentModelProfile={id:'profile-agent-01',agentId:'agent-01',provider:'deepseek',model:'m',apiKey:'TEST_SECRET_123',enabled:true,timeoutMs:1000,maxRetries:2,costLimit:0};
 try{
 store.saveAgentProfile(p);
 for(const apiKey of [undefined,'','已配置']){store.saveAgentProfile({...p,model:'changed',apiKey});expect(store.agentProfile(p.agentId)?.apiKey).toBe('TEST_SECRET_123');}
 expect(JSON.stringify(store.agentProfiles())).not.toContain('TEST_SECRET_123');
 expect(readFileSync(join(dir,'werewolf.sqlite')).includes(Buffer.from('TEST_SECRET_123'))).toBe(false);
 store.saveAgentProfile({...p,apiKey:'NEW_TEST_KEY'});expect(store.agentProfile(p.agentId)?.apiKey).toBe('NEW_TEST_KEY');
 }finally{store.close();}
});
it('旧身份配置占位符不会破坏密钥',()=>{
 const store=new LocalStore(mkdtempSync(join(tmpdir(),'wolf-settings-')));
 try{store.saveSettings({roleModels:{村民1:{provider:'deepseek',model:'m',apiKey:'TEST'}}} as Settings);
 store.saveSettings({roleModels:{村民1:{provider:'deepseek',model:'m2',apiKey:'已配置'}}} as Settings);
 expect(store.settings()?.roleModels.村民1.apiKey).toBe('TEST');}finally{store.close();}
});
it('事件增量读取严格有序且不混局，流重放保留可见性',()=>{
 const store=new LocalStore(mkdtempSync(join(tmpdir(),'wolf-events-')));
 try{const base={gameId:'g',phase:'夜晚',type:'记录',payload:{text:'secret'}};
 const a=store.addEvent({...base,visibility:'public'});
 const b=store.addEvent({...base,visibility:'wolves',audience:[1]});
 store.addEvent({...base,gameId:'other',visibility:'public'});
 expect(store.events('g',a.id).map(e=>e.id)).toEqual([b.id]);
 expect(eventFrame(b,'public')).toBe('');expect(eventFrame(b,'omniscient')).toContain(`id: ${b.id}`);
 expect(eventFrame(a,'public')).toContain('data:');
 expect(eventCursor('12')).toBe(12);for(const v of [-1,Infinity,'bad','1.5'])expect(eventCursor(v)).toBe(0);
 }finally{store.close();}
});
it.each(['deepseek','anthropic','google'] as const)('%s 使用档案超时且不泄漏供应商错误正文',async provider=>{
 const timeout=vi.spyOn(AbortSignal,'timeout');const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('PRIVATE_RESPONSE_SECRET',{status:401}));
 try{await expect(decide({binding:{provider,model:'test',apiKey:'TEST',timeoutMs:1234},player:{seat:1,role:'村民',slot:'村民1',alive:true,belief:{},persona:PERSONAS[0]},prompt:'test',candidates:[1]})).rejects.not.toThrow('PRIVATE_RESPONSE_SECRET');
 expect(timeout).toHaveBeenCalledWith(1234);expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
 }finally{timeout.mockRestore();fetchMock.mockRestore();}
});
