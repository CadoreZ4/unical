import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, fetchUserInfo } from "@/server/feishu-oauth";
import { issueLogin, AUTH_COOKIE, AUTH_TTL_SECONDS, OAUTH_STATE_COOKIE } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 授权回调：校验 state → code 换 token → 取用户信息 → 建登录态（sid 写 httpOnly cookie）
export async function GET(req: Request) {
  const u = new URL(req.url);
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/?oauth=${encodeURIComponent(reason)}`, u.origin));

  if (u.searchParams.get("error")) return fail("denied");

  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code) return fail("nocode");

  // CSRF：校验 login 阶段种下的 state
  const expected = cookies().get(OAUTH_STATE_COOKIE)?.value;
  if (!expected || !state || expected !== state) return fail("bad_state");

  try {
    const tokens = await exchangeCode(code);
    const info = await fetchUserInfo(tokens.accessToken);
    const { sid } = issueLogin(tokens, info);

    const res = NextResponse.redirect(new URL("/?oauth=ok", u.origin));
    res.cookies.set(AUTH_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_TTL_SECONDS,
    });
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (e) {
    const code2 = (e as { code?: string }).code || "token_exchange_failed";
    return fail(code2);
  }
}
