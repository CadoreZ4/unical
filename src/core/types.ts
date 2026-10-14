// 全应用统一的数据结构。日历适配层负责把它与各平台 Event 字段互转。

export type ISO = string; // RFC3339，带时区偏移，如 2026-09-30T14:00:00+08:00

// 周期规则（v1 仅用到 DAILY / WEEKLY）
export type RecurrenceRule = {
  freq: "DAILY" | "WEEKLY";
  until?: ISO; // 周期截止（含当日）
  count?: number; // 重复次数（与 until 二选一）
  byWeekday?: number[]; // WEEKLY 时生效，0=周一 … 6=周日；为空则固定起始星期
};

// 一条“AI/系统替用户补的默认值或推断”，必须在 UI 显式标注，不能伪装成用户原话
export type Inference = {
  field: string; // 被补全的字段，如 startTime / durationMinutes / title
  assumed: string; // 实际采用的值（人读）
  reason: string; // 为什么这样猜（人读）
};

// 候选日程（尚未写入日历）
export type EventDraft = {
  clientId: string; // 会话内稳定 ID，用于幂等与行内编辑
  title: string;
  start: ISO;
  end: ISO;
  allDay?: boolean;
  recurrence?: RecurrenceRule | null;
  location?: string;
  description?: string;
  kind: "concrete" | "goal";
  planId?: string;
  inferences?: Inference[]; // 非用户明确给出、由 AI/默认值补全的部分
};

export type Clash = {
  at: ISO; // 发生冲突的具体实例时间
  withEvent: string; // 与之冲突的已有日程标题
};

export type ConflictInfo = {
  hasConflict: boolean;
  clashes: Clash[]; // 最多保留前若干条，仅提示不改期
};

export type Candidate = EventDraft & {
  conflict: ConflictInfo;
};

// 抽象目标 -> 可执行方案（第一道关确认对象）
export type Plan = {
  id: string;
  goal: string;
  rationale: string;
  frequency: string; // 人读：如「每天（含周末）」
  perSessionMinutes: number;
  durationDays: number;
  content: string; // 具体做什么
  checkpoints: string; // 检查点安排
  assumptions: string[]; // 方案基于的假设
};

export type ClarificationQuestion = {
  id: string;
  label: string;
};

export type TimeSuggestion = {
  start: ISO;
  end: ISO;
};

export type Stage =
  | "clarifying" // 目标信息不足，先问一轮
  | "plan_review" // 第一道关：确认方案
  | "selecting_time" // 明确安排时间不明确，让用户从推荐时段里选
  | "confirm_candidates" // 第二道关：确认日程清单
  | "committed";

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export type WriteResult = {
  clientId: string;
  ok: boolean;
  eventId?: string;
  link?: string;
  error?: string;
};

export type Session = {
  id: string;
  stage: Stage;
  messages: ChatMessage[];
  questions?: ClarificationQuestion[];
  pendingGoal?: string; // 澄清阶段暂存的原始目标
  planAnswers?: string; // 用户对澄清问题的回答（修改方案时需带上原约束）
  plan?: Plan;
  candidates: Candidate[];
  results?: WriteResult[];
  timeSuggestions?: TimeSuggestion[]; // 时段推荐（selecting_time 阶段使用）
  pendingCandidate?: EventDraft; // 等用户选时间的候选日程
  idempotencyKey: string; // 每会话一个，防止整体重复写入
  createdAt: number;
};
