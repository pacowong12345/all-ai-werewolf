import { describe, expect, it } from "vitest";
import { ROLE_SLOTS, type Settings } from "../server/types.js";
import { GameEngine } from "../server/game.js";
import { LocalStore } from "../server/store.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const testStore = () => new LocalStore(mkdtempSync(join(tmpdir(), "wolf-rules-")));

const settings: Settings = { roleModels: Object.fromEntries(ROLE_SLOTS.map(slot => [slot, { provider: "mock", model: "test" }])) } as Settings;

describe("狼人杀规则核心", () => {
  it("创建 12 名玩家，角色组合正确", () => {
    const engine = new GameEngine(testStore(), settings);
    expect(engine.game.players).toHaveLength(12);
    expect(engine.game.players.filter(p => p.role === "狼人")).toHaveLength(4);
    expect(engine.game.players.filter(p => p.role === "村民")).toHaveLength(4);
    expect(engine.game.players.map(p => p.persona.name)).toEqual(expect.arrayContaining(["逻辑侦探", "老练玩家"]));
  });

  it("全知事件可保存，公开事件不会包含狼人密聊", async () => {
    const store = testStore(); const engine = new GameEngine(store, settings);
    await engine.step(); // 警长竞选
    await engine.step(); // 夜晚
    const all = store.events(engine.game.id);
    expect(all.some(e => e.type === "狼人密聊" && e.visibility === "wolves")).toBe(true);
    const publicEvents = all.filter(e => e.visibility === "public");
    expect(publicEvents.some(e => e.type === "狼人密聊")).toBe(false);
  });
});
