// 有把握的默认规则集中在此，便于后续做成用户可配置项
export const config = {
  timezone: "Asia/Shanghai",
  weekStartsOn: 1, // 周一为一周起点
  workHours: { startHour: 9, startMinute: 30, endHour: 19, endMinute: 0 },
  defaultMeetingMinutes: 30,
  defaultMorningHour: 10, // “上午”无具体时刻
  defaultAfternoonHour: 14, // “下午”无具体时刻
  goal: {
    defaultDurationDays: 28,
    dailySessionMinutes: 15,
    dailyHour: 18, // 每天锻炼默认排在 18:00
    dailyMinute: 0,
    reviewWeekday: 6, // 周日
    reviewHour: 8,
    reviewMinute: 30,
    reviewMinutes: 15,
  },
  maxClashesShown: 3,
};
