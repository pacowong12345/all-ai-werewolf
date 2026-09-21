export const ROLE_SLOTS = ["狼人1", "狼人2", "狼人3", "狼人4", "预言家", "女巫", "猎人", "守卫", "村民1", "村民2", "村民3", "村民4"] as const;
export type RoleSlot = typeof ROLE_SLOTS[number];
export type Role = "狼人" | "预言家" | "女巫" | "猎人" | "守卫" | "村民";
export type Visibility = "public" | "omniscient" | "wolves" | "private";

export interface EventRecord {
  id: number;
  gameId: string;
  phase: string;
  type: string;
  visibility: Visibility;
  audience?: number[];
  payload: Record<string, unknown>;
  createdAt: string;
}

export type ProviderId = "mock" | "openai-compatible" | "openai" | "anthropic" | "google" | "deepseek" | "ark" | "qianfan" | "dashscope" | "zhipu" | "moonshot" | "hunyuan" | "minimax";
export interface ModelBinding { provider: ProviderId; baseUrl?: string; apiKey?: string; model: string; profileId?: string; }
export interface Settings { roleModels: Record<RoleSlot, ModelBinding>; }
export interface AgentModelProfile extends ModelBinding { id: string; agentId: string; enabled: boolean; timeoutMs: number; maxRetries: number; costLimit: number; }
export interface AgentReflection { agentId: string; gameId: string; privateSummary: string; publicSummary: string; createdAt: string; }

export interface Guild { id: string; name: string; motto: string; color: string; score: number; }
export interface WorldAgent {
  id: string; name: string; guildId: string; persona: Persona; elo: number; reputation: number;
  games: number; wins: number; contribution: number; strategy: { risk: number; trust: number; initiative: number; deception: number };
  biography: string; titles: string[];
}
export interface Relation { fromId: string; toId: string; score: number; label: "盟友" | "宿敌" | "观察"; updatedAt: string; }
export interface Chronicle { gameId: string; title: string; summary: string; highlights: string[]; hook: string; createdAt: string; }

export interface Player {
  seat: number;
  role: Role;
  slot: RoleSlot;
  persona: Persona;
  alive: boolean;
  belief: Record<number, number>;
  lastGuardedSeat?: number;
  agentId?: string;
  guildId?: string;
}

export interface Persona { name: string; style: string; risk: string; trust: string; bluff: string; }
export interface GameSnapshot {
  id: string; day: number; phase: string; status: "running" | "paused" | "finished" | "error";
  players: Player[]; sheriff?: number; winner?: "狼人" | "好人"; speed: number; error?: string; seed?: number; rosterIds?: string[]; seasonId?: string;
}
