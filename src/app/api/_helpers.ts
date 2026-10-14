// 兼容层：路由统一从这里取“日历工厂”和“会话读取”，具体实现已迁到 src/server。
import { getCalendar } from "@/server/auth";
import { requireSession } from "@/server/session-store";

// 注意：现在是 async（飞书模式下可能触发 token 自动刷新），路由内需 await。
export const getCal = getCalendar;
export { requireSession };
