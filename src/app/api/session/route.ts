import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api";
import { beginSession } from "@/server/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 新建一个业务会话
export const POST = apiHandler(async () => {
  const session = beginSession();
  return NextResponse.json({ session });
});
