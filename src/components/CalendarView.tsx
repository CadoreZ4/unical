"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  dateStr,
  expandInstances,
  toShanghaiISO,
  today,
  weekdayOf,
  type Civil,
} from "@/core/time";
import type { RecurrenceRule } from "@/core/types";

type ApiEvent = {
  eventId: string;
  title: string;
  start: string;
  end: string;
  recurrence: RecurrenceRule | null;
  cancelledStarts?: number[];
};

type Occurrence = { key: string; title: string; start: string; end: string };

const WD = ["一", "二", "三", "四", "五", "六", "日"];

export function CalendarView({
  open,
  onClose,
  focusKey,
}: {
  open: boolean;
  onClose: () => void;
  focusKey?: string;
}) {
  const t = today();
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: t.y, m: t.m });
  const [selected, setSelected] = useState<string>(
    focusKey || dateStr(t)
  );
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 打开时定位到指定日期所在月份
  useEffect(() => {
    if (open && focusKey) {
      const [y, m] = focusKey.split("-").map(Number);
      setCursor({ y, m });
      setSelected(focusKey);
    }
  }, [open, focusKey]);

  // 计算月历格子（周一起）与请求窗口
  const { cells, windowFrom, windowTo } = useMemo(() => {
    const first: Civil = { y: cursor.y, m: cursor.m, d: 1, weekday: weekdayOf(cursor.y, cursor.m, 1) };
    const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
    const rows = Math.ceil((first.weekday + daysInMonth) / 7);
    const gridStart = addDays(first, -first.weekday);
    const total = rows * 7;
    const cells = Array.from({ length: total }, (_, i) => addDays(gridStart, i));
    return { cells, windowFrom: dateStr(gridStart), windowTo: dateStr(cells[total - 1]) };
  }, [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // 加时间戳破坏任何缓存，确保拿到飞书最新日程（用户可能刚在飞书删过）
      const r = await fetch(
        `/api/calendar/events?from=${windowFrom}&to=${windowTo}&_t=${Date.now()}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || "加载失败");
      setEvents(d.events || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [windowFrom, windowTo]);

  useEffect(() => {
    if (open) load();
    else setEvents([]); // 关闭时清空，下次打开必定重新拉取
  }, [open, load]);

  // 展开周期日程，按天分组
  const byDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const e of events) {
      const insts = expandInstances({
        clientId: e.eventId,
        title: e.title,
        // 飞书返回 UTC（Z），统一换成 +08 墙钟，保证非周期日程的日期/时刻显示正确
        start: toShanghaiISO(Date.parse(e.start)),
        end: toShanghaiISO(Date.parse(e.end)),
        recurrence: e.recurrence,
        kind: "concrete",
      });
      const cancelled = e.cancelledStarts?.length
        ? new Set(e.cancelledStarts)
        : null;
      for (const i of insts) {
        // 跳过用户在飞书里已单独取消/删除的周期实例
        if (cancelled && cancelled.has(Date.parse(i.start))) continue;
        const key = i.start.slice(0, 10);
        if (key >= windowFrom && key <= windowTo) {
          const arr = map.get(key) || [];
          arr.push({ key: i.start, title: e.title, start: i.start, end: i.end });
          map.set(key, arr);
        }
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [events, windowFrom, windowTo]);

  const todayKey = dateStr(t);
  const selectedOcc = byDay.get(selected) || [];

  const shiftMonth = (delta: number) => {
    const dt = new Date(Date.UTC(cursor.y, cursor.m - 1 + delta, 1));
    setCursor({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1 });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl animate-popIn flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-lift">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">最新日历</h2>
            <p className="text-xs text-ink-faint">来自你的飞书主日历 · 周期日程已展开</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft transition hover:bg-brand-50"
            >
              刷新
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition hover:bg-brand-50 hover:text-ink"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden md:grid-cols-[1fr_260px]">
          {/* 月历 */}
          <div className="flex flex-col border-line p-5 md:border-r">
            <div className="mb-3 flex items-center justify-between">
              <button
                onClick={() => shiftMonth(-1)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-brand-50"
              >
                ‹
              </button>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-ink">
                  {cursor.y} 年 {cursor.m} 月
                </span>
                <button
                  onClick={() => {
                    setCursor({ y: t.y, m: t.m });
                    setSelected(todayKey);
                  }}
                  className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-soft transition hover:bg-brand-50"
                >
                  今天
                </button>
              </div>
              <button
                onClick={() => shiftMonth(1)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-brand-50"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-faint">
              {WD.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid flex-1 grid-cols-7 gap-1">
              {cells.map((c) => {
                const key = dateStr(c);
                const inMonth = c.m === cursor.m;
                const occ = byDay.get(key) || [];
                const isToday = key === todayKey;
                const isSel = key === selected;
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(key)}
                    className={`flex min-h-[64px] flex-col items-start rounded-xl border p-1.5 text-left transition ${
                      isSel
                        ? "border-brand-300 bg-brand-50 shadow-sm"
                        : "border-transparent hover:border-line hover:bg-brand-50/50"
                    } ${inMonth ? "" : "opacity-40"}`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                        isToday
                          ? "bg-brand-500 font-semibold text-white"
                          : "text-ink-soft"
                      }`}
                    >
                      {c.d}
                    </span>
                    <span className="mt-0.5 w-full space-y-0.5">
                      {occ.slice(0, 2).map((o) => (
                        <span
                          key={o.key}
                          className="block truncate rounded bg-brand-100 px-1 py-px text-[10px] leading-tight text-brand-700"
                        >
                          {o.title}
                        </span>
                      ))}
                      {occ.length > 2 && (
                        <span className="block px-1 text-[10px] text-ink-faint">
                          +{occ.length - 2}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {loading && <p className="mt-2 text-center text-[11px] text-ink-faint">加载中…</p>}
            {error && <p className="mt-2 text-center text-[11px] text-red-500">{error}</p>}
          </div>

          {/* 当日议程 */}
          <div className="flex flex-col bg-brand-50/30 p-5">
            <p className="mb-3 text-xs font-semibold text-ink">
              {selected.slice(5).replace("-", " 月 ")} 日 日程
            </p>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {selectedOcc.length === 0 && (
                <p className="text-xs text-ink-faint">这一天还没有日程安排。</p>
              )}
              {selectedOcc.map((o) => (
                <div key={o.key} className="rounded-xl border border-line bg-surface p-2.5 shadow-sm">
                  <p className="text-[11px] font-medium text-brand-600">
                    {o.start.slice(11, 16)} – {o.end.slice(11, 16)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink">{o.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
