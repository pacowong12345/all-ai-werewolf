import {it,expect} from 'vitest';
import {strategyBrief,decisionContext,reviewDossier} from '../server/intelligence.js';
import {evaluatePair} from '../server/evaluation.js';
import {PERSONAS} from '../server/personas.js';
import type {Player,EventRecord} from '../server/types.js';
const p:Player={seat:1,role:'村民',slot:'村民1',persona:PERSONAS[0],alive:true,belief:{}};
it('人格改变行动偏好但不给出策略目标',()=>{
 expect(strategyBrief(p)).toContain('优先考虑保留');
 expect(strategyBrief({...p,persona:PERSONAS[7]})).toContain('少数派判断');
 expect(strategyBrief({...p,role:'狼人'})).toContain('切割');
});
it('复盘检查点严格限制当前局和本人，证据不含后来身份',()=>{
 const base={gameId:'g',phase:'日',createdAt:'',visibility:'private' as const,type:'决策检查点'};
 const es:EventRecord[]=[{...base,id:1,audience:[1],payload:{tag:'OWN'}},{...base,id:2,audience:[2],payload:{tag:'OTHER_SECRET'}},{...base,id:3,gameId:'other',audience:[1],payload:{tag:'OLD_SECRET'}},{...base,id:4,type:'结局',visibility:'omniscient',payload:{tag:'FUTURE_ROLES'}}];
 expect(JSON.stringify(reviewDossier(es,p,'g'))).toContain('OWN');expect(JSON.stringify(reviewDossier(es,p,'g'))).not.toMatch(/OTHER_SECRET|OLD_SECRET|FUTURE_ROLES/);
 expect(JSON.stringify(decisionContext(es,p,'g'))).not.toMatch(/SECRET|FUTURE_ROLES/);
});
it('对照使用相同局势与候选，仅切换经验；报告不宣称智能提升',async()=>{
 const calls:any[]=[];const report=await evaluatePair({provider:'mock',model:'test'},p,'TEST_MEMORY',async c=>{calls.push(c);return {text:'答复',target:3,action:'skip',confidence:.5,suspects:[]};});
 expect(calls).toHaveLength(6);expect(calls.filter(c=>c.prompt.includes('TEST_MEMORY'))).toHaveLength(3);expect(report.withMemory).toBe(3);expect(report.withoutMemory).toBe(3);expect(report.limitation).toContain('不代表');
 for(let i=0;i<6;i+=2)expect(calls[i].candidates).toEqual(calls[i+1].candidates);
});
