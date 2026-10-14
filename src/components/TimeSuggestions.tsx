import type { TimeSuggestion } from "@/core/types";
import { formatDateTime } from "@/lib/format";

export function TimeSuggestions({
  suggestions,
  onPick,
}: {
  suggestions: TimeSuggestion[];
  onPick: (index: number) => void;
}) {
  if (!suggestions.length) return null;
  return (
    <div className="card animate-riseIn p-4 text-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-brand-500 px-2 py-0.5 text-[11px] font-medium text-white">
          时段选择
        </span>
        <span className="font-medium text-ink">你没说具体几点，挑个可用时段</span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onPick(i)}
            className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50 active:scale-[.99]"
          >
            <span className="font-medium text-ink">{formatDateTime(s.start)}</span>
            <span className="text-xs text-ink-faint">
              {s.start.slice(11, 16)} - {s.end.slice(11, 16)}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-ink-faint">
        点击上方任一选项，或直接在输入框回复你想要的时间。
      </p>
    </div>
  );
}
