import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { HttpError, apiHandler } from "@/server/api";
import { OAUTH_STATE_COOKIE } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 发起飞书用户授权（OAuth）。未配置 App ID 时给出明确提示。
export const GET = apiHandler(async () => {
  const appId = process.env.FEISHU_APP_ID;
  const redirectUri =
    process.env.FEISHU_REDIRECT_URI || "http://localhost:3000/api/auth/callback";
  if (!appId) {
    throw new HttpError(
      400,
      "FEISHU_NOT_CONFIGURED",
      "缺少 FEISHU_APP_ID。请在飞书开放平台创建自建应用后填入 .env.local，当前可先用 Mock 日历体验。"
    );
  }

  // 用户身份权限：读日历/读日程/建日程/读忙闲 + offline_access（换取 refresh_token）
  const scope =
    process.env.FEISHU_SCOPES ||
    "calendar:calendar:read calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.free_busy:read offline_access";
  const accountsHost = process.env.FEISHU_ACCOUNTS_URL || "https://accounts.feishu.cn";
  const state = randomBytes(16).toString("hex");

  const url =
    `${accountsHost}/open-apis/authen/v1/authorize` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&scope=${encodeURIComponent(scope)}`;

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
});
