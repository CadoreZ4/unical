import { config } from "./config";
import { expandInstances, overlaps, type Instance } from "./time";
import type {
  Candidate,
  Clash,
  ConflictInfo,
  EventDraft,
} from "./types";
import type { ExistingEvent } from "@/adapters/calendar/types";

const NO_CONFLICT: ConflictInfo = { hasConflict: false, clashes: [] };

function existingInstances(e: ExistingEvent): Instance[] {
  if (!e.recurrence) return [{ start: e.start, end: e.end }];
  const insts = expandInstances({
    clientId: e.eventId,
    title: e.title,
    start: e.start,
    end: e.end,
    recurrence: e.recurrence,
    kind: "concrete",
  });
  // 跳过用户已单独取消/删除的周期实例
  if (e.cancelledStarts?.length) {
    const cancelled = new Set(e.cancelledStarts);
    return insts.filter((i) => !cancelled.has(Date.parse(i.start)));
  }
  return insts;
}

// 只标红、不改期：返回每个候选与已有日程的冲突明细
export function detectConflicts(
  drafts: EventDraft[],
  existing: ExistingEvent[]
): Candidate[] {
  const occupied: { inst: Instance; title: string }[] = existing.flatMap((e) =>
    existingInstances(e).map((inst) => ({ inst, title: e.title }))
  );

  return drafts.map((d) => {
    const clashes: Clash[] = [];
    for (const inst of expandInstances(d)) {
      for (const o of occupied) {
        if (overlaps(inst.start, inst.end, o.inst.start, o.inst.end)) {
          clashes.push({ at: inst.start, withEvent: o.title });
          if (clashes.length >= config.maxClashesShown) break;
        }
      }
      if (clashes.length >= config.maxClashesShown) break;
    }
    return {
      ...d,
      conflict: clashes.length ? { hasConflict: true, clashes } : NO_CONFLICT,
    };
  });
}
