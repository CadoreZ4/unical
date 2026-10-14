import { getCurrentUser } from "@/server/auth";
import { repository } from "@/server/repository";
import { HttpError, requireString } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PutBody = {
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  clear?: unknown;
};

// GET /api/user/settings — 获取当前用户的 LLM 配置（不返回明文 key，只返回是否已配置）
export async function GET() {
  const user = getCurrentUser();
  if (!user) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "未登录" } }, { status: 401 });
  }
  const s = repository.getUserLlmSettings(user.id);
  return Response.json({
    hasApiKey: Boolean(s?.apiKey),
    baseUrl: s?.baseUrl ?? null,
    model: s?.model ?? null,
  });
}

// PUT /api/user/settings — 保存/清除用户自带的 LLM 配置
export async function PUT(req: Request) {
  const user = getCurrentUser();
  if (!user) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "未登录" } }, { status: 401 });
  }

  let body: PutBody;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: { code: "BAD_JSON", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  // 清除配置
  if (body.clear === true) {
    repository.saveUserLlmSettings(user.id, { apiKey: null, baseUrl: null, model: null });
    return Response.json({ ok: true });
  }

  try {
    const apiKey = body.apiKey ? requireString(body.apiKey, "apiKey", { max: 500 }) : null;
    const baseUrl = body.baseUrl ? requireString(body.baseUrl, "baseUrl", { max: 500 }) : null;
    const model = body.model ? requireString(body.model, "model", { max: 200 }) : null;
    repository.saveUserLlmSettings(user.id, { apiKey, baseUrl, model });
    return Response.json({ ok: true, hasApiKey: Boolean(apiKey) });
  } catch (e: any) {
    return Response.json(
      { error: { code: e?.code || "VALIDATION", message: e?.message || "参数错误" } },
      { status: e?.status || 400 }
    );
  }
}
