import type { Candidate, RecurrenceRule } from "@/core/types";
import { formatDateTime, shiftKeepingDuration, toLocalInput } from "@/lib/format";

function recurrenceLabel(r?: RecurrenceRule | null): string {
  if (!r) return "单次";
  if (r.freq === "DAILY") return "每天（含周末）";
  if (r.byWeekday?.includes(6)) return "每周日";
  return "每周";
}

function CandidateCard({
  c,
  onUpdate,
  onDelete,
  disabled,
}: {
  c: Candidate;
  onUpdate: (
    clientId: string,
    patch: { title?: string; start?: string; end?: string }
  ) => void;
  onDelete: (clientId: string) => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3.5 text-sm shadow-sm transition ${
        c.conflict.hasConflict
          ? "border-red-300 bg-red-50/80"
          : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          defaultValue={c.title}
          disabled={disabled}
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value !== c.title)
              onUpdate(c.clientId, { title: e.target.value.trim() });
          }}
          className="min-w-0 flex-1 bg-transparent font-medium text-ink outline-none disabled:opacity-70"
        />
        <span className="shrink-0 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700">
          {recurrenceLabel(c.recurrence)}
        </span>
        {!disabled && (
          <button
            onClick={() => onDelete(c.clientId)}
            className="shrink-0 text-ink-faint transition hover:text-red-500"
            aria-label="删除"
          >
            ✕
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
        <input
          type="datetime-local"
          defaultValue={toLocalInput(c.start)}
          disabled={disabled}
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return;
            const moved = shiftKeepingDuration(
              c.start,
              c.end,
              `${value}:00+08:00`
            );
            onUpdate(c.clientId, moved);
          }}
          className="rounded-lg border border-line bg-surface px-1.5 py-1 text-ink-soft disabled:bg-transparent"
        />
        <span className="text-ink-faint">首次：{formatDateTime(c.start)}</span>
      </div>

      {c.conflict.hasConflict && (
        <div className="mt-2 rounded-lg bg-red-100 px-2.5 py-1.5 text-xs text-red-700">
          冲突：与{" "}
          {c.conflict.clashes.map((x) => `「${x.withEvent}」`).join("、")}{" "}
          撞车。仅标红，未自动改期，请你决定保留或手动调整。
        </div>
      )}

      {c.inferences && c.inferences.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          <div className="mb-1 flex items-center gap-1 font-medium">
            <span className="rounded bg-amber-200/70 px-1 py-0.5 text-[10px]">
              AI 推测
            </span>
            <span>以下不是你明确说的，请确认或修改：</span>
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {c.inferences.map((inf, i) => (
              <li key={i}>
                <span className="font-medium">{inf.assumed}</span>
                <span className="text-amber-700/80"> — {inf.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CandidateList({
  candidates,
  onUpdate,
  onDelete,
  disabled,
}: {
  candidates: Candidate[];
  onUpdate: (
    clientId: string,
    patch: { title?: string; start?: string; end?: string }
  ) => void;
  onDelete: (clientId: string) => void;
  disabled: boolean;
}) {
  if (!candidates.length) return null;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-soft">
        <span className="rounded-md bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
          日程确认
        </span>
        共 {candidates.length} 条
      </div>
      {candidates.map((c) => (
        <CandidateCard
          key={c.clientId}
          c={c}
          onUpdate={onUpdate}
          onDelete={onDelete}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
