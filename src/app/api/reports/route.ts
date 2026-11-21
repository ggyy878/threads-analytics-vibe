// src/app/api/reports/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { normalizeAnalyzeResponse } from "@/lib/normalize-report";
import type { AnalysisReport } from "@/types/dashboard";

type AnyRecord = Record<string, unknown>;

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "未登入" }, { status: 401 });
    }

    const { data: reportRows, error } = await supabase
      .from("aggregated_reports")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      return NextResponse.json(
        { error: "無法讀取歷史分析報告", detail: error.message },
        { status: 500 }
      );
    }

    const latestRowByAccountId = new Map<string, AnyRecord>();
    for (const row of (reportRows ?? []) as AnyRecord[]) {
      const accountId = String(row.account_id ?? "");
      if (!accountId || latestRowByAccountId.has(accountId)) continue;
      latestRowByAccountId.set(accountId, row);
    }

    const accountIds = Array.from(latestRowByAccountId.keys());
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

    const reports: AnalysisReport[] = [];
    for (const [accountId, row] of latestRowByAccountId.entries()) {
      const account = accountMap.get(accountId);
      const allAccountPosts = postsByAccountId.get(accountId) ?? [];
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

      if (normalized) reports.push(normalized);
    }

    return NextResponse.json({ reports });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "伺服器錯誤", detail: message },
      { status: 500 }
    );
  }
}