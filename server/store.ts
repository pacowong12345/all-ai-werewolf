import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AgentModelProfile, AgentReflection, Chronicle, EventRecord, GameSnapshot, Guild, Relation, Settings, Visibility, WorldAgent } from "./types.js";
import { GUILDS, seedAgents } from "./world.js";
import type { Experience } from "./learning.js";

export class LocalStore {
  experiences(agentId: string): Experience[] {
    return (this.db.prepare("SELECT value FROM agent_experiences WHERE agent_id=? ORDER BY rowid DESC LIMIT 200").all(agentId) as {value:string}[]).map(row => JSON.parse(row.value));
  }
  saveExperience(value: Experience) {
    this.db.prepare("INSERT INTO agent_experiences(agent_id,game_id,value) VALUES(?,?,?) ON CONFLICT(agent_id,game_id) DO UPDATE SET value=excluded.value").run(value.agentId, value.gameId, JSON.stringify(value));
  }
  close() { this.db.close(); }
  private dir: string;
  private db: DatabaseSync;
  private key: Buffer;
  constructor(directory = join(process.cwd(), "data")) {
    this.dir = directory;
    mkdirSync(this.dir, { recursive: true });
    const keyPath = join(this.dir, ".settings-key");
    // Local key is intentionally outside SQLite; API keys are never returned by read endpoints.
    this.key = Buffer.from(process.env.WEREWOLF_SETTINGS_KEY ?? randomBytes(32).toString("hex"), "hex");
    if (!process.env.WEREWOLF_SETTINGS_KEY) {
      this.key = existsSync(keyPath) ? Buffer.from(readFileSync(keyPath, "utf8"), "hex") : this.key;
      if (!existsSync(keyPath)) writeFileSync(keyPath, this.key.toString("hex"), { mode: 0o600 });
    }
    this.db = new DatabaseSync(join(this.dir, "werewolf.sqlite"));
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, phase TEXT NOT NULL, type TEXT NOT NULL, visibility TEXT NOT NULL, audience TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS world_agents (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS guilds (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relations (from_id TEXT NOT NULL, to_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(from_id,to_id));
      CREATE TABLE IF NOT EXISTS chronicles (game_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (agent_id TEXT NOT NULL, game_id TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(agent_id,game_id));
      CREATE TABLE IF NOT EXISTS model_profiles (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_model_profiles (agent_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_reflections (agent_id TEXT NOT NULL, game_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(agent_id, game_id));
      CREATE TABLE IF NOT EXISTS agent_action_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, agent_id TEXT NOT NULL, phase TEXT NOT NULL, action TEXT NOT NULL, visibility TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_call_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT, agent_id TEXT, profile_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS simulations (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_experiences (agent_id TEXT NOT NULL, game_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(agent_id,game_id));`);
    if (Number((this.db.prepare("SELECT count(*) AS count FROM world_agents").get() as { count: number }).count) === 0) {
      for (const agent of seedAgents()) this.db.prepare("INSERT INTO world_agents(id,value) VALUES(?,?)").run(agent.id, JSON.stringify(agent));
      for (const guild of GUILDS) this.db.prepare("INSERT INTO guilds(id,value) VALUES(?,?)").run(guild.id, JSON.stringify(guild));
    }
  }
  private encrypt(value: string) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join("."); }
  private decrypt(value: string) { const [iv, tag, body] = value.split("."); const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64")); decipher.setAuthTag(Buffer.from(tag, "base64")); return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8"); }
  settings() { const row = this.db.prepare("SELECT value FROM settings WHERE id=1").get() as { value?: string } | undefined; if (!row?.value) return undefined; const decoded = JSON.parse(row.value) as Settings; for (const model of Object.values(decoded.roleModels)) if (model.apiKey) model.apiKey = this.decrypt(model.apiKey); return decoded; }
  saveSettings(settings: Settings) { const copy = structuredClone(settings); for (const model of Object.values(copy.roleModels)) if (model.apiKey && model.apiKey !== "已配置") model.apiKey = this.encrypt(model.apiKey); this.db.prepare("INSERT OR REPLACE INTO settings(id,value) VALUES(1,?)").run(JSON.stringify(copy)); }
  saveGame(game: GameSnapshot) { this.db.prepare("INSERT OR REPLACE INTO games(id,snapshot,updated_at) VALUES(?,?,?)").run(game.id, JSON.stringify(game), new Date().toISOString()); }
  game(id: string) { const row = this.db.prepare("SELECT snapshot FROM games WHERE id=?").get(id) as { snapshot?: string } | undefined; return row?.snapshot ? JSON.parse(row.snapshot) as GameSnapshot : undefined; }
  games() { return (this.db.prepare("SELECT snapshot FROM games ORDER BY updated_at DESC").all() as { snapshot: string }[]).map(row => JSON.parse(row.snapshot) as GameSnapshot); }
  addEvent(event: Omit<EventRecord, "id" | "createdAt">) {
    const createdAt = new Date().toISOString();
    const result = this.db.prepare("INSERT INTO events(game_id,phase,type,visibility,audience,payload,created_at) VALUES(?,?,?,?,?,?,?)").run(event.gameId, event.phase, event.type, event.visibility, event.audience ? JSON.stringify(event.audience) : null, JSON.stringify(event.payload), createdAt);
    return { ...event, id: Number(result.lastInsertRowid), createdAt };
  }
  events(gameId: string) { return (this.db.prepare("SELECT * FROM events WHERE game_id=? ORDER BY id").all(gameId) as Array<{ id: number; game_id: string; phase: string; type: string; visibility: Visibility; audience: string | null; payload: string; created_at: string }>).map(row => ({ id: row.id, gameId: row.game_id, phase: row.phase, type: row.type, visibility: row.visibility, audience: row.audience ? JSON.parse(row.audience) : undefined, payload: JSON.parse(row.payload), createdAt: row.created_at })); }
  worldAgents() { return (this.db.prepare("SELECT value FROM world_agents").all() as { value: string }[]).map(x => JSON.parse(x.value) as WorldAgent); }
  worldAgent(id: string) { const row = this.db.prepare("SELECT value FROM world_agents WHERE id=?").get(id) as { value?: string } | undefined; return row?.value ? JSON.parse(row.value) as WorldAgent : undefined; }
  saveWorldAgent(agent: WorldAgent) { this.db.prepare("INSERT OR REPLACE INTO world_agents(id,value) VALUES(?,?)").run(agent.id, JSON.stringify(agent)); }
  guilds() { return (this.db.prepare("SELECT value FROM guilds").all() as { value: string }[]).map(x => JSON.parse(x.value) as Guild); }
  saveGuild(guild: Guild) { this.db.prepare("INSERT OR REPLACE INTO guilds(id,value) VALUES(?,?)").run(guild.id, JSON.stringify(guild)); }
  relations() { return (this.db.prepare("SELECT value FROM relations").all() as { value: string }[]).map(x => JSON.parse(x.value) as Relation); }
  saveRelation(value: Relation) { this.db.prepare("INSERT OR REPLACE INTO relations(from_id,to_id,value) VALUES(?,?,?)").run(value.fromId, value.toId, JSON.stringify(value)); }
  saveChronicle(value: Chronicle) { this.db.prepare("INSERT OR REPLACE INTO chronicles(game_id,value) VALUES(?,?)").run(value.gameId, JSON.stringify(value)); }
  chronicles() { return (this.db.prepare("SELECT value FROM chronicles ORDER BY rowid DESC").all() as { value: string }[]).map(x => JSON.parse(x.value) as Chronicle); }
  saveSafeMemory(agentId: string, gameId: string, summary: string) { this.db.prepare("INSERT OR REPLACE INTO memories(agent_id,game_id,summary) VALUES(?,?,?)").run(agentId, gameId, summary); }
  memories(agentId: string) { return (this.db.prepare("SELECT summary FROM memories WHERE agent_id=? ORDER BY rowid DESC LIMIT 8").all(agentId) as { summary: string }[]).map(x => x.summary); }
  agentProfile(agentId: string) { const row = this.db.prepare("SELECT value FROM agent_model_profiles WHERE agent_id=?").get(agentId) as { value?: string } | undefined; if (!row?.value) return undefined; const profile = JSON.parse(row.value) as AgentModelProfile; if (profile.apiKey) profile.apiKey = this.decrypt(profile.apiKey); return profile; }
  agentProfiles() { return this.worldAgents().map(agent => { const profile = this.agentProfile(agent.id); return profile ? { ...profile, apiKey: profile.apiKey ? "已配置" : undefined } : { id: `profile-${agent.id}`, agentId: agent.id, provider: "mock", model: "offline-demo", enabled: true, timeoutMs: 30000, maxRetries: 2, costLimit: 0 }; }); }
  saveAgentProfile(profile: AgentModelProfile) { const copy = structuredClone(profile); if (copy.apiKey && copy.apiKey !== "已配置") copy.apiKey = this.encrypt(copy.apiKey); this.db.prepare("INSERT OR REPLACE INTO agent_model_profiles(agent_id,value) VALUES(?,?)").run(copy.agentId, JSON.stringify(copy)); }
  deleteAgentProfile(agentId: string) { this.db.prepare("DELETE FROM agent_model_profiles WHERE agent_id=?").run(agentId); }
  addReflection(value: AgentReflection) { this.db.prepare("INSERT OR REPLACE INTO agent_reflections(agent_id,game_id,value) VALUES(?,?,?)").run(value.agentId, value.gameId, JSON.stringify(value)); }
  reflections(agentId: string) { return (this.db.prepare("SELECT value FROM agent_reflections WHERE agent_id=? ORDER BY rowid DESC LIMIT 8").all(agentId) as { value: string }[]).map(x => JSON.parse(x.value) as AgentReflection); }
  logAction(gameId: string, agentId: string, phase: string, action: string, visibility: Visibility) { this.db.prepare("INSERT INTO agent_action_logs(game_id,agent_id,phase,action,visibility,created_at) VALUES(?,?,?,?,?,?)").run(gameId, agentId, phase, action, visibility, new Date().toISOString()); }
  logModelCall(gameId: string | undefined, agentId: string | undefined, profile: AgentModelProfile | undefined, latency: number, status: string) { if (!profile) return; this.db.prepare("INSERT INTO model_call_logs(game_id,agent_id,profile_id,provider,model,latency_ms,status,created_at) VALUES(?,?,?,?,?,?,?,?)").run(gameId ?? null, agentId ?? null, profile.id, profile.provider, profile.model, latency, status, new Date().toISOString()); }
}
