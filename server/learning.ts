import type { EventRecord, GameSnapshot, Player } from "./types.js";
export const LESSONS = {
  verify: "投票前交叉核对公开发言与实际票型；多人重复一个指控不是多份独立证据。",
  counter: "对首要怀疑对象寻找反证，并比较替代解释；不要把口误直接等同于狼人身份。",
  uncertainty: "信息不足时降低确信度，明确证据缺口，先提出可回答的问题再下结论。",
  adapt: "根据新增公开证据重新评估判断；上轮成功或失败都不能证明本轮身份。",
  conceal: "作为狼人，保持公开说法与自己的票型一致，避免全队机械跟票。",
} as const;
export type Lesson = keyof typeof LESSONS;
export interface Experience {
  gameId: string; agentId: string; role: Player["role"]; won: boolean;
  votes: number; correct: number; survived: boolean; lesson: Lesson;
  sourceEventIds: number[]; reviewed: boolean;
}
// Only aggregate public evidence is eligible: no dialogue, private actions or teammates.
export function extractExperience(game: GameSnapshot, events: EventRecord[], player: Player): Experience | undefined {
  if (game.status !== "finished" || !game.winner || !player.agentId) return;
  let votes = 0, correct = 0; const sourceEventIds: number[] = [];
  for (const event of events) {
    if (event.gameId !== game.id || event.visibility !== "public" || event.type !== "投票" || !Array.isArray(event.payload.votes)) continue;
    const vote = event.payload.votes.find((v: { seat?: number }) => v.seat === player.seat);
    const target = game.players.find(p => p.seat === vote?.target);
    if (!target) continue;
    votes++; sourceEventIds.push(event.id);
    if ((target.role === "狼人") !== (player.role === "狼人")) correct++;
  }
  return { gameId: game.id, agentId: player.agentId, role: player.role,
    won: (game.winner === "狼人") === (player.role === "狼人"), votes, correct,
    survived: player.alive, lesson: player.role === "狼人" ? "conceal" : votes === 0 ? "uncertainty" : correct / votes < 0.5 ? "counter" : "verify",
    sourceEventIds, reviewed: false };
}
export function summarizeExperience(x: Experience) {
  return `历史复盘（不代表本局身份）：${x.won ? "获胜" : "失利"}；${x.votes}次公开放逐投票中${x.correct}次投向对立阵营。${LESSONS[x.lesson]} 样本有限，作为待验证经验。`;
}
export function retrieveExperiences(all: Experience[], agentId: string, gameId: string, role: Player["role"], task: string) {
  return all.filter(x => x.agentId === agentId && x.gameId !== gameId && (role === "狼人" ? x.role === "狼人" : x.role !== "狼人"))
    .map((x, i) => ({ x, score: (x.role === role ? 5 : 0) + (/投票|放逐|发言|警长/.test(task) ? Math.min(x.votes, 3) : 0) + (!x.won ? 1 : 0) + (x.reviewed ? 1 : 0) + 1 / (i + 1) }))
    .sort((a,b) => b.score - a.score).slice(0, 3).map(({ x }) => x);
}
