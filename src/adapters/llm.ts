// 可选的 OpenAI 兼容模型网关。未配置时引擎回退到内置确定性规则解析。
export type LlmConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export function llmConfigured(cfg?: LlmConfig): boolean {
  const apiKey = cfg?.apiKey ?? process.env.LLM_API_KEY;
  const baseUrl = cfg?.baseUrl ?? process.env.LLM_BASE_URL;
  return Boolean(apiKey && baseUrl);
}

const REQUEST_TIMEOUT_MS = 150_000;

function resolveCfg(cfg?: LlmConfig) {
  return {
    apiKey: cfg?.apiKey ?? process.env.LLM_API_KEY ?? "",
    baseUrl: cfg?.baseUrl ?? process.env.LLM_BASE_URL ?? "",
    model: cfg?.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini",
  };
}

function commonHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function chatJson(system: string, user: string, cfg?: LlmConfig): Promise<unknown> {
  const { apiKey, baseUrl, model } = resolveCfg(cfg);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: commonHeaders(apiKey),
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("模型响应超时，请重试");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`LLM 请求失败: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || "{}");
}

// 流式对话：逐块回调正文增量，resolve 时返回完整文本。
// 用于"对话表达层"，不做 JSON 约束，让用户看到逐字生成。
export async function chatStream(
  system: string,
  user: string,
  onDelta?: (chunk: string) => void,
  cfg?: LlmConfig
): Promise<string> {
  const { apiKey, baseUrl, model } = resolveCfg(cfg);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: commonHeaders(apiKey),
    body: JSON.stringify({
      model,
      temperature: 0.5,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`LLM 流式请求失败: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const json = JSON.parse(payload);
      const piece: string = json.choices?.[0]?.delta?.content ?? "";
      if (piece) {
        full += piece;
        onDelta?.(piece);
      }
    } catch {
      // 忽略个别无法解析的心跳/分片
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    // SSE 以换行分隔事件；逐行消费，避免缓冲跨块
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.trim()) handleLine(buffer);
  return full;
}
