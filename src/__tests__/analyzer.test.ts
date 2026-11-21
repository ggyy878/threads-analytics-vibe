// src/__tests__/analyzer.test.ts
import { describe, it, expect } from "vitest";

interface RawPost {
  id: string;
  content: string;
  likes: number;
  replies: number;
  reposts: number;
  views: number | null;
}

interface CleanedPost extends RawPost {
  engagementScore: number;
}

type EngagementTier = "high" | "medium" | "low";

// 若專案已於 src/lib/ 匯出對應函式，可直接改為 import 導入
function cleanPosts(posts: RawPost[]): CleanedPost[] {
  const seen = new Set<string>();
  const result: CleanedPost[] = [];

  for (const post of posts) {
    if (!post.id || seen.has(post.id)) continue;
    seen.add(post.id);

    const likes = Math.max(0, Number(post.likes) || 0);
    const replies = Math.max(0, Number(post.replies) || 0);
    const reposts = Math.max(0, Number(post.reposts) || 0);
    const views =
      post.views === null || post.views === undefined
        ? null
        : Math.max(0, Number(post.views));

    result.push({
      id: post.id,
      content: post.content.trim(),
      likes,
      replies,
      reposts,
      views,
      engagementScore: likes + replies * 2 + reposts * 3,
    });
  }

  return result;
}

function classifyEngagementTiers(
  posts: CleanedPost[]
): Array<CleanedPost & { tier: EngagementTier }> {
  if (posts.length === 0) return [];

  const sorted = [...posts].sort(
    (a, b) => b.engagementScore - a.engagementScore
  );
  const highCutoff = Math.ceil(sorted.length / 3);
  const mediumCutoff = Math.ceil((sorted.length * 2) / 3);

  return sorted.map((post, index) => {
    let tier: EngagementTier = "low";
    if (index < highCutoff) {
      tier = "high";
    } else if (index < mediumCutoff) {
      tier = "medium";
    }
    return { ...post, tier };
  });
}

describe("Threads 分析器核心邏輯", () => {
  it("資料清理：應去除重複貼文、修剪空白、修正負數指標並保留 nullable views", () => {
    const rawData: RawPost[] = [
      {
        id: "post-1",
        content: "  第一篇測試貼文  ",
        likes: 10,
        replies: -3,
        reposts: 2,
        views: null,
      },
      {
        id: "post-1", // 重複 ID 應被過濾
        content: "重複貼文",
        likes: 99,
        replies: 99,
        reposts: 99,
        views: 1000,
      },
      {
        id: "post-2",
        content: "第二篇貼文",
        likes: 5,
        replies: 1,
        reposts: 0,
        views: 250,
      },
    ];

    const cleaned = cleanPosts(rawData);

    expect(cleaned).toHaveLength(2);
    expect(cleaned[0]).toEqual({
      id: "post-1",
      content: "第一篇測試貼文",
      likes: 10,
      replies: 0,
      reposts: 2,
      views: null,
      engagementScore: 16, // 10 + 0*2 + 2*3
    });
    expect(cleaned[1].views).toBe(250);
  });

  it("三群組分類：應依據互動分數正確劃分為 high / medium / low 三組", () => {
    const samplePosts: RawPost[] = [
      { id: "p1", content: "低互動 A", likes: 2, replies: 0, reposts: 0, views: null },
      { id: "p2", content: "高互動 A", likes: 100, replies: 20, reposts: 10, views: null },
      { id: "p3", content: "中互動 A", likes: 30, replies: 5, reposts: 2, views: null },
      { id: "p4", content: "低互動 B", likes: 5, replies: 1, reposts: 0, views: null },
      { id: "p5", content: "高互動 B", likes: 80, replies: 15, reposts: 5, views: null },
      { id: "p6", content: "中互動 B", likes: 25, replies: 4, reposts: 1, views: null },
    ];

    const cleaned = cleanPosts(samplePosts);
    const classified = classifyEngagementTiers(cleaned);

    const highIds = classified.filter((p) => p.tier === "high").map((p) => p.id);
    const mediumIds = classified.filter((p) => p.tier === "medium").map((p) => p.id);
    const lowIds = classified.filter((p) => p.tier === "low").map((p) => p.id);

    expect(highIds).toEqual(["p2", "p5"]);
    expect(mediumIds).toEqual(["p3", "p6"]);
    expect(lowIds).toEqual(["p4", "p1"]);
  });
});