export function currentTaskRules(task:string,seat?:number):string {
 const notes=['未公开认证不等于虚假。神职技能结果通常仅本人可见；比较对跳、行动、风险和替代解释，不要求不存在的公开证明。'];
 if(/竞选|报名|退水/.test(task)) notes.push('报名上警者整场警长选举无投票权，退水也不能恢复。报名结束后不能临时上警。计划必须基于这些实际可用选项。');
 if(/投票|放逐/.test(task)) notes.push('只核对当前存活候选人。发言先后和改票不是天然狼证；明确新证据，再决定是否改变自己的判断。');
 if(task.startsWith('女巫剩余') && seat!==undefined && task.includes(`今晚刀口${seat}号。`)) notes.push('你本人是今晚刀口且不能自救，但仍可在本夜结算前使用剩余毒药（若合法动作包含poison）。必须比较：现在用毒可能带走狼人，也可能误伤好人；不用毒可避免误伤，但若你今晚死亡，剩余药物永久无法使用，不能假设留到未来再用。你不知道守卫本夜目标，可能被守住但不可当作保证，也不要据此断言必死。夜间用药决定先于竞选发言，不能等听完竞选再补毒。text简短交代两种选择的代价和最终决定；允许基于信息不足选择skip，绝不强制天毒。');
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
