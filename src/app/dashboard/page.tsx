// src/app/dashboard/page.tsx
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { normalizeAnalyzeResponse } from "@/lib/normalize-report";
import type { AnalysisReport } from "@/types/dashboard";

type AnyRecord = Record<string, unknown>;

async function DashboardContent() {
  // 明確告知 Next.js 16 此元件需在請求當下動態渲染，避免 Supabase 內部的 Date.now() 觸發預渲染錯誤
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 1. 讀取當前使用者的歷史分析報告（aggregated_reports）
  const { data: reportRows, error: reportError } = await supabase
    .from("aggregated_reports")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (reportError) {
    console.error(
      "[Dashboard] 讀取 aggregated_reports 失敗：",
      reportError.message
    );
  }

  const rows = (reportRows ?? []) as AnyRecord[];

  // 依 account_id 去重，每個帳號只保留最新一筆報告
  const latestRowByAccountId = new Map<string, AnyRecord>();
  for (const row of rows) {
    const accountId = String(row.account_id ?? "");
    if (!accountId || latestRowByAccountId.has(accountId)) continue;
    latestRowByAccountId.set(accountId, row);
  }

  const accountIds = Array.from(latestRowByAccountId.keys());

  // 2. 平行撈取對應帳號（threads_accounts）與貼文明細（posts）
  const [accountsRes, postsRes] =
    accountIds.length > 0
      ? await Promise.all([
          supabase.from("threads_accounts").select("*").in("id", accountIds),
          supabase.from("posts").select("*").in("account_id", accountIds),
        ])
      : [{ data: [] }, { data: [] }];

  const accountMap = new Map<string, AnyRecord>();
  for (const acc of (accountsRes.data ?? []) as AnyRecord[]) {
    accountMap.set(String(acc.id ?? ""), acc);
  }

  const postsByAccountId = new Map<string, AnyRecord[]>();
  for (const post of (postsRes.data ?? []) as AnyRecord[]) {
    const accId = String(post.account_id ?? "");
    if (!accId) continue;
    const list = postsByAccountId.get(accId) ?? [];
    list.push(post);
    postsByAccountId.set(accId, list);
  }

  // 3. 轉換為前端統一的 AnalysisReport 格式
  const initialReports: AnalysisReport[] = [];
  for (const [accountId, row] of latestRowByAccountId.entries()) {
    const account = accountMap.get(accountId);
    const allAccountPosts = postsByAccountId.get(accountId) ?? [];

    // 若貼文帶有 task_id，優先篩出該次報告對應的貼文，避免多次分析重複累加
    const taskId = String(row.task_id ?? "");
    const taskPosts = taskId
      ? allAccountPosts.filter((p) => String(p.task_id ?? "") === taskId)
      : [];
    const posts = taskPosts.length > 0 ? taskPosts : allAccountPosts;

    const normalized = normalizeAnalyzeResponse(
      {
        report: row,
        account,
        posts,
        cached: true,
        data_source: row.data_source ?? "cache",
      },
      account?.username
        ? String(account.username)
        : `account_${accountId.slice(0, 6)}`
    );

    if (normalized) {
      initialReports.push(normalized);
    }
  }

  return (
    <>
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-bold tracking-tight text-slate-900">
              Threads Analytics
            </span>
            <span className="hidden text-slate-300 sm:inline">|</span>
            <p className="text-xs text-slate-500">登入帳號：{user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </nav>

      <DashboardClient initialReports={initialReports} />
    </>
  );
}

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Suspense
        fallback={
          <div className="mx-auto max-w-7xl px-4 py-12 text-sm text-slate-500 sm:px-6 lg:px-8">
            載入儀表板中...
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </main>
  );
}