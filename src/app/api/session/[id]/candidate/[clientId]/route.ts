import { NextResponse } from "next/server";
import { removeCandidate, updateCandidate } from "@/core/engine";
import { apiHandler, HttpError, pickStringFields, readJson } from "@/server/api";
import { persist, requireSession } from "@/server/session-store";
import { getCal } from "@/app/api/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["title", "start", "end", "description"] as const;

export const PATCH = apiHandler(async (req, { params }) => {
  const body = await readJson<Record<string, unknown>>(req);
  const patch = pickStringFields(body, ALLOWED);
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "VALIDATION", "没有可更新的字段");
  }
  const session = requireSession(params.id);
  await updateCandidate(session, params.clientId, patch, await getCal());
  persist(session);
  return NextResponse.json({ session });
});

export const DELETE = apiHandler(async (_req, { params }) => {
  const session = requireSession(params.id);
  removeCandidate(session, params.clientId);
  persist(session);
  return NextResponse.json({ session });
});
