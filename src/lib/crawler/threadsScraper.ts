// src/lib/crawler/threadsScraper.ts
import type { Browser, Page, Response } from "playwright";
import {
  CrawlOptions,
  ScrapedAccountProfile,
  ScrapedPostRecord,
  ThreadsCrawlerError,
} from "./types";
import {
  deduplicatePosts,
  extractTextFeatures,
  normalizeThreadsTarget,
  randomDelay,
  resolvePlaywrightTimeoutMs,
} from "./utils";

interface RawDomPost {
  externalPostId: string | null;
  postUrl: string;
  content: string;
  publishedAt: string | null;
  likeText: string;
  replyText: string;
  repostText: string;
  quoteText: string;
  hasImage: boolean;
  imageCount: number;
}

interface EmbeddedEngagementMetrics {
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  quote_count?: number;
}

export interface ScrapeOutput {
  account: ScrapedAccountProfile;
  posts: ScrapedPostRecord[];
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_SCROLL_ROUNDS = 28;
const MAX_STAGNANT_ROUNDS = 4;

/**
 * 中英文互動數值解析函式
 * 支援："1.2萬" -> 12000、"3.5K" -> 3500、"1,234" -> 1234、"2.1M" -> 2100000、"1.5億" -> 150000000 與純數字
 */
export function parseEngagementNumber(
  rawText: string | number | null | undefined
): number {
  if (typeof rawText === "number") {
    return Number.isFinite(rawText) && rawText >= 0 ? Math.round(rawText) : 0;
  }
  if (!rawText) return 0;

  const normalized = rawText
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ",")
    .replace(/．/g, ".")
    .replace(/,/g, "")
    .trim();

  if (!normalized) return 0;

  // (?![A-Za-z]) 避免將 "5min" 誤判為 "5M"
  const match = normalized.match(
    /(\d+(?:\.\d+)?)\s*(億|亿|萬|万|千|[KkMmBb](?![A-Za-z]))?/
  );
  if (!match) return 0;

  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base) || base < 0) return 0;

  const unit = (match[2] ?? "").toUpperCase();
  switch (unit) {
    case "千":
    case "K":
      return Math.round(base * 1_000);
    case "萬":
    case "万":
      return Math.round(base * 10_000);
    case "M":
      return Math.round(base * 1_000_000);
    case "億":
    case "亿":
      return Math.round(base * 100_000_000);
    case "B":
      return Math.round(base * 1_000_000_000);
    default:
      return Math.round(base);
  }
}

/**
 * 將未知 JSON 值安全轉為非負整數（無效時回傳 undefined）
 */
function toOptionalCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string" && /\d/.test(value)) {
    return parseEngagementNumber(value);
  }
  return undefined;
}

/**
 * 合併同一篇貼文來自多個 JSON 來源的互動計數（優先保留較大／非 undefined 數值）
 */
function mergeEmbeddedMetrics(
  targetMap: Map<string, EmbeddedEngagementMetrics>,
  postCode: string,
  incoming: EmbeddedEngagementMetrics
): void {
  const existing = targetMap.get(postCode) ?? {};
  const pick = (prev?: number, next?: number): number | undefined => {
    if (next === undefined) return prev;
    if (prev === undefined) return next;
    return Math.max(prev, next);
  };

  targetMap.set(postCode, {
    like_count: pick(existing.like_count, incoming.like_count),
    reply_count: pick(existing.reply_count, incoming.reply_count),
    repost_count: pick(existing.repost_count, incoming.repost_count),
    quote_count: pick(existing.quote_count, incoming.quote_count),
  });
}

/**
 * 遞迴走訪 Threads Relay / GraphQL JSON，依據貼文 shortcode (`code`) 提取互動欄位
 * 支援 like_count、direct_reply_count、repost_count、quote_count（含 text_post_app_info 巢狀結構）
 */
function collectMetricsFromJsonTree(
  root: unknown,
  targetMap: Map<string, EmbeddedEngagementMetrics>
): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];
  const MAX_DEPTH = 28;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.depth > MAX_DEPTH) continue;

    const { node, depth } = current;
    if (!node || typeof node !== "object") continue;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (node[i] && typeof node[i] === "object") {
          stack.push({ node: node[i], depth: depth + 1 });
        }
      }
      continue;
    }

    const record = node as Record<string, unknown>;
    const code = record.code;

    if (typeof code === "string" && /^[A-Za-z0-9_-]{6,32}$/.test(code)) {
      const textPostInfo =
        record.text_post_app_info && typeof record.text_post_app_info === "object"
          ? (record.text_post_app_info as Record<string, unknown>)
          : null;

      const likeCount = toOptionalCount(record.like_count);
      const replyCount =
        toOptionalCount(textPostInfo?.direct_reply_count) ??
        toOptionalCount(record.direct_reply_count) ??
        toOptionalCount(record.comment_count) ??
        toOptionalCount(record.reply_count);
      const repostCount =
        toOptionalCount(textPostInfo?.repost_count) ??
        toOptionalCount(record.repost_count) ??
        toOptionalCount(textPostInfo?.reshare_count) ??
        toOptionalCount(record.reshare_count);
      const quoteCount =
        toOptionalCount(textPostInfo?.quote_count) ??
        toOptionalCount(record.quote_count);

      if (
        likeCount !== undefined ||
        replyCount !== undefined ||
        repostCount !== undefined ||
        quoteCount !== undefined
      ) {
        mergeEmbeddedMetrics(targetMap, code, {
          like_count: likeCount,
          reply_count: replyCount,
          repost_count: repostCount,
          quote_count: quoteCount,
        });
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        stack.push({ node: value, depth: depth + 1 });
      }
    }
  }
}

/**
 * 解析頁面中所有內嵌 <script type="application/json"> 區塊（SSR Relay Store）
 */
async function extractEmbeddedMetricsFromScripts(
  page: Page,
  targetMap: Map<string, EmbeddedEngagementMetrics>
): Promise<void> {
  try {
    const scriptPayloads = await page.evaluate(() => {
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>(
          'script[type="application/json"]'
        )
      );
      return scripts
        .map((s) => s.textContent ?? "")
        .filter(
          (text) =>
            text.length > 50 &&
            (text.includes("like_count") ||
              text.includes("direct_reply_count") ||
              text.includes("repost_count") ||
              text.includes("quote_count"))
        );
    });

    for (const payload of scriptPayloads) {
      try {
        const parsed: unknown = JSON.parse(payload);
        collectMetricsFromJsonTree(parsed, targetMap);
      } catch {
        // 忽略格式異常的 script 區塊
      }
    }
  } catch {
    // 頁面關閉或導覽中時略過，不影響主流程
  }
}

/**
 * 掛載網路回應監聽，擷取捲動載入時 Threads GraphQL / API 回傳的互動計數 JSON
 */
function attachGraphqlMetricsListener(
  page: Page,
  targetMap: Map<string, EmbeddedEngagementMetrics>
): void {
  page.on("response", async (response: Response) => {
    try {
      if (page.isClosed()) return;
      if (response.status() !== 200) return;

      const url = response.url();
      if (!/graphql|\/api\/v1\/|query/i.test(url)) return;

      const contentType = (response.headers()["content-type"] ?? "").toLowerCase();
      if (!contentType.includes("json") && !contentType.includes("text/plain")) {
        return;
      }

      const rawText = await response.text();
      if (
        !rawText ||
        (!rawText.includes("like_count") &&
          !rawText.includes("direct_reply_count") &&
          !rawText.includes("repost_count") &&
          !rawText.includes("quote_count"))
      ) {
        return;
      }

      // 移除 Meta 常見的 anti-XSSI 前綴並相容 NDJSON 多行回應
      const cleaned = rawText.replace(/^for\s*\(;;\);/, "").trim();
      try {
        collectMetricsFromJsonTree(JSON.parse(cleaned), targetMap);
      } catch {
        for (const line of cleaned.split(/\r?\n/)) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith("{")) continue;
          try {
            collectMetricsFromJsonTree(JSON.parse(trimmedLine), targetMap);
          } catch {
            // 忽略非完整 JSON 行
          }
        }
      }
    } catch {
      // 瀏覽器關閉或回應 body 不可讀取時靜默忽略
    }
  });
}

/**
 * 偵測是否遭遇 Threads 登入牆、反爬蟲挑戰或不存在帳號
 */
async function assertNoBlockingState(page: Page, username: string): Promise<void> {
  const currentUrl = page.url().toLowerCase();
  const bodyText = await page.evaluate(() => document.body?.innerText ?? "");

  if (
    currentUrl.includes("/login") ||
    currentUrl.includes("accounts/login") ||
    /log in to threads|登入 threads|continue with instagram|使用 instagram 帳號繼續/i.test(
      bodyText.slice(0, 800)
    )
  ) {
    const hasPostLinks = await page.evaluate(
      () => document.querySelectorAll('a[href*="/post/"]').length > 0
    );
    if (!hasPostLinks) {
      throw new ThreadsCrawlerError(
        "LOGIN_WALL",
        `爬取 @${username} 時遇到 Threads 登入牆阻擋。`
      );
    }
  }

  if (
    currentUrl.includes("/challenge") ||
    /please wait a few minutes|suspicious activity|verify you are human|請稍候幾分鐘再試/i.test(
      bodyText.slice(0, 1200)
    )
  ) {
    throw new ThreadsCrawlerError(
      "ANTI_BOT_BLOCKED",
      `爬取 @${username} 時觸發 Threads 反爬蟲頻率限制或驗證挑戰。`
    );
  }

  if (
    /sorry, this page isn't available|this profile is private|此頁面無法使用|此帳號為不公開帳號/i.test(
      bodyText.slice(0, 1200)
    )
  ) {
    throw new ThreadsCrawlerError(
      "ACCOUNT_NOT_FOUND",
      `找不到公開 Threads 帳號 @${username}，或該帳號為私人帳號。`
    );
  }
}

/**
 * 從個人頁 Header 與 Meta 標籤擷取公開帳號資訊
 */
async function extractProfileMetadata(
  page: Page,
  username: string,
  profileUrl: string
): Promise<ScrapedAccountProfile> {
  const rawProfile = await page.evaluate(() => {
    const ogTitle =
      document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
    const ogDesc =
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") ?? "";

    const h1Text = document.querySelector("h1")?.textContent?.trim() ?? "";

    const bodyText = document.body?.innerText ?? "";
    const followerMatch = bodyText.match(
      /([\d.,]+\s*[KkMmBb萬億]?)\s*(?:followers|位粉絲|粉絲)/i
    );

    return {
      ogTitle,
      ogDesc,
      h1Text,
      followerText: followerMatch ? followerMatch[1] : null,
    };
  });

  const displayName =
    rawProfile.h1Text ||
    rawProfile.ogTitle.replace(/\s*\(@[^)]+\).*$/, "").trim() ||
    username;

  const bio = rawProfile.ogDesc
    ? rawProfile.ogDesc.replace(/^.*?Threads:\s*/i, "").trim() || null
    : null;

  const followerCount = rawProfile.followerText
    ? parseEngagementNumber(rawProfile.followerText)
    : null;

  return {
    username,
    profile_url: profileUrl,
    display_name: displayName || null,
    bio,
    follower_count: followerCount,
  };
}

/**
 * 多層級互動按鈕選取器（Fallback Selectors）
 * 定位包含正文與互動按鈕列的單篇貼文容器，並依多層級策略提取讚／回覆／轉發／引用數值
 */
async function extractVisiblePostsFromDom(
  page: Page,
  username: string
): Promise<RawDomPost[]> {
  return page.evaluate((targetUsername: string) => {
    const results: RawDomPost[] = [];
    const seen = new Set<string>();

    const COMPACT_NUM_REGEX =
      /^[\d,，.．]+\s*(?:億|亿|萬|万|千|[KkMmBb])?$/;
    const INLINE_NUM_REGEX =
      /(\d+(?:[,，]\d{3})*(?:[.．]\d+)?\s*(?:億|亿|萬|万|千|[KkMmBb](?![A-Za-z]))?)/;
    const UI_NOISE_REGEX =
      /^(翻譯|查看翻譯|顯示原文|瞭解詳情|了解更多|查看更多|顯示較少|See translation|Translate|Learn more|See more|Sorry, we're having trouble playing this video\.?|很抱歉，播放此影片時\s*發生問題。?)$/i;

    const ACTION_PATTERNS = {
      like: /(^|\b)(like|unlike)s?(\b|$)|讚|喜歡/i,
      reply: /(^|\b)(reply|replies|comment|comments)(\b|$)|回覆|留言/i,
      repost: /(^|\b)(repost|reposts)(\b|$)|轉發|轉貼/i,
      quote: /(^|\b)(quote|quotes)(\b|$)|引用/i,
    };

    const getDistinctPostIds = (el: HTMLElement): Set<string> => {
      const ids = new Set<string>();
      const links = el.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]');
      for (const link of links) {
        const m = (link.getAttribute("href") ?? "").match(
          /\/post\/([A-Za-z0-9_-]+)/
        );
        if (m) ids.add(m[1]);
      }
      return ids;
    };

    const countActionIcons = (el: HTMLElement): number => {
      const labels = new Set<string>();
      const candidates = el.querySelectorAll<HTMLElement>(
        'svg[aria-label], [role="button"][aria-label], button[aria-label]'
      );
      for (const node of candidates) {
        const label = node.getAttribute("aria-label") ?? "";
        if (ACTION_PATTERNS.like.test(label)) labels.add("like");
        else if (ACTION_PATTERNS.reply.test(label)) labels.add("reply");
        else if (ACTION_PATTERNS.repost.test(label)) labels.add("repost");
        else if (ACTION_PATTERNS.quote.test(label)) labels.add("quote");
      }
      return labels.size;
    };

    const extractNumericFromElement = (el: HTMLElement | null): string => {
      if (!el) return "";

      const spans = Array.from(el.querySelectorAll<HTMLElement>("span"));
      for (const span of spans) {
        if (span.closest("time")) continue;
        const txt = (span.innerText ?? span.textContent ?? "").trim();
        if (txt && COMPACT_NUM_REGEX.test(txt)) {
          return txt;
        }
      }

      const ownText = (el.innerText ?? el.textContent ?? "").trim();
      if (ownText && COMPACT_NUM_REGEX.test(ownText)) {
        return ownText;
      }
      const inlineMatch = ownText.match(INLINE_NUM_REGEX);
      if (inlineMatch) {
        return inlineMatch[1];
      }

      return "";
    };

    const extractCountNearTrigger = (
      trigger: HTMLElement,
      ariaLabel: string
    ): string => {
      // Level A: 按鈕／觸發元素內部
      const inside = extractNumericFromElement(trigger);
      if (inside) return inside;

      // Level B: 按鈕右側相鄰節點
      let sibling = trigger.nextElementSibling as HTMLElement | null;
      for (let step = 0; step < 2 && sibling; step++) {
        if (
          sibling.matches('button, [role="button"]') ||
          sibling.querySelector("svg[aria-label]")
        ) {
          break;
        }
        const sibCount = extractNumericFromElement(sibling);
        if (sibCount) return sibCount;
        sibling = sibling.nextElementSibling as HTMLElement | null;
      }

      // Level C: 直接父容器內的獨立數字 span
      const parent = trigger.parentElement;
      if (parent && countActionIcons(parent) <= 1) {
        const parentCount = extractNumericFromElement(parent);
        if (parentCount) return parentCount;
      }

      // Level D: 從 aria-label 本身擷取
      const labelMatch = ariaLabel.match(INLINE_NUM_REGEX);
      if (labelMatch) return labelMatch[1];

      return "";
    };

    const postAnchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]')
    );

    for (const anchor of postAnchors) {
      const href = anchor.getAttribute("href") ?? "";
      const match = href.match(/\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/i);
      if (!match) continue;

      const anchorUser = match[1].toLowerCase();
      const postId = match[2];
      if (anchorUser !== targetUsername.toLowerCase()) continue;

      const normalizedUrl = `https://www.threads.net/@${anchorUser}/post/${postId}`;
      if (seen.has(normalizedUrl)) continue;

      // 往上尋找同時包含「正文 + 互動按鈕列」的單篇貼文容器
      let container: HTMLElement | null = anchor.closest("article");
      if (!container || countActionIcons(container) < 2) {
        let bestWithActions: HTMLElement | null = null;
        let fallbackSinglePost: HTMLElement | null = null;
        let cursor: HTMLElement | null = anchor.parentElement;

        for (let depth = 0; depth < 14 && cursor; depth++) {
          const distinctIds = getDistinctPostIds(cursor);
          if (distinctIds.size > 5) break;

          const textLen = (cursor.innerText ?? "").trim().length;
          if (distinctIds.size === 1 && textLen > 10) {
            fallbackSinglePost = cursor;
          }

          if (countActionIcons(cursor) >= 2) {
            bestWithActions = cursor;
            break;
          }

          cursor = cursor.parentElement;
        }

        container = bestWithActions ?? container ?? fallbackSinglePost;
      }

      if (!container) continue;
      seen.add(normalizedUrl);

      const timeEl = container.querySelector<HTMLTimeElement>("time[datetime]");
      const publishedAt = timeEl?.getAttribute("datetime") ?? null;

      // 擷取貼文正文（僅排除時間標籤與介面雜訊文字，避免誤濾包在 role="button" 內的貼文）
      const textBlocks = Array.from(
        container.querySelectorAll<HTMLElement>('span[dir="auto"], div[dir="auto"]')
      )
        .filter((el) => !el.closest("time"))
        .map((el) => el.innerText?.trim() ?? "")
        .filter((txt) => {
          if (!txt) return false;
          if (UI_NOISE_REGEX.test(txt)) return false;
          if (txt.toLowerCase() === targetUsername.toLowerCase()) return false;
          if (COMPACT_NUM_REGEX.test(txt)) return false;
          if (/^\d+\s*(秒|分鐘|小時|天|週|s|m|h|d|w)$/i.test(txt)) return false;
          return true;
        });

      const uniqueBlocks = Array.from(new Set(textBlocks));
      const content = uniqueBlocks.join("\n").trim();

      let likeText = "";
      let replyText = "";
      let repostText = "";
      let quoteText = "";

      // Fallback Selector 層級 1：掃描按鈕與其內嵌 aria-label / svg[aria-label] / svg title
      const buttons = Array.from(
        container.querySelectorAll<HTMLElement>('[role="button"], button')
      );

      for (const btn of buttons) {
        const ariaLabel = (
          btn.getAttribute("aria-label") ??
          btn.querySelector("svg[aria-label]")?.getAttribute("aria-label") ??
          btn.querySelector("svg title")?.textContent ??
          btn.querySelector("[aria-label]")?.getAttribute("aria-label") ??
          ""
        ).trim();

        if (!ariaLabel) continue;

        if (!likeText && ACTION_PATTERNS.like.test(ariaLabel)) {
          likeText = extractCountNearTrigger(btn, ariaLabel);
        } else if (!replyText && ACTION_PATTERNS.reply.test(ariaLabel)) {
          replyText = extractCountNearTrigger(btn, ariaLabel);
        } else if (!repostText && ACTION_PATTERNS.repost.test(ariaLabel)) {
          repostText = extractCountNearTrigger(btn, ariaLabel);
        } else if (!quoteText && ACTION_PATTERNS.quote.test(ariaLabel)) {
          quoteText = extractCountNearTrigger(btn, ariaLabel);
        }
      }

      // Fallback Selector 層級 2：從 svg[aria-label] 反查
      if (!likeText || !replyText || !repostText || !quoteText) {
        const svgs = Array.from(
          container.querySelectorAll<SVGElement>("svg[aria-label]")
        );
        for (const svg of svgs) {
          const ariaLabel = (svg.getAttribute("aria-label") ?? "").trim();
          const trigger =
            (svg.closest('[role="button"], button') as HTMLElement | null) ??
            (svg.parentElement as HTMLElement | null);
          if (!trigger) continue;

          if (!likeText && ACTION_PATTERNS.like.test(ariaLabel)) {
            likeText = extractCountNearTrigger(trigger, ariaLabel);
          } else if (!replyText && ACTION_PATTERNS.reply.test(ariaLabel)) {
            replyText = extractCountNearTrigger(trigger, ariaLabel);
          } else if (!repostText && ACTION_PATTERNS.repost.test(ariaLabel)) {
            repostText = extractCountNearTrigger(trigger, ariaLabel);
          } else if (!quoteText && ACTION_PATTERNS.quote.test(ariaLabel)) {
            quoteText = extractCountNearTrigger(trigger, ariaLabel);
          }
        }
      }

      // Fallback Selector 層級 3：檢查貼文頁尾文字摘要
      const containerText = container.innerText ?? "";
      if (!likeText) {
        const m = containerText.match(
          /([\d,，.．]+\s*(?:億|亿|萬|万|千|[KkMmBb])?)\s*(?:個讚|讚|likes?)/i
        );
        if (m) likeText = m[1];
      }
      if (!replyText) {
        const m = containerText.match(
          /([\d,，.．]+\s*(?:億|亿|萬|万|千|[KkMmBb])?)\s*(?:則回覆|回覆|留言|replies|comments?)/i
        );
        if (m) replyText = m[1];
      }
      if (!repostText) {
        const m = containerText.match(
          /([\d,，.．]+\s*(?:億|亿|萬|万|千|[KkMmBb])?)\s*(?:次轉發|轉發|reposts?)/i
        );
        if (m) repostText = m[1];
      }
      if (!quoteText) {
        const m = containerText.match(
          /([\d,，.．]+\s*(?:億|亿|萬|万|千|[KkMmBb])?)\s*(?:次引用|引用|quotes?)/i
        );
        if (m) quoteText = m[1];
      }

      const contentImages = Array.from(
        container.querySelectorAll<HTMLImageElement>("img")
      ).filter((img) => {
        const width = img.naturalWidth || img.width || 0;
        const alt = (img.getAttribute("alt") ?? "").toLowerCase();
        return (
          width >= 120 &&
          !alt.includes("profile picture") &&
          !alt.includes("大頭貼")
        );
      });

      results.push({
        externalPostId: postId,
        postUrl: normalizedUrl,
        content,
        publishedAt,
        likeText,
        replyText,
        repostText,
        quoteText,
        hasImage: contentImages.length > 0,
        imageCount: contentImages.length,
      });
    }

    return results;
  }, username);
}

/**
 * 結合 DOM 解析結果與頁面內嵌 JSON 互動數據（優先採用 JSON 精確值，若無則回退 DOM 解析值）
 */
function resolveMetric(
  embeddedVal: number | undefined,
  domVal: number
): number {
  if (embeddedVal !== undefined && (embeddedVal > 0 || domVal === 0)) {
    return embeddedVal;
  }
  return domVal;
}

/**
 * 將原始 DOM 資料 + 內嵌 JSON 指標轉換為對齊 SQL public.posts 的 ScrapedPostRecord
 */
function normalizeRawDomPost(
  raw: RawDomPost,
  embedded?: EmbeddedEngagementMetrics
): ScrapedPostRecord {
  const content = raw.content.trim();
  const features = extractTextFeatures(content);

  let publishedIso = new Date().toISOString();
  if (raw.publishedAt) {
    const parsedDate = new Date(raw.publishedAt);
    if (!Number.isNaN(parsedDate.getTime())) {
      publishedIso = parsedDate.toISOString();
    }
  }

  const domLike = parseEngagementNumber(raw.likeText);
  const domReply = parseEngagementNumber(raw.replyText);
  const domRepost = parseEngagementNumber(raw.repostText);
  const domQuote = parseEngagementNumber(raw.quoteText);

  const likeCount = resolveMetric(embedded?.like_count, domLike);
  const replyCount = resolveMetric(embedded?.reply_count, domReply);
  const repostCount = resolveMetric(embedded?.repost_count, domRepost);
  const quoteCount = resolveMetric(embedded?.quote_count, domQuote);

  const mediaType =
    raw.imageCount > 1 ? "carousel" : raw.hasImage ? "image" : "text";

  return {
    external_post_id: raw.externalPostId,
    post_url: raw.postUrl,
    content,
    published_at: publishedIso,
    like_count: likeCount,
    reply_count: replyCount,
    repost_count: repostCount,
    quote_count: quoteCount,
    view_count: null, // Threads 公開頁面不揭露曝光數，對齊資料庫 Nullable 設計
    char_count: features.char_count,
    hashtag_count: features.hashtag_count,
    mention_count: features.mention_count,
    url_count: features.url_count,
    hashtags: features.hashtags,
    mentions: features.mentions,
    engagement_tier: null,
    is_nlp_sample: false,
    nlp_post_insights: null,
    raw_payload: {
      source: "playwright",
      media_type: mediaType,
      has_image: raw.hasImage,
      has_question: features.has_question,
      raw_counts: {
        like: raw.likeText,
        reply: raw.replyText,
        repost: raw.repostText,
        quote: raw.quoteText,
      },
      embedded_counts: embedded ?? null,
    },
  };
}

/**
 * 使用 Playwright 爬取公開 Threads 帳號貼文（預設至少抓取 30 篇）
 */
export async function scrapeThreadsAccount(
  inputQuery: string,
  options: CrawlOptions = {}
): Promise<ScrapeOutput> {
  const { username, profileUrl } = normalizeThreadsTarget(inputQuery);
  const targetPostCount = Math.max(1, options.targetPostCount ?? 30);
  const timeoutMs = resolvePlaywrightTimeoutMs(options.timeoutMs);
  const headless = options.headless ?? true;
  const deadline = Date.now() + timeoutMs;

  let browser: Browser | null = null;

  try {
    const { chromium } = await import("playwright");

    browser = await chromium.launch({
      headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1280, height: 900 },
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });

    // 修正 tsx / esbuild (keepNames) 在 page.evaluate 內注入 __name 導致瀏覽器端 ReferenceError
    await context.addInitScript({
      content:
        "globalThis.__name = globalThis.__name || function (target) { return target; };",
    });

    const page = await context.newPage();
    page.setDefaultTimeout(Math.min(timeoutMs, 15_000));

    // 建立內嵌 JSON 互動數據索引表（key = external_post_id / shortcode）
    const embeddedMetricsMap = new Map<string, EmbeddedEngagementMetrics>();
    attachGraphqlMetricsListener(page, embeddedMetricsMap);

    // 攔截字型與影音串流以降低頻寬與超時風險（保留圖片 DOM 與 JSON/XHR 回應）
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (resourceType === "font" || resourceType === "media") {
        return route.abort();
      }
      return route.continue();
    });

    const navTimeout = Math.max(5_000, deadline - Date.now());
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: navTimeout,
    });

    await randomDelay(1_200, 2_200);
    await assertNoBlockingState(page, username);

    // 嘗試關閉可能遮擋畫面的非強制登入提示彈窗
    await page
      .locator(
        '[role="dialog"] button[aria-label*="Close"], [role="dialog"] button[aria-label*="關閉"]'
      )
      .first()
      .click({ timeout: 1_500 })
      .catch(() => {});

    // 首次解析頁面內嵌 <script type="application/json"> 中的互動計數
    await extractEmbeddedMetricsFromScripts(page, embeddedMetricsMap);

    const account = await extractProfileMetadata(page, username, profileUrl);

    const collectedMap = new Map<string, ScrapedPostRecord>();
    let stagnantRounds = 0;

    for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
      if (Date.now() >= deadline) {
        if (collectedMap.size > 0) {
          break;
        }
        throw new ThreadsCrawlerError(
          "TIMEOUT",
          `爬取 @${username} 超過 PLAYWRIGHT_TIMEOUT_MS（${timeoutMs}ms）限制。`
        );
      }

      const visibleRawPosts = await extractVisiblePostsFromDom(page, username);
      const prevCount = collectedMap.size;

      for (const raw of visibleRawPosts) {
        if (raw.content.length === 0) continue;

        const embedded = raw.externalPostId
          ? embeddedMetricsMap.get(raw.externalPostId)
          : undefined;
        const normalizedPost = normalizeRawDomPost(raw, embedded);
        const existing = collectedMap.get(raw.postUrl);

        if (!existing) {
          collectedMap.set(raw.postUrl, normalizedPost);
        } else {
          existing.like_count = Math.max(existing.like_count, normalizedPost.like_count);
          existing.reply_count = Math.max(existing.reply_count, normalizedPost.reply_count);
          existing.repost_count = Math.max(
            existing.repost_count,
            normalizedPost.repost_count
          );
          existing.quote_count = Math.max(existing.quote_count, normalizedPost.quote_count);
        }
      }

      if (collectedMap.size >= targetPostCount) {
        break;
      }

      // 檢查滾動前位置與總高度
      const scrollStateBefore = await page.evaluate(() => ({
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        scrollHeight: document.body.scrollHeight,
      }));

      // 每次滾動約 1.8 個視窗高度（加隨機偏移），快速跨過大型圖片／新聞預覽卡片
      const scrollStep =
        Math.round(scrollStateBefore.innerHeight * 1.8) +
        Math.floor(Math.random() * 500);
      await page.evaluate((y) => window.scrollBy(0, y), scrollStep);

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 800) break;

      await randomDelay(
        Math.min(1_200, remainingMs),
        Math.min(2_300, remainingMs)
      );

      const scrollStateAfter = await page.evaluate(() => ({
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        scrollHeight: document.body.scrollHeight,
      }));

      const reachedBottom =
        scrollStateAfter.scrollY + scrollStateAfter.innerHeight >=
        scrollStateAfter.scrollHeight - 250;
      const heightGrew =
        scrollStateAfter.scrollHeight > scrollStateBefore.scrollHeight + 50;

      // 僅在「已滑到底部、頁面未再長高、且未抓到新貼文」時才計入停滯
      if (collectedMap.size === prevCount && reachedBottom && !heightGrew) {
        stagnantRounds += 1;
        if (stagnantRounds >= MAX_STAGNANT_ROUNDS) {
          break;
        }
      } else if (collectedMap.size > prevCount || heightGrew) {
        stagnantRounds = 0;
      }

      await assertNoBlockingState(page, username);
    }

    // 結束前再補掃一次內嵌 JSON，並回填所有已收集貼文的精確互動數據
    await extractEmbeddedMetricsFromScripts(page, embeddedMetricsMap);
    for (const post of collectedMap.values()) {
      if (!post.external_post_id) continue;
      const embedded = embeddedMetricsMap.get(post.external_post_id);
      if (!embedded) continue;

      post.like_count = resolveMetric(embedded.like_count, post.like_count);
      post.reply_count = resolveMetric(embedded.reply_count, post.reply_count);
      post.repost_count = resolveMetric(embedded.repost_count, post.repost_count);
      post.quote_count = resolveMetric(embedded.quote_count, post.quote_count);
      if (post.raw_payload) {
        post.raw_payload = {
          ...post.raw_payload,
          embedded_counts: embedded,
        };
      }
    }

    const dedupedPosts = deduplicatePosts(Array.from(collectedMap.values())).slice(
      0,
      targetPostCount
    );

    if (dedupedPosts.length === 0) {
      throw new ThreadsCrawlerError(
        "EMPTY_RESULT",
        `成功開啟 @${username} 頁面，但未能擷取到任何公開貼文（可能受到動態版型或登入限制影響）。`
      );
    }

    return {
      account,
      posts: dedupedPosts,
    };
  } catch (error) {
    if (error instanceof ThreadsCrawlerError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    if (/timeout/i.test(message)) {
      throw new ThreadsCrawlerError(
        "TIMEOUT",
        `Playwright 操作超時（上限 ${timeoutMs}ms）：${message}`,
        { cause: error }
      );
    }

    if (/executable doesn't exist|browserType\.launch/i.test(message)) {
      throw new ThreadsCrawlerError(
        "BROWSER_LAUNCH_FAILED",
        `Playwright Chromium 無法啟動，請確認已執行 playwright install chromium：${message}`,
        { cause: error }
      );
    }

    throw new ThreadsCrawlerError(
      "UNKNOWN",
      `爬取 @${username} 時發生未預期錯誤：${message}`,
      { cause: error }
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}