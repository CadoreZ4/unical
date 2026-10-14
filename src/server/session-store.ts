import { createSession } from "@/core/engine";
import { repository } from "./repository";
import { getCurrentUser } from "./auth";
import { HttpError } from "./api";
import type { Session } from "@/core/types";

// 新建业务会话并落库；若已登录则绑定到当前飞书用户。
export function beginSession(): Session {
  const session = createSession();
  const userId = getCurrentUser()?.id ?? null;
  repository.saveAppSession(session, userId);
  return session;
}

// 读取会话（含从 write_results 台账恢复的结果）；校验归属。
export function requireSession(id: string): Session {
  const row = repository.getAppSession(id);
  if (!row) throw new HttpError(404, "SESSION_NOT_FOUND", "会话不存在或已过期");

  const me = getCurrentUser();
  if (row.userId && me && row.userId !== me.id) {
    throw new HttpError(403, "FORBIDDEN", "无权访问该会话");
  }
  return row.session;
}

// 持久化会话。owner 一旦确定不再改变：老会话沿用原 owner，新会话取当前登录用户。
export function persist(session: Session): void {
  const existing = repository.getAppSession(session.id);
  const userId = existing?.userId ?? getCurrentUser()?.id ?? null;
  repository.saveAppSession(session, userId);
}
