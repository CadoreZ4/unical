import { NextResponse } from "next/server";

// 统一的受控错误：带 HTTP 状态与机器可读 code
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// 极简结构化日志（带时间戳），后续可平滑替换为 pino/winston
export const logger = {
  info: (msg: string, meta?: unknown) =>
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg, ...(meta as object) })),
  warn: (msg: string, meta?: unknown) =>
    console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg, ...(meta as object) })),
  error: (msg: string, meta?: unknown) =>
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg, ...(meta as object) })),
};

// 安全解析 JSON 请求体
export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "BAD_JSON", "请求体不是合法 JSON");
  }
}

export function requireString(value: unknown, field: string, opts?: { max?: number }): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "VALIDATION", `字段 ${field} 不能为空`);
  }
  const v = value.trim();
  if (opts?.max && v.length > opts.max) {
    throw new HttpError(400, "VALIDATION", `字段 ${field} 长度不能超过 ${opts.max}`);
  }
  return v;
}

// 只允许给定键的字符串字段（用于候选日程的局部更新）
export function pickStringFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
  max = 2000
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v !== "string" || !v.trim()) {
      throw new HttpError(400, "VALIDATION", `字段 ${key} 必须是非空字符串`);
    }
    if (v.length > max) throw new HttpError(400, "VALIDATION", `字段 ${key} 过长`);
    out[key] = v.trim();
  }
  return out;
}

// 路由统一包装：捕获错误 → 标准 JSON 响应 + 服务端日志
type Ctx = { params: Record<string, string> };
export function apiHandler(
  fn: (req: Request, ctx: Ctx) => Promise<NextResponse>
) {
  return async (req: Request, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status >= 500) logger.error(e.message, { code: e.code });
        return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      }
      const message = e instanceof Error ? e.message : "内部错误";
      logger.error("未处理异常", { error: message });
      return NextResponse.json(
        { error: { code: "INTERNAL", message: "服务暂时不可用，请稍后重试" } },
        { status: 500 }
      );
    }
  };
}
