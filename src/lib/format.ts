import type { ISO } from "@/core/types";

const WD = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function parts(iso: ISO) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return g;
}

// “9月30日 周三 14:00”
export function formatDateTime(iso: ISO): string {
  const g = parts(iso);
  const jsDay = new Date(
    Date.UTC(Number(g("year")), Number(g("month")) - 1, Number(g("day")))
  ).getUTCDay();
  const weekday = WD[(jsDay + 6) % 7];
  return `${+g("month")}月${+g("day")}日 ${weekday} ${g("hour")}:${g("minute")}`;
}

// datetime-local 输入值（按 +08 的墙钟时间）
export function toLocalInput(iso: ISO): string {
  const g = parts(iso);
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

// datetime-local 值 -> +08 ISO
export function fromLocalInput(value: string): ISO {
  return `${value}:00+08:00`;
}

export function durationMinutes(start: ISO, end: ISO): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 60000);
}

export function shiftKeepingDuration(
  oldStart: ISO,
  oldEnd: ISO,
  newStart: ISO
): { start: ISO; end: ISO } {
  const dur = durationMinutes(oldStart, oldEnd);
  const end = new Date(Date.parse(newStart) + dur * 60000)
    .toISOString();
  // 转 +08 墙钟
  const g = parts(end);
  return {
    start: newStart,
    end: `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:00+08:00`,
  };
}
