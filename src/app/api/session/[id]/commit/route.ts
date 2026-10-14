import { NextResponse } from "next/server";
import { commit } from "@/core/engine";
import { narrateText } from "@/core/narrate";
import { apiHandler } from "@/server/api";
import { persist, requireSession } from "@/server/session-store";
import { getCal } from "@/app/api/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiHandler(async (_req, { params }) => {
  const session = requireSession(params.id);
  const { okN, failN } = await commit(session, await getCal());
  session.messages.push({
    role: "assistant",
    text: narrateText({ t: "committed", okN, failN }),
  });
  persist(session);
  return NextResponse.json({ session });
});
