import type { EventDraft, ISO, RecurrenceRule } from "@/core/types";
import { config } from "@/core/config";
import { iso, toShanghaiISO } from "@/core/time";
import type { CalendarAdapter, ExistingEvent, TimeSlot } from "./types";

// 飞书日历 OpenAPI 适配（用户态 user_access_token）。
// 实测要点（2026-10，API v4）：
//  - 日程列表的 start_time/end_time 是「秒级时间戳字符串」，不是 JSON，也不是 RFC3339；
//  - 创建日程 body 的 start_time/end_time 才是 {timestamp(秒,字符串), timezone}；
//  - 忙闲 /freebusy/list 的 time_min/time_max 是 RFC3339，且必须带 user_id(open_id)；
//  - 忙闲响应忙碌段在 data.freebusy_list[]，时间为 RFC3339 字符串；
//  - 主日历真实 id 需先 POST /calendars/primary 解析（data.calendars[0].calendar.calendar_id）。
const BASE = process.env.FEISHU_BASE_URL || "https://open.feishu.cn";
const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function untilUTC(rule: RecurrenceRule): string | null {
  if (!rule.until) return null;
  // 转成 UTC 的 yyyyMMddTHHmmssZ
  const dt = new Date(rule.until);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}${g("month")}${g("day")}T${g("hour")}${g("minute")}${g("second")}Z`;
}

// 内部 RecurrenceRule -> 飞书 recurrence 字符串（RFC5545，不带 RRULE: 前缀）
export function toRrule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`, "INTERVAL=1"];
  if (rule.freq === "WEEKLY" && rule.byWeekday && rule.byWeekday.length) {
    parts.push(`BYDAY=${rule.byWeekday.map((w) => BYDAY[w]).join(",")}`);
  }
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  const u = untilUTC(rule);
  if (u) parts.push(`UNTIL=${u}`);
  return parts.join(";");
}

function timeInfo(iso: ISO) {
  return {
    timestamp: String(Math.floor(Date.parse(iso) / 1000)),
    timezone: "Asia/Shanghai",
  };
}

// 飞书日程体里的时间字段可能是 {timestamp,timezone} 或 RFC3339 字符串，统一转 ISO
function toISO(t: unknown, fallback: ISO): ISO {
  if (!t || typeof t !== "object") return fallback;
  const o = t as { timestamp?: string; date?: string };
  if (o.timestamp) return new Date(Number(o.timestamp) * 1000).toISOString();
  if (o.date) return `${o.date}T00:00:00+08:00`;
  return fallback;
}

// 飞书 recurrence 字符串（如 FREQ=WEEKLY;BYDAY=SU;UNTIL=20261129T155900Z）-> 内部规则
function parseRecurrence(raw: unknown): RecurrenceRule | null {
  if (typeof raw !== "string" || !raw) return null;
  const up = raw.toUpperCase();
  const get = (key: string) => {
    const m = up.match(new RegExp(`${key}=([^;]+)`));
    return m ? m[1].trim() : null;
  };
  const freq = get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY") return null;
  const rule: RecurrenceRule = { freq };

  const by = get("BYDAY");
  if (freq === "WEEKLY" && by) {
    const map: Record<string, number> = {
      MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6,
    };
    const days = by
      .split(",")
      .map((x) => map[x.trim()])
      .filter((x): x is number => typeof x === "number");
    if (days.length) rule.byWeekday = days;
  }

  const count = get("COUNT");
  if (count && /^\d+$/.test(count)) rule.count = Number(count);

  const until = get("UNTIL");
  if (until) {
    const m = until.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (m) {
      const [, y, mo, d, hh, mm, ss] = m.map(Number);
      rule.until = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss)).toISOString();
    }
  }
  return rule;
}

class FeishuCalendar implements CalendarAdapter {
  private calendarIdPromise: Promise<string> | null = null;

  constructor(
    private token: string,
    private openId: string | null
  ) {}

  private async request(path: string, init?: RequestInit) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init?.headers || {}),
      },
    });
    const json = await res.json();
    if (json.code !== 0) {
      const detail = json.error?.details?.[0]?.value;
      throw new Error(
        `飞书接口错误 ${json.code}: ${json.msg || "unknown"}${detail ? `（${detail}）` : ""}`
      );
    }
    return json.data;
  }

  // 懒解析并缓存主日历 id
  private resolveCalendarId(): Promise<string> {
    this.calendarIdPromise ??= (async () => {
      const data = await this.request("/open-apis/calendar/v4/calendars/primary", {
        method: "POST",
      });
      const id: string | undefined = data.calendars?.[0]?.calendar?.calendar_id;
      if (!id) throw new Error("未能解析飞书主日历 ID");
      return id;
    })();
    return this.calendarIdPromise;
  }

  async listEvents(from: ISO, to: ISO): Promise<ExistingEvent[]> {
    const calId = await this.resolveCalendarId();
    // 列表接口：秒级时间戳字符串
    const q = new URLSearchParams({
      page_size: "500",
      start_time: String(Math.floor(Date.parse(from) / 1000)),
      end_time: String(Math.floor(Date.parse(to) / 1000)),
    });
    const data = await this.request(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calId)}/events?${q.toString()}`
    );

    // 飞书把周期日程拆成：系列主条目（event_id 以 _0 结尾，status=confirmed）+
    // 每个实例条目（event_id 以 _<timestamp> 结尾）。用户单独取消的实例 status=cancelled。
    // 这里按 event_id 前缀（去掉 _0 / _timestamp）分组，保留主条目，并收集被取消实例的起始时间戳。
    const groups = new Map<string, { master?: any; cancelledStarts: number[] }>();
    for (const e of data.items || []) {
      const fullId: string = e.event_id || "";
      const m = fullId.match(/^(.+)_(\d+)$/);
      const baseId = m ? m[1] : fullId;
      const g = groups.get(baseId) || { cancelledStarts: [] };
      if (e.status === "cancelled") {
        // 被取消的实例：记录其起始时间戳（秒级 timestamp 字段）
        const ts = e.start_time?.timestamp;
        if (ts) g.cancelledStarts.push(Number(ts) * 1000);
      } else if (!g.master) {
        // 系列主条目或单次日程：只保留第一个确认状态的
        g.master = e;
      }
      groups.set(baseId, g);
    }

    const out: ExistingEvent[] = [];
    for (const g of groups.values()) {
      if (!g.master) continue;
      const e = g.master;
      out.push({
        eventId: e.event_id,
        title: e.summary,
        start: toISO(e.start_time, from),
        end: toISO(e.end_time, from),
        recurrence: parseRecurrence(e.recurrence),
        cancelledStarts: g.cancelledStarts.length ? g.cancelledStarts : undefined,
      });
    }
    return out;
  }

  async create(draft: EventDraft) {
    const calId = await this.resolveCalendarId();
    const body = {
      summary: draft.title,
      description: draft.description || "",
      location: draft.location ? { name: draft.location } : undefined,
      start_time: timeInfo(draft.start),
      end_time: timeInfo(draft.end),
      recurrence: draft.recurrence ? toRrule(draft.recurrence) : undefined,
      need_notification: false, // v1 仅本人占位，不通知他人
    };
    const data = await this.request(
      `/open-apis/calendar/v4/calendars/${encodeURIComponent(calId)}/events`,
      { method: "POST", body: JSON.stringify(body) }
    );
    return {
      eventId: data.event.event_id,
      link: data.event.app_link || `${BASE}/calendar/event/${data.event.event_id}`,
    };
  }

  async suggestTimes(
    date: string,
    durationMinutes: number,
    preferStart?: string,
    exclude?: TimeSlot[],
    timeWindow?: [string, string],
    allSlots?: boolean
  ): Promise<TimeSlot[]> {
    const [y, m, d] = date.split("-").map(Number);
    const { startHour, startMinute, endHour, endMinute } = config.workHours;
    let dayStart = iso(y, m, d, startHour, startMinute);
    let dayEnd = iso(y, m, d, endHour, endMinute);

    // 若指定了时间窗口（如晚宴 17:00-21:30），把搜索范围收窄到该窗口
    if (timeWindow) {
      const [ws, we] = timeWindow;
      const [wh, wm] = ws.split(":").map(Number);
      const [eh, em] = we.split(":").map(Number);
      const winStart = iso(y, m, d, wh, wm);
      const winEnd = iso(y, m, d, eh, em);
      dayStart = Date.parse(winStart) > Date.parse(dayStart) ? winStart : dayStart;
      dayEnd = Date.parse(winEnd) < Date.parse(dayEnd) ? winEnd : dayEnd;
    }

    // 忙闲接口：RFC3339 + 当前用户 open_id
    if (!this.openId) throw new Error("缺少用户 open_id，无法查询忙闲");
    const data = await this.request("/open-apis/calendar/v4/freebusy/list", {
      method: "POST",
      body: JSON.stringify({
        time_min: toShanghaiISO(Date.parse(dayStart)),
        time_max: toShanghaiISO(Date.parse(dayEnd)),
        user_id: this.openId,
      }),
    });

    // 忙碌段：data.freebusy_list[]，{start_time,end_time} 均为 RFC3339。
    // 注意：统一转成 epoch 毫秒再比较——不同 UTC 偏移写法的 ISO 字符串不能直接做词法比较。
    const busy: { start: number; end: number }[] = (data.freebusy_list || [])
      .map((b: any) => ({
        start: Date.parse(b.start_time),
        end: Date.parse(b.end_time),
      }))
      .sort((a: { start: number; end: number }, b: { start: number; end: number }) => a.start - b.start);

    // 计算工作时间内的空闲段
    const dayStartMs = Date.parse(dayStart);
    const dayEndMs = Date.parse(dayEnd);
    const free: { start: number; end: number }[] = [];
    let cursor = dayStartMs;
    for (const b of busy) {
      if (b.start > cursor) free.push({ start: cursor, end: b.start });
      if (b.end > cursor) cursor = b.end;
    }
    if (cursor < dayEndMs) free.push({ start: cursor, end: dayEndMs });

    const durMs = durationMinutes * 60_000;
    const fits = free.filter((s) => s.end - s.start >= durMs);

    const excludeStarts = new Set(
      (exclude || []).map((s) => Date.parse(s.start))
    );
    const slots: TimeSlot[] = [];
    const MAX_SLOTS = allSlots ? Infinity : 5;
    const pushSlot = (startMs: number) => {
      if (excludeStarts.has(startMs)) return;
      if (slots.some((x) => Date.parse(x.start) === startMs)) return;
      slots.push({
        start: toShanghaiISO(startMs),
        end: toShanghaiISO(startMs + durMs),
      });
    };

    // 1) 优先按偏好起点（可能是单个或按类型给的一组）在空闲段里对齐
    const preferredList: string[] = [];
    if (preferStart) {
      // preferStart 可能是 "18:00" 或 "12:00,18:00" 这种逗号分隔列表
      preferredList.push(...preferStart.split(",").map((s) => s.trim()).filter(Boolean));
    }
    for (const pref of preferredList) {
      if (slots.length >= MAX_SLOTS) break;
      const prefMs = Date.parse(`${date}T${pref}:00+08:00`);
      const seg = fits.find((s) => s.start <= prefMs && prefMs + durMs <= s.end);
      if (seg) pushSlot(prefMs);
    }

    // 2) 再把每个空闲段的起点、以及段内按 30 分钟步进的可用点都纳入候选，取前 MAX_SLOTS 个
    const candidates: number[] = [];
    for (const s of fits) {
      candidates.push(s.start);
      let t = s.start + 30 * 60_000;
      while (t + durMs <= s.end) {
        candidates.push(t);
        t += 30 * 60_000;
      }
    }
    candidates.sort((a, b) => a - b);
    for (const c of candidates) {
      if (slots.length >= MAX_SLOTS) break;
      pushSlot(c);
    }

    // 按起始时间升序返回，方便用户阅读
    slots.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return slots;
  }
}

export function createFeishuCalendar(token: string, openId?: string | null): CalendarAdapter {
  return new FeishuCalendar(token, openId ?? null);
}
