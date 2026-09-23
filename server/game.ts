import { randomUUID } from "node:crypto";
import { PERSONAS } from "./personas.js";
import { decide } from "./model.js";
import type { AgentModelProfile, EventRecord, GameSnapshot, Player, Role, RoleSlot, Settings, Visibility } from "./types.js";
import { ROLE_SLOTS } from "./types.js";
import type { LocalStore } from "./store.js";
import { chronicle, relation, safeMemory, seededShuffle } from "./world.js";
import type { WorldAgent } from "./types.js";
import { visibleToPlayer } from "./visibility.js";
import { RULES, RULE_VERSION, nightDeaths, victory } from './rules.js';
import { LESSONS, extractExperience, retrieveExperiences, summarizeExperience, type Lesson } from "./learning.js";

const roleOf = (slot: RoleSlot): Role => slot.startsWith("狼人") ? "狼人" : slot.startsWith("村民") ? "村民" : slot as Role;
const defaultBinding = { provider: "mock" as const, model: "offline-demo" };

export class GameEngine {
  readonly game: GameSnapshot;
  private listeners = new Set<(event: EventRecord) => void>();
  private stepping = false;
  private runningLoop = false;
  private elected = false;
  private publishState() {
    this.emit("公开状态", { phase: this.game.phase, day: this.game.day, status: this.game.status, sheriff: this.game.sheriff ?? null, winner: this.game.winner, players: this.game.players.map(p => ({ seat:p.seat, alive:p.alive })) });
  }
  constructor(private store: LocalStore, private settings: Settings, id = randomUUID(), roster?: WorldAgent[], seed = Date.now()) {
    const selected = roster ? seededShuffle(roster, seed).slice(0, 12) : undefined;
    const slots = seededShuffle([...ROLE_SLOTS], seed + 19);
    const players: Player[] = slots.map((slot, index) => ({ seat: index + 1, slot, role: roleOf(slot), persona: selected?.[index]?.persona ?? PERSONAS[index], agentId: selected?.[index]?.id, guildId: selected?.[index]?.guildId, alive: true, belief: {} }));
    this.game = { id, day: 0, phase: "准备中", status: "paused", players, speed: 2, seed, rosterIds: selected?.map(agent => agent.id), ruleVersion: RULE_VERSION, rules: [...RULES] };
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
  play() { if (this.game.status === "finished" || this.game.status === "error") return; this.game.status = "running"; this.save(); this.emit("状态", { status: "running" }); void this.run(); }
  async step() { if (this.stepping || this.game.status === "finished" || this.game.status === "error") return; this.game.status = "paused"; await this.runPhase(); }
  private async wait() { await new Promise(resolve => setTimeout(resolve, 550 / this.game.speed)); }
  private async run() { if(this.runningLoop) return; this.runningLoop=true; try { while (this.game.status === "running") { await this.runPhase(); if (this.game.status !== "running") break; await this.wait(); } } finally {this.runningLoop=false;} }
  private async runPhase() {
    if (this.stepping) return; this.stepping = true;
    try {
      if (!this.elected) { await this.night(true); this.elected=true; }
      else if (this.game.phase === "夜晚结束") await this.dayDiscussion();
      else await this.night();
    } catch (error) { this.game.status = "error"; this.game.error = error instanceof Error ? error.message : "未知错误"; this.emit("错误", { message: this.game.error }); }
    finally { this.save(); this.publishState(); this.stepping = false; }
  }
  private alive() { return this.game.players.filter(p => p.alive); }
  private async resolveSheriffBadge(deceased: Player) {
    if (this.game.sheriff !== deceased.seat) return;
    const candidates = this.alive().filter(player => player.seat !== deceased.seat).map(player => player.seat);
    if (!candidates.length) { delete this.game.sheriff; this.emit("撕毁警徽", { seat: deceased.seat, text: `${deceased.seat}号出局，警徽被撕毁。` }); return; }
    const decision = await this.decideFor(deceased, candidates, "你是警长且即将出局。请决定警徽去向：action 只能为 transfer 或 destroy；transfer 时 target 为接任警长的座位，destroy 时撕毁警徽。", ["transfer","destroy"]);
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
    const decision = await this.decideFor(hunter, candidates, "你以猎人身份死亡，可发动开枪技能。action 只能为 shoot 或 skip；shoot 时 target 为要开枪带走的存活玩家。请谨慎决定。", ["shoot","skip"]);
    if (decision.action !== "shoot") { this.emit("猎人放弃开枪", { seat: hunter.seat }, "omniscient"); return; }
    const target = this.alive().find(player => player.seat === decision.target);
    if (!target) return;
    target.alive = false;
    this.emit("猎人开枪", { seat: hunter.seat, target: target.seat }, "public");
    await this.resolveSheriffBadge(target);
  }
  private profileFor(player: Player): AgentModelProfile | undefined {
    const profile = player.agentId ? this.store.agentProfile(player.agentId) : undefined;
    if (profile?.enabled) return profile;
    const fallback = this.settings.roleModels[player.slot] ?? defaultBinding;
    return { ...fallback, id: `legacy-${player.slot}`, agentId: player.agentId ?? "legacy", enabled: true, timeoutMs: 30000, maxRetries: 2, costLimit: 0 };
  }
  private async decideFor(player: Player, candidates: number[], intent: string, actions?: string[]) {
    const task = intent;
    intent = `本局固定规则：${RULES.join('\n')}\n${intent}`;
    const profile = this.profileFor(player); const started = Date.now();
    const experiences = player.agentId ? retrieveExperiences(this.store.experiences(player.agentId), player.agentId, this.game.id, player.role, intent) : [];
    const memory = experiences.map(summarizeExperience).join("\n");
    const agent = player.agentId ? this.store.worldAgent(player.agentId) : undefined;
    const checks = this.store.events(this.game.id).filter(e => e.type === "验人" && e.visibility === "private" && e.audience?.includes(player.seat));
    intent = `你是本局${player.seat}号，身份${player.role}，目标为${player.role === "狼人" ? "狼人" : "好人"}阵营获胜。存活座位：${this.alive().map(p => p.seat).join("、")}。当前警长：${this.game.sheriff ?? "无"}。你自己的暂定判断：${JSON.stringify(player.belief)}。个人策略：${JSON.stringify(agent?.strategy ?? {})}。主持人确认的自身查验：${JSON.stringify(checks.map(e=>e.payload))}。真实查验优先于发言推测；你可公开报查杀和金水，无需为防泄密而隐瞒。\n${intent}`;
    const visible = this.store.events(this.game.id)
      .filter(event => visibleToPlayer(event, player, this.game.id))
      .filter((event, index, all) => event.visibility === "private" || index >= all.length - 36)
      .map(event => `${event.phase} · ${event.type}: ${JSON.stringify(event.payload)}`)
      .join("\n");
    const teammates = player.role === "狼人"
      ? `你的狼人同伴座位：${this.game.players.filter(p => p.role === "狼人" && p.seat !== player.seat).map(p => p.seat).join("、") || "无"}。`
      : "";
    intent = `${intent}\n候选目标必须从 [${candidates.join(",")}] 中选择，target 不得为 null。请说明具体理由，并引用可见的发言座位、投票、查验或行为证据。${teammates}\n你可见的近期记录：\n${visible || "暂无公开记录"}`;
    for(let attempt=0; attempt<3; attempt++) { try {
      const decision = await decide({ player, candidates, binding: profile!, prompt: `你的身份是${player.role}。人格表达：${player.persona.style}；风险偏好：${player.persona.risk}；信任方式：${player.persona.trust}；诈唬风格：${player.persona.bluff}。长期公开履历：${memory || "无"}。当前任务：${intent}。只根据你合法可见信息决定目标。不要复读其他玩家的原话或把多数人的重复当成事实；独立评估证据强度，并在公开发言中保留不确定性。` });
      if(!candidates.includes(decision.target)) throw new Error("必须选择合法候选目标");
      if(actions && !actions.includes(decision.action ?? "")) throw new Error(`action必须为${actions.join("、")}`);
      if(player.role === "预言家" && task.includes("投票放逐") && checks.some(e=>e.payload.target===decision.target && e.payload.result==="好人")) throw new Error("你正在投票放逐自己已经验明的好人，请依据真实查验修正目标");
      if (player.agentId) this.store.logAction(this.game.id, player.agentId, this.game.phase, `${intent}\n模型决定：${JSON.stringify(decision)}`, "private");
      this.store.logModelCall(this.game.id, player.agentId, profile, Date.now() - started, "ok"); return decision;
    } catch (error) {
      this.store.logModelCall(this.game.id, player.agentId, profile, Date.now() - started, "retry");
      this.emit("行动重试", {seat:player.seat, attempt:attempt+1, reason: error instanceof Error && /target=|必须选择|action必须|验明/.test(error.message) ? error.message : "供应商请求或输出格式未通过校验"}, "private", [player.seat]);
      intent += `\n输出需要修正：${error instanceof Error ? error.message : "格式错误"}`;
      if(attempt===2) throw new Error(`${player.seat}号模型连续三次未通过行动校验，对局已停止，不代投目标。`);
    } }
    throw new Error("没有模型决定");
  }
  private async sheriffElection() {
    this.game.phase = "警长竞选";
    this.emit("阶段", { title: "警长竞选开始", detail: "首夜死亡尚未公布。自主上警，只有未报名的警下玩家有投票权。" });
    const players = this.alive();
    const nominations = await Promise.all(players.map(async p => ({ player: p, decision: await this.decideFor(p, [p.seat], '警长报名：action 为 run（上警）或 stay（留在警下投票）；target 填自己的座位。', ['run', 'stay']) })));
    const nominated = nominations.filter(n => n.decision.action === 'run').map(n => n.player);
    const voters = players.filter(p => !nominated.includes(p));
    this.emit('警长报名', { candidates: nominated.map(p=>p.seat), voters: voters.map(p=>p.seat), text: `上警：${nominated.map(p=>p.seat).join('、') || '无'}；可投票：${voters.map(p=>p.seat).join('、') || '无'}。` });
    let candidates: Player[] = [];
    for (const player of nominated) {
      const speech = await this.decideFor(player, [player.seat], '发表警长竞选发言。action 为 continue（继续竞选）或 withdraw（退水）；target 填自己。退水者仍不可投警长票。', ['continue', 'withdraw']);
      this.emit('发言', { seat: player.seat, text: speech.text });
      if (speech.action === 'continue') candidates.push(player);
      else this.emit('退水', { seat: player.seat, text: `${player.seat}号退水，不参与警长投票。` });
      await this.wait();
    }
    let sheriff: number | undefined;
    if (!candidates.length || !voters.length) this.emit('警长投票', { votes: [], result: !candidates.length ? '无人继续竞选，本局无警长。' : '全部上警，无合资格投票者，本局无警长。' });
    else if (candidates.length === 1) sheriff = candidates[0].seat;
    else for (let round=1; round<=2; round++) {
      if (round===2) for (const p of candidates) {
        const speech=await this.decideFor(p,[p.seat],'警长平票 PK：回应质疑，争取警下票；target 填自己。');
        this.emit('发言',{seat:p.seat,text:speech.text});
      }
      const votes=await Promise.all(voters.map(async p=>({seat:p.seat,target:(await this.decideFor(p,candidates.map(c=>c.seat),'投票选出警长，依据竞选发言说明理由')).target,weight:1})));
      const totals=new Map<number,number>(); votes.forEach(v=>totals.set(v.target,(totals.get(v.target)??0)+1));
      const maximum=Math.max(...totals.values());
      const tied=candidates.filter(p=>totals.get(p.seat)===maximum);
      sheriff=tied.length===1?tied[0].seat:undefined;
      this.emit('警长投票',{round,votes,result:sheriff?`${sheriff}号当选警长。`:round===1?'首轮平票，并列候选人进行 PK。':'再次平票，本局无警长。'});
      if(sheriff) break;
      candidates=tied;
    }
    if (sheriff) { this.game.sheriff = sheriff; this.emit('警长', { seat: sheriff, text: `${sheriff}号当选警长，放逐票重为 1.5。` }); }
  }
  private async night(firstNightElection = false) {
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
    const guard = alive.find(p => p.role === "守卫"); const guardDecision = guard ? await this.decideFor(guard, alive.filter(p => p.seat !== guard.lastGuardedSeat).map(p => p.seat), `选择今夜守护对象。上晚守护${guard.lastGuardedSeat ?? "无人"}号，不能连续两晚守同一个人。${guard.lastGuardedSeat ? `本晚禁止选择${guard.lastGuardedSeat}号，即使他是预言家也不能守他。` : ""}`) : undefined; const guarded = guard && alive.find(p => p.seat === guardDecision?.target);
    if (guard && guarded) { guard.lastGuardedSeat = guarded.seat; this.emit("守卫行动", { seat: guard.seat, target: guarded.seat }, "private", [guard.seat]); }
    const seer = alive.find(p => p.role === "预言家"); const seerDecision = seer ? await this.decideFor(seer, alive.filter(p => p.seat !== seer.seat).map(p => p.seat), "选择今夜查验对象") : undefined; const inspected = seer && alive.find(p => p.seat === seerDecision?.target);
    if (seer && inspected) this.emit("验人", { seat: seer.seat, target: inspected.seat, result: inspected.role === "狼人" ? "狼人" : "好人" }, "private", [seer.seat]);
    const witch = alive.find(p => p.role === "女巫");
    const witchCandidates = witch ? alive.filter(player => player.seat !== witch.seat).map(player => player.seat) : [];
    const witchActions = ["skip", ...(!witch?.poisonUsed ? ["poison"] : []), ...(witch && !witch.antidoteUsed && victim && victim.seat!==witch.seat ? ["save"] : [])];
    const witchDecision = witch && witchCandidates.length ? await this.decideFor(witch, witchCandidates, `女巫剩余解药${witch.antidoteUsed?0:1}瓶、毒药${witch.poisonUsed?0:1}瓶。${witch.antidoteUsed ? "解药已耗尽，不再得知刀口。" : `今晚刀口${victim?.seat ?? "无人"}号。`} action只能为${witchActions.join("、")}；save救刀口但不可自救，poison毒target，skip不用药。每晚最多一瓶。`, witchActions) : undefined;
    const saved = Boolean(witch && victim && victim.seat !== witch.seat && !witch.antidoteUsed && witchDecision?.action === "save");
    const poisoned = witch && !witch.poisonUsed && witchDecision?.action === "poison" ? alive.find(player => player.seat === witchDecision.target && player.seat !== witch.seat) : undefined;
    if (witch && saved && victim) { witch.antidoteUsed = true; this.emit("女巫用药", { seat: witch.seat, action: "解药", target: victim.seat }, "private", [witch.seat]); }
    if (witch && poisoned) { witch.poisonUsed = true; this.emit("女巫用药", { seat: witch.seat, action: "毒药", target: poisoned.seat }, "private", [witch.seat]); }
    const deaths = nightDeaths(victim?.seat, guarded?.seat, saved, poisoned?.seat).map(d=>({player:alive.find(p=>p.seat===d.seat)!,cause:d.cause}));
    if (firstNightElection) { await this.sheriffElection(); this.game.phase = `第${this.game.day}夜`; }
    for (const death of deaths) { death.player.alive = false; this.emit("夜晚死亡", { seat: death.player.seat, cause: death.cause }, "omniscient"); }
    this.emit("天亮公告", { seats: deaths.map(d=>d.player.seat), text: deaths.length ? `昨夜${deaths.map(d=>d.player.seat).join("、")}号倒牌。` : "昨夜平安夜。" });
    for (const death of deaths) await this.resolveSheriffBadge(death.player);
    for (const death of deaths) if (death.player.role === "猎人") await this.resolveHunterShot(death.player, death.cause);
    if(this.game.day===1) for(const death of deaths) await this.lastWords(death.player);
    this.game.phase = "夜晚结束"; this.checkWin();
  }
  private async lastWords(player: Player) {
    const decision=await this.decideFor(player,[player.seat],'你已出局，请发表一次公开遗言，交代自己的信息与建议；不得把未证实推测当成主持人确认的事实。target 填自己的座位。');
    this.emit('遗言',{seat:player.seat,text:decision.text});
  }
  private async dayDiscussion() {
    this.game.phase = `第${this.game.day}日讨论`;
    const deaths = this.store.events(this.game.id).filter(e => e.type === "夜晚死亡" && e.phase === `第${this.game.day}夜`);
    this.emit("阶段", { title: this.game.phase, detail: deaths.length ? `昨夜 ${deaths.map(e=>String(e.payload.seat)).join("、")} 号倒牌。` : "昨夜平安夜。" });
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
    if (eliminated) { eliminated.alive = false; await this.lastWords(eliminated); await this.resolveSheriffBadge(eliminated); if (eliminated.role === "猎人") await this.resolveHunterShot(eliminated, "放逐"); }
    this.checkWin(); if(this.game.status!=="finished") this.game.phase = "白天结束";
  }
  private checkWin() {
    const result= victory(this.game.players);
    if (result) { this.game.winner = result.winner; this.game.winReason=result.reason; this.game.status = "finished"; this.game.phase = "游戏结束"; this.emit("结局", { winner: this.game.winner, reason:result.reason, roles: this.game.players.map(p => ({ seat: p.seat, role: p.role, persona: p.persona.name, agentId: p.agentId })) }, "omniscient"); this.settleWorld(); void this.reflectWorld(); }
  }
  private settleWorld() {
    this.emit("结局公告", { winner: this.game.winner, reason:this.game.winReason, text: `${this.game.winner}阵营胜利（${this.game.winReason}），身份与夜间详情可切换到全知模式查看。` }, "public");
    for (const player of this.game.players) {
      const experience = extractExperience(this.game, this.store.events(this.game.id), player);
      if (experience) this.store.saveExperience(experience);
    }
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
