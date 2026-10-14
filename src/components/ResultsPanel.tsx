import type { Candidate, WriteResult } from "@/core/types";

export function ResultsPanel({
  results,
  candidates,
  onViewCalendar,
}: {
  results: WriteResult[];
  candidates: Candidate[];
  onViewCalendar: () => void;
}) {
  const titleOf = new Map(candidates.map((c) => [c.clientId, c.title]));
  const okN = results.filter((r) => r.ok).length;
  const failN = results.length - okN;

  return (
    <div className="card space-y-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">写入结果</h3>
        <button
          onClick={onViewCalendar}
          className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
        >
          查看最新日历
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        成功 {okN} 条{failN > 0 ? `，失败 ${failN} 条` : ""}
      </p>
      <div className="space-y-1.5 text-sm">
        {results.map((r) => (
          <div key={r.clientId} className="flex items-center gap-2">
            <span>{r.ok ? "✅" : "⚠️"}</span>
            <span className="flex-1 truncate text-ink-soft">
              {titleOf.get(r.clientId) || r.clientId}
            </span>
            {!r.ok && <span className="text-xs text-red-500">{r.error}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
