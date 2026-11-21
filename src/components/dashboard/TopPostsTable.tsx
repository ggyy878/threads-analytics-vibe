// src/components/dashboard/TopPostsTable.tsx
"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, ExternalLink, Trophy } from "lucide-react";
import type { AnalysisReport, PostItem, TierKey } from "@/types/dashboard";

interface TopPostsTableProps {
  report: AnalysisReport;
}

type SortKey = "total_engagement" | "likes" | "replies" | "reposts" | "published_at";

const TIER_BADGE: Record<TierKey, string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-200 text-slate-700",
};

const TIER_LABEL: Record<TierKey, string> = {
  high: "高表現",
  medium: "中表現",
  low: "低表現",
};

export function TopPostsTable({ report }: TopPostsTableProps) {
  const [tierFilter, setTierFilter] = useState<"all" | TierKey>("all");
  const [sortBy, setSortBy] = useState<SortKey>("total_engagement");
  const [sortAsc, setSortAsc] = useState(false);

  const normalizedPosts = useMemo<PostItem[]>(() => {
    if (!report.posts || report.posts.length === 0) return [];
    return report.posts.map((post) => {
      let tier: TierKey = post.tier ?? "medium";
      if (!post.tier) {
        if (post.total_engagement >= report.high_tier_threshold) tier = "high";
        else if (post.total_engagement <= report.low_tier_threshold) tier = "low";
        else tier = "medium";
      }
      return { ...post, tier };
    });
  }, [report.posts, report.high_tier_threshold, report.low_tier_threshold]);

  const filteredAndSorted = useMemo(() => {
    const list =
      tierFilter === "all"
        ? normalizedPosts
        : normalizedPosts.filter((p) => p.tier === tierFilter);

    return [...list].sort((a, b) => {
      const valA =
        sortBy === "published_at"
          ? new Date(a.published_at).getTime()
          : a[sortBy];
      const valB =
        sortBy === "published_at"
          ? new Date(b.published_at).getTime()
          : b[sortBy];
      return sortAsc ? valA - valB : valB - valA;
    });
  }, [normalizedPosts, tierFilter, sortBy, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortBy(key);
      setSortAsc(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
            <Trophy className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Top Posts 互動排行榜
            </h3>
            <p className="text-xs text-slate-500">
              共 {filteredAndSorted.length} 篇符合條件貼文
            </p>
          </div>
        </div>

        {/* 群組篩選按鈕 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "high", "medium", "low"] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter(tier)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tierFilter === tier
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tier === "all" ? "全部群組" : TIER_LABEL[tier]}
            </button>
          ))}
        </div>
      </div>

      {filteredAndSorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
          <p className="font-medium text-slate-700">
            目前報表尚未附帶單篇貼文明細（`posts` 陣列）
          </p>
          <p className="mt-1">
            請確認 `POST /api/analyze` 回傳結果包含 `posts` 陣列，即可自動啟用完整排行榜與排序功能。
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {report.tier_summary.high.sample_post_ids.map((id) => (
              <span
                key={id}
                className="rounded-md bg-white px-2.5 py-1 text-[11px] font-mono text-slate-600 border border-slate-200"
              >
                代表高互動 ID: {id}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="px-3 py-2.5 font-semibold">#</th>
                <th className="px-3 py-2.5 font-semibold">貼文內容</th>
                <th className="px-3 py-2.5 font-semibold">群組</th>
                <th className="px-3 py-2.5 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort("total_engagement")}
                    className="inline-flex items-center gap-1 hover:text-indigo-600"
                  >
                    總互動 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort("likes")}
                    className="inline-flex items-center gap-1 hover:text-indigo-600"
                  >
                    讚 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort("replies")}
                    className="inline-flex items-center gap-1 hover:text-indigo-600"
                  >
                    回覆 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort("reposts")}
                    className="inline-flex items-center gap-1 hover:text-indigo-600"
                  >
                    轉發 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort("published_at")}
                    className="inline-flex items-center gap-1 hover:text-indigo-600"
                  >
                    發布時間 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSorted.map((post, idx) => {
                const tier = post.tier ?? "medium";
                return (
                  <tr key={post.post_id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-3 font-mono text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="max-w-md px-3 py-3">
                      <p className="line-clamp-2 text-slate-800">{post.content}</p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                        <span className="font-mono">{post.post_id}</span>
                        {post.post_url && (
                          <a
                            href={post.post_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline"
                          >
                            原文 <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TIER_BADGE[tier]}`}
                      >
                        {TIER_LABEL[tier]}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-bold text-indigo-700">
                      {post.total_engagement.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {post.likes.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {post.replies.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {post.reposts.toLocaleString()}
                    </td>
                    <td
                      suppressHydrationWarning
                      className="whitespace-nowrap px-3 py-3 text-slate-500"
                    >
                      {new Date(post.published_at).toLocaleString("zh-TW", {
                        timeZone: "Asia/Taipei",
                        hour12: false,
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}