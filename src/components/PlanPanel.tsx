import type { Plan } from "@/core/types";

export function PlanPanel({
  plan,
  onConfirm,
}: {
  plan: Plan;
  onConfirm: () => void;
}) {
  return (
    <div className="card animate-riseIn p-4 text-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-brand-500 px-2 py-0.5 text-[11px] font-medium text-white">
          第一道关 · 方案确认
        </span>
        <span className="font-semibold text-ink">{plan.goal}</span>
      </div>
      <dl className="space-y-2 text-ink-soft">
        <div className="flex gap-2">
          <dt className="shrink-0 font-medium text-ink">频率</dt>
          <dd>
            {plan.frequency}，单次约 {plan.perSessionMinutes} 分钟，周期{" "}
            {plan.durationDays} 天
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-medium text-ink">内容</dt>
          <dd>{plan.content}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-medium text-ink">检查点</dt>
          <dd>{plan.checkpoints}</dd>
        </div>
        {plan.assumptions.length > 0 && (
          <div className="rounded-xl bg-brand-50 px-3 py-2 text-xs text-ink-soft">
            <span className="font-medium text-brand-700">假设：</span>
            {plan.assumptions.join("；")}
          </div>
        )}
      </dl>
      <button
        onClick={onConfirm}
        className="mt-4 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-600 active:scale-[.99]"
      >
        方案没问题，拆解成日程
      </button>
    </div>
  );
}
