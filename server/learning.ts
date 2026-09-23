import type { EventRecord, GameSnapshot, Player } from "./types.js";
export const LESSONS = {
  verify: "投票前交叉核对公开发言与实际票型；多人重复一个指控不是多份独立证据。",
  counter: "对首要怀疑对象寻找反证，并比较替代解释；不要把口误直接等同于狼人身份。",
  uncertainty: "信息不足时降低确信度，明确证据缺口，先提出可回答的问题再下结论。",
  adapt: "根据新增公开证据重新评估判断；上轮成功或失败都不能证明本轮身份。",
  conceal: "作为狼人，保持公开说法与自己的票型一致，避免全队机械跟票。",
  skills: "神职发动不可逆技能前核对证据、反证与误伤风险；不要把银水当成验明好人。",
  independence: "跟随多数前核对独立证据，区分票型事实、身份声明和自己的推测。",
} as const;
export type Lesson = keyof typeof LESSONS;
export interface Experience {
  gameId: string; agentId: string; role: Player["role"]; won: boolean;
  votes: number; correct: number; survived: boolean; lesson: Lesson;
  sourceEventIds: number[]; reviewed: boolean;
  reviewCases?: Array<{kind:string;count:number;lesson:Lesson}>;
}
// Only aggregate outcomes persist: no dialogue, skill targets or teammates.
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
  const local=events.filter(e=>e.gameId===game.id);
  let wrongMajority=0,poisonAlly=0,shotAlly=0;
  for(const e of local) {
    if(e.type==='投票' && e.visibility==='public' && Array.isArray(e.payload.votes)) {
      const vs=e.payload.votes as {seat:number;target:number}[];const own=vs.find(v=>v.seat===player.seat);const target=game.players.find(p=>p.seat===own?.target);
      if(own && target && (target.role==='狼人')===(player.role==='狼人') && vs.filter(v=>v.target===own.target).length>vs.length/2) wrongMajority++;
    }
    // Only one's own authenticated skill outcome becomes an anonymous count.
    if(e.payload.seat!==player.seat) continue;
    const target=game.players.find(p=>p.seat===e.payload.target);
    if(!target || target.role==='狼人') continue;
    if(e.type==='女巫用药' && e.visibility==='private' && e.audience?.includes(player.seat) && e.payload.action==='毒药')poisonAlly++;
    if(e.type==='猎人开枪' && e.visibility==='public')shotAlly++;
  }
  const reviewCases:NonNullable<Experience['reviewCases']>=[
    {kind:'随多数投向同阵营',count:wrongMajority,lesson:'independence'},
    {kind:'自身毒药误伤好人',count:poisonAlly,lesson:'skills'},
    {kind:'自身开枪误伤好人',count:shotAlly,lesson:'skills'},
  ].filter(x=>x.count>0) as NonNullable<Experience['reviewCases']>;
  return { gameId: game.id, agentId: player.agentId, role: player.role, reviewCases,
    won: (game.winner === "狼人") === (player.role === "狼人"), votes, correct,
    survived: player.alive, lesson: player.role === "狼人" ? "conceal" : votes === 0 ? "uncertainty" : correct / votes < 0.5 ? "counter" : "verify",
    sourceEventIds, reviewed: false };
}
export function summarizeExperience(x: Experience) {
  return `历史复盘（不代表本局身份）：${x.won ? "获胜" : "失利"}；${x.votes}次公开放逐投票中${x.correct}次投向对立阵营。${(x.reviewCases??[]).map(c=>`${c.kind}${c.count}次；建议：${LESSONS[c.lesson]}`).join(' ')} ${LESSONS[x.lesson]} 样本有限，作为待验证经验，不把一次误判等同于策略错误。`;
}
export function retrieveExperiences(all: Experience[], agentId: string, gameId: string, role: Player["role"], task: string) {
  return all.filter(x => x.agentId === agentId && x.gameId !== gameId && (role === "狼人" ? x.role === "狼人" : x.role !== "狼人"))
    .map((x, i) => ({ x, score: (x.role === role ? 5 : 0) + (/投票|放逐|发言|警长/.test(task) ? Math.min(x.votes, 3) : 0) + (!x.won ? 1 : 0) + (x.reviewed ? 1 : 0) + 1 / (i + 1) }))
    .sort((a,b) => b.score - a.score).slice(0, 3).map(({ x }) => x);
}
