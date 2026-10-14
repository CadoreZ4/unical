import { config } from "./config";
import { addDays, iso, today } from "./time";
import { llmEventsFromPlan, llmPlanOnly } from "./llm-client";
import type { LlmConfig } from "@/adapters/llm";
import type {
  ClarificationQuestion,
  EventDraft,
  Inference,
  ISO,
  Plan,
} from "./types";
import { id } from "./id";

export const CLARIFICATION_QUESTIONS: ClarificationQuestion[] = [
  { id: "deadline", label: "希望多久内达成 / 截止时间？（如：1 个月、6 周）" },
  { id: "effort", label: "每次大概能投入多长时间？（如：15 分钟、半小时）" },
  { id: "venue", label: "主要在哪里做、有无器材？（如：办公室无器材 / 家里有哑铃）" },
];

type GoalType = "fitness" | "study" | "reading" | "generic";

function goalType(goal: string): GoalType {
  if (/瘦|减肥|减重|减脂|健身/.test(goal)) return "fitness";
  if (/学|考|背单词|练/.test(goal)) return "study";
  if (/读|看书|阅读/.test(goal)) return "reading";
  return "generic";
}

type Answers = { durationDays: number; perSessionMinutes: number; venue: string };

function parseAnswers(text: string): Answers {
  let durationDays = config.goal.defaultDurationDays;
  const d = text.match(/(\d+(?:\.\d+)?)\s*(个月|月|周|星期|天|日)/);
  if (d) {
    const n = Number(d[1]);
    durationDays = /月/.test(d[2])
      ? Math.round(n * 30)
      : /周|星期/.test(d[2])
      ? Math.round(n * 7)
      : Math.round(n);
  }
  let perSessionMinutes = config.goal.dailySessionMinutes;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(小时|分钟|分|钟头)/);
  if (m) {
    const n = Number(m[1]);
    perSessionMinutes = /小时|钟头/.test(m[2]) ? Math.round(n * 60) : Math.round(n);
  } else if (/半小时/.test(text)) perSessionMinutes = 30;
  let venue = "办公室（无器材）";
  if (/家/.test(text)) venue = "家里";
  if (/健身房|器材|哑铃|杠铃/.test(text)) venue = "有器材场地";
  if (/户外|跑步|操场/.test(text)) venue = "户外";
  return { durationDays, perSessionMinutes, venue };
}

function contentFor(type: GoalType, minutes: number, venue: string): string {
  if (type === "fitness") {
    if (/办公室/.test(venue)) {
      return [
        `约 ${minutes} 分钟办公室循环（无器材）：`,
        "1) 徒手深蹲 15 次；2) 靠墙静蹲 30 秒；",
        "3) 站姿提踵 20 次；4) 平板支撑 30 秒；",
        "5) 原地高抬腿 30 秒。循环 2 组，动作间休息 20 秒。",
      ].join("");
    }
    return `约 ${minutes} 分钟：热身 3 分钟 + 自重力量（深蹲/俯卧撑/平板）+ 拉伸 3 分钟。`;
  }
  if (type === "study") {
    return `约 ${minutes} 分钟专注学习：先 2 分钟回顾上次内容，主体练习，最后 3 分钟做要点笔记。`;
  }
  if (type === "reading") {
    return `约 ${minutes} 分钟阅读：固定页数目标，读完用 3 句话记录收获。`;
  }
  return `约 ${minutes} 分钟：执行一个最小可推进的动作，并记录进展。`;
}

// 规则版回退（LLM 不可用时）
function buildPlanRule(goal: string, rawAnswers: string): Plan {
  const a = parseAnswers(rawAnswers);
  const type = goalType(goal);
  const isFitness = type === "fitness";
  return {
    id: id("plan"),
    goal,
    rationale: isFitness
      ? "用高频、低门槛、在办公场景就能完成的动作制造稳定热量缺口与肌肉参与，比依赖大段去健身房时间更可持续。"
      : "把目标拆成每天固定的小时间块，靠连续性而非单次强度推进。",
    frequency: "每天（含周末，自然日）",
    perSessionMinutes: a.perSessionMinutes,
    durationDays: a.durationDays,
    content: contentFor(type, a.perSessionMinutes, a.venue),
    checkpoints: "建议每周固定一次复盘：记录进展、评估完成率并微调下一周（时间由你决定）。",
    assumptions: [
      `周期按 ${a.durationDays} 天计`,
      `每天单次约 ${a.perSessionMinutes} 分钟（具体时刻待你确认）`,
      `场地假设：${a.venue}`,
    ],
  };
}

function planToDraftsRule(plan: Plan): EventDraft[] {
  const g = config.goal;
  const start = addDays(today(), 1);
  const end = addDays(start, plan.durationDays);
  const until = iso(end.y, end.m, end.d, 23, 59);

  const daily: EventDraft = {
    clientId: id("cand"),
    title: `${plan.goal.replace(/^我要|^我想/g, "")}·每日执行`,
    start: iso(start.y, start.m, start.d, g.dailyHour, g.dailyMinute),
    end: iso(start.y, start.m, start.d, g.dailyHour, g.dailyMinute + plan.perSessionMinutes),
    kind: "goal",
    planId: plan.id,
    description: plan.content,
    recurrence: { freq: "DAILY", until },
    inferences: [
      {
        field: "startTime",
        assumed: `${String(g.dailyHour).padStart(2, "0")}:${String(g.dailyMinute).padStart(2, "0")}`,
        reason: "方案未指定执行时刻，时间待你确认",
      },
      {
        field: "date",
        assumed: "明天开始",
        reason: "未指定开始日期，默认从明天起",
      },
    ],
  };

  // 不再自动生成复盘日程
  return [daily];
}

// ===== 对外：优先 LLM，回退规则 =====
// 拆成两步：先生成方案（小 JSON，快），用户确认后再生成日程
// 安全拒绝（refused）原样透传，绝不回退规则

// 第一步：仅生成方案
export async function buildPlan(
  goal: string,
  answers: string,
  cfg?: LlmConfig
): Promise<{ plan: Plan } | { refused: true; message: string }> {
  const r = await llmPlanOnly(goal, answers, cfg);
  if (r) {
    if ("refused" in r) return { refused: true, message: r.message };
    return { plan: r.plan };
  }
  const plan = buildPlanRule(goal, answers);
  return { plan };
}

// 第二步：根据已确认的方案生成具体日程
export async function buildEventsFromPlan(
  plan: Plan,
  existingEvents: { title: string; start: ISO; end: ISO }[],
  cfg?: LlmConfig
): Promise<{ events: EventDraft[] } | { refused: true; message: string }> {
  const r = await llmEventsFromPlan(plan, existingEvents, cfg);
  if (r) {
    if ("refused" in r) return { refused: true, message: r.message };
    return { events: r.events };
  }
  return { events: planToDraftsRule(plan) };
}

// 兼容旧调用（一次性生成方案+日程），内部走两步
export async function decomposeGoal(
  goal: string,
  answers: string,
  existingEvents: { title: string; start: ISO; end: ISO }[]
): Promise<
  | { plan: Plan; events: EventDraft[] }
  | { refused: true; message: string }
> {
  const planR = await buildPlan(goal, answers);
  if ("refused" in planR) return planR;
  const evR = await buildEventsFromPlan(planR.plan, existingEvents);
  if ("refused" in evR) return evR;
  return { plan: planR.plan, events: evR.events };
}
