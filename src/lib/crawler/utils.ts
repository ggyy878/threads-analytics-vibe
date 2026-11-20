import {
    ScrapedPostRecord,
    PostInsertRow,
    ThreadsCrawlerError,
  } from "./types";
  
  const HASHTAG_REGEX = /#([^\s#.,!?;:()[\]{}「」『』、。！？，；：]+)/g;
  const MENTION_REGEX = /(?:^|[^\w.])@([A-Za-z0-9._]+)/g;
  const URL_REGEX = /https?:\/\/[^\s]+/gi;
  
  export interface NormalizedTarget {
    username: string;
    profileUrl: string;
  }
  
  /**
   * 將使用者輸入的 URL 或 Username 正規化為小寫且不含 @ 的 username 與標準個人頁 URL
   * 支援格式：
   * - "zuck" / "@zuck"
   * - "https://www.threads.net/@zuck"
   * - "https://www.threads.com/@zuck?hl=zh-tw"
   */
  export function normalizeThreadsTarget(inputQuery: string): NormalizedTarget {
    const trimmed = inputQuery.trim();
    if (!trimmed) {
      throw new ThreadsCrawlerError("INVALID_INPUT", "請輸入有效的 Threads 帳號或個人頁網址。");
    }
  
    let username = "";
  
    if (/^https?:\/\//i.test(trimmed)) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmed);
      } catch {
        throw new ThreadsCrawlerError("INVALID_INPUT", `無法解析網址格式：${trimmed}`);
      }
  
      const hostname = parsedUrl.hostname.toLowerCase();
      if (!hostname.endsWith("threads.net") && !hostname.endsWith("threads.com")) {
        throw new ThreadsCrawlerError("INVALID_INPUT", `僅支援 threads.net 或 threads.com 網址：${trimmed}`);
      }
  
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      const firstSegment = segments[0] ?? "";
      username = firstSegment.replace(/^@/, "");
    } else {
      username = trimmed.replace(/^@/, "").split(/[/?#]/)[0] ?? "";
    }
  
    username = username.trim().toLowerCase();
  
    if (!/^[a-z0-9._]{1,30}$/.test(username)) {
      throw new ThreadsCrawlerError(
        "INVALID_INPUT",
        `無效的 Threads 帳號名稱：${inputQuery}`
      );
    }
  
    return {
      username,
      profileUrl: `https://www.threads.net/@${username}`,
    };
  }
  
  export interface TextFeatures {
    char_count: number;
    hashtag_count: number;
    mention_count: number;
    url_count: number;
    hashtags: string[];
    mentions: string[];
    has_question: boolean;
  }
  
  /**
   * 抽取貼文文字特徵，直接對齊 public.posts 的文字清理欄位
   */
  export function extractTextFeatures(content: string): TextFeatures {
    const normalized = content.trim();
  
    const hashtags: string[] = [];
    for (const match of normalized.matchAll(HASHTAG_REGEX)) {
      if (match[1]) hashtags.push(match[1]);
    }
  
    const mentions: string[] = [];
    for (const match of normalized.matchAll(MENTION_REGEX)) {
      if (match[1]) mentions.push(match[1]);
    }
  
    const urls = normalized.match(URL_REGEX) ?? [];
    const has_question = /[？?]/.test(normalized);
  
    return {
      char_count: normalized.length,
      hashtag_count: hashtags.length,
      mention_count: mentions.length,
      url_count: urls.length,
      hashtags,
      mentions,
      has_question,
    };
  }
  
  /**
   * 解析 Threads 介面常見的簡寫數字（例如 "1,234"、"2.5K"、"1.8萬"、"3M"）
   */
  export function parseCompactCount(rawText: string | null | undefined): number {
    if (!rawText) return 0;
    const cleaned = rawText.replace(/,/g, "").trim();
    const match = cleaned.match(/(\d+(?:\.\d+)?)\s*([KkMmBb萬億])?/);
    if (!match) return 0;
  
    const base = Number.parseFloat(match[1]);
    if (Number.isNaN(base) || base < 0) return 0;
  
    const unit = match[2];
    switch (unit) {
      case "K":
      case "k":
        return Math.round(base * 1_000);
      case "M":
      case "m":
        return Math.round(base * 1_000_000);
      case "B":
      case "b":
        return Math.round(base * 1_000_000_000);
      case "萬":
        return Math.round(base * 10_000);
      case "億":
        return Math.round(base * 100_000_000);
      default:
        return Math.round(base);
    }
  }
  
  /**
   * 隨機延遲（防反爬蟲偵測）
   */
  export function randomDelay(minMs: number, maxMs: number): Promise<void> {
    const safeMin = Math.max(0, minMs);
    const safeMax = Math.max(safeMin, maxMs);
    const ms = Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  
  /**
   * 讀取並驗證 PLAYWRIGHT_TIMEOUT_MS 環境變數（預設 30000ms）
   */
  export function resolvePlaywrightTimeoutMs(overrideMs?: number): number {
    if (typeof overrideMs === "number" && Number.isFinite(overrideMs) && overrideMs > 0) {
      return overrideMs;
    }
    const envVal = Number.parseInt(process.env.PLAYWRIGHT_TIMEOUT_MS ?? "", 10);
    if (Number.isFinite(envVal) && envVal >= 3_000) {
      return envVal;
    }
    return 30_000;
  }
  
  /**
   * 依 post_url 與 external_post_id 去除重複貼文（對齊 uq_posts_task_url 與 uq_posts_task_external_id）
   */
  export function deduplicatePosts(posts: ScrapedPostRecord[]): ScrapedPostRecord[] {
    const seenUrls = new Set<string>();
    const seenExternalIds = new Set<string>();
    const result: ScrapedPostRecord[] = [];
  
    for (const post of posts) {
      const urlKey = post.post_url.trim();
      if (!urlKey || seenUrls.has(urlKey)) continue;
      if (post.external_post_id && seenExternalIds.has(post.external_post_id)) continue;
  
      seenUrls.add(urlKey);
      if (post.external_post_id) {
        seenExternalIds.add(post.external_post_id);
      }
      result.push(post);
    }
  
    return result;
  }
  
  /**
   * 將爬取結果轉為可直接寫入 Supabase public.posts 的陣列（自動排除 total_engagement）
   */
  export function toSupabasePostInsertRows(
    posts: ScrapedPostRecord[],
    relations: { task_id: string; account_id: string; user_id: string }
  ): PostInsertRow[] {
    return deduplicatePosts(posts).map((post) => ({
      task_id: relations.task_id,
      account_id: relations.account_id,
      user_id: relations.user_id,
      external_post_id: post.external_post_id,
      post_url: post.post_url,
      content: post.content,
      published_at: post.published_at,
      like_count: Math.max(0, Math.trunc(post.like_count)),
      reply_count: Math.max(0, Math.trunc(post.reply_count)),
      repost_count: Math.max(0, Math.trunc(post.repost_count)),
      quote_count: Math.max(0, Math.trunc(post.quote_count)),
      view_count:
        post.view_count === null ? null : Math.max(0, Math.trunc(post.view_count)),
      char_count: Math.max(0, Math.trunc(post.char_count)),
      hashtag_count: Math.max(0, Math.trunc(post.hashtag_count)),
      mention_count: Math.max(0, Math.trunc(post.mention_count)),
      url_count: Math.max(0, Math.trunc(post.url_count)),
      hashtags: post.hashtags,
      mentions: post.mentions,
      engagement_tier: post.engagement_tier,
      is_nlp_sample: post.is_nlp_sample,
      nlp_post_insights: post.nlp_post_insights,
      raw_payload: post.raw_payload,
    }));
  }