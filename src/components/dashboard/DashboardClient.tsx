// src/components/dashboard/DashboardClient.tsx
"use client";

import { useState } from "react";
import {
  Download,
  FileJson,
  FileSpreadsheet,
  LayoutDashboard,
  Users,
} from "lucide-react";
import type { AnalysisReport } from "@/types/dashboard";
import { exportReportAsCsv, exportReportAsJson } from "@/lib/export-report";
import { AnalyzeForm } from "./AnalyzeForm";
import { KpiCards } from "./KpiCards";
import { DashboardCharts } from "./DashboardCharts";
import { AiInsightsSection } from "./AiInsightsSection";
import { TopPostsTable } from "./TopPostsTable";
import { AccountComparison } from "./AccountComparison";

interface DashboardClientProps {
  initialReports: AnalysisReport[];
}

function isValidReport(item: unknown): item is AnalysisReport {
  return Boolean(
    item &&
      typeof item === "object" &&
      "account" in item &&
      (item as AnalysisReport).account?.username &&
      "metrics" in item &&
      (item as AnalysisReport).metrics
  );
}

export function DashboardClient({ initialReports }: DashboardClientProps) {
  const validInitial = (initialReports ?? []).filter(isValidReport);

  const [reports, setReports] = useState<AnalysisReport[]>(validInitial);
  const [activeReport, setActiveReport] = useState<AnalysisReport | null>(
    validInitial[0] ?? null
  );
  const [activeTab, setActiveTab] = useState<"overview" | "compare">("overview");

  function handleAnalysisSuccess(newReport: AnalysisReport) {
    if (!isValidReport(newReport)) {
      console.error("收到格式不完整的報表物件：", newReport);
      return;
    }

    setActiveReport(newReport);
    setActiveTab("overview");
    setReports((prev) => {
      const filtered = prev.filter(
        (r) =>
          r?.account?.username?.toLowerCase() !==
          newReport.account.username.toLowerCase()
      );
      return [newReport, ...filtered];
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* 頁首與匯出動作列 */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Threads 內容數據分析儀表板
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            互動分群洞察、黃金發文時段與 AI 策略建議
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeReport && (
            <>
              <button
                type="button"
                onClick={() => exportReportAsJson(activeReport)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FileJson className="h-4 w-4 text-indigo-600" />
                匯出 JSON
              </button>
              <button
                type="button"
                onClick={() => exportReportAsCsv(activeReport)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                匯出 CSV
              </button>
            </>
          )}
        </div>
      </header>

      {/* 帳號分析輸入區 */}
      <AnalyzeForm
        currentReport={activeReport}
        onAnalysisSuccess={handleAnalysisSuccess}
      />

      {/* 歷史帳號快速切換 + 模式頁籤 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
              activeTab === "overview"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            單一帳號分析
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("compare")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
              activeTab === "compare"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            多帳號比較 ({reports.length})
          </button>
        </div>

        {reports.length > 0 && activeTab === "overview" && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">切換已分析帳號：</span>
            <select
              value={activeReport?.account?.username ?? ""}
              onChange={(e) => {
                const found = reports.find(
                  (r) => r?.account?.username === e.target.value
                );
                if (found) setActiveReport(found);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
            >
              {reports.map((r) => (
                <option key={r.account.username} value={r.account.username}>
                  @{r.account.username} ({r.account.display_name})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 主內容區 */}
      {activeTab === "compare" ? (
        <AccountComparison
          reports={reports}
          onSelectAccount={(report) => {
            setActiveReport(report);
            setActiveTab("overview");
          }}
        />
      ) : activeReport ? (
        <div className="space-y-6">
          <KpiCards metrics={activeReport.metrics} />
          <DashboardCharts report={activeReport} />
          <AiInsightsSection report={activeReport} />
          <TopPostsTable report={activeReport} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <Download className="h-8 w-8 text-slate-300" />
          <h2 className="mt-3 text-base font-semibold text-slate-800">
            尚未載入分析報告
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            請在上方輸入 Threads 帳號（例如 taipei_pm_notes）並點擊「開始分析」。
          </p>
        </div>
      )}
    </div>
  );
}