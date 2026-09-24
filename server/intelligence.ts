import type {EventRecord,Player,WorldAgent} from './types.js';
import {evidenceLedger} from './evidence.js';
export function strategyBrief(player:Player,strategy?:WorldAgent['strategy']) {
 const cautious=/低|保守/.test(player.persona.risk);
 const bold=/高/.test(player.persona.risk);
 const risk=Math.max(.1,Math.min(.9,(cautious?.25:bold?.75:.5)+((strategy?.risk??.5)-.5)*.3));
 return `行为偏好（不是强制答案）：风险承受${risk.toFixed(2)}；${risk<.4?'不可逆技能证据不足时优先考虑保留，主动寻找误伤的替代解释':risk>.6?'允许承担有理由的少数派判断和技能风险，但必须指出失败代价':'比较行动与等待的收益，不自动随多数'}。信任方式：${player.persona.trust}；${/慢热|高门槛|证据/.test(player.persona.trust)?'建立信任前比较至少两种解释，不能把缺少公开认证等同虚假':'可提出暂定联盟，但随新证据修订'}。主动性${strategy?.initiative??.5}决定是否主动提出可检验预测，不决定上警人数。${player.role==='狼人'?'狼队收益优先：比较保队友与切割的代价，决定诈唬分工，不能把阵营私有证据当成公开事实。':'好人收益优先：目标是找狼而非证明自己上一轮正确；允许承认错误。'}人格保持稳定，历史胜败不改变核心人格。`;
}
export function decisionKind(task:string) {
 if(task.startsWith('投票放逐'))return '放逐投票';
 if(task.startsWith('女巫剩余'))return '女巫用药';
 if(task.includes('即将出局')&&task.includes('警徽'))return '警徽移交';
 if(task.includes('发动开枪'))return '猎人技能';
 return undefined;
}
export function decisionContext(events:EventRecord[],player:Player,gameId:string) {
 const ledger=evidenceLedger(events,player,gameId);
 return {notice:ledger.notice,facts:ledger.facts.slice(-16),claims:ledger.claims.slice(-8)};
}
// Same-game review only. It must never be passed to next-game prompts.
export function reviewDossier(events:EventRecord[],player:Player,gameId:string) {
 return events.filter(e=>e.gameId===gameId&&e.type==='决策检查点'&&e.visibility==='private'&&e.audience?.includes(player.seat)).slice(-3).map(e=>({eventId:e.id,...e.payload}));
}
