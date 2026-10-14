import { cookies } from "next/headers";
import { mockCalendar } from "@/adapters/calendar/mock";
import { createFeishuCalendar } from "@/adapters/calendar/feishu";
import type { CalendarAdapter } from "@/adapters/calendar/types";
import { repository, type AuthUser } from "./repository";
import { refreshAccessToken, type FeishuTokenResponse, type FeishuUserInfo } from "./feishu-oauth";
import { HttpError, logger } from "./api";

export const AUTH_COOKIE = "unical_sid";
export const OAUTH_STATE_COOKIE = "oauth_state";
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 登录态 30 天
export const AUTH_TTL_SECONDS = AUTH_TTL_MS / 1000;
const REFRESH_MARGIN_MS = 60 * 1000; // 距过期不足 1 分钟即提前刷新

// 白名单：ALLOWED_OPEN_IDS 为空/未设置时放行所有人；否则只允许列表内的飞书 open_id
function allowedOpenIds(): Set<string> | null {
  const raw = process.env.ALLOWED_OPEN_IDS?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isOpenIdAllowed(openId: string): boolean {
  const wl = allowedOpenIds();
  if (!wl) return true;
  return wl.has(openId);
}

function currentSid(): string | undefined {
  return cookies().get(AUTH_COOKIE)?.value;
}

export function getCurrentUser(): AuthUser | null {
  const sid = currentSid();
  if (!sid) return null;
  return repository.getAuthUser(sid);
}

// OAuth 回调成功后：建/更新用户 → 存加密 token → 建立登录态，返回 sid
export function issueLogin(
  tokens: FeishuTokenResponse,
  info: FeishuUserInfo
): { sid: string; user: AuthUser } {
  // 白名单校验
  if (!isOpenIdAllowed(info.openId)) {
    throw new HttpError(
      403,
      "NOT_ALLOWED",
      "当前账号不在允许名单内，请联系管理员开通权限。"
    );
  }
  const userId = repository.upsertFeishuUser({
    openId: info.openId,
    unionId: info.unionId,
    name: info.name,
    avatarUrl: info.avatarUrl,
  });
  repository.saveTokens(userId, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
  });
  const sid = repository.createAuthSession(userId, AUTH_TTL_MS);
  return {
    sid,
    user: { id: userId, provider: "feishu", openId: info.openId, name: info.name },
  };
}

// 取得当前请求可用的日历：mock 直接返回；feishu 需登录且自动刷新过期 token。
export async function getCalendar(): Promise<CalendarAdapter> {
  const provider = process.env.CALENDAR_PROVIDER || "mock";
  if (provider !== "feishu") return mockCalendar;

  const user = getCurrentUser();
  if (!user) {
    throw new HttpError(401, "FEISHU_UNAUTHORIZED", "尚未连接飞书，请先完成授权（右上角“连接飞书”）。");
  }

  const tokens = repository.getTokens(user.id);
  if (!tokens) {
    throw new HttpError(401, "FEISHU_UNAUTHORIZED", "未找到飞书授权信息，请重新连接。");
  }

  let accessToken = tokens.accessToken;
  if (tokens.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    if (!tokens.refreshToken) {
      throw new HttpError(401, "FEISHU_TOKEN_EXPIRED", "飞书登录已过期，请重新连接。");
    }
    try {
      const fresh = await refreshAccessToken(tokens.refreshToken);
      repository.saveTokens(user.id, fresh);
      accessToken = fresh.accessToken;
      logger.info("飞书 access_token 已自动刷新", { userId: user.id });
    } catch (e) {
      logger.warn("刷新飞书 token 失败，需重新授权", {
        userId: user.id,
        error: e instanceof Error ? e.message : String(e),
      });
      throw new HttpError(401, "FEISHU_TOKEN_EXPIRED", "飞书登录已失效，请重新连接。");
    }
  }

  return createFeishuCalendar(accessToken, user.openId);
}
