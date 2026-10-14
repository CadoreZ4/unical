"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/core/types";

export type StreamingState = { status: string; text: string };

const EXAMPLES = ["周三下午和团队开个同步会", "我要在一个月内系统学习 AI"];

export function ChatStream({
  messages,
  streaming,
  onExample,
}: {
  messages: ChatMessage[];
  streaming?: StreamingState | null;
  onExample?: (text: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming?.text, streaming?.status]);

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-1 py-1">
      {messages.length === 0 && !streaming && (
        <div className="mt-4 animate-riseIn rounded-2xl border border-dashed border-line bg-surface/70 p-5">
          <p className="text-sm font-medium text-ink-soft">试试说：</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => onExample?.(ex)}
                className="rounded-full border border-line bg-brand-50 px-3.5 py-1.5 text-xs text-brand-700 transition hover:border-brand-300 hover:bg-brand-100"
              >
                {ex}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            明确的安排（几点开会）我会直接帮你查冲突、排进日历；
            抽象的目标（学 AI、减重）我会先问你几个相关问题，再拆成可执行的日程方案。
          </p>
        </div>
      )}

      {messages.map((m, i) => (
        <Bubble key={i} role={m.role} text={m.text} />
      ))}

      {streaming && (
        <Bubble role="assistant" text={streaming.text} status={streaming.status} live />
      )}

      <div ref={endRef} />
    </div>
  );
}

function Bubble({
  role,
  text,
  status,
  live,
}: {
  role: "user" | "assistant";
  text: string;
  status?: string;
  live?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex animate-riseIn ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white shadow-sm">
          U
        </div>
      )}
      <div
        className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          isUser
            ? "rounded-br-sm bg-brand-500 text-white"
            : "rounded-bl-sm border border-line bg-surface text-ink"
        }`}
      >
        {text ? (
          <>
            {text}
            {live && <span className="ml-0.5 inline-block h-4 w-[2px] animate-blink bg-brand-500 align-middle" />}
          </>
        ) : live ? (
          <span className="flex items-center gap-2 py-0.5">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounceDot rounded-full bg-brand-500"
                  style={{ animationDelay: `${i * 0.16}s` }}
                />
              ))}
            </span>
            <span className="text-xs text-ink-faint">{status || "思考中…"}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
