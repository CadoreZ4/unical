import type { EventDraft, ISO, RecurrenceRule } from "@/core/types";

// 已有日程（读取自用户日历）。recurrence 与候选日程同一套结构。
// cancelledStarts: 周期日程中被用户单独取消/删除的实例的起始时间戳（毫秒），展开时需跳过
export type ExistingEvent = {
  eventId: string;
  title: string;
  start: ISO;
  end: ISO;
  recurrence?: RecurrenceRule | null;
  cancelledStarts?: number[];
};

// 推荐的可用时段
export type TimeSlot = {
  start: ISO;
  end: ISO;
};

export interface CalendarAdapter {
  // 拉取时间窗内的日程（含周期日程原始规则）
  listEvents(from: ISO, to: ISO): Promise<ExistingEvent[]>;
  // 在“本人主日历”创建一条日程；v1 不邀请他人、不订会议室
  create(
    draft: EventDraft
  ): Promise<{ eventId: string; link: string }>;
  // 给定日期、期望时长和参考时刻，推荐若干不与已有日程冲突的可用时段
  // preferStart 可以是单个 "HH:mm" 或逗号分隔的多个偏好时刻（如 "12:00,18:00"）
  // exclude 是之前已推荐过、本轮需要跳过的时段
  // timeWindow 可选：[起始HH:mm, 结束HH:mm]，只在该窗口内推荐（如晚宴只给 17:00-21:30）
  // allSlots=true 时返回当天全部可用时段（不限制数量），用于"用户不满意、列出所有"
  suggestTimes(
    date: string, // YYYY-MM-DD
    durationMinutes: number,
    preferStart?: string,
    exclude?: TimeSlot[],
    timeWindow?: [string, string],
    allSlots?: boolean
  ): Promise<TimeSlot[]>;
}
