// src/components/dashboard/AnalyzeForm.tsx
"use client";

import { useState, type FormEvent } from "react";
import {
  Search,
  Loader2,
  Sparkles,
  Database,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { AnalysisReport } from "@/types/dashboard";
import { normalizeAnalyzeResponse } from "@/lib/normalize-report";

interface AnalyzeFormProps {
  currentReport: AnalysisReport | null;
  onAnalysisSuccess: (report: AnalysisReport) => void;
}

const LOADING_STEPS = [
  "正在連線並擷取 Threads 公開貼文...",
  "正在計算三群組互動指標與時段分布...",
  "正在呼叫 Gemini 生成 AI 內容策略洞察...",
];

export function AnalyzeForm({
  currentReport,
  onAnalysisSuccess,
}: AnalyzeFormProps) {
  const [username, setUsername] = useState(
    currentReport?.account?.username ?? "taipei_pm_notes"
  );
  const [isLoading, setIsLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleaned = username.trim().replace(/^@+/, "");
    if (!cleaned) {
      setErrorMsg("請輸入有效的 Threads 帳號名稱");
      return;
    }

    setErrorMsg(null);
    setIsLoading(true);
    setStepIndex(0);

    const timer = setInterval(() => {
      setStepIndex((prev) => (prev + 1) % LOADING_STEPS.length);
    }, 2500);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleaned }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(
          payload?.error || payload?.message || `分析失敗 (${res.status})`
        );
      }

      const normalizedReport = normalizeAnalyzeResponse(payload, cleaned);
      if (!normalizedReport) {
        console.error("無法轉換 /api/analyze 回傳內容：", payload);
        throw new Error("回傳資料格式異常，請查看 Console 紀錄。");
      }

      onAnalysisSuccess(normalizedReport);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "分析過程發生未知錯誤");
    } finally {
      clearInterval(timer);
      setIsLoading(false);
    }
  }

  function renderSourceBadge() {
    if (!currentReport) return null;

    if (currentReport.cached || currentReport.data_source === "cache") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
          <Database className="h-3.5 w-3.5" />
          快取命中 (Cache Hit)
        </span>
      );
    }

    if (currentReport.data_source === "mock_fallback") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" />
          模擬資料回退 (Mock Fallback)
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        即時擷取 (Live)
      </span>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="輸入 Threads 帳號，例如 taipei_pm_notes 或 @zuck"
            disabled={isLoading}
            className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              分析中...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              開始分析
            </>
          )}
        </button>
      </form>

      {isLoading && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-indigo-50 px-3.5 py-2.5 text-xs font-medium text-indigo-700">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>{LOADING_STEPS[stepIndex]}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
          {errorMsg}
        </div>
      )}

      {currentReport && !isLoading && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">
                {currentReport.account.display_name ||
                  currentReport.account.username}
              </h2>
              <a
                href={currentReport.account.profile_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-indigo-600 hover:underline"
              >
                @{currentReport.account.username}
              </a>
              <span className="text-xs text-slate-500">
                ・粉絲數 {currentReport.account.follower_count.toLocaleString()}
              </span>
            </div>
            {currentReport.account.bio && (
              <p className="mt-1 truncate text-xs text-slate-500">
                {currentReport.account.bio}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {renderSourceBadge()}
            <span
              suppressHydrationWarning
              className="text-xs text-slate-400"
            >
              更新於{" "}
              {new Date(currentReport.generated_at).toLocaleString("zh-TW", {
                timeZone: "Asia/Taipei",
                hour12: false,
              })}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}