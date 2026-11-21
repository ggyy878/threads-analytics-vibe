// src/components/dashboard/AiInsightsSection.tsx
"use client";

import {
  TrendingUp,
  TrendingDown,
  Eye,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import type { AnalysisReport } from "@/types/dashboard";

interface AiInsightsSectionProps {
  report: AnalysisReport;
}

const PRIORITY_STYLE: Record<string, string> = {
  P0: "bg-rose-100 text-rose-700 border-rose-200",
  P1: "bg-amber-100 text-amber-800 border-amber-200",
  P2: "bg-sky-100 text-sky-700 border-sky-200",
};

export function AiInsightsSection({ report }: AiInsightsSectionProps) {
  return (
    <section className="space-y-6">
      {/* 執行摘要 */}
      {report.executive_summary && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5">
          <div className="flex items-center gap-2 text-indigo-800">
            <Sparkles className="h-4 w-4" />
            <h3 className="text-sm font-bold">AI 策略總結（Executive Summary）</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">
            {report.executive_summary}
          </p>
        </div>
      )}

      {/* 高互動成功歸因 vs 低互動失敗歸因 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 成功歸因 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </span>
            <h3 className="text-base font-bold text-slate-900">高互動成功歸因</h3>
          </div>
          <div className="space-y-3">
            {report.success_factors.map((item, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    {item.title}
                  </h4>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium uppercase text-emerald-700">
                    {item.impact_level}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  {item.description}
                </p>
                {item.hook_pattern && (
                  <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-emerald-900 border border-emerald-100">
                    <span className="font-semibold">鉤子模板：</span>
                    {item.hook_pattern}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 失敗歸因 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded-lg bg-rose-50 p-2 text-rose-600">
              <TrendingDown className="h-4 w-4" />
            </span>
            <h3 className="text-base font-bold text-slate-900">低互動失敗歸因</h3>
          </div>
          <div className="space-y-3">
            {report.failure_factors.map((item, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-rose-100 bg-rose-50/40 p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    {item.title}
                  </h4>
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium uppercase text-rose-700">
                    {item.impact_level}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  {item.description}
                </p>
                {item.evidence_post_ids.length > 0 && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    參考貼文 ID：{item.evidence_post_ids.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 內容策略觀察 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-lg bg-sky-50 p-2 text-sky-600">
            <Eye className="h-4 w-4" />
          </span>
          <h3 className="text-base font-bold text-slate-900">內容策略觀察</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {report.content_observations.map((obs, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
            >
              <h4 className="text-sm font-semibold text-slate-900">
                {obs.dimension}
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-700">
                {obs.finding}
              </p>
              <p className="mt-2 border-t border-slate-200 pt-2 text-[11px] font-medium text-sky-700">
                數據佐證：{obs.metric_evidence}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* AI 行動建議 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-lg bg-amber-50 p-2 text-amber-600">
            <Lightbulb className="h-4 w-4" />
          </span>
          <h3 className="text-base font-bold text-slate-900">AI 行動建議</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {report.ai_recommendations.map((rec, idx) => (
            <div
              key={idx}
              className="flex flex-col justify-between rounded-xl border border-slate-200 p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-bold text-slate-900">{rec.title}</h4>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                      PRIORITY_STYLE[rec.priority] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {rec.priority}
                  </span>
                </div>

                <ul className="mt-2.5 list-disc space-y-1 pl-4 text-xs text-slate-600">
                  {rec.action_steps.map((step, sIdx) => (
                    <li key={sIdx}>{step}</li>
                  ))}
                </ul>

                {rec.example_hook && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700 border border-slate-200/80">
                    <span className="font-semibold text-indigo-700">範例開頭：</span>
                    「{rec.example_hook}」
                  </div>
                )}
              </div>

              <p className="mt-3 border-t border-slate-100 pt-2.5 text-xs font-medium text-emerald-700">
                預期成效：{rec.expected_impact}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}