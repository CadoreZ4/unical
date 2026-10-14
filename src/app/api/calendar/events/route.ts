import { NextResponse } from "next/server";
import { apiHandler, HttpError } from "@/server/api";
import { getCal } from "@/app/api/_helpers";
import { iso } from "@/core/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 应用内日历视图数据源：返回时间窗内的日程（含周期规则，由前端展开实例）。
// GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError(400, "VALIDATION", "from/to 必须是 YYYY-MM-DD");
  }

  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cal = await getCal();
  const events = await cal.listEvents(iso(fy, fm, fd, 0, 0), iso(ty, tm, td, 23, 59));
  return NextResponse.json(
    { events },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
});
