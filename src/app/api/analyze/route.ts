import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@/utils/supabase/server';
import { crawlThreadsPosts } from '@/lib/crawler';
import {
  cleanAndExtractPosts,
  type RawThreadsAccount,
  type RawThreadsPost,
} from '@/lib/analyzer/dataCleaner';
import {
  analyzePostsWithNLP,
  type NlpAnalysisResult,
} from '@/lib/analyzer/nlpAnalyzer';

//export const runtime = 'nodejs';
//export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AnalyzeRequestBody {
  input_query?: string;
  username?: string;
  target_post_count?: number;
  force_refresh?: boolean;
}

interface NormalizedCrawlerResult {
  account: RawThreadsAccount;
  posts: RawThreadsPost[];
  dataSource: 'playwright' | 'mock_fallback';
  isFallbackUsed: boolean;
  fallbackReason: string | null;
}

function getCacheTtlHours(): number {
  const parsed = Number(process.env.SCRAPER_CACHE_TTL_HOURS ?? '24');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

/**
 * 解析使用者輸入（支援 "@taipei_pm_notes"、"taipei_pm_notes" 或完整 Threads URL）
 */
function parseThreadsUsername(rawInput: string): {
  username: string;
  profileUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/threads\.(?:net|com)\/@?([A-Za-z0-9._]+)/i);
  const candidate = urlMatch ? urlMatch[1] : trimmed.replace(/^@+/, '');
  const username = candidate.replace(/\/.*$/, '').trim().toLowerCase();

  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return null;
  }

  return {
    username,
    profileUrl: `https://www.threads.net/@${username}`,
  };
}

/**
 * 通用非同步重試包裝器（適用爬蟲或外部網路短暫異常）
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1000,
  label = 'Operation'
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      console.warn(
        `[${label}] 第 ${attempt}/${retries} 次執行失敗，${delayMs}ms 後重試：`,
        error instanceof Error ? error.message : error
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Phase 3 爬蟲模組轉接器（對接 crawlThreadsPosts）
 */
async function invokePhase3Crawler(
    username: string,
    targetPostCount: number
  ): Promise<NormalizedCrawlerResult> {
    const result = await crawlThreadsPosts(username, { targetPostCount });
  
    const dataSource: 'playwright' | 'mock_fallback' =
      result.is_fallback_used || result.data_source === 'mock_fallback'
        ? 'mock_fallback'
        : 'playwright';
  
    return {
      account: result.account as unknown as RawThreadsAccount,
      posts: result.posts as unknown as RawThreadsPost[],
      dataSource,
      isFallbackUsed: result.is_fallback_used,
      fallbackReason: result.fallback_reason ?? null,
    };
  }
  

/**
 * 同步輸出分析報告至專案 reports/ 資料夾（Markdown + JSON）
 * 若部署於唯讀檔案系統（如 Vercel Serverless），僅記錄警告不中斷主流程
 */
async function exportReportFiles(params: {
  username: string;
  taskId: string;
  dataSource: string;
  isFallbackUsed: boolean;
  cleaned: ReturnType<typeof cleanAndExtractPosts>;
  analysis: NlpAnalysisResult;
}): Promise<{ markdownPath: string; jsonPath: string } | null> {
  try {
    const reportsDir = path.join(process.cwd(), 'reports');
    await mkdir(reportsDir, { recursive: true });

    const now = new Date();
    const stamp = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    const safeUser = params.username.replace(/[^a-z0-9._-]/gi, '_');
    const baseName = `${safeUser}_${stamp}`;

    const mdFile = path.join(reportsDir, `${baseName}.md`);
    const jsonFile = path.join(reportsDir, `${baseName}.json`);

    const { cleaned, analysis } = params;
    const { high, medium, low } = analysis.tier_summary;

    const mdLines: string[] = [
      `# Threads 帳號分析報告：@${cleaned.account.username}`,
      '',
      `- **Task ID**: \`${params.taskId}\``,
      `- **產生時間 (UTC)**: ${now.toISOString()}`,
      `- **資料來源**: \`${params.dataSource}\`${params.isFallbackUsed ? '（已啟用 Mock Fallback）' : ''}`,
      `- **分析模型**: \`${analysis.llm_model}\` (\`${analysis.prompt_version}\`)`,
      `- **有效貼文數**: ${cleaned.metrics.total_posts} 篇（去重移除 ${cleaned.metrics.duplicate_removed_count} 篇）`,
      `- **總互動數 / 平均互動 / 中位數**: ${cleaned.metrics.total_engagement} / ${cleaned.metrics.avg_engagement} / ${cleaned.metrics.median_engagement}`,
      '',
      '## 總覽摘要',
      '',
      analysis.executive_summary,
      '',
      '## 三群組互動表現統計',
      '',
      '| 群組 | 篇數 | 佔比 | 平均互動 | 中位數互動 | 平均字數 | 含問句比例 | 含多媒體比例 |',
      '| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      `| ${high.label} | ${high.count} | ${high.percentage}% | ${high.avg_engagement} | ${high.median_engagement} | ${high.avg_char_count} | ${high.question_rate}% | ${high.media_rate}% |`,
      `| ${medium.label} | ${medium.count} | ${medium.percentage}% | ${medium.avg_engagement} | ${medium.median_engagement} | ${medium.avg_char_count} | ${medium.question_rate}% | ${medium.media_rate}% |`,
      `| ${low.label} | ${low.count} | ${low.percentage}% | ${low.avg_engagement} | ${low.median_engagement} | ${low.avg_char_count} | ${low.question_rate}% | ${low.media_rate}% |`,
      '',
      `- **高表現門檻 (\`high_tier_threshold\`)**: ${analysis.high_tier_threshold ?? 'N/A'}`,
      `- **低表現門檻 (\`low_tier_threshold\`)**: ${analysis.low_tier_threshold ?? 'N/A'}`,
      '',
      '## 高表現成功因素與高互動鉤子 (Hook)',
      '',
      ...analysis.success_factors.flatMap((f, idx) => [
        `### ${idx + 1}. ${f.title}（影響力：${f.impact_level}）`,
        `- **核心分析**：${f.description}`,
        ...(f.hook_pattern ? [`- **Hook 句型結構**：${f.hook_pattern}`] : []),
        `- **佐證貼文 ID**：${f.evidence_post_ids.join(', ') || '無'}`,
        '',
      ]),
      '## 低表現成因診斷',
      '',
      ...analysis.failure_factors.flatMap((f, idx) => [
        `### ${idx + 1}. ${f.title}（影響力：${f.impact_level}）`,
        `- **成因分析**：${f.description}`,
        `- **佐證貼文 ID**：${f.evidence_post_ids.join(', ') || '無'}`,
        '',
      ]),
      '## 跨群組內容與時段觀察（Asia/Taipei）',
      '',
      ...analysis.content_observations.map(
        (obs) => `- **${obs.dimension}**：${obs.finding}（數據佐證：${obs.metric_evidence}）`
      ),
      '',
      '## AI 內容優化策略建議',
      '',
      ...analysis.ai_recommendations.flatMap((rec, idx) => [
        `### [${rec.priority}] ${idx + 1}. ${rec.title}`,
        ...rec.action_steps.map((step) => `- ${step}`),
        `> **示範 Hook**：${rec.example_hook}`,
        `- **預期效益**：${rec.expected_impact}`,
        '',
      ]),
    ];

    await Promise.all([
      writeFile(mdFile, mdLines.join('\n'), 'utf-8'),
      writeFile(
        jsonFile,
        JSON.stringify(
          {
            task_id: params.taskId,
            generated_at: now.toISOString(),
            data_source: params.dataSource,
            account: cleaned.account,
            metrics: cleaned.metrics,
            chart_snapshots: cleaned.chart_snapshots,
            high_tier_threshold: analysis.high_tier_threshold,
            low_tier_threshold: analysis.low_tier_threshold,
            tier_summary: analysis.tier_summary,
            executive_summary: analysis.executive_summary,
            success_factors: analysis.success_factors,
            failure_factors: analysis.failure_factors,
            content_observations: analysis.content_observations,
            ai_recommendations: analysis.ai_recommendations,
          },
          null,
          2
        ),
        'utf-8'
      ),
    ]);

    return {
      markdownPath: path.relative(process.cwd(), mdFile).replace(/\\/g, '/'),
      jsonPath: path.relative(process.cwd(), jsonFile).replace(/\\/g, '/'),
    };
  } catch (error) {
    console.warn(
      '[reports] 無法寫入本地 reports/ 資料夾（若為 Serverless 環境屬正常現象）：',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // 1. 驗證 Supabase 使用者登入狀態
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: '未授權存取，請先登入系統。' },
      { status: 401 }
    );
  }

  // 2. 解析與驗證請求參數
  let body: AnalyzeRequestBody;
  try {
    body = (await request.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json(
      { error: '請求格式錯誤，請提供合法的 JSON Body。' },
      { status: 400 }
    );
  }

  const rawQuery = (body.input_query ?? body.username ?? '').trim();
  const parsedAccount = parseThreadsUsername(rawQuery);
  if (!parsedAccount) {
    return NextResponse.json(
      { error: '請輸入有效的 Threads 帳號名稱（例如 @taipei_pm_notes）或個人頁網址。' },
      { status: 400 }
    );
  }

  const targetPostCount = Math.min(
    50,
    Math.max(5, Number(body.target_post_count) || 30)
  );
  const forceRefresh = Boolean(body.force_refresh);
  const cacheTtlHours = getCacheTtlHours();
  const { username, profileUrl } = parsedAccount;

  let activeTaskId: string | null = null;

  try {
    // 3. 查詢或建立 threads_accounts 紀錄
    const { data: existingAccount, error: accountLookupError } = await supabase
      .from('threads_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('username', username)
      .maybeSingle();

    if (accountLookupError) {
      throw new Error(`查詢帳號紀錄失敗：${accountLookupError.message}`);
    }

    let accountRecord = existingAccount;

    // 4. 快取檢查（SCRAPER_CACHE_TTL_HOURS 內是否已有完成之報告）
    if (!forceRefresh && accountRecord) {
      const ttlCutoffIso = new Date(
        Date.now() - cacheTtlHours * 60 * 60 * 1000
      ).toISOString();

      const { data: cachedTask } = await supabase
        .from('analysis_tasks')
        .select('*')
        .eq('user_id', user.id)
        .eq('account_id', accountRecord.id)
        .eq('status', 'completed')
        .eq('cache_hit', false)
        .gte('completed_at', ttlCutoffIso)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cachedTask) {
        const [{ data: cachedReport }, { data: cachedPosts }] = await Promise.all([
          supabase
            .from('aggregated_reports')
            .select('*')
            .eq('task_id', cachedTask.id)
            .maybeSingle(),
          supabase
            .from('posts')
            .select('*')
            .eq('task_id', cachedTask.id)
            .order('total_engagement', { ascending: false }),
        ]);

        if (cachedReport) {
          // 寫入一筆快取命中稽核紀錄至 analysis_tasks
          const nowIso = new Date().toISOString();
          const { data: cacheAuditTask } = await supabase
            .from('analysis_tasks')
            .insert({
              user_id: user.id,
              account_id: accountRecord.id,
              input_query: rawQuery,
              status: 'completed',
              data_source: 'cache',
              is_fallback_used: cachedTask.is_fallback_used,
              fallback_reason: cachedTask.fallback_reason,
              cache_hit: true,
              cached_from_task_id: cachedTask.id,
              target_post_count: targetPostCount,
              fetched_post_count: cachedTask.fetched_post_count,
              started_at: nowIso,
              completed_at: nowIso,
            })
            .select('*')
            .single();

          return NextResponse.json({
            cache_hit: true,
            cache_ttl_hours: cacheTtlHours,
            task: cacheAuditTask ?? cachedTask,
            source_task_id: cachedTask.id,
            account: accountRecord,
            report: cachedReport,
            posts: cachedPosts ?? [],
            report_files: null,
          });
        }
      }
    }

    if (!accountRecord) {
      const { data: createdAccount, error: createAccountError } = await supabase
        .from('threads_accounts')
        .insert({
          user_id: user.id,
          username,
          profile_url: profileUrl,
        })
        .select('*')
        .single();

      if (createAccountError || !createdAccount) {
        throw new Error(`建立帳號紀錄失敗：${createAccountError?.message}`);
      }
      accountRecord = createdAccount;
    }

    // 5. 建立分析任務紀錄（狀態：scraping）
    const startedAtIso = new Date().toISOString();
    const { data: newTask, error: createTaskError } = await supabase
      .from('analysis_tasks')
      .insert({
        user_id: user.id,
        account_id: accountRecord.id,
        input_query: rawQuery,
        status: 'scraping',
        data_source: 'playwright',
        is_fallback_used: false,
        cache_hit: false,
        target_post_count: targetPostCount,
        fetched_post_count: 0,
        started_at: startedAtIso,
      })
      .select('*')
      .single();

      if (createTaskError || !newTask) {
        throw new Error(`建立分析任務失敗：${createTaskError?.message}`);
      }
      const taskId = String(newTask.id);
      activeTaskId = taskId;

    // 6. 呼叫 Phase 3 爬蟲模組（含 Retry）
    const crawlResult = await withRetry(
      () => invokePhase3Crawler(username, targetPostCount),
      2,
      1500,
      'Phase 3 Threads Crawler'
    );

    if (!crawlResult.posts || crawlResult.posts.length === 0) {
      throw new Error(`帳號 @${username} 未擷取到任何可分析貼文。`);
    }

    // 7. 資料清理與特徵提取（Phase 4）
    const cleaned = cleanAndExtractPosts(crawlResult.account, crawlResult.posts);

    // 更新帳號中繼資料與快取過期時間，並推進任務狀態至 analyzing
    const scrapedAt = new Date();
    const cacheExpiresAt = new Date(
      scrapedAt.getTime() + cacheTtlHours * 60 * 60 * 1000
    );

    const [{ data: updatedAccount }, { error: updateTaskAnalyzingError }] =
      await Promise.all([
        supabase
          .from('threads_accounts')
          .update({
            profile_url: cleaned.account.profile_url,
            display_name: cleaned.account.display_name,
            bio: cleaned.account.bio,
            follower_count: cleaned.account.follower_count,
            last_scraped_at: scrapedAt.toISOString(),
            cache_expires_at: cacheExpiresAt.toISOString(),
          })
          .eq('id', accountRecord.id)
          .select('*')
          .single(),
        supabase
          .from('analysis_tasks')
          .update({
            status: 'analyzing',
            data_source: crawlResult.dataSource,
            is_fallback_used: crawlResult.isFallbackUsed,
            fallback_reason: crawlResult.fallbackReason,
            fetched_post_count: cleaned.posts.length,
          })
          .eq('id', activeTaskId),
      ]);

    if (updateTaskAnalyzingError) {
      throw new Error(`更新任務狀態失敗：${updateTaskAnalyzingError.message}`);
    }

    // 8. 三群組分群與 Gemini 2.5 Flash NLP 策略分析（Phase 5）
    const nlpResult = await analyzePostsWithNLP(cleaned, { samplePerTier: 4 });

    // 9. 寫入 posts 資料表（注意：不可傳入 GENERATED ALWAYS 欄位 total_engagement）
    const postRows = nlpResult.posts.map((post) => ({
      task_id: activeTaskId,
      account_id: accountRecord.id,
      user_id: user.id,
      external_post_id: post.external_post_id,
      post_url: post.post_url,
      content: post.content,
      published_at: post.published_at,
      like_count: post.like_count,
      reply_count: post.reply_count,
      repost_count: post.repost_count,
      quote_count: post.quote_count,
      view_count: post.view_count,
      char_count: post.char_count,
      hashtag_count: post.hashtag_count,
      mention_count: post.mention_count,
      url_count: post.url_count,
      hashtags: post.hashtags,
      mentions: post.mentions,
      engagement_tier: post.engagement_tier,
      is_nlp_sample: post.is_nlp_sample,
      nlp_post_insights: post.nlp_post_insights,
      raw_payload: post.raw_payload,
    }));

    const { data: insertedPosts, error: insertPostsError } = await supabase
      .from('posts')
      .insert(postRows)
      .select('*');

    if (insertPostsError) {
      throw new Error(`寫入 posts 資料表失敗：${insertPostsError.message}`);
    }

    // 10. 寫入 aggregated_reports 資料表
    const { data: insertedReport, error: insertReportError } = await supabase
      .from('aggregated_reports')
      .insert({
        task_id: activeTaskId,
        account_id: accountRecord.id,
        user_id: user.id,
        total_posts: cleaned.metrics.total_posts,
        total_likes: cleaned.metrics.total_likes,
        total_replies: cleaned.metrics.total_replies,
        total_reposts: cleaned.metrics.total_reposts,
        total_quotes: cleaned.metrics.total_quotes,
        total_engagement: cleaned.metrics.total_engagement,
        avg_engagement: cleaned.metrics.avg_engagement,
        median_engagement: cleaned.metrics.median_engagement,
        avg_char_count: cleaned.metrics.avg_char_count,
        high_tier_threshold: nlpResult.high_tier_threshold,
        low_tier_threshold: nlpResult.low_tier_threshold,
        tier_summary: {
          ...nlpResult.tier_summary,
          executive_summary: nlpResult.executive_summary,
        },
        success_factors: nlpResult.success_factors,
        failure_factors: nlpResult.failure_factors,
        content_observations: nlpResult.content_observations,
        ai_recommendations: nlpResult.ai_recommendations,
        chart_snapshots: cleaned.chart_snapshots,
        llm_model: nlpResult.llm_model,
        prompt_version: nlpResult.prompt_version,
      })
      .select('*')
      .single();

    if (insertReportError || !insertedReport) {
      throw new Error(`寫入 aggregated_reports 失敗：${insertReportError?.message}`);
    }

    // 11. 標記任務完成
    const completedAtIso = new Date().toISOString();
    const { data: completedTask, error: completeTaskError } = await supabase
      .from('analysis_tasks')
      .update({
        status: 'completed',
        completed_at: completedAtIso,
      })
      .eq('id', activeTaskId)
      .select('*')
      .single();

    if (completeTaskError) {
      throw new Error(`更新任務完成狀態失敗：${completeTaskError.message}`);
    }

    // 12. 同步輸出報告至 reports/ 資料夾
    const reportFiles = await exportReportFiles({
        username,
        taskId,
        dataSource: crawlResult.dataSource,
        isFallbackUsed: crawlResult.isFallbackUsed,
        cleaned,
        analysis: nlpResult,
      });

    return NextResponse.json(
      {
        cache_hit: false,
        cache_ttl_hours: cacheTtlHours,
        task: completedTask,
        account: updatedAccount ?? accountRecord,
        report: insertedReport,
        posts: insertedPosts ?? [],
        report_files: reportFiles,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : '分析流程發生未知錯誤';

    if (activeTaskId) {
      await supabase
        .from('analysis_tasks')
        .update({
          status: 'failed',
          error_message: errorMessage.slice(0, 1000),
          completed_at: new Date().toISOString(),
        })
        .eq('id', activeTaskId);
    }

    console.error('[/api/analyze] 分析失敗：', error);

    const status =
      errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')
        ? 429
        : 500;

    return NextResponse.json(
      {
        error: '分析任務執行失敗',
        detail: errorMessage,
        task_id: activeTaskId,
      },
      { status }
    );
  }
}