import { randomUUID } from "node:crypto";
import type { Session, WriteResult } from "@/core/types";
import { getDb } from "./db";
import { decrypt, encrypt } from "./crypto";

// ===== 对外类型 =====

export type AuthUser = {
  id: string;
  provider: string;
  openId: string | null;
  name: string | null;
};

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: number; // epoch 毫秒
  scope?: string | null;
};

// 仓储抽象：core/路由只依赖这个接口，将来换 PostgreSQL 只需新增一个实现。
export interface Repository {
  // 用户与令牌
  upsertFeishuUser(input: {
    openId: string;
    unionId?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
  }): string;
  saveTokens(userId: string, tokens: OAuthTokenSet): void;
  getTokens(userId: string): OAuthTokenSet | null;

  // 登录态（cookie 里的不透明 sid）
  createAuthSession(userId: string, ttlMs: number): string;
  getAuthUser(sid: string): AuthUser | null;
  revokeAuthSession(sid: string): void;

  // 业务会话（对话聚合）
  saveAppSession(session: Session, userId: string | null): void;
  getAppSession(id: string): { session: Session; userId: string | null } | null;

  // 用户 LLM 配置（自带 Key）
  getUserLlmSettings(userId: string): {
    apiKey: string | null;
    baseUrl: string | null;
    model: string | null;
  } | null;
  saveUserLlmSettings(
    userId: string,
    settings: { apiKey: string | null; baseUrl: string | null; model: string | null }
  ): void;
}

// ===== SQLite 实现 =====

class SqliteRepository implements Repository {
  private db() {
    return getDb();
  }

  upsertFeishuUser(input: {
    openId: string;
    unionId?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
  }): string {
    const now = Date.now();
    const existing = this.db()
      .prepare("SELECT id FROM users WHERE provider='feishu' AND open_id=?")
      .get(input.openId) as { id: string } | undefined;

    if (existing) {
      this.db()
        .prepare(
          `UPDATE users SET union_id=?, name=COALESCE(?, name), avatar_url=COALESCE(?, avatar_url), updated_at=?
           WHERE id=?`
        )
        .run(input.unionId ?? null, input.name ?? null, input.avatarUrl ?? null, now, existing.id);
      return existing.id;
    }

    const id = randomUUID();
    this.db()
      .prepare(
        `INSERT INTO users(id, provider, open_id, union_id, name, avatar_url, created_at, updated_at)
         VALUES(?, 'feishu', ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.openId, input.unionId ?? null, input.name ?? null, input.avatarUrl ?? null, now, now);
    return id;
  }

  saveTokens(userId: string, tokens: OAuthTokenSet): void {
    this.db()
      .prepare(
        `INSERT INTO oauth_accounts(user_id, provider, access_token_enc, refresh_token_enc, expires_at, scope, updated_at)
         VALUES(?, 'feishu', ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           access_token_enc=excluded.access_token_enc,
           refresh_token_enc=COALESCE(excluded.refresh_token_enc, oauth_accounts.refresh_token_enc),
           expires_at=excluded.expires_at,
           scope=excluded.scope,
           updated_at=excluded.updated_at`
      )
      .run(
        userId,
        encrypt(tokens.accessToken),
        tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
        tokens.expiresAt,
        tokens.scope ?? null,
        Date.now()
      );
  }

  getTokens(userId: string): OAuthTokenSet | null {
    const row = this.db()
      .prepare(
        `SELECT access_token_enc, refresh_token_enc, expires_at, scope
         FROM oauth_accounts WHERE user_id=?`
      )
      .get(userId) as
      | { access_token_enc: string; refresh_token_enc: string | null; expires_at: number; scope: string | null }
      | undefined;
    if (!row) return null;
    return {
      accessToken: decrypt(row.access_token_enc),
      refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null,
      expiresAt: row.expires_at,
      scope: row.scope,
    };
  }

  createAuthSession(userId: string, ttlMs: number): string {
    const sid = randomUUID();
    const now = Date.now();
    this.db()
      .prepare(
        "INSERT INTO auth_sessions(sid, user_id, expires_at, created_at) VALUES(?, ?, ?, ?)"
      )
      .run(sid, userId, now + ttlMs, now);
    return sid;
  }

  getAuthUser(sid: string): AuthUser | null {
    const row = this.db()
      .prepare(
        `SELECT u.id, u.provider, u.open_id, u.name, a.expires_at
         FROM auth_sessions a JOIN users u ON u.id = a.user_id
         WHERE a.sid = ?`
      )
      .get(sid) as
      | { id: string; provider: string; open_id: string | null; name: string | null; expires_at: number }
      | undefined;
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.revokeAuthSession(sid);
      return null;
    }
    return { id: row.id, provider: row.provider, openId: row.open_id, name: row.name };
  }

  revokeAuthSession(sid: string): void {
    this.db().prepare("DELETE FROM auth_sessions WHERE sid=?").run(sid);
  }

  saveAppSession(session: Session, userId: string | null): void {
    const now = Date.now();
    const { results: _results, ...aggregate } = session; // results 以 write_results 台账为准
    const data = JSON.stringify(aggregate);

    const tx = this.db().transaction(() => {
      this.db()
        .prepare(
          `INSERT INTO app_sessions(id, user_id, stage, idempotency_key, data, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             stage=excluded.stage,
             idempotency_key=excluded.idempotency_key,
             data=excluded.data,
             updated_at=excluded.updated_at`
        )
        .run(session.id, userId, session.stage, session.idempotencyKey, data, session.createdAt, now);

      // 对账写入台账（失败重试会覆盖旧的失败行；已成功的在引擎层不会再调用 create）
      for (const r of session.results || []) {
        this.db()
          .prepare(
            `INSERT INTO write_results(app_session_id, client_id, idempotency_key, ok, provider_event_id, link, error, created_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(app_session_id, client_id) DO UPDATE SET
               ok=excluded.ok, provider_event_id=excluded.provider_event_id,
               link=excluded.link, error=excluded.error`
          )
          .run(
            session.id,
            r.clientId,
            session.idempotencyKey,
            r.ok ? 1 : 0,
            r.eventId ?? null,
            r.link ?? null,
            r.error ?? null,
            now
          );
      }
    });
    tx.immediate();
  }

  getAppSession(id: string): { session: Session; userId: string | null } | null {
    const row = this.db()
      .prepare("SELECT user_id, data FROM app_sessions WHERE id=?")
      .get(id) as { user_id: string | null; data: string } | undefined;
    if (!row) return null;

    const session = JSON.parse(row.data) as Session;
    const resultRows = this.db()
      .prepare(
        `SELECT client_id, ok, provider_event_id, link, error
         FROM write_results WHERE app_session_id=? ORDER BY id`
      )
      .all(id) as {
      client_id: string;
      ok: number;
      provider_event_id: string | null;
      link: string | null;
      error: string | null;
    }[];

    if (resultRows.length) {
      session.results = resultRows.map<WriteResult>((r) => ({
        clientId: r.client_id,
        ok: r.ok === 1,
        eventId: r.provider_event_id ?? undefined,
        link: r.link ?? undefined,
        error: r.error ?? undefined,
      }));
    }
    return { session, userId: row.user_id };
  }

  getUserLlmSettings(userId: string) {
    const row = this.db()
      .prepare(
        `SELECT llm_api_key_enc, llm_base_url, llm_model
         FROM user_settings WHERE user_id=?`
      )
      .get(userId) as
      | { llm_api_key_enc: string | null; llm_base_url: string | null; llm_model: string | null }
      | undefined;
    if (!row) return null;
    return {
      apiKey: row.llm_api_key_enc ? decrypt(row.llm_api_key_enc) : null,
      baseUrl: row.llm_base_url,
      model: row.llm_model,
    };
  }

  saveUserLlmSettings(
    userId: string,
    settings: { apiKey: string | null; baseUrl: string | null; model: string | null }
  ): void {
    this.db()
      .prepare(
        `INSERT INTO user_settings(user_id, llm_api_key_enc, llm_base_url, llm_model, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           llm_api_key_enc=excluded.llm_api_key_enc,
           llm_base_url=excluded.llm_base_url,
           llm_model=excluded.llm_model,
           updated_at=excluded.updated_at`
      )
      .run(
        userId,
        settings.apiKey ? encrypt(settings.apiKey) : null,
        settings.baseUrl ?? null,
        settings.model ?? null,
        Date.now()
      );
  }
}

// 单例
const globalForRepo = globalThis as unknown as { __unical_repo__?: Repository };
export const repository: Repository =
  globalForRepo.__unical_repo__ ?? (globalForRepo.__unical_repo__ = new SqliteRepository());
