import { randomUUID } from "node:crypto";
import { PERSONAS } from "./personas.js";
import { decide } from "./model.js";
import type { AgentModelProfile, EventRecord, GameSnapshot, Player, Role, RoleSlot, Settings, Visibility } from "./types.js";
import { ROLE_SLOTS } from "./types.js";
import type { LocalStore } from "./store.js";
import { chronicle, relation, safeMemory, seededShuffle } from "./world.js";
import type { WorldAgent } from "./types.js";

const roleOf = (slot: RoleSlot): Role => slot.startsWith("狼人") ? "狼人" : slot.startsWith("村民") ? "村民" : slot as Role;
const defaultBinding = { provider: "mock" as const, model: "offline-demo" };

export class GameEngine {
  readonly game: GameSnapshot;
  private listeners = new Set<(event: EventRecord) => void>();
  private stepping = false;
  constructor(private store: LocalStore, private settings: Settings, id = randomUUID(), roster?: WorldAgent[], seed = Date.now()) {
    const selected = roster ? seededShuffle(roster, seed).slice(0, 12) : undefined;
    const slots = seededShuffle([...ROLE_SLOTS], seed + 19);
    const players: Player[] = slots.map((slot, index) => ({ seat: index + 1, slot, role: roleOf(slot), persona: selected?.[index]?.persona ?? PERSONAS[index], agentId: selected?.[index]?.id, guildId: selected?.[index]?.guildId, alive: true, belief: {} }));
    this.game = { id, day: 0, phase: "准备中", status: "paused", players, speed: 2, seed, rosterIds: selected?.map(agent => agent.id) };
    this.store.saveGame(this.game);
  }
  on(listener: (event: EventRecord) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(type: string, payload: Record<string, unknown>, visibility: Visibility = "public", audience?: number[]) {
    const event = this.store.addEvent({ gameId: this.game.id, phase: this.game.phase, type, payload, visibility, audience });
    this.listeners.forEach(listener => listener(event)); return event;
  }
  private save() { this.store.saveGame(this.game); }
  setSpeed(speed: number) { this.game.speed = Math.min(5, Math.max(0.25, speed)); this.save(); }
  pause() { this.game.status = "paused"; this.save(); this.emit("状态", { status: "paused" }); }
  play() { if (this.game.status === "finished") return; this.game.status = "running"; this.save(); this.emit("状态", { status: "running" }); void this.run(); }
  async step() { if (this.stepping || this.game.status === "finished") return; this.game.status = "paused"; await this.runPhase(); }
  private async wait() { await new Promise(resolve => setTimeout(resolve, 550 / this.game.speed)); }
  private async run() { while (this.game.status === "running") { await this.runPhase(); if (this.game.status !== "running") break; await this.wait(); } }
  private async runPhase() {
    if (this.stepping) return; this.stepping = true;
    try {
      if (this.game.day === 0) await this.sheriffElection();
      else if (this.game.phase === "夜晚结束") await this.dayDiscussion();
      else await this.night();
    } catch (error) { this.game.status = "error"; this.game.error = error instanceof Error ? error.message : "未知错误"; this.emit("错误", { message: this.game.error }); }
    finally { this.save(); this.stepping = false; }
  }
  private alive() { return this.game.players.filter(p => p.alive); }
  private profileFor(player: Player): AgentModelProfile | undefined {
    const profile = player.agentId ? this.store.agentProfile(player.agentId) : undefined;
    if (profile?.enabled) return profile;
    const fallback = this.settings.roleModels[player.slot] ?? defaultBinding;
    return { ...fallback, id: `legacy-${player.slot}`, agentId: player.agentId ?? "legacy", enabled: true, timeoutMs: 30000, maxRetries: 2, costLimit: 0 };
  }
  private async decideFor(player: Player, candidates: number[], intent: string) {
    const profile = this.profileFor(player); const started = Date.now();
    const memory = player.agentId ? this.store.memories(player.agentId).join("；") : "";
    try {
      const decision = await decide({ player, candidates, binding: profile!, prompt: `你的身份是${player.role}。人格：${player.persona.style}。长期公开履历：${memory || "无"}。当前任务：${intent}。只根据你合法可见信息决定目标。` });
      if (player.agentId) this.store.logAction(this.game.id, player.agentId, this.game.phase, `${intent}:${decision.target ?? "无目标"}`, "private");
      this.store.logModelCall(this.game.id, player.agentId, profile, Date.now() - started, "ok"); return decision;
    } catch (error) { this.store.logModelCall(this.game.id, player.agentId, profile, Date.now() - started, "fallback"); return { text: "我会保留判断。", target: candidates[0], confidence: 0.3, suspects: [] }; }
  }
  private async sheriffElection() {
    this.game.phase = "警长竞选"; this.emit("阶段", { title: "警长竞选开始", detail: "所有存活玩家可竞选并公开发言。" });
    for (const player of this.alive().slice(0, 4)) { this.emit("发言", { seat: player.seat, text: `${player.seat}号宣布上警：我愿意承担归票责任，也接受所有人的检验。` }); await this.wait(); }
    const sheriff = 1; this.game.sheriff = sheriff; this.emit("警长", { seat: sheriff, text: "1号以多数票当选警长，票重为 1.5。" });
    this.game.day = 1; this.game.phase = "白天讨论";
  }
  private async night() {
    this.game.day += 1; this.game.phase = `第${this.game.day}夜`;
    this.emit("阶段", { title: this.game.phase, detail: "夜幕降临，秘密行动开始。" }, "public");
    const alive = this.alive(); const wolves = alive.filter(p => p.role === "狼人"); const wolfCandidates = alive.filter(p => p.role !== "狼人").map(p => p.seat); const wolfDecision = wolves[0] ? await this.decideFor(wolves[0], wolfCandidates, "与狼人阵营决定夜袭目标") : undefined; const victim = alive.find(p => p.seat === wolfDecision?.target) ?? alive.find(p => p.role !== "狼人");
    this.emit("狼人密聊", { seats: wolves.map(w => w.seat), text: `狼人一致决定袭击 ${victim?.seat} 号。` }, "wolves", wolves.map(w => w.seat));
    const guard = alive.find(p => p.role === "守卫"); const guardDecision = guard ? await this.decideFor(guard, alive.filter(p => p.seat !== guard.lastGuardedSeat).map(p => p.seat), "选择今夜守护对象") : undefined; const guarded = guard && alive.find(p => p.seat === guardDecision?.target);
    if (guard && guarded) { guard.lastGuardedSeat = guarded.seat; this.emit("守卫行动", { seat: guard.seat, target: guarded.seat }, "omniscient"); }
    const seer = alive.find(p => p.role === "预言家"); const seerDecision = seer ? await this.decideFor(seer, alive.filter(p => p.seat !== seer.seat).map(p => p.seat), "选择今夜查验对象") : undefined; const inspected = seer && alive.find(p => p.seat === seerDecision?.target);
    if (seer && inspected) this.emit("验人", { seat: seer.seat, target: inspected.seat, result: inspected.role === "狼人" ? "狼人" : "好人" }, "private", [seer.seat]);
    if (victim && guarded?.seat !== victim.seat) { victim.alive = false; this.emit("夜晚死亡", { seat: victim.seat, cause: "狼人袭击" }, "omniscient"); }
    this.game.phase = "夜晚结束"; this.checkWin();
  }
  private async dayDiscussion() {
    this.game.phase = `第${this.game.day}日讨论`;
    const deaths = this.store.events(this.game.id).filter(e => e.type === "夜晚死亡" && e.phase === `第${this.game.day}夜`);
    this.emit("阶段", { title: this.game.phase, detail: deaths.length ? `昨夜 ${String(deaths[0].payload.seat)} 号倒牌。` : "昨夜平安夜。" });
    for (const player of this.alive()) {
      const candidates = this.alive().map(p => p.seat).filter(seat => seat !== player.seat);
      const decision = await this.decideFor(player, candidates, "发表公开短发言并给出暂定怀疑目标");
      player.belief[decision.target ?? candidates[0]] = decision.confidence;
      this.emit("判断摘要", { seat: player.seat, suspects: decision.suspects }, "omniscient");
      this.emit("发言", { seat: player.seat, text: decision.text }); await this.wait();
    }
    const voters = this.alive(); const votes = await Promise.all(voters.map(async p => ({ seat: p.seat, target: (await this.decideFor(p, voters.filter(x => x.seat !== p.seat).map(x => x.seat), "投票放逐一名你认为最可疑的玩家")).target, weight: p.seat === this.game.sheriff ? 1.5 : 1 })));
    const totals = new Map<number, number>(); votes.forEach(v => totals.set(v.target ?? 0, (totals.get(v.target ?? 0) ?? 0) + v.weight)); const ranking = [...totals.entries()].sort((a, b) => b[1] - a[1]); const eliminated = ranking.length && (!ranking[1] || ranking[0][1] > ranking[1][1]) ? this.alive().find(p => p.seat === ranking[0][0]) : undefined;
    this.emit("投票", { target: eliminated?.seat, result: eliminated ? `${eliminated.seat}号被放逐。` : "平票，无人出局。", votes });
    if (eliminated) { eliminated.alive = false; this.emit("遗言", { seat: eliminated.seat, text: "请继续核对投票链，不要把我的出局当成结论。" }); }
    this.checkWin(); this.game.phase = "白天结束";
  }
  private checkWin() {
    const alive = this.alive(); const wolves = alive.filter(p => p.role === "狼人").length;
    if (wolves === 0 || wolves >= alive.length - wolves) { this.game.winner = wolves === 0 ? "好人" : "狼人"; this.game.status = "finished"; this.game.phase = "游戏结束"; this.emit("结局", { winner: this.game.winner, roles: this.game.players.map(p => ({ seat: p.seat, role: p.role, persona: p.persona.name, agentId: p.agentId })) }, "omniscient"); this.settleWorld(); void this.reflectWorld(); }
  }
  private settleWorld() {
    const roster = this.game.players.map(player => player.agentId ? this.store.worldAgent(player.agentId) : undefined).filter((x): x is WorldAgent => Boolean(x));
    if (!roster.length || !this.game.winner) return;
    const wolfWin = this.game.winner === "狼人";
    const c = chronicle(this.game.id, this.game.winner, roster);
    const guildGains = new Map<string, number>();
    for (const player of this.game.players) {
      const agent = player.agentId ? this.store.worldAgent(player.agentId) : undefined; if (!agent) continue;
      const won = (player.role === "狼人") === wolfWin; const expected = 0.5; const actual = won ? 1 : 0;
      agent.elo = Math.round(agent.elo + 28 * (actual - expected)); agent.games++; if (won) { agent.wins++; guildGains.set(agent.guildId, (guildGains.get(agent.guildId) ?? 0) + 1); }
      agent.reputation += won ? 3 : 1; agent.contribution += won ? 2 : 0;
      agent.strategy.risk = Math.max(0.2, Math.min(0.8, agent.strategy.risk + (won ? 0.015 : -0.008)));
      if (agent.games >= 5 && agent.wins / agent.games > 0.65 && !agent.titles.includes("月下常胜者")) agent.titles.push("月下常胜者");
      this.store.saveWorldAgent(agent); this.store.saveSafeMemory(agent.id, this.game.id, safeMemory(agent, c));
    }
    for (let i = 0; i < roster.length - 1; i++) this.store.saveRelation(relation(roster[i].id, roster[i + 1].id, roster[i].guildId === roster[i + 1].guildId ? 5 : -3));
    for (const guild of this.store.guilds()) { guild.score += guildGains.get(guild.id) ?? 0; this.store.saveGuild(guild); }
    this.store.saveChronicle(c);
  }
  private async reflectWorld() {
    for (const player of this.game.players) {
      if (!player.agentId) continue;
      const reflection = await this.decideFor(player, this.game.players.filter(p => p.seat !== player.seat).map(p => p.seat), `本局已经结束。请复盘自己的公开发言、投票和结果，提出下局可执行的改进。不要复述任何其他玩家的秘密信息。`);
      const publicSummary = `${player.persona.name}完成赛后复盘：将更重视公开投票链与发言一致性。`;
      this.store.addReflection({ agentId: player.agentId, gameId: this.game.id, privateSummary: reflection.text, publicSummary, createdAt: new Date().toISOString() });
      this.store.saveSafeMemory(player.agentId, this.game.id, publicSummary);
    }
  }
}
