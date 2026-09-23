import type { Player } from './types.js';

export const RULE_VERSION = '2026-09-23-v2';
// This is the explicitly selected house ruleset, not a claim of a universal standard.
export const RULES = [
  '本版采用人数压制＋屠边：狼人全部出局则好人胜；否则神职全灭、村民全灭或狼人不少于好人数，任一条件成立则狼人胜。死亡技能结算完后判胜。',
  '流程：首夜行动 → 警长竞选 → 公布首夜死亡 → 白天讨论与放逐。首夜死者在公布前仍参与竞选。',
  '自主报名上警；仅未报名的警下玩家可投警长票。报名者不可投票，包括退水者。仅一位最终候选人直接当选，无候选人或全部上警则无警长。',
  '警长首轮平票由并列者进行一次 PK，警下玩家复投；再次平票则无警长。警长票重仅在放逐时为 1.5；放逐平票无人出局。',
  '守卫可自守，不可连续守同一人。狼人刀口同时被守护和解药救治时仍死亡（奶穿）；守护和解药均不能抵挡毒药。',
  '女巫整局不可自救，每晚最多用一瓶药；解药、毒药各一瓶。解药耗尽后不再得知刀口。',
  '猎人被毒杀不能开枪；本版奶穿按非毒死亡，可开枪。刀毒同中按毒杀处理。警徽只能移交存活者，也可撕毁。',
  '首夜死者和白天被放逐者有自主遗言，其他夜晚死者及被猎人带走者无遗言；出局不自动翻牌。',
];

export function victory(players: Pick<Player, 'role' | 'alive'>[]) {
  const alive = players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === '狼人').length;
  if (!wolves) return { winner: '好人' as const, reason: '狼人全部出局' };
  if (!alive.some(p => p.role !== '狼人' && p.role !== '村民')) return { winner: '狼人' as const, reason: '屠神：神职全部出局' };
  if (!alive.some(p => p.role === '村民')) return { winner: '狼人' as const, reason: '屠民：村民全部出局' };
  if (wolves >= alive.length - wolves) return { winner: '狼人' as const, reason: '人数压制：狼人不少于好人' };
}

export function nightDeaths(victim?: number, guarded?: number, saved = false, poisoned?: number) {
  const deaths: { seat: number; cause: string }[] = [];
  if (victim !== undefined && ((guarded === victim) === saved)) {
    deaths.push({ seat: victim, cause: saved ? '同守同救' : '狼人袭击' });
  }
  if (poisoned !== undefined) {
    const existing = deaths.find(d => d.seat === poisoned);
    if (existing) existing.cause = '女巫毒杀';
    else deaths.push({ seat: poisoned, cause: '女巫毒杀' });
  }
  return deaths;
}
