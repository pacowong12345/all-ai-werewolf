export function currentTaskRules(task:string):string {
 const notes=['未公开认证不等于虚假。神职技能结果通常仅本人可见；比较对跳、行动、风险和替代解释，不要求不存在的公开证明。'];
 if(/竞选|报名|退水/.test(task)) notes.push('报名上警者整场警长选举无投票权，退水也不能恢复。报名结束后不能临时上警。计划必须基于这些实际可用选项。');
 if(/投票|放逐/.test(task)) notes.push('只核对当前存活候选人。发言先后和改票不是天然狼证；明确新证据，再决定是否改变自己的判断。');
 return notes.join('\n');
}
// Only reject explicit current first-person declarations. Do not judge role
// claims, quotations, hypothetical plans, or strategic bluffing as contradictions.
export function validateActionText(action:string|undefined,text:string) {
 if(action==='withdraw' && /^\s*我\s*\d+号[，,][^。！？]{0,16}[，,]\s*不退水[。！；，]/.test(text)) throw new Error('行动与发言矛盾：action 是退水，开头却宣称不退水，请统一当前决定。');
 const declarations=[...text.matchAll(/(?:^|[。！？\n])\s*(?:我\s*)?\d*号?\s*(?:我)?(?:决定|选择|本轮|现在|这次)?\s*(不退水|继续竞选|退水|不上警|留在警下|留警下|上警)[，。！；\s]/g)].map(m=>m[1]);
 const contrary:Record<string,string[]>={withdraw:['不退水','继续竞选'],continue:['退水'],run:['不上警','留在警下','留警下'],stay:['上警']};
 if(action && declarations.some(d=>contrary[action]?.includes(d))) throw new Error('行动与发言矛盾：请让当前第一人称决定与 action 一致；若改变计划，清楚说明，不要同时作相反承诺。');
}
