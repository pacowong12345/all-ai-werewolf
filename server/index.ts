import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LocalStore } from "./store.js";
import { GameEngine } from "./game.js";
import { ROLE_SLOTS, type Settings } from "./types.js";
import { PROVIDERS } from "./providers.js";
import type { AgentModelProfile } from "./types.js";

const app = express(); const store = new LocalStore(); const games = new Map<string, GameEngine>();
app.use(cors()); app.use(express.json({ limit: "128kb" }));
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
app.post("/api/agent-model-profiles/:agentId/test", (req, res) => { const profile = store.agentProfile(req.params.agentId); if (!profile) return res.status(404).json({ error: "未配置人物模型" }); res.json({ ok: profile.provider === "mock" || Boolean(profile.apiKey), provider: profile.provider, model: profile.model, message: profile.provider === "mock" ? "离线演示模型可用" : "密钥已配置；首局调用时将执行真实连通性校验" }); });
app.put("/api/settings", (req, res) => { const parsed = settingsSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() }); store.saveSettings(parsed.data as Settings); res.json(redact(parsed.data as Settings)); });
app.get("/api/rules", (_req, res) => res.json({ roles: ROLE_SLOTS, rules: ["守卫不可连续守同一人", "警长局女巫整局不可自救", "猎人被毒不能开枪", "平票无人出局", "警长票重 1.5", "狼人夜间私聊后共同选择目标"] }));
app.post("/api/models/test", (req, res) => { const parsed = binding.safeParse(req.body); if (!parsed.success) return res.status(400).json({ ok: false, error: "模型配置无效" }); res.json({ ok: true, message: parsed.data.provider === "mock" ? "离线演示模型可用" : "配置格式有效；实际连通性将在开局调用时验证" }); });
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
app.post("/api/simulations", async (req, res) => { const count = Math.min(20, Math.max(1, Number(req.body?.count) || 1)); const settings = store.settings() ?? { roleModels: Object.fromEntries(ROLE_SLOTS.map(slot => [slot, { provider: "mock", model: "offline-demo" }])) } as Settings; const job = { id: crypto.randomUUID(), count, completed: 0, status: "queued", budget: Number(req.body?.budget) || 0, createdAt: new Date().toISOString() }; res.status(202).json(job); void (async () => { for (let i = 0; i < count; i++) { const game = new GameEngine(store, settings, undefined, store.worldAgents(), Date.now() + i); games.set(game.game.id, game); game.play(); while (game.game.status === "running") await new Promise(resolve => setTimeout(resolve, 100)); job.completed++; } job.status = "finished"; })(); });

const dist = join(process.cwd(), "dist");
if (existsSync(dist)) app.use(express.static(dist));
app.listen(3000, () => console.log("AI 狼人杀观战台：http://localhost:3000"));
