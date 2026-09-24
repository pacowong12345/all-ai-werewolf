import {decide} from './model.js';
import {PERSONAS} from './personas.js';
import type {ModelBinding} from './types.js';
export function localRequestAllowed(host:string|undefined,origin:string|undefined) {
 const hosts=['localhost:3000','127.0.0.1:3000','[::1]:3000'];
 return Boolean(host && hosts.includes(host.toLowerCase()) && (!origin || hosts.some(h=>origin===`http://${h}`)));
}
export async function testModel(binding:ModelBinding) {
 const started=Date.now();
 try {
  await decide({binding,player:{seat:1,role:'村民',slot:'村民1',alive:true,belief:{},persona:PERSONAS[0]},candidates:[1],nonTarget:true,prompt:'连通性与结构化输出测试。只输出JSON，text="连接成功",target=1,confidence=1,suspects=[]。'});
  return {ok:true,provider:binding.provider,model:binding.model,latencyMs:Date.now()-started,message:binding.provider==='mock'?'离线演示测试通过':'真实模型请求及结构化输出校验通过'};
 }catch {
  // Never echo provider bodies: these may contain credentials or private URLs.
  return {ok:false,provider:binding.provider,model:binding.model,latencyMs:Date.now()-started,message:'真实请求失败或输出格式不合格，请检查密钥、模型名、地址和网络。'};
 }
}
