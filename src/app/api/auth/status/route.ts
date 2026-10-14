import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api";
import { getCurrentUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 前端据此渲染「已连接 / Mock」状态
export const GET = apiHandler(async () => {
  const provider = process.env.CALENDAR_PROVIDER === "feishu" ? "feishu" : "mock";
  const user = getCurrentUser();
  return NextResponse.json({
    provider,
    connected: provider === "feishu" ? Boolean(user) : false,
    name: user?.name ?? null,
  });
});
