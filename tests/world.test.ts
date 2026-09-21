import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../server/providers.js";
import { GUILDS, seedAgents, seededShuffle } from "../server/world.js";

describe("月下议会世界层", () => {
  it("建立三大公会与 36 名稳定常驻 AI", () => {
    const agents = seedAgents();
    expect(GUILDS).toHaveLength(3);
    expect(agents).toHaveLength(36);
    expect(new Set(agents.map(x => x.id)).size).toBe(36);
    expect(agents.filter(x => x.guildId === "umbra")).toHaveLength(12);
  });
  it("相同种子抽取相同 12 人，且供应商目录完整", () => {
    const first = seededShuffle(seedAgents(), 4242).slice(0, 12).map(x => x.id);
    const second = seededShuffle(seedAgents(), 4242).slice(0, 12).map(x => x.id);
    expect(first).toEqual(second);
    expect(PROVIDERS.map(x => x.id)).toEqual(expect.arrayContaining(["deepseek", "ark", "qianfan", "dashscope", "zhipu", "moonshot", "hunyuan", "minimax"]));
  });
});
