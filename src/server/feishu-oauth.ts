// 飞书用户态 OAuth v2：code 换 token、refresh 刷新、拉用户信息。
// 仅服务端调用，依赖 App ID/Secret（放服务端环境变量，绝不下发浏览器）。

const BASE = () => process.env.FEISHU_BASE_URL || "https://open.feishu.cn";

export type FeishuTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch 毫秒
  scope: string | null;
};

async function postToken(body: Record<string, string>): Promise<FeishuTokenResponse> {
  const res = await fetch(`${BASE()}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  // v2 为标准 OAuth2：成功时字段在顶层（无 code/data 包装）；
  // 失败时返回 { error, error_description, code }。
  if (json.access_token) {
    return {
      accessToken: json.access_token as string,
      refreshToken: json.refresh_token || null,
      expiresAt: Date.now() + (json.expires_in || 7200) * 1000,
      scope: json.scope || null,
    };
  }
  throw Object.assign(
    new Error(
      `飞书换 token 失败 ${json.code ?? ""}: ${json.error_description || json.error || "unknown"}`
    ),
    { status: 502, code: "FEISHU_TOKEN_FAILED" }
  );
}

export function exchangeCode(code: string): Promise<FeishuTokenResponse> {
  return postToken({
    grant_type: "authorization_code",
    client_id: process.env.FEISHU_APP_ID || "",
    client_secret: process.env.FEISHU_APP_SECRET || "",
    code,
    redirect_uri:
      process.env.FEISHU_REDIRECT_URI || "http://localhost:3000/api/auth/callback",
  });
}

export function refreshAccessToken(refreshToken: string): Promise<FeishuTokenResponse> {
  return postToken({
    grant_type: "refresh_token",
    client_id: process.env.FEISHU_APP_ID || "",
    client_secret: process.env.FEISHU_APP_SECRET || "",
    refresh_token: refreshToken,
  });
}

export type FeishuUserInfo = {
  openId: string;
  unionId: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export async function fetchUserInfo(accessToken: string): Promise<FeishuUserInfo> {
  const res = await fetch(`${BASE()}/open-apis/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (json.code !== 0 || !json.data?.open_id) {
    throw Object.assign(new Error(`获取飞书用户信息失败 ${json.code}: ${json.msg || "unknown"}`), {
      status: 502,
      code: "FEISHU_USERINFO_FAILED",
    });
  }
  const d = json.data;
  return {
    openId: d.open_id,
    unionId: d.union_id || null,
    name: d.name || null,
    avatarUrl: d.avatar_url || d.avatar_thumb?.avatar_url || null,
  };
}
