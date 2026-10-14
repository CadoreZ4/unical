import type { EventDraft, ISO, RecurrenceRule } from "@/core/types";
import { addDays, expandInstances, iso, overlaps, toShanghaiISO, today, type Civil } from "@/core/time";
import { config } from "@/core/config";
import type { CalendarAdapter, ExistingEvent, TimeSlot } from "./types";

// Mock 日历：预置几条“已有安排”，让冲突标红和时段推荐在无真实飞书时也能演示。
class MockCalendar implements CalendarAdapter {
  // 固定两条种子日程：明天 14:00-15:00 产品评审、后天 10:00-11:00 周会
  private seed(t0: Civil = today()): ExistingEvent[] {
    const day1 = addDays(t0, 1);
    const day2 = addDays(t0, 2);
    return [
      {
        eventId: "mock-evt-1",
        title: "产品评审会",
        start: iso(day1.y, day1.m, day1.d, 14, 0),
        end: iso(day1.y, day1.m, day1.d, 15, 0),
      },
      {
        eventId: "mock-evt-2",
        title: "团队周会",
        start: iso(day2.y, day2.m, day2.d, 10, 0),
        end: iso(day2.y, day2.m, day2.d, 11, 0),
      },
    ];
  }

  private inWindow(e: ExistingEvent, from: ISO, to: ISO): boolean {
    const insts = e.recurrence
      ? expandInstances({
          clientId: e.eventId,
          title: e.title,
          start: e.start,
          end: e.end,
          recurrence: e.recurrence,
          kind: "concrete",
        })
      : [{ start: e.start, end: e.end }];
    return insts.some((i) => overlaps(i.start, i.end, from, to));
  }

  async listEvents(from: ISO, to: ISO): Promise<ExistingEvent[]> {
    return this.seed().filter((e) => this.inWindow(e, from, to));
  }

  private created = new Map<string, { eventId: string; link: string }>();
  private seq = 100;

  async create(draft: EventDraft) {
    const eventId = `mock-evt-${this.seq++}`;
    const link = `https://mock-calendar.local/event/${eventId}`;
    this.created.set(draft.clientId, { eventId, link });
    return { eventId, link };
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
    if (timeWindow) {
      const [ws, we] = timeWindow;
      const [wh, wm] = ws.split(":").map(Number);
      const [eh, em] = we.split(":").map(Number);
      const winStart = iso(y, m, d, wh, wm);
      const winEnd = iso(y, m, d, eh, em);
      dayStart = Date.parse(winStart) > Date.parse(dayStart) ? winStart : dayStart;
      dayEnd = Date.parse(winEnd) < Date.parse(dayEnd) ? winEnd : dayEnd;
    }

    // 取当天已有日程的忙时段
    const busy = this.seed()
      .filter((e) => this.inWindow(e, dayStart, dayEnd))
      .map((e) => {
        // 展开后取当天的实例
        const insts = e.recurrence
          ? expandInstances({
              clientId: e.eventId,
              title: e.title,
              start: e.start,
              end: e.end,
              recurrence: e.recurrence,
              kind: "concrete",
            })
          : [{ start: e.start, end: e.end }];
        return insts[0];
      })
      .filter((i) => overlaps(i.start, i.end, dayStart, dayEnd))
      .sort((a, b) => a.start.localeCompare(b.start));

    // 计算工作时间内的空闲段
    const free: { start: ISO; end: ISO }[] = [];
    let cursor = dayStart;
    for (const b of busy) {
      if (b.start > cursor) free.push({ start: cursor, end: b.start });
      if (b.end > cursor) cursor = b.end;
    }
    if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });

    const durMs = durationMinutes * 60_000;
    const fits = free.filter(
      (s) => Date.parse(s.end) - Date.parse(s.start) >= durMs
    );

    const excludeStarts = new Set((exclude || []).map((s) => Date.parse(s.start)));
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

    const preferredList: string[] = [];
    if (preferStart) {
      preferredList.push(...preferStart.split(",").map((s) => s.trim()).filter(Boolean));
    }
    for (const pref of preferredList) {
      if (slots.length >= MAX_SLOTS) break;
      const prefMs = Date.parse(`${date}T${pref}:00+08:00`);
      if (fits.some((s) => Date.parse(s.start) <= prefMs && prefMs + durMs <= Date.parse(s.end))) {
        pushSlot(prefMs);
      }
    }
    for (const s of fits) {
      if (slots.length >= MAX_SLOTS) break;
      pushSlot(Date.parse(s.start));
    }
    slots.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return slots;
  }
}

export const mockCalendar: CalendarAdapter = new MockCalendar();
