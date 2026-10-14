"use client";

import { useEffect, useState } from "react";

type Settings = {
  hasApiKey: boolean;
  baseUrl: string | null;
  model: string | null;
};

export function LlmSettings() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const r = await fetch("/api/user/settings");
    if (r.ok) {
      const d = await r.json();
      setSettings(d);
      setBaseUrl(d.baseUrl ?? "");
      setModel(d.model ?? "");
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const save = async () => {
    setSaving(true);
    setMsg("");
    const r = await fetch("/api/user/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
      }),
    });
    setSaving(false);
    if (r.ok) {
      setMsg("已保存");
      load();
      setApiKey("");
    } else {
      const d = await r.json().catch(() => ({}));
      setMsg(d?.error?.message || "保存失败");
    }
  };

  const clear = async () => {
    setSaving(true);
    setMsg("");
    const r = await fetch("/api/user/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
    setSaving(false);
    if (r.ok) {
      setMsg("已清除");
      setApiKey("");
      setBaseUrl("");
      setModel("");
      load();
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs text-ink-soft shadow-sm transition hover:bg-surface"
        title="LLM 设置"
      >
        ⚙️
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setOpen(false)}>
          <div
            className="w-[420px] rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">LLM 设置</h3>
              <button onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink">✕</button>
            </div>

            <p className="mb-4 text-xs text-ink-faint">
              填入你自己的 LLM API Key 后，所有对话将消耗你自己的 token，不再使用平台默认额度。支持任意 OpenAI 兼容接口。
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings?.hasApiKey ? "（已配置，留空则不修改）" : "sk-..."}
                  className="w-full rounded-lg border border-line bg-surface/50 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Base URL（可选）</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.deepseek.com/v1"
                  className="w-full rounded-lg border border-line bg-surface/50 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">模型名（可选）</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="deepseek-chat"
                  className="w-full rounded-lg border border-line bg-surface/50 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </div>
            </div>

            {msg && <p className="mt-3 text-xs text-brand-600">{msg}</p>}

            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={clear}
                disabled={saving || !settings?.hasApiKey}
                className="text-xs text-rose-500 hover:text-rose-600 disabled:opacity-40"
              >
                清除我的配置
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line px-4 py-2 text-xs text-ink-soft hover:bg-surface"
                >
                  取消
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
