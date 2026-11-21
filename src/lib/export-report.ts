// src/lib/export-report.ts

import type { AnalysisReport } from "@/types/dashboard";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportReportAsJson(report: AnalysisReport) {
  const timestamp = new Date(report.generated_at)
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const filename = `${report.account.username}_report_${timestamp}.json`;
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  triggerDownload(blob, filename);
}

export function exportReportAsCsv(report: AnalysisReport) {
  const timestamp = new Date(report.generated_at)
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const filename = `${report.account.username}_report_${timestamp}.csv`;

  const rows: string[][] = [
    ["區塊", "項目", "數值 / 內容", "備註"],
    ["帳號資訊", "Username", `@${report.account.username}`, report.account.display_name],
    ["帳號資訊", "資料來源", report.data_source, report.generated_at],
    ["總覽指標", "總貼文數", String(report.metrics.total_posts), ""],
    ["總覽指標", "總互動數", String(report.metrics.total_engagement), `讚:${report.metrics.total_likes} / 回:${report.metrics.total_replies} / 轉:${report.metrics.total_reposts} / 引:${report.metrics.total_quotes}`],
    ["總覽指標", "平均互動數", String(report.metrics.avg_engagement), ""],
    ["總覽指標", "中位數互動", String(report.metrics.median_engagement), ""],
    ["總覽指標", "平均字數", String(report.metrics.avg_char_count), ""],
    [],
    ["三群組摘要", "群組", "貼文數", "平均互動數 / 問句率"],
    [
      "三群組摘要",
      report.tier_summary.high.label,
      String(report.tier_summary.high.count),
      `均互動 ${report.tier_summary.high.avg_engagement} / 問句率 ${report.tier_summary.high.question_rate}%`,
    ],
    [
      "三群組摘要",
      report.tier_summary.medium.label,
      String(report.tier_summary.medium.count),
      `均互動 ${report.tier_summary.medium.avg_engagement} / 問句率 ${report.tier_summary.medium.question_rate}%`,
    ],
    [
      "三群組摘要",
      report.tier_summary.low.label,
      String(report.tier_summary.low.count),
      `均互動 ${report.tier_summary.low.avg_engagement} / 問句率 ${report.tier_summary.low.question_rate}%`,
    ],
  ];

  if (report.posts && report.posts.length > 0) {
    rows.push([]);
    rows.push([
      "貼文 ID",
      "發布時間",
      "總互動數",
      "讚數",
      "回覆數",
      "轉發數",
      "引用數",
      "群組",
      "內容摘要",
    ]);
    for (const p of report.posts) {
      rows.push([
        p.post_id,
        p.published_at,
        String(p.total_engagement),
        String(p.likes),
        String(p.replies),
        String(p.reposts),
        String(p.quotes),
        p.tier ?? "",
        p.content.replace(/\r?\n/g, " "),
      ]);
    }
  }

  const csvBody = rows
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");

  // 加上 UTF-8 BOM 確保 Excel 開啟繁體中文不亂碼
  const blob = new Blob(["\uFEFF" + csvBody], {
    type: "text/csv;charset=utf-8",
  });
  triggerDownload(blob, filename);
}