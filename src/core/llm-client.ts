import { chatJson, llmConfigured, type LlmConfig } from "@/adapters/llm";
import { config } from "./config";
import { addDays, iso, today, toShanghaiISO } from "./time";
import type { EventDraft, ISO, Plan, RecurrenceRule } from "./types";
import { id } from "./id";

// ===== LLM 输出的中间结构（便于 JSON 校验后再转成领域模型）=====

type LlmRecurrence = {
  freq: "DAILY" | "WEEKLY";
  byWeekday?: number[];
  count?: number | null;
  untilDate?: string | null; // YYYY-MM-DD
};

type LlmEvent = {
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  durationMinutes: number;
  recurrence?: LlmRecurrence | null;
  description?: string;
  inferred?: LlmInference[];
};

type LlmInference = {
  field: string;
  assumed: string;
  reason: string;
};

type ExtractResult = {
  kind: "concrete" | "goal" | "refused";
  event: LlmEvent | null;
  timeVague?: boolean;
  message?: string;
};

type DecomposeResult = {
  plan: {
    goal: string;
    rationale: string;
    frequency: string;
    perSessionMinutes: number;
    durationDays: number;
    content: string;
    checkpoints: string;
    assumptions: string[];
  };
  events: LlmEvent[];
};

// ===== 轻量 JSON 校验（不引入 zod）=====

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function validateExtract(r: unknown): r is ExtractResult {
  if (!isObj(r)) return false;
  if (r.kind === "refused") return typeof r.message === "string";
  if (r.kind !== "concrete" && r.kind !== "goal") return false;
  if (r.kind === "goal") return r.event === null;
  const e = r.event;
  if (!isObj(e)) return false;
  return (
    typeof e.title === "string" &&
    typeof e.date === "string" &&
    typeof e.startTime === "string" &&
    typeof e.durationMinutes === "number"
  );
}

function isDecomposeRefused(r: unknown): r is { refused: true; message: string } {
  return isObj(r) && r.refused === true && typeof r.message === "string";
}

function validateDecompose(r: unknown): r is DecomposeResult {
  if (!isObj(r)) return false;
  if (!isObj(r.plan) || !Array.isArray(r.events)) return false;
  const p = r.plan as Record<string, unknown>;
  return (
    typeof p.goal === "string" &&
    typeof p.frequency === "string" &&
    typeof p.perSessionMinutes === "number" &&
    typeof p.durationDays === "number" &&
    (r.events as unknown[]).every(
      (e) =>
        isObj(e) &&
        typeof (e as LlmEvent).title === "string" &&
        typeof (e as LlmEvent).date === "string" &&
        typeof (e as LlmEvent).startTime === "string" &&
        typeof (e as LlmEvent).durationMinutes === "number"
    )
  );
}

// ===== LLM 事件 → 领域 EventDraft =====

function parseDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function llmEventToDraft(
  e: LlmEvent,
  kind: "concrete" | "goal",
  planId?: string
): EventDraft {
  const { y, m, d } = parseDate(e.date);
  const [hh, mm] = e.startTime.split(":").map(Number);
  const start = iso(y, m, d, hh, mm);
  const endMs = Date.parse(start) + e.durationMinutes * 60_000;
  const end = toShanghaiISO(endMs);

  let recurrence: RecurrenceRule | null = null;
  if (e.recurrence) {
    recurrence = {
      freq: e.recurrence.freq,
      // DAILY 表示自然日每天，忽略模型误带的星期列表；WEEKLY 才使用 byWeekday
      byWeekday:
        e.recurrence.freq === "WEEKLY" && Array.isArray(e.recurrence.byWeekday)
          ? e.recurrence.byWeekday
          : undefined,
    };
    if (e.recurrence.untilDate) {
      const ud = parseDate(e.recurrence.untilDate);
      (recurrence as RecurrenceRule).until = iso(ud.y, ud.m, ud.d, 23, 59);
    }
  }

  return {
    clientId: id("cand"),
    title: e.title,
    start,
    end,
    kind,
    planId,
    description: e.description,
    recurrence,
    inferences: Array.isArray(e.inferred)
      ? e.inferred
          .filter(
            (x) =>
              x &&
              typeof x.field === "string" &&
              typeof x.assumed === "string" &&
              typeof x.reason === "string"
          )
          .map((x) => ({ field: x.field, assumed: x.assumed, reason: x.reason }))
      : undefined,
  };
}

// ===== 注入给 LLM 的默认值（对齐点 A：从 config 注入）=====

function defaultsBlock() {
  return `## 可用默认值（从用户配置注入，可直接使用）
- 默认会议时长：${config.defaultMeetingMinutes} 分钟
- "上午"无具体时刻 → ${config.defaultMorningHour}:00
- "下午"无具体时刻 → ${config.defaultAfternoonHour}:00
- 时区：${config.timezone}，今天是 ${todayStr()}
- "每天"= 自然日（含周末），用 DAILY
- 复盘日程固定：每周日 ${String(config.goal.reviewHour).padStart(2, "0")}:${String(config.goal.reviewMinute).padStart(2, "0")}

## 星期与日期规则（必须严格遵守）
- byWeekday 编号固定为：0=周一, 1=周二, 2=周三, 3=周四, 4=周五, 5=周六, 6=周日。
- freq=DAILY 表示自然日每天（含周末），此时 byWeekday 必须为空数组 []，不要罗列星期。
- 只有 freq=WEEKLY 才用 byWeekday 指定星期；每周日复盘固定为 [6]。
- 首次执行日期默认取明天；若用户说的"周X"恰好就是今天，按下周的那一天算（除非明确说"今天"）。
- 重复规则只给 untilDate（首次日期 + durationDays），不要给 count。`;
}

// 两段 prompt 共用：凡是 AI 替用户补的内容，必须显式标注，不许伪装成用户原话
const INFERENCE_RULE = `## 推测标注（重要）
- 每条事件都要给 inferred 数组，逐项列出"用户没有明说、由你用默认值或常识补全"的字段。
- inferred 每项形如：{"field":"字段名","assumed":"采用的值","reason":"为什么这样猜"}。
- 典型需要标注的情况：
  - 用户只说"下班后/早上/下午"等模糊时段，你据此定的具体 startTime（如把"下班后"理解为 18:00）
  - 用户没说时长，你用了默认时长
  - 用户没给日期，你默认成明天
  - 用户没说标题，你根据内容拟的标题
  - 目标拆解里你替用户定的执行时间（如默认每天 18:00）
- 用户已经明确说清的字段（如"下午三点"的 15:00、"15分钟"的时长）绝对不要标注。
- 若所有字段都来自用户原话，inferred 给空数组 []，不要为了凑数标注。`;

function todayStr(): string {
  const t = today();
  return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
}

// ===== Prompt 1：意图分类 + 明确安排抽取 =====

const EXTRACT_SYSTEM = `你是一个日程安排助手。用户用自然语言告诉你一个安排或目标，你需要拆解关键要素并输出结构化 JSON。

## 一、核心判断（最高优先级）

1. 扫描用户输入，判断是否已经明确了"日期 + 时间段"。
   - 算明确的情况：
     - 用户直接说了时间，如"下周六晚上7点吃饭""这周三下午3点开评审会""明天12点见客户"；
     - 用户给了精确到分钟的时刻（"下午2点""15:30"）。
   - 不算明确的情况："最近""有空的时候""找个时间""下周吧""尽快""什么时候都行""下午"（没说几点）。

2. 只要用户已明确日期+时刻 → kind=concrete，timeVague=false，startTime 用用户给的精确时刻。

3. 用户给了日期但没给精确时刻（如"下周一吃饭""明天下午开会"）→ kind=concrete，timeVague=true。
   - 此时 startTime 可以给一个合理推测值，但必须放进 inferred 标注清楚；系统会另行为用户推荐真实可用时段，不会直接用你猜的时间。

4. 只有抽象目标/愿望（"我要瘦五斤""想学会弹吉他""我想健身"）→ kind=goal，event=null，timeVague=false。

5. 涉及伤害他人、违法违规、报复、骚扰等不当或不安全请求 → kind=refused（即使句子里带时间词，也绝不能判成 concrete）。

## 二、场景时长估算（用于 durationMinutes）

- 吃饭/聚餐：90 分钟；喝咖啡/下午茶：60 分钟；酒吧/喝酒：120 分钟；早餐：60 分钟。
- 工作会议/项目对齐：60 分钟；1v1/汇报/面试：60 分钟；朋友叙旧：90-120 分钟；约会：120-180 分钟。
- 健身/撸铁：60 分钟；跑步/户外：60 分钟；看病/体检：60 分钟；牙医/理疗：60 分钟。
- 看电影：120 分钟；逛展/博物馆：120 分钟；桌游/剧本杀：180-240 分钟；KTV：120 分钟。
- 周边游/郊游：全天（480 分钟）；银行/政务：60 分钟；自习/看书：90 分钟。
- 不确定时默认 60 分钟。

## 三、红线规则（影响分类与时长，不替用户改时间）

- 用户自己报了日期+时间段，哪怕不符合常识（周一逛博物馆、周五下午面试），也照单全收，最多在 inferred 里提醒一句。
- "每天"= 自然日（含周末），用 DAILY；byWeekday 编号：0=周一 … 6=周日。
- 重复规则只给 untilDate，不要给 count。
- 首次执行日期默认取明天；若"周X"恰好是今天，按下周算（除非明确说"今天"）。

## 四、输出 JSON

正常情况：
{
  "kind": "concrete" | "goal",
  "event": null | {
    "title": string,
    "date": "YYYY-MM-DD",
    "startTime": "HH:mm",
    "durationMinutes": number,
    "recurrence": null | { "freq": "DAILY"|"WEEKLY", "byWeekday": [number], "untilDate": "YYYY-MM-DD"|null },
    "inferred": [ { "field": string, "assumed": string, "reason": string } ]
  },
  "timeVague": boolean
}
拒绝情况：
{ "kind": "refused", "event": null, "timeVague": false, "message": "一句话说明无法协助的原因，并给出合法正向的简短建议" }

## 五、推测标注规则

- inferred 列出所有"用户没明说、你用常识补全"的字段（startTime、durationMinutes、date、title）。
- 用户明确说清的字段绝对不要标注。
- 若所有字段都来自用户原话，inferred 给空数组 []。

时区：${config.timezone}，今天是 ${todayStr()}。只输出 JSON，不要解释。`;

// ===== Prompt 2：方案拆解（目标 → 方案 + 日程）=====

function decomposeSystem(existingSummary: string): string {
  return `你是"目标→可执行日程"拆解专家。用户给了一个抽象目标和约束，你要：
1. 设计可执行、可落地的方案（plan）
2. 直接把方案拆解成具体日历日程项（events）

## 安全边界
- 若目标涉及伤害他人、违法违规、报复、骚扰等不当或不安全内容，不要产出任何方案或日程，
  只输出：{ "refused": true, "message": "一句话拒绝原因与合法正向建议", "plan": null, "events": [] }
- 拒绝时不要自作主张把目标改写成别的计划、也不要生成替代性日程。

## 设计原则
- 高频低门槛：优先拆成每天/每周的小动作，而非少数大块时间
- 具体到动作：content 必须写清"做什么、做多少、怎么做"
- 含复盘点：至少一条周期性复盘日程
- 现实可行：考虑场地/器材约束
- "每天"= 自然日（含周末），用 DAILY

## 输出 JSON
正常情况：
{
  "plan": {
    "goal": string,
    "rationale": string,
    "frequency": string,
    "perSessionMinutes": number,
    "durationDays": number,
    "content": string,
    "checkpoints": string,
    "assumptions": [string]
  },
  "events": [
    {
      "title": string,
      "date": "YYYY-MM-DD",
      "startTime": "HH:mm",
      "durationMinutes": number,
      "recurrence": { "freq": "DAILY"|"WEEKLY", "byWeekday": [number], "untilDate": "YYYY-MM-DD" },
      "description": string,
      "inferred": [ { "field": string, "assumed": string, "reason": string } ]
    }
  ]
}

## 已有日程（生成时请避开，不要撞车）
${existingSummary}

## 约束
- 执行类日程默认每天 18:00，首次日期为明天；复盘固定每周日 08:30。
- events 至少包含 1 条执行 + 1 条复盘。
- 所有事件的 untilDate = 首次日期 + durationDays；不要输出 count。
- 只输出 JSON。

${defaultsBlock()}

${INFERENCE_RULE}

## 本阶段标注口径（覆盖上面的通用推测标注，务必遵守）
- 方案本身（plan，以及 events 的标题 title、具体动作 description、频率 recurrence、周期长度）是你为用户设计的提案，会在"方案确认"环节整体展示给用户确认，因此这些一律不要放进 inferred。
- events[].inferred 只列"排期层面、用户没有指定而你采用默认"的项：执行/复盘的具体时刻 startTime（如默认 18:00、周日 08:30）、首次日期 date（默认明天）。
- 若用户在澄清回答里已经说了时间或开始日期，对应项也不要标注。
- 因此通常每条事件的 inferred 只有 0~2 项，不要罗列方案内容。`;
}

// ===== 主函数 =====

export async function llmExtract(text: string, cfg?: LlmConfig): Promise<
  | { kind: "concrete"; event: EventDraft; timeVague: boolean }
  | { kind: "goal" }
  | { kind: "refused"; message: string }
  | null
> {
  if (!llmConfigured(cfg)) return null;
  try {
    const raw = await chatJson(EXTRACT_SYSTEM, `用户说：${text}`, cfg);
    if (!validateExtract(raw)) {
      console.warn("[llm] extract 输出校验失败，回退规则", raw);
      return null;
    }
    if (raw.kind === "refused") return { kind: "refused", message: raw.message! };
    if (raw.kind === "goal") return { kind: "goal" };
    const event = llmEventToDraft(raw.event!, "concrete");
    return { kind: "concrete", event, timeVague: raw.timeVague ?? false };
  } catch (e) {
    console.warn("[llm] extract 调用失败，回退规则", e);
    return null;
  }
}

export async function llmDecompose(
  goal: string,
  answers: string,
  existingEvents: { title: string; start: ISO; end: ISO }[]
): Promise<
  | { plan: Plan; events: EventDraft[] }
  | { refused: true; message: string }
  | null
> {
  if (!llmConfigured()) return null;
  const summary = existingEvents.length
    ? existingEvents
        .map((e) => `- ${e.title}（${e.start.slice(11, 16)}~${e.end.slice(11, 16)}）`)
        .join("\n")
    : "（暂无已有日程）";

  try {
    const raw = await chatJson(
      decomposeSystem(summary),
      `目标：${goal}\n用户回答：${answers}`
    );
    // 安全拒绝必须原样上抛，绝不回退到规则版
    if (isDecomposeRefused(raw)) {
      return { refused: true, message: raw.message };
    }
    if (!validateDecompose(raw)) {
      console.warn("[llm] decompose 输出校验失败，回退规则", raw);
      return null;
    }
    const plan: Plan = {
      id: id("plan"),
      goal: raw.plan.goal,
      rationale: raw.plan.rationale,
      frequency: raw.plan.frequency,
      perSessionMinutes: raw.plan.perSessionMinutes,
      durationDays: raw.plan.durationDays,
      content: raw.plan.content,
      checkpoints: raw.plan.checkpoints,
      assumptions: raw.plan.assumptions,
    };
    const events = raw.events.map((e) => llmEventToDraft(e, "goal", plan.id));
    return { plan, events };
  } catch (e) {
    console.warn("[llm] decompose 调用失败，回退规则", e);
    return null;
  }
}

// ===== 拆分版：先方案、后日程（更小的 JSON，响应更快）=====

const PLAN_ONLY_SYSTEM = `你是"目标→可执行方案"设计专家。用户给了一个抽象目标和约束，你只需要设计方案（plan），不要生成具体日程。

## 安全边界
- 若目标涉及伤害他人、违法违规、报复、骚扰等不当或不安全内容，不要产出方案，
  只输出：{ "refused": true, "message": "一句话拒绝原因与合法正向建议" }
- 拒绝时不要自作主张把目标改写成别的计划。

## 设计原则
- 高频低门槛：优先拆成每天/每周的小动作，而非少数大块时间
- 具体到动作：content 必须写清"做什么、做多少、怎么做"
- 现实可行：考虑场地/器材约束
- "每天"= 自然日（含周末）
- 不自动安排复盘日程（由用户决定是否需要）

## 输出 JSON（只输出 JSON）
{
  "plan": {
    "goal": string,
    "rationale": string,
    "frequency": string,
    "perSessionMinutes": number,
    "durationDays": number,
    "content": string,
    "checkpoints": string,
    "assumptions": [string]
  }
}

## 约束
- assumptions 列 1~3 条关键假设（周期长度、单次时长、场地等）。
- 不要假设具体执行时刻（如 18:00），时间由用户后续确认。
- checkpoints 只写复盘的内容/频率建议，不写具体时刻。
- 只输出 plan，不要输出 events。`;

// 仅生成方案（不含日程），JSON 更小、响应更快
export async function llmPlanOnly(
  goal: string,
  answers: string,
  cfg?: LlmConfig
): Promise<{ plan: Plan } | { refused: true; message: string } | null> {
  if (!llmConfigured(cfg)) return null;
  try {
    const raw = await chatJson(
      PLAN_ONLY_SYSTEM,
      `目标：${goal}\n用户回答/约束：${answers}`,
      cfg
    );
    if (isObj(raw) && raw.refused) {
      return { refused: true, message: String(raw.message || "无法处理该目标") };
    }
    if (!isObj(raw) || !isObj(raw.plan)) {
      console.warn("[llm] planOnly 输出校验失败，回退规则", raw);
      return null;
    }
    const p = raw.plan;
    if (
      typeof p.goal !== "string" ||
      typeof p.rationale !== "string" ||
      typeof p.frequency !== "string" ||
      typeof p.content !== "string" ||
      typeof p.checkpoints !== "string"
    ) {
      console.warn("[llm] planOnly 字段缺失", raw);
      return null;
    }
    const plan: Plan = {
      id: id("plan"),
      goal: p.goal,
      rationale: p.rationale,
      frequency: p.frequency,
      perSessionMinutes: Number(p.perSessionMinutes) || 30,
      durationDays: Number(p.durationDays) || 30,
      content: p.content,
      checkpoints: p.checkpoints,
      assumptions: Array.isArray(p.assumptions)
        ? p.assumptions.map(String)
        : [],
    };
    return { plan };
  } catch (e) {
    console.warn("[llm] planOnly 调用失败，回退规则", e);
    return null;
  }
}

// 根据已确认的方案生成具体日程（第二阶段，按需调用）
export async function llmEventsFromPlan(
  plan: Plan,
  existingEvents: { title: string; start: ISO; end: ISO }[],
  cfg?: LlmConfig
): Promise<{ events: EventDraft[] } | { refused: true; message: string } | null> {
  if (!llmConfigured(cfg)) return null;
  const summary = existingEvents.length
    ? existingEvents
        .map((e) => `- ${e.title}（${e.start.slice(11, 16)}~${e.end.slice(11, 16)}）`)
        .join("\n")
    : "（暂无已有日程）";

  const system = `你是"方案→日历日程"拆解助手。用户已经确认了下面的方案，你只需把它转成具体的日历日程 events，不要改动方案内容。

## 已有日程（生成时请避开，不要撞车）
${summary}

## 输出 JSON（只输出 JSON）
{
  "events": [
    {
      "title": string,
      "date": "YYYY-MM-DD",
      "startTime": "HH:mm",
      "durationMinutes": number,
      "recurrence": { "freq": "DAILY"|"WEEKLY", "byWeekday": [number], "untilDate": "YYYY-MM-DD" },
      "description": string,
      "inferred": [ { "field": string, "assumed": string, "reason": string } ]
    }
  ]
}

## 约束
- 不自动生成复盘日程；只生成方案中明确要求的执行类日程。
- 不要假设具体执行时刻：如果方案没给时间，startTime 统一填 "18:00" 并在 inferred 里标注"时间待用户确认"，系统会让用户另行选择。
- events 只包含执行类日程（每天/每周的动作）。
- 所有事件的 untilDate = 首次日期 + durationDays(${plan.durationDays}天)；不要输出 count。
- DAILY 类型 byWeekday 必须为空数组 []。
- "每天"= 自然日（含周末）。
- 首次日期默认为明天。

${INFERENCE_RULE}

## 本阶段标注口径
- events[].inferred 必须标注 startTime（因为方案不指定时间，需用户后续确认）。
- 方案内容（标题、动作、频率）是用户已确认的提案，不要放进 inferred。`;

  try {
    const raw = await chatJson(system, `已确认方案：\n${JSON.stringify(plan, null, 2)}`, cfg);
    if (isObj(raw) && raw.refused) {
      return { refused: true, message: String(raw.message || "无法生成日程") };
    }
    if (!isObj(raw) || !Array.isArray(raw.events)) {
      console.warn("[llm] eventsFromPlan 输出校验失败，回退规则", raw);
      return null;
    }
    const events = (raw.events as unknown[]).map((e) =>
      llmEventToDraft(e as LlmEvent, "goal", plan.id)
    );
    return { events };
  } catch (e) {
    console.warn("[llm] eventsFromPlan 调用失败，回退规则", e);
    return null;
  }
}
