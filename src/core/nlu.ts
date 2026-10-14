import { llmExtract } from "./llm-client";
import type { LlmConfig } from "@/adapters/llm";
import type { EventDraft, Inference } from "./types";

// ===== 规则版（LLM 不可用时的回退）=====

const WD_CHAR: Record<string, number> = {
  一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 末: 5,
};
const WEEKDAY_RE = /(下|下个个)?(?:个)?(?:星期|礼拜|周)\s*([一二三四五六日天末])/;
const REL_DAY_RE = /(今天|今日|明天|明日|后天)/;
const CLOCK_RE = /([01]?\d|2[0-3]):([0-5]\d)/;
const DIAN_RE =
  /(上午|早上|早晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*点(?:\s*(半|\d{1,2})\s*分?)?/;
const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
const CN_DIAN_RE =
  /(上午|早上|早晨|中午|下午|傍晚|晚上)?\s*([零一二两三四五六七八九十])\s*点(半)?/;
const DURATION_RE = /(\d+(?:\.\d+)?)\s*(?:个)?\s*(小时|钟头|分钟|分)/;

import { config } from "./config";
import { addDays, iso, resolveWeekday, today, type Civil } from "./time";
import { id } from "./id";

export type InputKind = "concrete" | "goal";

function classifyRule(text: string): InputKind {
  const hasAnchor =
    WEEKDAY_RE.test(text) || REL_DAY_RE.test(text) || /\d{1,2}\s*[点:]/.test(text);
  const hasGoalMarker =
    /我要|我想|我打算|我准备|想要|打算|希望|目标|想\s*瘦|想\s*学/.test(text);
  const hasGoalNoun = /瘦|减肥|减重|减脂|学会|读完|看完|健身|养成|背单词/.test(text);
  if (hasAnchor) return "concrete";
  if (hasGoalMarker || hasGoalNoun) return "goal";
  return "concrete";
}

function resolveDay(text: string): Civil {
  const base = today();
  const rel = text.match(REL_DAY_RE);
  if (rel) {
    if (/明天|明日/.test(rel[1])) return addDays(base, 1);
    if (/后天/.test(rel[1])) return addDays(base, 2);
    return base;
  }
  const wd = text.match(WEEKDAY_RE);
  if (wd) {
    const isNext = wd[1] === "下" || text.includes("下周");
    return resolveWeekday(base, WD_CHAR[wd[2]], isNext);
  }
  return addDays(base, 1);
}

function resolveClock(text: string): { h: number; min: number } {
  const clock = text.match(CLOCK_RE);
  if (clock) return { h: Number(clock[1]), min: Number(clock[2]) };
  const period = text.match(/(上午|早上|早晨|中午|下午|傍晚|晚上)/)?.[1];
  const dian = text.match(DIAN_RE);
  if (dian) {
    let h = Number(dian[2]);
    let min = 0;
    if (dian[3] === "半") min = 30;
    else if (dian[3]) min = Number(dian[3]);
    if (/下午|傍晚|晚上/.test(period || "") && h < 12) h += 12;
    if (period === "中午") h = 12;
    return { h, min };
  }
  const cnDian = text.match(CN_DIAN_RE);
  if (cnDian) {
    let h = CN_NUM[cnDian[2]];
    const min = cnDian[3] === "半" ? 30 : 0;
    if (/下午|傍晚|晚上/.test(period || "") && h < 12) h += 12;
    return { h, min };
  }
  if (/上午|早上|早晨/.test(period || "")) return { h: config.defaultMorningHour, min: 0 };
  if (/下午/.test(period || "")) return { h: config.defaultAfternoonHour, min: 0 };
  if (period === "中午") return { h: 12, min: 30 };
  if (/傍晚|晚上/.test(period || "")) return { h: 19, min: 0 };
  return { h: config.defaultMorningHour, min: 0 };
}

function isClockExplicit(text: string): boolean {
  return CLOCK_RE.test(text) || DIAN_RE.test(text) || CN_DIAN_RE.test(text);
}

function resolveDurationMinutes(text: string): number {
  const m = text.match(DURATION_RE);
  if (m) {
    const n = Number(m[1]);
    return /小时|钟头/.test(m[2]) ? Math.round(n * 60) : Math.round(n);
  }
  // 用户没说时长，按场景给合理默认（与 LLM 提示词中的时长表对齐）
  const meal = detectMealSubtype(text);
  if (meal) {
    if (/(酒|酒吧|喝)/.test(text)) return 120;
    if (meal === "dinner") return 90;
    if (meal === "lunch") return 90;
    return 60; // breakfast/coffee
  }
  if (/(健身|撸铁|跑步|户外|运动|打球|游泳|瑜伽)/.test(text)) return 60;
  if (/(看病|体检|牙医|理疗|按摩)/.test(text)) return 60;
  if (/(电影|看电影)/.test(text)) return 120;
  if (/(逛展|博物馆|美术馆)/.test(text)) return 120;
  if (/(桌游|剧本杀|密室)/.test(text)) return 180;
  if (/(KTV|唱歌)/.test(text)) return 120;
  if (/(周边游|郊游|爬山|旅行)/.test(text)) return 480;
  if (/(约会)/.test(text)) return 120;
  if (/(叙旧|闲聊|聊天)/.test(text)) return 90;
  if (/(面试|汇报|1v1|一对一)/.test(text)) return 60;
  if (/(会|会议|评审|对齐|沟通|讨论)/.test(text)) return 60;
  if (/(自习|看书|阅读|学习|备考)/.test(text)) return 90;
  if (/(银行|政务|派出所|办事)/.test(text)) return 60;
  return config.defaultMeetingMinutes;
}

function buildTitle(text: string): string {
  let t = text;
  t = t.replace(WEEKDAY_RE, "");
  t = t.replace(REL_DAY_RE, "");
  t = t.replace(DIAN_RE, "");
  t = t.replace(CN_DIAN_RE, "");
  t = t.replace(CLOCK_RE, "");
  t = t.replace(DURATION_RE, "");
  t = t.replace(/(下周|下个|上午|早上|早晨|中午|下午|傍晚|晚上|开会|个|次)/g, "");
  t = t.replace(/[\s,，。、和跟与的了]/g, "");
  if (t.length >= 2) return t;
  if (/会|开会/.test(text)) return "会议";
  return "新日程";
}

function extractConcreteRule(text: string): { draft: EventDraft; timeVague: boolean } {
  const day = resolveDay(text);
  const { h, min } = resolveClock(text);
  const timeVague = !isClockExplicit(text);
  const duration = resolveDurationMinutes(text);
  const start = iso(day.y, day.m, day.d, h, min);
  const endMs = Date.parse(start) + duration * 60_000;
  const g = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(endMs));
  const get = (k: string) => g.find((p) => p.type === k)!.value;
  let eh = Number(get("hour"));
  if (eh === 24) eh = 0;
  const endIso = `${get("year")}-${get("month")}-${get("day")}T${String(eh).padStart(2, "0")}:${get("minute")}:00+08:00`;

  // 规则版同样要把“替用户补的默认值”标出来，不能伪装成用户原话
  const title = buildTitle(text);
  const inferences: Inference[] = [];
  const hhmm = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  if (timeVague) {
    inferences.push({
      field: "startTime",
      assumed: hhmm,
      reason: "你没说具体几点，按模糊时段默认取了这个时间（如下班后/下午的默认时刻）",
    });
  }
  if (!DURATION_RE.test(text)) {
    inferences.push({
      field: "durationMinutes",
      assumed: `${duration} 分钟`,
      reason: "你没说时长，按会议类默认时长补的",
    });
  }
  if (!REL_DAY_RE.test(text) && !WEEKDAY_RE.test(text)) {
    inferences.push({
      field: "date",
      assumed: `${get("month")}-${get("day")}（明天）`,
      reason: "你没说日期，默认安排在明天",
    });
  }
  if (title === "会议" || title === "新日程") {
    inferences.push({
      field: "title",
      assumed: title,
      reason: "没识别到明确标题，按类型先拟了一个，建议改成具体事项",
    });
  }

  return {
    draft: {
      clientId: id("cand"),
      title,
      start,
      end: endIso,
      kind: "concrete",
      recurrence: null,
      inferences: inferences.length ? inferences : undefined,
    },
    timeVague,
  };
}

// ===== 对外接口：规则优先（快），LLM 兜底（准/安全）=====

export type ParseInputResult =
  | { kind: "concrete"; draft: EventDraft; timeVague: boolean }
  | { kind: "goal" }
  | { kind: "refused"; message: string };

// 快速有害内容检查（正则，毫秒级），避免明显违规请求走慢 LLM
const HARMFUL_RE =
  /报复|打.*(他|她|人)|杀|砍|下毒|陷害|造谣|报复|揍|教训.*(他|她|同事|老板|老师)/;

// 单次输入解析：
// - 有明确日期锚点 → 规则直接抽取（秒级，不调 LLM）
// - 其余（目标/模糊/复杂）→ LLM 分类+抽取（含安全拒绝）
export async function parseInput(text: string, cfg?: LlmConfig): Promise<ParseInputResult> {
  // 1) 快速安全前置过滤
  if (HARMFUL_RE.test(text)) {
    return {
      kind: "refused",
      message: "这个请求涉及伤害他人或不当行为，我无法帮你安排。如果是压力或情绪困扰，建议和信任的人聊聊或寻求专业帮助。",
    };
  }

  // 2) 有明确日期锚点 → 规则抽取（快路径，覆盖绝大多数明确安排）
  if (hasDateAnchor(text)) {
    const { draft, timeVague } = extractConcreteRule(text);
    return { kind: "concrete", draft, timeVague };
  }

  // 3) 其余走 LLM（目标识别、复杂安排、安全边界）
  const r = await llmExtract(text, cfg);
  if (r) {
    if (r.kind === "refused") return { kind: "refused", message: r.message };
    if (r.kind === "goal") return { kind: "goal" };
    return { kind: "concrete", draft: r.event, timeVague: r.timeVague };
  }
  // LLM 不可用：回退规则分类
  const kind = classifyRule(text);
  if (kind === "goal") return { kind: "goal" };
  const { draft, timeVague } = extractConcreteRule(text);
  return { kind: "concrete", draft, timeVague };
}

export async function classify(text: string, cfg?: LlmConfig): Promise<InputKind> {
  const r = await parseInput(text, cfg);
  return r.kind === "concrete" ? "concrete" : "goal";
}

export async function extractConcrete(
  text: string,
  cfg?: LlmConfig
): Promise<{ draft: EventDraft; timeVague: boolean }> {
  const r = await parseInput(text, cfg);
  if (r.kind === "concrete") return { draft: r.draft, timeVague: r.timeVague };
  return extractConcreteRule(text);
}

// ===== selecting_time 阶段的轻量本地检测（不走 LLM，避免篡改日期、减少耗时）=====

const DATE_ANCHOR_RE =
  /今天|今日|明天|明日|后天|大后天|下周|本周|这周|(?:星期|礼拜|周)\s*[一二三四五六日天末]|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{4}-\d{1,2}-\d{1,2}/;

// 用户这段话里是否出现了“日期锚点”？若没有，selecting_time 阶段必须保留原候选的日期。
export function hasDateAnchor(text: string): boolean {
  return DATE_ANCHOR_RE.test(text);
}

// 用户这段话里是否给了“精确到分钟的时刻”？若没有，不要当作自定义时间提交。
export function hasExplicitClock(text: string): boolean {
  return isClockExplicit(text);
}

// 仅用规则解析时刻（HH:mm），不解析日期。失败返回 null。
export function extractClockRule(
  text: string
): { h: number; min: number } | null {
  if (!isClockExplicit(text)) return null;
  try {
    return resolveClock(text);
  } catch {
    return null;
  }
}

// 根据日程标题/内容推断类型，用于选择合适的推荐时段窗口
export type EventCategory = "meal" | "exercise" | "meeting" | "other";

// 餐食细分子类：用户明确说了“晚/午/早”时只推对应餐段，避免晚宴给午餐
export type MealSubtype = "dinner" | "lunch" | "breakfast" | "any";

export function detectMealSubtype(text: string): MealSubtype | null {
  if (!/(饭|餐|吃|聚|宴|下午茶|咖啡|奶茶|喝|夜宵)/.test(text)) return null;
  if (/(晚|夜宵|宵夜)/.test(text)) return "dinner";
  if (/(午|中饭|午餐|午宴)/.test(text)) return "lunch";
  if (/(早|早餐|早饭|早点)/.test(text)) return "breakfast";
  return "any";
}

export function detectCategory(text: string): EventCategory {
  const t = text.toLowerCase();
  if (detectMealSubtype(text)) return "meal";
  if (/(健身|锻炼|运动|跑步|游泳|瑜伽|打球|训练|减脂|减重)/.test(t)) return "exercise";
  if (/(会|会议|同步|讨论|评审|复盘|面试|沟通|对齐|碰头)/.test(t)) return "meeting";
  return "other";
}

// 按类型（及餐食子类）给出偏好的时段起点（HH:mm），suggestTimes 会优先在这些窗口里找空闲
export function preferredStartsFor(
  category: EventCategory,
  mealSubtype?: MealSubtype | null
): string[] {
  if (category === "meal") {
    switch (mealSubtype) {
      case "dinner":
        return ["18:00", "18:30", "19:00", "19:30", "20:00", "17:30"];
      case "lunch":
        return ["12:00", "12:30", "13:00", "11:30", "13:30"];
      case "breakfast":
        return ["08:00", "08:30", "09:00", "07:30", "09:30"];
      default:
        // 没说早午晚：午餐 + 晚餐都给
        return ["12:00", "12:30", "18:00", "18:30", "13:00", "19:00", "11:30", "19:30"];
    }
  }
  switch (category) {
    case "exercise":
      return ["07:00", "07:30", "08:00", "18:00", "18:30", "19:00", "20:00", "06:30"];
    case "meeting":
      return ["10:00", "10:30", "14:00", "14:30", "15:00", "16:00", "09:30", "11:00"];
    default:
      return ["10:00", "14:00", "15:00", "16:00", "19:00", "10:30", "14:30"];
  }
}

// 餐食子类对应的时间窗口（[起始, 结束]），用于限制推荐范围，避免晚宴给午餐时段
export function mealWindowFor(subtype: MealSubtype | null | undefined): [string, string] | null {
  switch (subtype) {
    case "dinner":
      return ["17:00", "21:30"];
    case "lunch":
      return ["11:00", "14:30"];
    case "breakfast":
      return ["06:30", "10:00"];
    case "any":
      return ["11:00", "21:30"];
    default:
      return null;
  }
}
