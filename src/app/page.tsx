"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@/core/types";
import { ChatStream, type StreamingState } from "@/components/ChatStream";
import { PlanPanel } from "@/components/PlanPanel";
import { CandidateList } from "@/components/CandidateList";
import { ResultsPanel } from "@/components/ResultsPanel";
import { TimeSuggestions } from "@/components/TimeSuggestions";
import { CalendarView } from "@/components/CalendarView";
import { ThemePicker } from "@/components/ThemePicker";
import { LlmSettings } from "@/components/LlmSettings";

type View = "chat" | "pickSuccess";

type SSEHandlers = Record<string, (p: any) => void>;

async function readSSE(res: Response, handlers: SSEHandlers) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let payload: any = null;
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        /* 忽略不完整帧 */
      }
      handlers[event]?.(payload);
    }
  }
}

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [view, setView] = useState<View>("chat");
  const [calOpen, setCalOpen] = useState(false);
  const [calFocus, setCalFocus] = useState<string | undefined>(undefined);
  const [auth, setAuth] = useState<{
    provider: string;
    connected: boolean;
    name: string | null;
  }>({ provider: "mock", connected: false, name: null });

  const refreshAuth = useCallback(async () => {
    const r = await fetch("/api/auth/status");
    if (r.ok) setAuth(await r.json());
  }, []);

  const readSession = useCallback(async (r: Response) => {
    const d = await r.json();
    if (!r.ok) {
      setNotice(d?.error?.message || "请求失败，请重试");
      return null;
    }
    return d.session as Session;
  }, []);

  useEffect(() => {
    fetch("/api/session", { method: "POST" })
      .then((r) => r.json())
      .then((d) => setSession(d.session));
    refreshAuth();
    const oauth = new URLSearchParams(location.search).get("oauth");
    if (oauth === "ok") setNotice("已连接飞书账号");
    if (oauth === "denied") setNotice("已取消授权");
  }, [refreshAuth]);

  // 流式发送：先立即显示用户气泡 + 助手“思考中”，再逐字接收正文
  const send = useCallback(
    async (text: string) => {
      if (!session || !text.trim() || busy) return;
      setBusy(true);
      setView("chat");
      setPendingUser(text.trim());
      setStreaming({ status: "正在理解你的需求…", text: "" });
      setInput("");
      try {
        const res = await fetch(`/api/session/${session.id}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim() }),
        });

        // 401/400 等在建立流之前返回的 JSON 错误
        if (!res.ok || !res.body) {
          let msg = "请求失败，请重试";
          try {
            const d = await res.json();
            msg = d?.error?.message || msg;
          } catch {
            /* ignore */
          }
          setNotice(msg);
          setPendingUser(null);
          setStreaming(null);
          return;
        }

        const holder: { session: Session | null } = { session: null };
        let errMsg = "";
        await readSSE(res, {
          status: (p) =>
            setStreaming((s) => ({ status: p?.label || "思考中…", text: s?.text || "" })),
          delta: (p) =>
            setStreaming((s) => ({
              status: s?.status || "",
              text: (s?.text || "") + (p?.text || ""),
            })),
          done: (p) => {
            if (p?.session) holder.session = p.session as Session;
          },
          error: (p) => {
            errMsg = p?.error?.message || "出错了，请重试";
          },
        });

        const final = holder.session;
        if (final) {
          setSession(final);
          setPendingUser(null);
          setStreaming(null);
          // 选时段后停留在主界面，让用户在右侧确认写入；成功页只在真正写入后弹
        } else {
          setNotice(errMsg || "连接中断，请重试");
          setPendingUser(null);
          setStreaming(null);
        }
      } catch {
        setNotice("网络异常，请重试");
        setPendingUser(null);
        setStreaming(null);
      } finally {
        setBusy(false);
      }
    },
    [session, busy]
  );

  const updateCandidate = useCallback(
    async (
      clientId: string,
      patch: { title?: string; start?: string; end?: string }
    ) => {
      if (!session) return;
      const r = await fetch(`/api/session/${session.id}/candidate/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const next = await readSession(r);
      if (next) setSession(next);
    },
    [session, readSession]
  );

  const deleteCandidate = useCallback(
    async (clientId: string) => {
      if (!session) return;
      const r = await fetch(`/api/session/${session.id}/candidate/${clientId}`, {
        method: "DELETE",
      });
      const next = await readSession(r);
      if (next) setSession(next);
    },
    [session, readSession]
  );

  const commit = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/session/${session.id}/commit`, { method: "POST" });
      const next = await readSession(r);
      if (next) {
        setSession(next);
        // 只有真正写入主日历成功后，才弹出「查看日历 / 返回」页面
        if (next.stage === "committed") {
          setView("pickSuccess");
        }
      }
    } finally {
      setBusy(false);
    }
  }, [session, busy, readSession]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await refreshAuth();
  }, [refreshAuth]);

  const openCalendar = useCallback((focus?: string) => {
    setCalFocus(focus);
    setCalOpen(true);
  }, []);

  const stage = session?.stage;
  const shownMessages =
    session && pendingUser
      ? [...session.messages, { role: "user" as const, text: pendingUser }]
      : session?.messages || [];
  const chosenDate = session?.candidates[0]?.start?.slice(0, 10);

  return (
    <main className="mx-auto flex h-full max-w-5xl flex-col px-4 py-5">
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500 text-lg font-bold text-white shadow-soft">
            U
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-ink">UniCal</h1>
            <p className="text-xs text-ink-faint">把安排和目标，统一落到一个日历</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <ThemePicker />
          <LlmSettings />
          {auth.provider === "feishu" ? (
            auth.connected ? (
              <>
                <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs text-ink-soft shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  已连接{auth.name ? ` · ${auth.name}` : ""}
                </span>
                <button
                  onClick={logout}
                  className="rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs text-ink-soft shadow-sm transition hover:bg-surface"
                >
                  退出
                </button>
              </>
            ) : (
              <>
                <span className="rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs text-amber-600 shadow-sm">
                  未连接飞书
                </span>
                <a
                  href="/api/auth/login"
                  className="rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-600"
                >
                  连接飞书
                </a>
              </>
            )
          ) : (
            <span className="rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs text-ink-faint shadow-sm">
              Mock 日历
            </span>
          )}
        </div>
      </header>

      {notice && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-xs text-brand-700">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-brand-400 hover:text-brand-600">
            ✕
          </button>
        </div>
      )}

      {view === "pickSuccess" ? (
        <PickSuccess
          onView={() => openCalendar(chosenDate)}
          onBack={() => setView("chat")}
        />
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[1fr_380px]">
          <section className="card flex min-h-0 flex-col p-4">
            <div className="flex min-h-0 flex-1 flex-col">
              {session ? (
                <ChatStream
                  messages={shownMessages}
                  streaming={streaming}
                  onExample={(ex) => send(ex)}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">
                  初始化中…
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(input)}
                placeholder="说一个安排，或一个目标…"
                className="flex-1 rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
              />
              <button
                onClick={() => send(input)}
                disabled={busy || !input.trim()}
                className="rounded-2xl bg-brand-500 px-6 py-2.5 text-sm font-medium text-white shadow-soft transition hover:bg-brand-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                发送
              </button>
            </div>
          </section>

          <aside className="min-h-0 space-y-3 overflow-y-auto pr-1">
            {stage === "plan_review" && session?.plan && (
              <PlanPanel plan={session.plan} onConfirm={() => send("确认")} />
            )}
            {stage === "selecting_time" && session?.timeSuggestions && (
              <TimeSuggestions
                suggestions={session.timeSuggestions}
                onPick={(i) => send(`选${i + 1}`)}
              />
            )}
            {session && session.candidates.length > 0 && (
              <>
                <CandidateList
                  candidates={session.candidates}
                  onUpdate={updateCandidate}
                  onDelete={deleteCandidate}
                  disabled={stage === "committed"}
                />
                {stage === "confirm_candidates" && (
                  <button
                    onClick={commit}
                    disabled={busy}
                    className="w-full rounded-2xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700 active:scale-[.99] disabled:opacity-50"
                  >
                    确认写入我的主日历
                  </button>
                )}
              </>
            )}
            {stage === "committed" && session?.results && (
              <ResultsPanel
                results={session.results}
                candidates={session.candidates}
                onViewCalendar={() => openCalendar(chosenDate)}
              />
            )}
          </aside>
        </div>
      )}

      <CalendarView open={calOpen} onClose={() => setCalOpen(false)} focusKey={calFocus} />
    </main>
  );
}

function PickSuccess({ onView, onBack }: { onView: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="card w-full max-w-md animate-popIn p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-ink">已写入日历</h2>
        <p className="mt-1.5 text-sm text-ink-soft">日程已成功写入你的飞书主日历，点击查看最新日历。</p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onView}
            className="flex-1 rounded-2xl bg-brand-500 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-600 active:scale-[.99]"
          >
            查看日历
          </button>
          <button
            onClick={onBack}
            className="flex-1 rounded-2xl border border-line bg-surface py-3 text-sm font-medium text-ink-soft transition hover:bg-brand-50"
          >
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
