import { config } from "./config";
import type { EventDraft, ISO } from "./types";

// 所有时间显式按 Asia/Shanghai 处理，换算不依赖容器默认时区。
export const TZ = config.timezone;
export const WEEKDAY_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export type Civil = { y: number; m: number; d: number; weekday: number };

const pad = (n: number) => String(n).padStart(2, "0");

export function civilFromDate(date: Date): Civil {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  return { y, m, d, weekday: weekdayOf(y, m, d) };
}

export function today(): Civil {
  return civilFromDate(new Date());
}

export function weekdayOf(y: number, m: number, d: number): number {
  // 0=周一 … 6=周日
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function iso(y: number, m: number, d: number, h = 0, min = 0): ISO {
  return `${pad(y)}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:00+08:00`;
}

export function dateStr(c: Civil): string {
  return `${pad(c.y)}-${pad(c.m)}-${pad(c.d)}`;
}

export function addDays(c: Civil, delta: number): Civil {
  const ms = Date.UTC(c.y, c.m - 1, c.d) + delta * 86400_000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return { y, m, d, weekday: weekdayOf(y, m, d) };
}

// 以自然周（周一至周日）为锚点解析“周三 / 下周三”。
export function resolveWeekday(base: Civil, target: number, isNext: boolean): Civil {
  const monday = addDays(base, -base.weekday); // 本周一
  let candidate = addDays(monday, target); // 本周的目标星期
  if (isNext) {
    // “下周三”= 下一个自然周里的那天，必然严格晚于今天
    candidate = addDays(monday, 7 + target);
  } else if (dateStr(candidate) < dateStr(base)) {
    // 裸说“周三”而该日已在本周过去 -> 取下周
    candidate = addDays(candidate, 7);
  }
  return candidate;
}

export function toMs(s: ISO): number {
  return Date.parse(s);
}

// 取出某 ISO 的“时刻 + 日期”用于展开
function civilOfIso(s: ISO) {
  const dt = new Date(s);
  return civilFromDate(dt);
}

function hourMinOfIso(s: ISO): { h: number; min: number } {
  // 通过 Asia/Shanghai 格式化取时分，避免直接读容器时区
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(s));
  let h = Number(parts.find((p) => p.type === "hour")!.value);
  const min = Number(parts.find((p) => p.type === "minute")!.value);
  if (h === 24) h = 0;
  return { h, min };
}

export type Instance = { start: ISO; end: ISO };

// 把（可能是周期的）日程在其覆盖范围内展开成具体实例
export function expandInstances(draft: EventDraft): Instance[] {
  const rule = draft.recurrence;
  const first = civilOfIso(draft.start);
  const { h, min } = hourMinOfIso(draft.start);
  const { h: eh, min: emin } = hourMinOfIso(draft.end);

  if (!rule) {
    return [{ start: draft.start, end: draft.end }];
  }

  let endCivil: Civil | null = null;
  if (rule.until) endCivil = civilOfIso(rule.until);

  const out: Instance[] = [];
  let cursor = first;
  let guard = 0;
  while (guard++ < 400) {
    let include = false;
    if (rule.freq === "DAILY") include = true;
    else if (rule.byWeekday && rule.byWeekday.length > 0)
      include = rule.byWeekday.includes(cursor.weekday);
    else include = cursor.weekday === first.weekday;

    if (include) {
      out.push({
        start: iso(cursor.y, cursor.m, cursor.d, h, min),
        end: iso(cursor.y, cursor.m, cursor.d, eh, emin),
      });
      if (rule.count && out.length >= rule.count) break;
    }
    if (endCivil && dateStr(cursor) >= dateStr(endCivil)) break;
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function overlaps(
  aS: ISO,
  aE: ISO,
  bS: ISO,
  bE: ISO
): boolean {
  return toMs(aS) < toMs(bE) && toMs(bS) < toMs(aE);
}

export function isPast(s: ISO): boolean {
  return toMs(s) <= Date.now();
}

// 把任意 ISO（可能是 UTC 的 toISOString）转回 +08 墙钟的 ISO 字符串
export function toShanghaiISO(ms: number): ISO {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  let h = Number(g("hour"));
  if (h === 24) h = 0;
  return `${g("year")}-${g("month")}-${g("day")}T${String(h).padStart(2, "0")}:${g("minute")}:${g("second")}+08:00`;
}
