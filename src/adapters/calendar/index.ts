import { mockCalendar } from "./mock";
import { createFeishuCalendar } from "./feishu";
import type { CalendarAdapter } from "./types";

export type { CalendarAdapter, ExistingEvent } from "./types";

// 统一入口。接真实飞书时需先完成 OAuth（user_access_token）。
export function getCalendar(token?: string | null): CalendarAdapter {
  const provider = process.env.CALENDAR_PROVIDER || "mock";
  if (provider === "feishu") {
    if (!token) {
      throw new Error(
        "尚未获得飞书授权：请先完成 OAuth 登录（/api/auth/login），或把 CALENDAR_PROVIDER 设为 mock。"
      );
    }
    return createFeishuCalendar(token);
  }
  return mockCalendar;
}
