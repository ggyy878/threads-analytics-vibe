// src/components/dashboard/KpiCards.tsx
"use client";

import { FileText, Flame, TrendingUp, BarChart3, Type } from "lucide-react";
import type { ReportMetrics } from "@/types/dashboard";

interface KpiCardsProps {
  metrics: ReportMetrics;
}

export function KpiCards({ metrics }: KpiCardsProps) {
  const cards = [
    {
      label: "總貼文數",
      value: metrics.total_posts.toLocaleString(),
      sub:
        metrics.duplicate_removed_count > 0
          ? `已去重 ${metrics.duplicate_removed_count} 篇`
          : "有效分析樣本",
      icon: FileText,
      accent: "text-slate-700 bg-slate-100",
    },
    {
      label: "總互動數",
      value: metrics.total_engagement.toLocaleString(),
      sub: `讚 ${metrics.total_likes.toLocaleString()} · 回 ${metrics.total_replies.toLocaleString()} · 轉 ${metrics.total_reposts.toLocaleString()}`,
      icon: Flame,
      accent: "text-rose-600 bg-rose-50",
    },
    {
      label: "平均互動數",
      value: metrics.avg_engagement.toFixed(1),
      sub: "單篇平均總互動",
      icon: TrendingUp,
      accent: "text-indigo-600 bg-indigo-50",
    },
    {
      label: "中位數互動",
      value: metrics.median_engagement.toFixed(1),
      sub:
        metrics.avg_engagement > metrics.median_engagement * 1.4
          ? "爆文拉高均值（右偏分布）"
          : "互動表現相對集中",
      icon: BarChart3,
      accent: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "平均字數",
      value: `${metrics.avg_char_count.toFixed(1)} 字`,
      sub: "每篇貼文平均長度",
      icon: Type,
      accent: "text-amber-600 bg-amber-50",
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                {card.label}
              </span>
              <span className={`rounded-lg p-2 ${card.accent}`}>
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
              {card.value}
            </p>
            <p className="mt-1 truncate text-xs text-slate-500" title={card.sub}>
              {card.sub}
            </p>
          </div>
        );
      })}
    </section>
  );
}