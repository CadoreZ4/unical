import { handleText } from "@/core/engine";
import { narrateStream } from "@/core/narrate";
import { requireString } from "@/server/api";
import { persist, requireSession } from "@/server/session-store";
import { getCal } from "@/app/api/_helpers";
import { getCurrentUser } from "@/server/auth";
import { repository } from "@/server/repository";
import type { LlmConfig } from "@/adapters/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { text?: unknown };

// 流式对话：
//   event: status  -> 思考阶段提示
//   event: delta   -> 正文增量 {text}
//   event: done    -> 最终会话 {session}
//   event: error   -> {error:{code,message}}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: { code: "BAD_JSON", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  let text: string;
  try {
    text = requireString(body.text, "text", { max: 4000 });
  } catch (e: any) {
    return Response.json(
      { error: { code: e?.code || "VALIDATION", message: e?.message || "参数错误" } },
      { status: e?.status || 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      try {
        const session = requireSession(params.id);
        send("status", { label: "正在理解你的需求…" });

        // 获取当前用户的 LLM 配置（自带 Key 则用用户的，否则用全局）
        const user = getCurrentUser();
        let llmCfg: LlmConfig | undefined;
        if (user) {
          const s = repository.getUserLlmSettings(user.id);
          if (s?.apiKey) {
            llmCfg = { apiKey: s.apiKey, baseUrl: s.baseUrl ?? undefined, model: s.model ?? undefined };
          }
        }

        // 1) 结构化计算（分类/拆解/冲突/写日历），先持久化一次防止中途丢失
        const { session: next, say } = await handleText(
          session,
          text,
          await getCal(),
          (label) => send("status", { label }),
          llmCfg
        );
        persist(next);

        // 2) 叙述文本流式下发
        let acc = "";
        await narrateStream(say, (chunk) => {
          acc += chunk;
          send("delta", { text: chunk });
        }, llmCfg);

        // 3) 落定最终消息并持久化，回传完整会话用于右侧面板对齐
        next.messages.push({ role: "assistant", text: acc });
        persist(next);
        send("done", { session: next });
      } catch (e: any) {
        const code = e?.code || "INTERNAL";
        const message =
          e?.status >= 500 || !e?.status
            ? "服务暂时不可用，请稍后重试"
            : e?.message || "请求失败";
        if (e?.status >= 500 || !e?.status) {
          console.error(
            JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: e?.message })
          );
        }
        send("error", { error: { code, message } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
