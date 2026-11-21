// src/components/dashboard/AccountComparison.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Users, CheckSquare, Square } from "lucide-react";
import type { AnalysisReport } from "@/types/dashboard";

interface AccountComparisonProps {
  reports: AnalysisReport[];
  onSelectAccount?: (report: AnalysisReport) => void;
}

export function AccountComparison({
  reports,
  onSelectAccount,
}: AccountComparisonProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>(() =>
    reports.slice(0, 2).map((r) => r.account.username)
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // 當新增分析帳號且目前選取不足 2 個時，自動補齊勾選
    if (selectedUsernames.length < 2 && reports.length >= 2) {
      setSelectedUsernames(reports.slice(0, 2).map((r) => r.account.username));
    }
  }, [reports, selectedUsernames.length]);

  function toggleAccount(username: string) {
    setSelectedUsernames((prev) =>
      prev.includes(username)
        ? prev.filter((u) => u !== username)
        : [...prev, username]
    );
  }

  const comparedReports = useMemo(
    () => reports.filter((r) => selectedUsernames.includes(r.account.username)),
    [reports, selectedUsernames]
  );

  const chartData = useMemo(
    () =>
      comparedReports.map((r) => ({
        account: `@${r.account.username}`,
        avg_engagement: Number(r.metrics.avg_engagement.toFixed(1)),
        median_engagement: Number(r.metrics.median_engagement.toFixed(1)),
        high_tier_avg: Number(r.tier_summary.high.avg_engagement.toFixed(1)),
      })),
    [comparedReports]
  );

  return (
    <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
            <Users className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              多帳號並排比較
            </h3>
            <p className="text-xs text-slate-500">
              勾選 2 個以上已分析帳號，立即比較互動表現與內容策略指標
            </p>
          </div>
        </div>
        <span className="text-xs font-medium text-slate-500">
          已勾選 {selectedUsernames.length} / {reports.length} 個帳號
        </span>
      </div>

      {/* 帳號勾選清單 */}
      {reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
          尚無歷史分析紀錄，請先於上方輸入帳號執行分析。
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {reports.map((report) => {
            const username = report.account.username;
            const checked = selectedUsernames.includes(username);
            return (
              <button
                key={username}
                type="button"
                onClick={() => toggleAccount(username)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  checked
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {checked ? (
                  <CheckSquare className="h-4 w-4 text-indigo-600" />
                ) : (
                  <Square className="h-4 w-4 text-slate-400" />
                )}
                <span>@{username}</span>
                <span className="text-[11px] text-slate-400">
                  (均互動 {report.metrics.avg_engagement.toFixed(0)})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {comparedReports.length < 2 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          請至少勾選 <strong>2 個帳號</strong> 進行並排對比（若目前僅有 1 個帳號，請先分析另一個 Threads 帳號）。
        </div>
      ) : (
        <>
          {/* 並排對比圖表 */}
          <div className="h-72 w-full">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 10, right: 16, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="account" tick={{ fontSize: 12, fill: "#334155" }} />
                  <YAxis tick={{ fontSize: 12, fill: "#475569" }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      borderColor: "#e2e8f0",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Bar
                    dataKey="avg_engagement"
                    name="平均互動數"
                    fill="#6366f1"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                  <Bar
                    dataKey="median_engagement"
                    name="中位數互動"
                    fill="#10b981"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                  <Bar
                    dataKey="high_tier_avg"
                    name="高表現群組均互動"
                    fill="#f59e0b"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 並排指標比較表格 */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-3 py-2.5 font-semibold">指標項目</th>
                  {comparedReports.map((r) => (
                    <th key={r.account.username} className="px-3 py-2.5 font-semibold">
                      <div className="flex items-center justify-between gap-2">
                        <span>@{r.account.username}</span>
                        {onSelectAccount && (
                          <button
                            type="button"
                            onClick={() => onSelectAccount(r)}
                            className="text-[11px] font-medium text-indigo-600 hover:underline"
                          >
                            檢視詳情
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-3 py-2.5 font-medium text-slate-600">粉絲數</td>
                  {comparedReports.map((r) => (
                    <td key={r.account.username} className="px-3 py-2.5 font-semibold">
                      {r.account.follower_count.toLocaleString()}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium text-slate-600">分析貼文數</td>
                  {comparedReports.map((r) => (
                    <td key={r.account.username} className="px-3 py-2.5">
                      {r.metrics.total_posts} 篇
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium text-slate-600">總互動數</td>
                  {comparedReports.map((r) => (
                    <td key={r.account.username} className="px-3 py-2.5 font-semibold text-indigo-700">
                      {r.metrics.total_engagement.toLocaleString()}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium text-slate-600">平均互動數</td>
                  {comparedReports.map((r) => (
                    <td key={r.account.username} className="px-3 py-2.5">
                      {r.metrics.avg_engagement.toFixed(1)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium text-slate-600">中位數互動</td>
                  {comparedReports.map((r) => (
                    <td key={r.account.username} className="px-3 py-2.5">
                      {r.metrics.median_engagement.toFixed(1)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium text-slate-600">平均字數</td>
                  {comparedReports.map((r) => (
                    <td key={r.account.username} className="px-3 py-2.5">
                      {r.metrics.avg_char_count.toFixed(1)} 字
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium text-slate-600">
                    高表現群組問句率
                  </td>
                  {comparedReports.map((r) => (
                    <td key={r.account.username} className="px-3 py-2.5 text-emerald-700 font-medium">
                      {r.tier_summary.high.question_rate}%
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}