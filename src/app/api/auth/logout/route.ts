import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiHandler } from "@/server/api";
import { AUTH_COOKIE } from "@/server/auth";
import { repository } from "@/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 退出登录：吊销服务端登录态并清 cookie（已加密落库的 token 保留，下次授权可复用用户记录）
export const POST = apiHandler(async () => {
  const sid = cookies().get(AUTH_COOKIE)?.value;
  if (sid) repository.revokeAuthSession(sid);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AUTH_COOKIE);
  return res;
});
