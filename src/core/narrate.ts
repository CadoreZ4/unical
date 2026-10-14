import { chatStream, llmConfigured, type LlmConfig } from "@/adapters/llm";
import type { Plan } from "./types";

// 引擎完成结构化计算后，用 SaySpec 描述“这一轮要对用户说什么”。
// 叙述文本统一走流式 LLM；未配置/失败时回退到确定性模板。
export type SaySpec =
  | { t: "refused"; message: string }
  | { t: "clarify"; goal: string }
  | { t: "slots"; title: string; dateLabel: string; lines: string[] }
  | { t: "single"; title: string; conflictText: string }
  | { t: "slot_chosen"; label: string; conflictText: string }
  | { t: "slot_custom"; label: string; conflictText: string }
  | { t: "plan"; plan: Plan }
  | { t: "plan_ready"; count: number; conflictText: string }
  | { t: "committed"; okN: number; failN: number }
  | { t: "calendar_query"; answer: string; title: string; dateLabel: string; lines: string[] }
  | { t: "hint"; key: "plan_adjust" | "edit_candidates" };

const NARRATE_SYSTEM = `你是 UniCal 日历助手的“对话表达层”。后台已经完成了计算，并把要告诉用户的事实放在用户消息的 JSON（facts）里。
你的唯一任务：依据 facts 写一段中文回复，通过流式逐字输出给用户。

## 硬性要求
- 只能使用 facts 里的事实，绝不允许编造时间、数量、标题、频率、地点。
- facts 中给出的时间行 / 选项行（如时段序号、HH:mm）必须原样、逐字、按原顺序呈现，不许改写或换算。
- 口语化、简洁、友好，可适度使用 emoji 但不滥用；适当换行分点，便于手机阅读。
- 不要输出 JSON，不要解释你的处理过程，不要提到“facts / 系统 / 接口”。

## 按 facts.kind 输出
- clarify：用户给了一个抽象目标 facts.goal。提出 2~3 个“与该目标强相关”的问题，帮助把它变成可执行日程。
  · 必须包含：① 期望多久达成 / 截止时间；② 每次能投入多长时间。
  · 第 3 个问题必须贴合该目标所在领域的关键条件，例如：
    学习/考试/技能类 → 现有基础（零基础/有经验）与可用学习资源或工具、每天在什么场景学；
    健身/运动类 → 场地与器材、身体禁忌；
    阅读类 → 读什么书/材料、每天阅读场景；
    创作/副业类 → 现有积累、可投入的工具与产出形式；
    其他目标 → 达成它最需要确认的现实条件。
  · 绝不要对非健身目标问器材，绝不要千篇一律；用项目符号列出，结尾提示“可以一句话回答”。
- slots：说明没听清具体几点、已参考其日历给出可用时段；把 facts.lines 原样逐行列出；结尾让用户回复序号（如“选2”）或直接说想要的时间。
- single：告知已生成 1 条日程 facts.title，请用户确认或直接修改；若 facts.conflictText 非空，要包含冲突提醒（仅标红、不自动改期）。
- slot_chosen / slot_custom：确认时间已安排在 facts.label；非空 conflictText 时附上冲突提醒。
- plan：这是第一道“方案确认”。按 目标 / 频率·单次时长·周期 / 具体内容 / 检查点 / 假设 分点呈现 facts.plan，结尾让用户回复“确认”进入日程拆解，或直接说要调整什么。
- plan_ready：说明方案已落成 facts.count 条日程（第二道关），非空时附冲突，结尾让用户回复“确认写入”加入主日历。
- committed：告知已写入 facts.okN 条到主日历；facts.failN>0 时说明有几条失败、可重试；最后提示可以继续说下一个安排或目标。
- calendar_query：用户在选时段时问了日历情况。先用一句话回答 facts.answer（那天某时段有没有安排、有哪些），然后重新列出 facts.lines 这些可用时段让用户选（序号、时间原样），结尾让用户回复序号或说想要的时间。
- hint：plan_adjust → 请用户说明方案要调整什么，无异议回复“确认”；edit_candidates → 提示可在清单里直接编辑/删除，准备好后回复“确认写入”。
- refused：原样转达 facts.message，不要改写或追加。`;

function fallbackText(spec: SaySpec): string {
  switch (spec.t) {
    case "refused":
      return spec.message;
    case "clarify":
      return (
        `这个目标我先帮你变成可执行方案（目标：${spec.goal}）。开始前确认几点（可以一句话回答）：\n` +
        "· 希望多久内达成 / 截止时间？（如：1 个月、6 周）\n" +
        "· 每次大概能投入多长时间？（如：15 分钟、半小时）\n" +
        "· 结合这个目标，你现在的基础和可用条件是什么？（如：零基础 / 有经验；在家或在公司；需要什么工具或材料）"
      );
    case "slots":
      return (
        `你没说具体几点，我看了下你那天的日历，给你几个可用时段：\n` +
        spec.lines.join("\n") +
        `\n回复序号（如“选2”）即可，也可以直接告诉我你想要的时间。`
      );
    case "single":
      return `已拆解为 1 条日程「${spec.title}」，请确认或修改：\n${spec.conflictText}`;
    case "slot_chosen":
      return `好的，已安排在 ${spec.label}。\n${spec.conflictText}`;
    case "slot_custom":
      return `已按你说的时间调整：${spec.label}。\n${spec.conflictText}`;
    case "plan": {
      const p = spec.plan;
      return [
        "我先给一版可执行方案（第一道关）：",
        `目标：${p.goal}`,
        `频率：${p.frequency}；单次约 ${p.perSessionMinutes} 分钟；周期 ${p.durationDays} 天`,
        `具体内容：${p.content}`,
        `检查点：${p.checkpoints}`,
        `假设：${p.assumptions.join("；")}`,
        "回复「确认」进入日程拆解，或直接告诉我要调整什么。",
      ].join("\n");
    }
    case "plan_ready":
      return (
        `方案已落成 ${spec.count} 条日程（第二道关），请确认：\n${spec.conflictText}\n` +
        "回复「确认写入」加入你的主日历。"
      );
    case "committed":
      return (
        `已写入 ${spec.okN} 条到你的主日历。` +
        (spec.failN ? ` ${spec.failN} 条失败，可单独重试。` : "") +
        " 你可以继续告诉我下一个安排或目标。"
      );
    case "calendar_query":
      return (
        `${spec.answer}\n` +
        `回到「${spec.title}」的时间选择，${spec.dateLabel} 可用时段：\n` +
        spec.lines.join("\n") +
        `\n回复序号（如"选2"）或告诉我你想要的时间。`
      );
    case "hint":
      return spec.key === "plan_adjust"
        ? "请告诉我方案要调整哪里；如无异议，回复「确认」即可。"
        : "你可以在下方清单里直接编辑/删除条目；准备好后回复「确认写入」。";
  }
}

// 这几类是结构化、机械性的回复，直接用模板生成，不消耗 LLM token。
// 只有 clarify（领域化提问）和 plan（方案自然表达）保留 LLM。
const TEMPLATE_ONLY = new Set([
  "slots",
  "single",
  "slot_chosen",
  "slot_custom",
  "plan_ready",
  "committed",
  "calendar_query",
  "hint",
  "refused",
]);

// 流式叙述：onDelta 收到正文增量；resolve 返回完整文本。
// 安全拒绝和模板直出类型不走模型，原样逐块下发，不消耗 token。
// llmCfg 仅在 clarify/plan 走 LLM 时生效（用户自带 Key 场景）。
export async function narrateStream(
  spec: SaySpec,
  onDelta: (chunk: string) => void,
  llmCfg?: LlmConfig
): Promise<string> {
  if (TEMPLATE_ONLY.has(spec.t)) {
    const text = fallbackText(spec);
    onDelta(text);
    return text;
  }
  if (!llmConfigured(llmCfg)) {
    const text = fallbackText(spec);
    onDelta(text);
    return text;
  }
  try {
    const text = await chatStream(
      NARRATE_SYSTEM,
      `facts: ${JSON.stringify(spec)}`,
      onDelta,
      llmCfg
    );
    const trimmed = text.trim();
    if (!trimmed) {
      const fb = fallbackText(spec);
      onDelta(fb);
      return fb;
    }
    return text;
  } catch (e) {
    console.warn("[narrate] 流式生成失败，回退模板", e);
    const fb = fallbackText(spec);
    onDelta(fb);
    return fb;
  }
}

export function narrateText(spec: SaySpec): string {
  return spec.t === "refused" ? spec.message : fallbackText(spec);
}
