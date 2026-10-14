import type { CalendarAdapter } from "@/adapters/calendar";
import type { LlmConfig } from "@/adapters/llm";
import { addDays, iso, today, toShanghaiISO } from "./time";
import {
  detectCategory,
  detectMealSubtype,
  extractClockRule,
  extractConcrete,
  hasDateAnchor,
  hasExplicitClock,
  mealWindowFor,
  parseInput,
  preferredStartsFor,
} from "./nlu";
import { buildEventsFromPlan, buildPlan } from "./planner";
import { detectConflicts } from "./conflict";
import type { Candidate, Session, TimeSuggestion, WriteResult } from "./types";
import { id } from "./id";
import type { SaySpec } from "./narrate";

const CONFIRM_RE = /确认|可以|没问题|好的|OK|ok|行|同意|写入/;
const SELECT_NUM_RE = /(?:选|要|第)\s*([1-9])/;
// 用户在"选时段"阶段说这些话 = 想看更多可用时段，而不是确认
const MORE_SLOTS_RE = /还有|其他|换一批|再看看|别的|再来|换个|有没有别的|其他时间|更多/;
// 用户对推荐的时段都不满意，要求列出当天全部可用时间
const ALL_SLOTS_RE = /全部|所有|都不?太?合适|都不行|都不太好|都不要|不满意|列出全部|全部时间|所有时间|都不合适/;
// 用户在询问日历情况（"晚上7点后我有日程吗""那天有空吗"），不是在选时间，不能直接排程
const CALENDAR_QUERY_RE = /日程吗|有空吗|有安排吗|忙吗|有没有.*(日程|安排|空)|是否.*(空|忙)|几点.*(空|有)|之后.*(日程|安排|空)/;

export function createSession(): Session {
  return {
    id: id("sess"),
    stage: "confirm_candidates",
    messages: [],
    candidates: [],
    idempotencyKey: id("idem"),
    createdAt: Date.now(),
  };
}

async function windowEvents(cal: CalendarAdapter) {
  const t = today();
  const from = iso(t.y, t.m, t.d, 0, 0);
  const end = addDays(t, 60);
  const to = iso(end.y, end.m, end.d, 23, 59);
  return cal.listEvents(from, to);
}

async function recompute(session: Session, cal: CalendarAdapter) {
  const existing = await windowEvents(cal);
  session.candidates = detectConflicts(
    session.candidates.map(({ conflict: _c, ...d }) => d),
    existing
  );
}

function conflictText(candidates: Candidate[]): string {
  const bad = candidates.filter((c) => c.conflict.hasConflict);
  if (!bad.length) return "未发现与现有日程冲突。";
  return bad
    .map(
      (c) =>
        `「${c.title}」有冲突：与 ${c.conflict.clashes
          .map((x) => `「${x.withEvent}」`)
          .join("、")} 撞车（仅标红，未自动改期，由你决定）。`
    )
    .join("\n");
}

function slotLabel(start: string, end: string): string {
  return `${start.slice(11, 16)} - ${end.slice(11, 16)}`;
}

export type TurnResult = { session: Session; say: SaySpec };

// 一轮对话：完成状态机推进与结构化计算，返回“要对用户说什么”（SaySpec）。
// 用户消息在此落盘；assistant 文案由叙述层流式生成后再追加（见 message 路由）。
// onPhase 用于在耗时较长的结构化阶段（LLM 拆解 / 读日历 / 写入）回传进度提示。
export async function handleText(
  session: Session,
  text: string,
  cal: CalendarAdapter,
  onPhase?: (label: string) => void,
  llmCfg?: LlmConfig
): Promise<TurnResult> {
  const phase = (label: string) => onPhase?.(label);
  if (session.stage === "committed") {
    session.plan = undefined;
    session.questions = undefined;
    session.pendingGoal = undefined;
    session.candidates = [];
    session.results = undefined;
    session.timeSuggestions = undefined;
    session.pendingCandidate = undefined;
    session.stage = "confirm_candidates";
  }

  session.messages.push({ role: "user", text });
  const say = (s: SaySpec): TurnResult => ({ session, say: s });

  const firstIntent =
    !session.plan &&
    session.candidates.length === 0 &&
    !session.pendingGoal &&
    !session.pendingCandidate &&
    session.stage !== "selecting_time" &&
    session.stage !== "clarifying";

  if (firstIntent) {
    const parsed = await parseInput(text, llmCfg);

    if (parsed.kind === "refused") {
      session.stage = "confirm_candidates";
      return say({ t: "refused", message: parsed.message });
    }

    if (parsed.kind === "goal") {
      session.pendingGoal = text;
      session.stage = "clarifying";
      // 澄清问题由叙述层按目标领域动态生成（学习/健身/阅读…各不相同）
      phase("正在准备和你的目标相关的问题…");
      return say({ t: "clarify", goal: text });
    }

    // 明确安排：单次解析已得到 draft
    const { draft, timeVague } = parsed;

    if (timeVague) {
      // 时间不明确 → 读日历推荐可用时段。按目标类型选择偏好窗口：
      // 约饭优先 12-14 / 18-20，运动优先早晚，会议优先工作时段
      phase("正在查询你的忙闲，推荐可用时段…");
      const date = draft.start.slice(0, 10);
      const duration = Math.round((Date.parse(draft.end) - Date.parse(draft.start)) / 60000);
      const category = detectCategory(draft.title || text);
      const mealSub = detectMealSubtype(text);
      const prefer = preferredStartsFor(category, mealSub).join(",");
      const mealWin = mealWindowFor(mealSub);
      const slots = await cal.suggestTimes(date, duration, prefer, undefined, mealWin ?? undefined);
      session.pendingCandidate = draft;
      session.timeSuggestions = slots;
      session.stage = "selecting_time";
      return say({
        t: "slots",
        title: draft.title,
        dateLabel: date,
        lines: slots.map((s, i) => `${i + 1}. ${slotLabel(s.start, s.end)}`),
      });
    }

    phase("正在检测与现有日程的冲突…");
    session.candidates = detectConflicts([draft], await windowEvents(cal));
    session.stage = "confirm_candidates";
    return say({
      t: "single",
      title: draft.title,
      conflictText: conflictText(session.candidates),
    });
  }

  switch (session.stage) {
    case "selecting_time": {
      const pending = session.pendingCandidate!;
      const currentSlots = session.timeSuggestions || [];

      // 1) 用户明确选了某个序号 → 用该时段，进入确认
      const m = text.match(SELECT_NUM_RE);
      let chosen = -1;
      if (m) chosen = Number(m[1]) - 1;
      if (chosen >= 0 && chosen < currentSlots.length) {
        const slot = currentSlots[chosen];
        pending.start = slot.start;
        pending.end = slot.end;
        session.candidates = detectConflicts([pending], await windowEvents(cal));
        session.timeSuggestions = undefined;
        session.pendingCandidate = undefined;
        session.stage = "confirm_candidates";
        return say({
          t: "slot_chosen",
          label: slotLabel(slot.start, slot.end),
          conflictText: conflictText(session.candidates),
        });
      }

      // 2) 用户对推荐的时段都不满意 → 列出当天全部可用时间（不受餐段窗口限制）
      if (ALL_SLOTS_RE.test(text)) {
        phase("正在列出当天所有可用时段…");
        const date = pending.start.slice(0, 10);
        const duration = Math.round(
          (Date.parse(pending.end) - Date.parse(pending.start)) / 60000
        );
        const all = await cal.suggestTimes(date, duration, undefined, currentSlots, undefined, true);
        if (all.length === 0) {
          return say({
            t: "slots",
            title: pending.title,
            dateLabel: date,
            lines: ["（那天已没有连续空闲时段，建议改天或缩短时长）"],
          });
        }
        session.timeSuggestions = all;
        return say({
          t: "slots",
          title: pending.title,
          dateLabel: date,
          lines: all.map((s, i) => `${i + 1}. ${slotLabel(s.start, s.end)}`),
        });
      }

      // 3) 用户说"还有别的吗 / 换一批" → 重新推荐，排除已推荐过的
      if (MORE_SLOTS_RE.test(text)) {
        phase("正在查询更多可用时段…");
        const date = pending.start.slice(0, 10);
        const duration = Math.round(
          (Date.parse(pending.end) - Date.parse(pending.start)) / 60000
        );
        const category = detectCategory(pending.title || "");
        const mealSub = detectMealSubtype(pending.title || "");
        const prefer = preferredStartsFor(category, mealSub).join(",");
        const mealWin = mealWindowFor(mealSub);
        const next = await cal.suggestTimes(date, duration, prefer, currentSlots, mealWin ?? undefined);
        if (next.length === 0) {
          // 当天没有更多空闲了，让用户直接给时间或改天
          return say({
            t: "slots",
            title: pending.title,
            dateLabel: date,
            lines: ["（那天已没有更多连续空闲时段）"],
          });
        }
        session.timeSuggestions = next;
        return say({
          t: "slots",
          title: pending.title,
          dateLabel: date,
          lines: next.map((s, i) => `${i + 1}. ${slotLabel(s.start, s.end)}`),
        });
      }

      // 3.5) 用户在问日历情况（"晚上7点后我有日程吗""那天有空吗"）→ 只回答，不排程
      //      必须排在时刻检测之前，否则"7点"会被当成选时间直接提交。
      if (CALENDAR_QUERY_RE.test(text)) {
        phase("正在查看你的日历…");
        const origDate = pending.start.slice(0, 10);
        const clock = extractClockRule(text);
        const keepDate = !hasDateAnchor(text);
        const baseDate = keepDate ? origDate : (await extractConcrete(text, llmCfg)).draft.start.slice(0, 10);
        // 查询该日的已有日程
        const all = await windowEvents(cal);
        const dayStart = `${baseDate}T00:00:00+08:00`;
        const dayEnd = `${baseDate}T23:59:59+08:00`;
        const dayEvents = all.filter(
          (e) => e.start >= dayStart && e.start <= dayEnd
        );
        // 如果用户指定了时刻（如"7点后"），只看该时刻之后的日程
        let filtered = dayEvents;
        let rangeLabel = `${baseDate} 全天`;
        if (clock) {
          const hh = String(clock.h).padStart(2, "0");
          const mm = String(clock.min).padStart(2, "0");
          const cutoff = `${baseDate}T${hh}:${mm}:00+08:00`;
          filtered = dayEvents.filter((e) => e.start >= cutoff);
          rangeLabel = `${baseDate} ${hh}:${mm} 之后`;
        }
        let answer: string;
        if (filtered.length === 0) {
          answer = `${rangeLabel} 你没有任何日程安排，是空的。`;
        } else {
          const list = filtered
            .map((e) => `${e.start.slice(11, 16)}-${e.end.slice(11, 16)} ${e.title}`)
            .join("；");
          answer = `${rangeLabel} 你有 ${filtered.length} 条日程：${list}。`;
        }
        const dateLabel = baseDate;
        const lines = currentSlots.map((s, i) => `${i + 1}. ${slotLabel(s.start, s.end)}`);
        return say({
          t: "calendar_query",
          answer,
          title: pending.title,
          dateLabel,
          lines,
        });
      }

      // 4) 用户给了具体时刻（如"下午3点"）→ 只改时刻，保留原日期；
      //    若同时给了新日期，则用新日期。绝不把"没说时间"的回复当成默认时间提交。
      const clock = extractClockRule(text);
      if (clock) {
        const origDate = pending.start.slice(0, 10);
        const keepDate = !hasDateAnchor(text);
        const baseDate = keepDate ? origDate : (await extractConcrete(text, llmCfg)).draft.start.slice(0, 10);
        const newStart = `${baseDate}T${String(clock.h).padStart(2, "0")}:${String(clock.min).padStart(2, "0")}:00+08:00`;
        const duration = Date.parse(pending.end) - Date.parse(pending.start);
        const newEnd = toShanghaiISO(Date.parse(newStart) + duration);
        const merged: Candidate = {
          ...pending,
          start: newStart,
          end: newEnd,
          conflict: { hasConflict: false, clashes: [] },
        };
        session.candidates = detectConflicts([merged], await windowEvents(cal));
        session.timeSuggestions = undefined;
        session.pendingCandidate = undefined;
        session.stage = "confirm_candidates";
        return say({
          t: "slot_custom",
          label: slotLabel(merged.start, merged.end),
          conflictText: conflictText(session.candidates),
        });
      }

      // 5) 其他情况（用户没选序号、没要更多、没给时刻）→ 不提交，重新列出现有时段让用户选
      const date = pending.start.slice(0, 10);
      return say({
        t: "slots",
        title: pending.title,
        dateLabel: date,
        lines: currentSlots.map((s, i) => `${i + 1}. ${slotLabel(s.start, s.end)}`),
      });
    }

    case "clarifying": {
      // 第一步：只生成方案（小 JSON，更快），日程等用户确认方案后再生成
      phase("正在为你设计方案…");
      session.planAnswers = text;
      const result = await buildPlan(session.pendingGoal!, text, llmCfg);
      if (!("plan" in result)) {
        // 安全拒绝
        session.pendingGoal = undefined;
        session.planAnswers = undefined;
        session.questions = undefined;
        session.stage = "confirm_candidates";
        return say({ t: "refused", message: result.message });
      }
      session.plan = result.plan;
      session.candidates = [];
      session.stage = "plan_review";
      return say({ t: "plan", plan: result.plan });
    }

    case "plan_review": {
      if (CONFIRM_RE.test(text)) {
        // 用户确认方案 → 生成具体日程
        phase("正在根据方案生成具体日程，并核对冲突…");
        const existing = await windowEvents(cal);
        const ev = await buildEventsFromPlan(
          session.plan!,
          existing.map((e) => ({ title: e.title, start: e.start, end: e.end })),
          llmCfg
        );
        if (!("events" in ev)) {
          return say({ t: "refused", message: ev.message });
        }
        session.candidates = detectConflicts(ev.events, existing);
        session.stage = "confirm_candidates";
        return say({
          t: "plan_ready",
          count: session.candidates.length,
          conflictText: conflictText(session.candidates),
        });
      }
      // 用户要修改方案 → 带上原回答 + 修改意见重新生成方案
      phase("正在按你的要求调整方案…");
      const baseAnswers = session.planAnswers || "";
      const revised = await buildPlan(
        session.pendingGoal || session.plan!.goal,
        `${baseAnswers}\n【调整要求】${text}`,
        llmCfg
      );
      if (!("plan" in revised)) {
        return say({ t: "refused", message: revised.message });
      }
      session.plan = revised.plan;
      session.stage = "plan_review";
      return say({ t: "plan", plan: revised.plan });
    }

    case "confirm_candidates": {
      if (CONFIRM_RE.test(text)) {
        phase("正在写入你的飞书主日历…");
        const { okN, failN } = await commit(session, cal);
        return say({ t: "committed", okN, failN });
      }
      return say({ t: "hint", key: "edit_candidates" });
    }
  }
  // 所有 stage 均已在上方处理；到此说明状态异常
  throw new Error(`未处理的会话阶段：${session.stage}`);
}

export async function updateCandidate(
  session: Session,
  clientId: string,
  patch: Partial<Pick<Candidate, "title" | "start" | "end" | "description">>,
  cal: CalendarAdapter
): Promise<Session> {
  const idx = session.candidates.findIndex((c) => c.clientId === clientId);
  if (idx >= 0) {
    session.candidates[idx] = { ...session.candidates[idx], ...patch };
    await recompute(session, cal);
  }
  return session;
}

export function removeCandidate(session: Session, clientId: string): Session {
  session.candidates = session.candidates.filter((c) => c.clientId !== clientId);
  return session;
}

// 写入主日历；幂等（已成功的 clientId 跳过）。只返回计数，不写消息。
export async function commit(
  session: Session,
  cal: CalendarAdapter
): Promise<{ okN: number; failN: number }> {
  const done = new Set((session.results || []).filter((r) => r.ok).map((r) => r.clientId));
  // 本轮待写入的候选；同 clientId 上次失败的旧记录需剔除，避免「旧 FAIL + 新 OK」并存
  const retrying = new Set(
    session.candidates.filter((c) => !done.has(c.clientId)).map((c) => c.clientId)
  );
  const results: WriteResult[] = (session.results || []).filter(
    (r) => !(retrying.has(r.clientId) && !r.ok)
  );

  for (const cand of session.candidates) {
    if (done.has(cand.clientId)) continue;
    try {
      const { eventId, link } = await cal.create(cand);
      results.push({ clientId: cand.clientId, ok: true, eventId, link });
    } catch (e: any) {
      results.push({ clientId: cand.clientId, ok: false, error: e?.message || "失败" });
    }
  }

  session.results = results;
  session.stage = "committed";
  const okN = results.filter((r) => r.ok).length;
  return { okN, failN: results.length - okN };
}
