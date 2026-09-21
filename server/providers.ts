import type { ProviderId } from "./types.js";

export interface ProviderPreset { id: ProviderId; name: string; protocol: "mock" | "openai" | "anthropic" | "google"; baseUrl?: string; hint: string; }

/** Defaults are editable because providers can change model catalogs without notice. */
export const PROVIDERS: ProviderPreset[] = [
  { id: "mock", name: "离线演示", protocol: "mock", hint: "无需密钥" },
  { id: "openai", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1", hint: "填写模型名与 API Key" },
  { id: "anthropic", name: "Anthropic", protocol: "anthropic", hint: "Claude 原生接口" },
  { id: "google", name: "Google", protocol: "google", hint: "Gemini 原生接口" },
  { id: "deepseek", name: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com", hint: "OpenAI 兼容" },
  { id: "ark", name: "豆包 Ark", protocol: "openai", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", hint: "火山方舟 OpenAI 兼容" },
  { id: "qianfan", name: "文心千帆", protocol: "openai", baseUrl: "https://qianfan.baidubce.com/v2", hint: "文心及千帆模型" },
  { id: "dashscope", name: "通义千问", protocol: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", hint: "百炼兼容模式" },
  { id: "zhipu", name: "智谱 GLM", protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", hint: "OpenAI 兼容" },
  { id: "moonshot", name: "Kimi", protocol: "openai", baseUrl: "https://api.moonshot.cn/v1", hint: "OpenAI 兼容" },
  { id: "hunyuan", name: "腾讯混元", protocol: "openai", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", hint: "兼容接口，可覆盖地址" },
  { id: "minimax", name: "MiniMax", protocol: "openai", baseUrl: "https://api.minimax.chat/v1", hint: "OpenAI 兼容" },
  { id: "openai-compatible", name: "自定义兼容接口", protocol: "openai", hint: "自定义地址与鉴权" }
];
export const provider = (id: ProviderId) => PROVIDERS.find(p => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
