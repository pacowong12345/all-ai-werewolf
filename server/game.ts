import { randomUUID } from "node:crypto";
import { PERSONAS } from "./personas.js";
import { decide } from "./model.js";
import type { AgentModelProfile, EventRecord, GameSnapshot, Player, Role, RoleSlot, Settings, Visibility } from "./types.js";
import { ROLE_SLOTS } from "./types.js";
import type { LocalStore } from "./store.js";
import { chronicle, relation, safeMemory, seededShuffle } from "./world.js";
import type { WorldAgent } from "./types.js";
import { visibleToPlayer } from "./visibility.js";
import { LESSONS, extractExperience, retrieveExperiences, summarizeExperience, type Lesson } from "./learning.js";

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
  private async resolveSheriffBadge(deceased: Player) {
    if (this.game.sheriff !== deceased.seat) return;
    const candidates = this.alive().filter(player => player.seat !== deceased.seat).map(player => player.seat);
    if (!candidates.length) { delete this.game.sheriff; this.emit("撕毁警徽", { seat: deceased.seat, text: `${deceased.seat}号出局，警徽被撕毁。` }); return; }
    const decision = await this.decideFor(deceased, candidates, "你是警长且即将出局。请决定警徽去向：action 只能为 transfer 或 destroy；transfer 时 target 为接任警长的座位，destroy 时撕毁警徽。");
    if (decision.action === "transfer") {
      this.game.sheriff = decision.target;
      this.emit("警徽移交", { from: deceased.seat, to: decision.target, text: `${deceased.seat}号将警徽移交给${decision.target}号。` });
    } else {
      delete this.game.sheriff;
      this.emit("撕毁警徽", { seat: deceased.seat, text: `${deceased.seat}号选择撕毁警徽。` });
    }
  }
  private async resolveHunterShot(hunter: Player, cause: string) {
    if (cause === "女巫毒杀") return;
    const candidates = this.alive().filter(player => player.seat !== hunter.seat).map(player => player.seat);
    if (!candidates.length) return;
    const decision = await this.decideFor(hunter, candidates, "你以猎人身份死亡，可发动开枪技能。action 只能为 shoot 或 skip；shoot 时 target 为要开枪带走的存活玩家。请谨慎决定。");
    if (decision.action !== "shoot") { this.emit("猎人放弃开枪", { seat: hunter.seat }, "omniscient"); return; }
    const target = this.alive().find(player => player.seat === decision.target);
    if (!target) return;
    target.alive = false;
    this.emit("猎人开枪", { seat: hunter.seat, target: target.seat }, "omniscient");
    await this.resolveSheriffBadge(target);
  }
  private profileFor(player: Player): AgentModelProfile | undefined {
    const profile = player.agentId ? this.store.agentProfile(player.agentId) : undefined;
    if (profile?.enabled) return profile;
    const fallback = this.settings.roleModels[player.slot] ?? defaultBinding;
    return { ...fallback, id: `legacy-${player.slot}`, agentId: player.agentId ?? "legacy", enabled: true, timeoutMs: 30000, maxRetries: 2, costLimit: 0 };
  }
  private async decideFor(player: Player, candidates: number[], intent: string) {
    const profile = this.profileFor(player); const started = Date.now();
    const experiences = player.agentId ? retrieveExperiences(this.store.experiences(player.agentId), player.agentId, this.game.id, player.role, intent) : [];
    const memory = experiences.map(summarizeExperience).join("\n");
    const agent = player.agentId ? this.store.worldAgent(player.agentId) : undefined;
    intent = `你是本局${player.seat}号。存活座位：${this.alive().map(p => p.seat).join("、")}。当前警长：${this.game.sheriff ?? "无"}。你自己的当前判断（可修正）：${JSON.stringify(player.belief)}。个人策略参数：${JSON.stringify(agent?.strategy ?? {})}。\n${intent}`;
    const visible = this.store.events(this.game.id)
      .filter(event => visibleToPlayer(event, player, this.game.id))
      .filter((event, index, all) => event.visibility === "private" || index >= all.length - 36)
      .map(event => `${event.type}: ${JSON.stringify(event.payload)}`)
      .join("\n");
    const teammates = player.role === "狼人"
      ? `你的狼人同伴座位：${this.game.players.filter(p => p.role === "狼人" && p.seat !== player.seat).map(p => p.seat).join("、") || "无"}。`
      : "";
    intent = `${intent}\n候选目标必须从 [${candidates.join(",")}] 中选择，target 不得为 null。请说明具体理由，并引用可见的发言座位、投票、查验或行为证据。${teammates}\n你可见的近期记录：\n${visible || "暂无公开记录"}`;
    try {
      const decision = await decide({ player, candidates, binding: profile!, prompt: `你的身份是${player.role}。人格表达：${player.persona.style}；风险偏好：${player.persona.risk}；信任方式：${player.persona.trust}；诈唬风格：${player.persona.bluff}。长期公开履历：${memory || "无"}。当前任务：${intent}。只根据你合法可见信息决定目标。不要复读其他玩家的原话或把多数人的重复当成事实；独立评估证据强度，并在公开发言中保留不确定性。` });
      if (player.agentId) this.store.logAction(this.game.id, player.agentId, this.game.phase, `${intent}:${decision.target ?? "无目标"}`, "private");
      this.store.logModelCall(this.game.id, player.agentId, profile, Date.now() - started, "ok"); return decision;
    } catch (error) { this.store.logModelCall(this.game.id, player.agentId, profile, Date.now() - started, "fallback"); return { text: "我会保留判断。", target: candidates[0], confidence: 0.3, suspects: [] }; }
  }
  private async sheriffElection() {
    this.game.phase = "警长竞选";
    this.emit("阶段", { title: "警长竞选开始", detail: "所有存活玩家公开竞选，并由全体存活玩家投票。" });
    const candidates = this.alive();
    for (const player of candidates) {
      const speech = await this.decideFor(player, candidates.map(candidate => candidate.seat), "发表警长竞选发言，说明你会如何归票与接受检验");
      this.emit("发言", { seat: player.seat, text: speech.text }); await this.wait();
    }
    const voters = this.alive();
    const votes = await Promise.all(voters.map(async player => ({ seat: player.seat, target: (await this.decideFor(player, candidates.map(candidate => candidate.seat), "投票选出一位最可信的警长候选人，并依据竞选发言说明理由")).target })));
    const totals = new Map<number, number>(); votes.forEach(vote => totals.set(vote.target, (totals.get(vote.target) ?? 0) + 1));
    const ranking = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const sheriff = ranking.length && (!ranking[1] || ranking[0][1] > ranking[1][1]) ? ranking[0][0] : undefined;
    this.emit("警长投票", { votes, result: sheriff ? `${sheriff}号当选警长。` : "警长竞选平票，本局无警长。" });
    if (sheriff) { this.game.sheriff = sheriff; this.emit("警长", { seat: sheriff, text: `${sheriff}号当选警长，票重为 1.5。` }); }
    this.game.day = 1; this.game.phase = "白天讨论";
  }
  private async night() {
    this.game.day += 1; this.game.phase = `第${this.game.day}夜`;
    this.emit("阶段", { title: this.game.phase, detail: "夜幕降临，秘密行动开始。" }, "public");
    const alive = this.alive();
    const wolves = alive.filter(p => p.role === "狼人");
    const wolfCandidates = alive.filter(p => p.role !== "狼人").map(p => p.seat);
    const wolfProposals = await Promise.all(wolves.map(wolf => this.decideFor(wolf, wolfCandidates, "在狼人夜聊中提出夜袭目标，并说服队友")));
    const wolfTotals = new Map<number, number>();
    wolfProposals.forEach(proposal => { if (proposal.target) wolfTotals.set(proposal.target, (wolfTotals.get(proposal.target) ?? 0) + 1); });
    const wolfTarget = [...wolfTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? wolfCandidates[0];
    const victim = alive.find(p => p.seat === wolfTarget) ?? alive.find(p => p.role !== "狼人");
    this.emit("狼人密聊", {
      messages: wolfProposals.map((proposal, index) => ({ seat: wolves[index].seat, name: wolves[index].agentId ? this.store.worldAgent(wolves[index].agentId!)?.name : undefined, target: proposal.target, text: proposal.text })),
      target: victim?.seat,
    }, "wolves", wolves.map(w => w.seat));
    const guard = alive.find(p => p.role === "守卫"); const guardDecision = guard ? await this.decideFor(guard, alive.filter(p => p.seat !== guard.lastGuardedSeat).map(p => p.seat), "选择今夜守护对象") : undefined; const guarded = guard && alive.find(p => p.seat === guardDecision?.target);
    if (guard && guarded) { guard.lastGuardedSeat = guarded.seat; this.emit("守卫行动", { seat: guard.seat, target: guarded.seat }, "omniscient"); }
    const seer = alive.find(p => p.role === "预言家"); const seerDecision = seer ? await this.decideFor(seer, alive.filter(p => p.seat !== seer.seat).map(p => p.seat), "选择今夜查验对象") : undefined; const inspected = seer && alive.find(p => p.seat === seerDecision?.target);
    if (seer && inspected) this.emit("验人", { seat: seer.seat, target: inspected.seat, result: inspected.role === "狼人" ? "狼人" : "好人" }, "private", [seer.seat]);
    const witch = alive.find(p => p.role === "女巫");
    const witchCandidates = witch ? alive.filter(player => player.seat !== witch.seat).map(player => player.seat) : [];
    const witchDecision = witch && witchCandidates.length ? await this.decideFor(witch, witchCandidates, `你是女巫。今晚狼人袭击${victim?.seat ?? "无人"}号。你有一瓶解药和一瓶毒药：action 只能为 save、poison 或 skip。save 只能救被袭击者，且不可自救；poison 时 target 为要毒杀的候选座位；skip 保留药水。`) : undefined;
    const saved = Boolean(witch && victim && victim.seat !== witch.seat && !witch.antidoteUsed && witchDecision?.action === "save");
    const poisoned = witch && !witch.poisonUsed && witchDecision?.action === "poison" ? alive.find(player => player.seat === witchDecision.target && player.seat !== witch.seat) : undefined;
    if (witch && saved && victim) { witch.antidoteUsed = true; this.emit("女巫用药", { seat: witch.seat, action: "解药", target: victim.seat }, "omniscient"); }
    if (witch && poisoned) { witch.poisonUsed = true; this.emit("女巫用药", { seat: witch.seat, action: "毒药", target: poisoned.seat }, "omniscient"); }
    const deaths: Array<{ player: Player; cause: string }> = [];
    if (victim && guarded?.seat !== victim.seat && !saved) deaths.push({ player: victim, cause: "狼人袭击" });
    if (poisoned && !deaths.some(death => death.player.seat === poisoned.seat)) deaths.push({ player: poisoned, cause: "女巫毒杀" });
    for (const death of deaths) { death.player.alive = false; this.emit("夜晚死亡", { seat: death.player.seat, cause: death.cause }, "omniscient"); await this.resolveSheriffBadge(death.player); }
    for (const death of deaths) if (death.player.role === "猎人") await this.resolveHunterShot(death.player, death.cause);
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
    if (eliminated) { eliminated.alive = false; this.emit("遗言", { seat: eliminated.seat, text: "请继续核对投票链，不要把我的出局当成结论。" }); await this.resolveSheriffBadge(eliminated); if (eliminated.role === "猎人") await this.resolveHunterShot(eliminated, "放逐"); }
    this.checkWin(); this.game.phase = "白天结束";
  }
  private checkWin() {
    const alive = this.alive(); const wolves = alive.filter(p => p.role === "狼人").length;
    if (wolves === 0 || wolves >= alive.length - wolves) { this.game.winner = wolves === 0 ? "好人" : "狼人"; this.game.status = "finished"; this.game.phase = "游戏结束"; this.emit("结局", { winner: this.game.winner, roles: this.game.players.map(p => ({ seat: p.seat, role: p.role, persona: p.persona.name, agentId: p.agentId })) }, "omniscient"); this.settleWorld(); void this.reflectWorld(); }
  }
  private settleWorld() {
    for (const player of this.game.players) {
      const experience = extractExperience(this.game, this.store.events(this.game.id), player);
      if (experience) this.store.saveExperience(experience);
    }
    const roster = this.game.players.map(player => player.agentId ? this.store.worldAgent(player.agentId) : undefined).filter((x): x is WorldAgent => Boolean(x));
    if (!roster.length || !this.game.winner) return;
    this.emit("结局公告", { winner: this.game.winner, text: `${this.game.winner}阵营胜利，身份与夜间详情可切换到全知模式查看。` }, "public");
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
      const experience = extractExperience(this.game, this.store.events(this.game.id), player);
      if (!experience) continue;
      this.store.saveExperience(experience);
      const allowed = Object.keys(LESSONS).filter(key => player.role === "狼人" || key !== "conceal");
      const profile = this.profileFor(player)!; const started = Date.now();
      try {
        // A separate sanitized call: previous private prompts never enter reflection.
        const reflection = await decide({ player, binding: profile, candidates: [player.seat], prompt: `赛后个人复盘。${summarizeExperience(experience)} 仅根据这些统计选出下一局最需改进的原则。action 必须为 ${allowed.join(",")}；原则：${JSON.stringify(LESSONS)}。target=${player.seat}。勿编造事件。` });
        if (reflection.action && allowed.includes(reflection.action)) { experience.lesson = reflection.action as Lesson; experience.reviewed = true; }
        this.store.logModelCall(this.game.id, player.agentId, profile, Date.now() - started, "reflection_ok");
      } catch { this.store.logModelCall(this.game.id, player.agentId, profile, Date.now() - started, "reflection_failed"); }
      this.store.saveExperience(experience);
      const publicSummary = summarizeExperience(experience);
      this.store.addReflection({ agentId: player.agentId, gameId: this.game.id, privateSummary: publicSummary, publicSummary, createdAt: new Date().toISOString() });
      this.store.saveSafeMemory(player.agentId, this.game.id, publicSummary);
    }
  }
}
