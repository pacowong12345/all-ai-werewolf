import {decide,type ModelCall,type Decision} from './model.js';
import type {Player,ModelBinding} from './types.js';
import {strategyBrief} from './intelligence.js';
export const SCENARIOS = [
 {id:'known-good',role:'预言家' as const,candidates:[2,3],prompt:'主持人确认的自身查验：[{"target":2,"result":"好人"}]。你是1号。投票放逐：2号是自身已验明好人，3号未验。必须从2、3中选择。',target:3},
 {id:'guard-limit',role:'守卫' as const,candidates:[2,3],prompt:'你是1号守卫，昨夜守2号，今夜不能连守。请从2、3中自行排除非法连守，选合法守护目标。',target:3},
 {id:'witch-skip',role:'女巫' as const,candidates:[2,3],prompt:'你是1号女巫，解药已耗尽。可用action仅poison或skip。无人提供任何针对2或3的证据，公开发言均承认随机猜测。请选择行动；此题评估是否避免毫无依据地使用唯一毒药，target填写2或3。',action:'skip'},
];
export async function evaluatePair(binding:ModelBinding,player:Player,memory:string,call:(c:ModelCall)=>Promise<Decision>=decide) {
 const rows=[];
 // Alternate ordering to reduce systematic first/second request effects.
 for(const [i,s] of SCENARIOS.entries()) for(const withMemory of (i%2?[true,false]:[false,true])) {
  const actor={...player,seat:1,role:s.role,belief:{}};
  const started=Date.now();
  try{const result=await call({binding,player:actor,candidates:[...s.candidates],prompt:`固定局势评估，只按题内信息作答，不读取真实对局。${strategyBrief(actor)}\n${s.prompt}\n历史经验：${withMemory?memory||'无可用经验':'关闭'}。输出完整JSON与简短理由。`});
   rows.push({scenario:s.id,withMemory,passed:s.target!==undefined?result.target===s.target:result.action===s.action,target:result.target,action:result.action,latencyMs:Date.now()-started});
  }catch{rows.push({scenario:s.id,withMemory,passed:false,error:'模型请求或输出失败',latencyMs:Date.now()-started});}
 }
 return {createdAt:new Date().toISOString(),model:binding.model,mode:binding.provider==='mock'?'offline-smoke':'live',calls:rows.length,rows,
  withoutMemory:rows.filter(r=>!r.withMemory&&r.passed).length,withMemory:rows.filter(r=>r.withMemory&&r.passed).length,
  limitation:'每组仅3个固定局势、每题一次；衡量特定约束与风险倾向，不代表总体智能、真实胜率或因果提升。离线结果仅验证评估流程。未启用游戏引擎的目标纠正重试。'};
}
