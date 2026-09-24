import {it,expect,vi} from 'vitest';
import {localRequestAllowed,testModel} from '../server/readiness.js';
import {chronicle} from '../server/world.js';
it('本地服务拒绝外站Origin、null及非本机Host',()=>{
 expect(localRequestAllowed('localhost:3000',undefined)).toBe(true);
 expect(localRequestAllowed('127.0.0.1:3000','http://localhost:3000')).toBe(true);
 for(const origin of ['null','https://attacker.example','http://localhost:4000'])expect(localRequestAllowed('localhost:3000',origin)).toBe(false);
 expect(localRequestAllowed('attacker.example',undefined)).toBe(false);
});
it('连通性测试真正调用模型接口，失败不暴露返回内容',async()=>{
 const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'连接成功',target:1})}}]})));
 try{const b={provider:'deepseek' as const,model:'test',apiKey:'TEST_KEY'};expect((await testModel(b)).ok).toBe(true);expect(fetchMock).toHaveBeenCalledTimes(1);fetchMock.mockResolvedValue(new Response('SECRET',{status:401}));const result=await testModel(b);expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toMatch(/SECRET|TEST_KEY/);}finally{fetchMock.mockRestore();}
});
it('战报只引用本局公开事件，不编造模板名场面',()=>{
 const common={gameId:'g',phase:'第1日',createdAt:''};
 const c=chronicle('g','好人',[],[{...common,id:1,type:'投票',visibility:'public',payload:{result:'2号被放逐。'}},{...common,id:2,type:'投票',visibility:'private',payload:{result:'SECRET'}},{...common,gameId:'other',id:3,type:'投票',visibility:'public',payload:{result:'OTHER'}}]);
 expect(c.highlights).toEqual(['第1日：2号被放逐。（事件#1）']);expect(JSON.stringify(c)).not.toMatch(/SECRET|OTHER|形成短暂同盟/);
});
