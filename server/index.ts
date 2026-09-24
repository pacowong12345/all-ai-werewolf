import express from "express";
import {localRequestAllowed,testModel} from './readiness.js';
import { RULES, RULE_VERSION } from './rules.js';
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LocalStore } from "./store.js";
import { GameEngine } from "./game.js";
import { ROLE_SLOTS, type Settings } from "./types.js";
import { PROVIDERS } from "./providers.js";
import type { AgentModelProfile } from "./types.js";
import { extractExperience, summarizeExperience } from "./learning.js";

const app = express(); const store = new LocalStore(); const games = new Map<string, GameEngine>();
app.use((req,res,next)=>{if(!localRequestAllowed(req.headers.host,req.headers.origin))return res.status(403).json({error:'仅允许本地观战页面访问'});next();});
// Idempotent local backfill: completed results only; no paid model calls at startup.
for (const game of store.games().filter(game => game.status === "finished")) {
  const events = store.events(game.id);
  for (const player of game.players) {
    if (!player.agentId || store.experiences(player.agentId).some(x => x.gameId === game.id)) continue;
    const experience = extractExperience(game, events, player);
    if (experience) store.saveExperience(experience);
  }
}
app.get("/api/learning", (_req, res) => res.json(store.worldAgents().map(agent => ({
  id: agent.id, name: agent.name, experiences: store.experiences(agent.id).map(x => ({ ...x, summary: summarizeExperience(x) }))
}))));
app.use(express.json({ limit: "128kb" }));
const binding = z.object({ provider: z.enum(["mock", "openai-compatible", "openai", "anthropic", "google", "deepseek", "ark", "qianfan", "dashscope", "zhipu", "moonshot", "hunyuan", "minimax"]), baseUrl: z.string().url().optional(), apiKey: z.string().max(500).optional(), model: z.string().min(1).max(160), profileId: z.string().optional() });
const settingsSchema = z.object({ roleModels: z.record(z.string(), binding) });
function redact(settings?: Settings) { if (!settings) return undefined; return { roleModels: Object.fromEntries(Object.entries(settings.roleModels).map(([slot, model]) => [slot, { ...model, apiKey: model.apiKey ? "已配置" : undefined }])) }; }
function eventFor(event: ReturnType<LocalStore["addEvent"]>, mode: "public" | "omniscient") { return mode === "omniscient" || event.visibility === "public" ? event : null; }

app.get("/api/settings", (_req, res) => res.json(redact(store.settings())));
app.get("/api/providers", (_req, res) => res.json(PROVIDERS));
const profileSchema = z.object({ agentId: z.string().min(1), provider: z.enum(["mock", "openai-compatible", "openai", "anthropic", "google", "deepseek", "ark", "qianfan", "dashscope", "zhipu", "moonshot", "hunyuan", "minimax"]), model: z.string().min(1).max(160), baseUrl: z.string().url().optional(), apiKey: z.string().max(500).optional(), enabled: z.boolean().default(true), timeoutMs: z.number().int().min(1000).max(120000).default(30000), maxRetries: z.number().int().min(0).max(5).default(2), costLimit: z.number().min(0).default(0) });
app.get("/api/agent-model-profiles", (_req, res) => res.json(store.agentProfiles()));
app.get("/api/agent-model-profiles/export", (_req, res) => res.json(store.agentProfiles().map(profile => ({ ...profile, apiKey: undefined }))));
app.put("/api/agent-model-profiles/:agentId", (req, res) => { const parsed = profileSchema.safeParse({ ...req.body, agentId: req.params.agentId }); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() }); const profile: AgentModelProfile = { id: `profile-${parsed.data.agentId}`, ...parsed.data }; if (!store.worldAgent(profile.agentId)) return res.sendStatus(404); store.saveAgentProfile(profile); res.json({ ...profile, apiKey: profile.apiKey ? "已配置" : undefined }); });
app.post("/api/agent-model-profiles/import", (req, res) => { const rows = z.array(profileSchema).max(36).safeParse(req.body?.profiles); if (!rows.success) return res.status(400).json({ error: rows.error.flatten() }); for (const row of rows.data) if (store.worldAgent(row.agentId)) store.saveAgentProfile({ id: `profile-${row.agentId}`, ...row }); res.json({ imported: rows.data.length }); });
app.post("/api/agent-model-profiles/:agentId/test", async (req, res) => { const profile = store.agentProfile(req.params.agentId); if (!profile) return res.status(404).json({ error: "未配置人物模型" }); res.json(await testModel(profile)); });
app.put("/api/settings", (req, res) => { const parsed = settingsSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() }); store.saveSettings(parsed.data as Settings); res.json(redact(parsed.data as Settings)); });
app.get("/api/rules", (_req, res) => res.json({ roles: ROLE_SLOTS, version: RULE_VERSION, rules: RULES }));
app.post("/api/models/test", async (req, res) => { const parsed = binding.safeParse(req.body); if (!parsed.success) return res.status(400).json({ ok: false, error: "模型配置无效" }); res.json(await testModel(parsed.data)); });
app.post("/api/games", (req, res) => { const settings = store.settings() ?? { roleModels: Object.fromEntries(ROLE_SLOTS.map(slot => [slot, { provider: "mock", model: "offline-demo" }])) } as Settings; const seed = Number(req.body?.seed) || Date.now(); const game = new GameEngine(store, settings, undefined, store.worldAgents(), seed); games.set(game.game.id, game); game.play(); res.status(201).json(game.game); });
app.get("/api/games", (_req, res) => res.json(store.games()));
app.get("/api/games/:id", (req, res) => { const game = games.get(req.params.id)?.game ?? store.game(req.params.id); if (!game) return res.sendStatus(404); res.json(game); });
app.get("/api/games/:id/events", (req, res) => { const mode = req.query.mode === "omniscient" ? "omniscient" : "public"; res.json(store.events(req.params.id).map(event => eventFor(event, mode)).filter(Boolean)); });
app.post("/api/games/:id/control", (req, res) => { const game = games.get(req.params.id); if (!game) return res.status(409).json({ error: "只能控制当前运行中的对局" }); const action = req.body?.action; if (action === "play") game.play(); else if (action === "pause") game.pause(); else if (action === "step") void game.step(); else if (action === "speed") game.setSpeed(Number(req.body.speed)); else return res.status(400).json({ error: "未知控制动作" }); res.json(game.game); });
app.get("/api/games/:id/stream", (req, res) => { const game = games.get(req.params.id); if (!game) return res.sendStatus(404); const mode = req.query.mode === "omniscient" ? "omniscient" : "public"; res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }); const off = game.on(event => { const visible = eventFor(event, mode); if (visible) res.write(`data: ${JSON.stringify(visible)}\n\n`); }); req.on("close", off); });
app.get("/api/world", (_req, res) => { const agents = store.worldAgents().sort((a, b) => b.elo - a.elo); res.json({ season: { name: "月下议会·第一季", mode: "手动开局 / 批量模拟" }, guilds: store.guilds(), agents, relations: store.relations(), chronicles: store.chronicles() }); });
app.get("/api/world/agents/:id", (req, res) => { const agent = store.worldAgent(req.params.id); if (!agent) return res.sendStatus(404); res.json({ agent, memories: store.memories(agent.id), relations: store.relations().filter(x => x.fromId === agent.id || x.toId === agent.id) }); });
app.get("/api/world/agents/:id/reflections", (req, res) => res.json(store.reflections(req.params.id).map(x => ({ ...x, privateSummary: undefined }))));
app.put("/api/world/agents/:id", (req, res) => {
  const agent = store.worldAgent(req.params.id); if (!agent) return res.sendStatus(404);
  const parsed = z.object({ name: z.string().min(1).max(24), biography: z.string().min(1).max(500), persona: z.object({ name: z.string().min(1).max(30), style: z.string().min(1).max(120), risk: z.string().min(1).max(40), trust: z.string().min(1).max(40), bluff: z.string().min(1).max(80) }), strategy: z.object({ risk: z.number().min(0.1).max(0.9), trust: z.number().min(0.1).max(0.9), initiative: z.number().min(0.1).max(0.9), deception: z.number().min(0.1).max(0.9) }) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  Object.assign(agent, parsed.data); store.saveWorldAgent(agent); res.json(agent);
});
app.post("/api/simulations", (_req,res)=>res.status(409).json({error:'批量模拟暂未开放：Token计费与预算强制限额尚未实现。请使用手动单局，避免产生不受控的API费用。'}));

const dist = join(process.cwd(), "dist");
if (existsSync(dist)) app.use(express.static(dist));
app.listen(3000, '127.0.0.1', () => console.log("AI 狼人杀观战台：http://localhost:3000"));
