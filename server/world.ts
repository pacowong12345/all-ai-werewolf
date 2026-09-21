import type { Chronicle, Guild, Relation, WorldAgent } from "./types.js";
import { PERSONAS } from "./personas.js";

export const GUILDS: Guild[] = [
  { id: "umbra", name: "烬影公会", motto: "契约藏于灰烬", color: "#a95461", score: 0 },
  { id: "lumen", name: "银灯议社", motto: "真相需要代价", color: "#d1ad62", score: 0 },
  { id: "tide", name: "雾潮同盟", motto: "潮汐从不宣誓", color: "#668eb2", score: 0 }
];
const NAMES = ["阿斯特","洛纱","迦南","维恩","弥拉","赛洛","诺亚","伊芙","塔林","瑟恩","露西娅","赫尔","兰铎","柯蕾","乌尔","菲娅","卡斯","伊莱","梅芙","奥伦","索拉","柏恩","薇达","卢恩","米娅","德洛","萨菲","恩雅","莱因","茉伊","科恩","塞拉","罗安","娜维","艾德","祈安"];
export function seedAgents(): WorldAgent[] {
  return NAMES.map((name, index) => ({ id: `agent-${String(index + 1).padStart(2, "0")}`, name, guildId: GUILDS[Math.floor(index / 12)].id, persona: PERSONAS[index % PERSONAS.length], elo: 1200, reputation: 20, games: 0, wins: 0, contribution: 0, strategy: { risk: 0.5, trust: 0.5, initiative: 0.5, deception: 0.5 }, biography: `${name}受公会契约派遣，常年出入月下议会。`, titles: [] }));
}
export function seededShuffle<T>(items: T[], seed: number) { const copy = [...items]; let x = seed || 1; for (let i = copy.length - 1; i > 0; i--) { x = (x * 1664525 + 1013904223) >>> 0; const j = x % (i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
export function chronicle(gameId: string, winner: string, roster: WorldAgent[]): Chronicle {
  const names = roster.slice(0, 3).map(a => a.name).join("、");
  return { gameId, title: `第 ${gameId.slice(0, 6)} 号审判：${winner}获胜`, summary: `${names}等十二名受契约约束的行者，在月下议会完成了一场充满伪装与指控的审判。`, highlights: ["警长归票改变了白昼的走向", "公会成员在公开席位上形成短暂同盟", "终局揭示重塑了议会的声望天平"], hook: "下一场审判前，三大公会都在重新计算盟友与代价。", createdAt: new Date().toISOString() };
}
export function safeMemory(agent: WorldAgent, c: Chronicle) { return `${agent.name}参与了${c.title}；公开履历记录：${c.highlights[0]}。`; }
export const relation = (fromId: string, toId: string, score: number): Relation => ({ fromId, toId, score, label: score > 12 ? "盟友" : score < -12 ? "宿敌" : "观察", updatedAt: new Date().toISOString() });
