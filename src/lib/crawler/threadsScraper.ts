import type { Browser, Page } from "playwright";
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
  parseCompactCount,
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

export interface ScrapeOutput {
  account: ScrapedAccountProfile;
  posts: ScrapedPostRecord[];
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_SCROLL_ROUNDS = 28;
const MAX_STAGNANT_ROUNDS = 4;

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
    // 若頁面上完全沒有任何貼文連結且顯示登入牆，判定為被登入牆阻擋
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

    // 嘗試從 header 區塊找追蹤人數文字（支援英文 followers 與繁中 粉絲）
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
    ? parseCompactCount(rawProfile.followerText)
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
 * 從目前 DOM 掃描可見貼文節點
 */
async function extractVisiblePostsFromDom(
  page: Page,
  username: string
): Promise<RawDomPost[]> {
  return page.evaluate((targetUsername: string) => {
    const results: RawDomPost[] = [];
    const seen = new Set<string>();

    // 以指向目標帳號 /post/<id> 的 <a> 作為每則貼文錨點，對 DOM 改版具較高容錯性
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

      // 往上尋找單篇貼文容器
      let container: HTMLElement | null = anchor.closest("article");
      if (!container) {
        let cursor: HTMLElement | null = anchor.parentElement;
        for (let depth = 0; depth < 8 && cursor; depth++) {
          const textLen = (cursor.innerText ?? "").trim().length;
          const postLinksInside = cursor.querySelectorAll('a[href*="/post/"]').length;
          if (textLen > 20 && postLinksInside <= 3) {
            container = cursor;
            break;
          }
          cursor = cursor.parentElement;
        }
      }
      if (!container) continue;

      seen.add(normalizedUrl);

      const timeEl = container.querySelector<HTMLTimeElement>("time[datetime]");
      const publishedAt = timeEl?.getAttribute("datetime") ?? null;

      // 擷取貼文正文：收集 span[dir="auto"] 並排除帳號名稱、純時間與純數字按鈕文字
      const textBlocks = Array.from(
        container.querySelectorAll<HTMLElement>('span[dir="auto"], div[dir="auto"]')
      )
        .map((el) => el.innerText?.trim() ?? "")
        .filter((txt) => {
          if (!txt) return false;
          if (txt.toLowerCase() === targetUsername.toLowerCase()) return false;
          if (/^[\d.,]+[KkMm萬]?$/.test(txt)) return false;
          if (/^\d+\s*(秒|分鐘|小時|天|週|s|m|h|d|w)$/i.test(txt)) return false;
          return true;
        });

      // 去重相鄰重複段落並取最主要文本
      const uniqueBlocks = Array.from(new Set(textBlocks));
      const content = uniqueBlocks.join("\n").trim();

      // 擷取互動按鈕數值（依 Threads 按鈕順序或 aria-label：讚、留言、轉發、引用/分享）
      const buttons = Array.from(
        container.querySelectorAll<HTMLElement>('[role="button"], button')
      );

      let likeText = "";
      let replyText = "";
      let repostText = "";
      let quoteText = "";

      for (const btn of buttons) {
        const label = (
          btn.getAttribute("aria-label") ??
          btn.querySelector("svg[aria-label]")?.getAttribute("aria-label") ??
          ""
        ).toLowerCase();
        const valueText = (btn.innerText ?? "").trim();

        if (!likeText && /(like|讚|喜歡)/i.test(label)) {
          likeText = valueText || label;
        } else if (!replyText && /(reply|comment|回覆|留言)/i.test(label)) {
          replyText = valueText || label;
        } else if (!repostText && /(repost|轉發)/i.test(label)) {
          repostText = valueText || label;
        } else if (!quoteText && /(quote|引用)/i.test(label)) {
          quoteText = valueText || label;
        }
      }

      // 判斷圖片（排除頭像小圖）
      const contentImages = Array.from(container.querySelectorAll<HTMLImageElement>("img")).filter(
        (img) => {
          const width = img.naturalWidth || img.width || 0;
          const alt = (img.getAttribute("alt") ?? "").toLowerCase();
          return width >= 120 && !alt.includes("profile picture") && !alt.includes("大頭貼");
        }
      );

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
 * 將原始 DOM 資料轉換為對齊 SQL public.posts 的 ScrapedPostRecord
 */
function normalizeRawDomPost(raw: RawDomPost): ScrapedPostRecord {
  const content = raw.content.trim();
  const features = extractTextFeatures(content);

  let publishedIso = new Date().toISOString();
  if (raw.publishedAt) {
    const parsedDate = new Date(raw.publishedAt);
    if (!Number.isNaN(parsedDate.getTime())) {
      publishedIso = parsedDate.toISOString();
    }
  }

  const mediaType =
    raw.imageCount > 1 ? "carousel" : raw.hasImage ? "image" : "text";

  return {
    external_post_id: raw.externalPostId,
    post_url: raw.postUrl,
    content,
    published_at: publishedIso,
    like_count: parseCompactCount(raw.likeText),
    reply_count: parseCompactCount(raw.replyText),
    repost_count: parseCompactCount(raw.repostText),
    quote_count: parseCompactCount(raw.quoteText),
    view_count: null, // Threads 公開頁面通常不揭露曝光數，對齊資料庫 Nullable 設計
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
    // 動態載入 playwright，確保純 Mock 環境或未安裝瀏覽器時不會在模組初始化階段崩潰
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

    const page = await context.newPage();
    page.setDefaultTimeout(Math.min(timeoutMs, 15_000));

    // 攔截字型與影音串流以降低頻寬與超時風險（保留圖片 DOM 標籤供判斷 has_image）
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

    // 隨機初始停頓，模擬真人閱讀與等待 CSR hydration
    await randomDelay(1_200, 2_200);
    await assertNoBlockingState(page, username);

    // 嘗試關閉可能遮擋畫面的非強制登入提示彈窗
    await page
      .locator('[role="dialog"] button[aria-label*="Close"], [role="dialog"] button[aria-label*="關閉"]')
      .first()
      .click({ timeout: 1_500 })
      .catch(() => {});

    const account = await extractProfileMetadata(page, username, profileUrl);

    const collectedMap = new Map<string, ScrapedPostRecord>();
    let stagnantRounds = 0;

    for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
      if (Date.now() >= deadline) {
        if (collectedMap.size > 0) {
          break; // 已抓到部分貼文時優雅結束，避免浪費既有成果
        }
        throw new ThreadsCrawlerError(
          "TIMEOUT",
          `爬取 @${username} 超過 PLAYWRIGHT_TIMEOUT_MS（${timeoutMs}ms）限制。`
        );
      }

      const visibleRawPosts = await extractVisiblePostsFromDom(page, username);
      const prevCount = collectedMap.size;

      for (const raw of visibleRawPosts) {
        if (!collectedMap.has(raw.postUrl) && raw.content.length > 0) {
          collectedMap.set(raw.postUrl, normalizeRawDomPost(raw));
        }
      }

      if (collectedMap.size >= targetPostCount) {
        break;
      }

      if (collectedMap.size === prevCount) {
        stagnantRounds += 1;
        if (stagnantRounds >= MAX_STAGNANT_ROUNDS) {
          break;
        }
      } else {
        stagnantRounds = 0;
      }

      // 隨機幅度向下滾動與隨機延遲，降低反爬蟲風控風險
      const scrollStep = 1_100 + Math.floor(Math.random() * 650);
      await page.evaluate((y) => window.scrollBy(0, y), scrollStep);

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 800) break;

      await randomDelay(
        Math.min(900, remainingMs),
        Math.min(2_100, remainingMs)
      );

      // 滾動過程再次確認是否跳出強制登入牆
      await assertNoBlockingState(page, username);
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