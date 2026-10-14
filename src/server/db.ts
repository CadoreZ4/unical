import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// 仅在 Node 运行时使用（better-sqlite3 为原生模块，不能跑在 edge）。
export const runtime = "nodejs";

// 数据库位置：默认 <项目根>/data/unical.db，可用 DATABASE_URL 覆盖（:memory: 用于测试）。
function resolveDbPath(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    if (url === ":memory:" || url === "file::memory:") return ":memory:";
    if (url.startsWith("file:")) return url.slice("file:".length);
    return url;
  }
  return join(process.cwd(), "data", "unical.db");
}

const DB_PATH = resolveDbPath();

type DB = Database.Database;

function openDb(): DB {
  if (DB_PATH !== ":memory:") {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

// 建表 / 迁移。schema_version 记录结构版本，便于将来平滑升级（乃至换 PostgreSQL）。
function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      provider   TEXT NOT NULL DEFAULT 'feishu',
      open_id    TEXT,
      union_id   TEXT,
      name       TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (provider, open_id)
    );

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider           TEXT NOT NULL DEFAULT 'feishu',
      access_token_enc   TEXT NOT NULL,
      refresh_token_enc  TEXT,
      expires_at         INTEGER NOT NULL,   -- epoch 毫秒
      scope              TEXT,
      updated_at         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      sid        TEXT PRIMARY KEY,           -- 写进 httpOnly cookie 的不透明会话标识
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS app_sessions (
      id              TEXT PRIMARY KEY,     -- 业务会话 id（与 URL 中一致）
      user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
      stage           TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      data            TEXT NOT NULL,        -- Session 聚合 JSON（results 单独落表，此处不含）
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);

    CREATE TABLE IF NOT EXISTS write_results (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      app_session_id TEXT NOT NULL REFERENCES app_sessions(id) ON DELETE CASCADE,
      client_id      TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      ok             INTEGER NOT NULL,
      provider_event_id TEXT,
      link           TEXT,
      error          TEXT,
      created_at     INTEGER NOT NULL,
      UNIQUE (app_session_id, client_id)    -- 每个候选只允许一条最终写入结果（重启后仍幂等）
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      llm_api_key_enc  TEXT,                -- 用户自带的 LLM API Key（加密存储），空表示用全局配置
      llm_base_url     TEXT,                -- 用户自带的 LLM Base URL（可选）
      llm_model        TEXT,                -- 用户自带的模型名（可选）
      updated_at       INTEGER NOT NULL
    );
  `);
  db.exec("INSERT OR IGNORE INTO schema_version(version) VALUES (1);");
}

// dev 热更新会产生模块副本，挂到 globalThis 复用同一条连接，避免 WAL/锁竞争。
const globalForDb = globalThis as unknown as { __unical_db__?: DB };

export function getDb(): DB {
  if (!globalForDb.__unical_db__) globalForDb.__unical_db__ = openDb();
  return globalForDb.__unical_db__;
}
