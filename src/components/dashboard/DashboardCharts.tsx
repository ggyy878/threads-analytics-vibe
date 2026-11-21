// src/components/dashboard/DashboardCharts.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { AnalysisReport } from "@/types/dashboard";

interface DashboardChartsProps {
  report: AnalysisReport;
}

// 👉 新增這一段
interface TrendDataPoint {
    label: string;
    engagement: number;
    likes?: number;
    replies?: number;
    post_count?: number;
  }

export function DashboardCharts({ report }: DashboardChartsProps) {
  // 確保僅在瀏覽器端掛載後渲染 Recharts，避免 Next.js 16 SSR 水合警告
  const [mounted, setMounted] = useState(false);
  const [trendMode, setTrendMode] = useState<"posts" | "hourly">(
    report.posts && report.posts.length > 0 ? "posts" : "hourly"
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setTrendMode(report.posts && report.posts.length > 0 ? "posts" : "hourly");
  }, [report.task_id, report.posts]);

  // 圖表一：高／中／低三群組分布與平均互動數（雙 Y 軸）
  const tierChartData = useMemo(() => {
    const { high, medium, low } = report.tier_summary;
    return [
      {
        name: high.label,
        post_count: high.count,
        avg_engagement: Number(high.avg_engagement.toFixed(1)),
        question_rate: high.question_rate,
      },
      {
        name: medium.label,
        post_count: medium.count,
        avg_engagement: Number(medium.avg_engagement.toFixed(1)),
        question_rate: medium.question_rate,
      },
      {
        name: low.label,
        post_count: low.count,
        avg_engagement: Number(low.avg_engagement.toFixed(1)),
        question_rate: low.question_rate,
      },
    ];
  }, [report.tier_summary]);

  // 圖表二（模式 A）：各篇貼文隨發布時間的互動趨勢
  // 👉 加上 <TrendDataPoint[]>
  const postTrendData = useMemo<TrendDataPoint[]>(() => {
    if (!report.posts || report.posts.length === 0) return [];
    return [...report.posts]
      .sort(
        (a, b) =>
          new Date(a.published_at).getTime() - new Date(b.published_at).getTime()
      )
      .map((post) => {
        const d = new Date(post.published_at);
        const label = Number.isNaN(d.getTime())
          ? post.post_id
          : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
        return {
          label,
          engagement: post.total_engagement,
          likes: post.likes,
          replies: post.replies,
        };
      });
  }, [report.posts]);

 // 👉 加上 <TrendDataPoint[]>
 const hourlyTrendData = useMemo<TrendDataPoint[]>(() => {
    return report.chart_snapshots.hourly_distribution.map((item) => ({
      label: item.label,
      engagement: Number(item.avg_engagement.toFixed(1)),
      post_count: item.post_count,
    }));
  }, [report.chart_snapshots.hourly_distribution]);

  const hasPosts = postTrendData.length > 0;
  // 👉 加上 : TrendDataPoint[]
  const activeTrendData: TrendDataPoint[] =
    trendMode === "posts" && hasPosts ? postTrendData : hourlyTrendData;

  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* 圖表一：三群組分布與表現對比 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              三群組表現對比（高／中／低）
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              高表現門檻 ≥ {report.high_tier_threshold} ｜ 低表現門檻 ≤{" "}
              {report.low_tier_threshold}
            </p>
          </div>
        </div>

        <div className="h-72 w-full">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={tierChartData}
                margin={{ top: 10, right: 12, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#475569" }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 12, fill: "#6366f1" }}
                  label={{
                    value: "平均互動數",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 11, fill: "#6366f1" },
                  }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "#10b981" }}
                  label={{
                    value: "貼文數",
                    angle: 90,
                    position: "insideRight",
                    style: { fontSize: 11, fill: "#10b981" },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    borderColor: "#e2e8f0",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar
                  yAxisId="left"
                  dataKey="avg_engagement"
                  name="平均互動數"
                  fill="#6366f1"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={44}
                />
                <Bar
                  yAxisId="right"
                  dataKey="post_count"
                  name="貼文數量"
                  fill="#10b981"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={44}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl bg-slate-50 text-xs text-slate-400">
              載入圖表中...
            </div>
          )}
        </div>
      </div>

      {/* 圖表二：貼文發布時間與互動趨勢 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              貼文發布時間與互動趨勢
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {trendMode === "posts" && hasPosts
                ? "依各篇貼文發布時間排序的互動變化"
                : "24 小時各發文時段平均互動表現（Asia/Taipei）"}
            </p>
          </div>

          {hasPosts && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setTrendMode("posts")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  trendMode === "posts"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                單篇時間軸
              </button>
              <button
                type="button"
                onClick={() => setTrendMode("hourly")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  trendMode === "hourly"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                24H 時段
              </button>
            </div>
          )}
        </div>

        <div className="h-72 w-full">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={activeTrendData}
                margin={{ top: 10, right: 12, left: 0, bottom: 5 }}
              >
                <defs>
                  <linearGradient id="engagementFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#475569" }}
                  minTickGap={18}
                />
                <YAxis tick={{ fontSize: 12, fill: "#475569" }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    borderColor: "#e2e8f0",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Area
                  type="monotone"
                  dataKey="engagement"
                  name={trendMode === "posts" && hasPosts ? "貼文總互動數" : "時段平均互動數"}
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  fill="url(#engagementFill)"
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl bg-slate-50 text-xs text-slate-400">
              載入圖表中...
            </div>
          )}
        </div>
      </div>
    </section>
  );
}