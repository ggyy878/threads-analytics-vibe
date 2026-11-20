-- ============================================================================
-- Migration: 20261120000000_init_schema.sql
-- Description: 初始化 Threads 貼文爬取與數據分析工具核心資料表、索引、觸發器與 RLS
-- ============================================================================

-- 啟用 UUID 產生器（Supabase 預設已啟用 pgcrypto，此處確保冪等性）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. 自訂 ENUM 型別
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE public.task_status AS ENUM (
      'pending',
      'scraping',
      'analyzing',
      'completed',
      'failed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_source_type') THEN
    CREATE TYPE public.data_source_type AS ENUM (
      'playwright',
      'mock_fallback',
      'cache'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'engagement_tier_type') THEN
    CREATE TYPE public.engagement_tier_type AS ENUM (
      'high',
      'medium',
      'low'
    );
  END IF;
END
$$;

-- ============================================================================
-- 2. 共用 Trigger 函式（自動更新 updated_at 與同步 auth.users）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. 資料表定義
-- ============================================================================

-- 3.1 使用者基本資料表（對接 Supabase Auth）
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  is_test_account BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 當 auth.users 新增帳號時自動寫入 public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3.2 追蹤的 Threads 帳號與快取狀態表（支援多帳號比較與避免重複爬取）
CREATE TABLE public.threads_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,                  -- 正規化後的帳號（小寫、不含 @）
  profile_url TEXT NOT NULL,               -- 完整 Threads 個人頁 URL
  display_name TEXT,
  bio TEXT,
  follower_count INTEGER CHECK (follower_count IS NULL OR follower_count >= 0),
  last_scraped_at TIMESTAMPTZ,             -- 最近一次成功爬取時間
  cache_expires_at TIMESTAMPTZ,            -- 快取有效期限，未過期時優先複用
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_threads_accounts_user_username UNIQUE (user_id, username)
);

CREATE TRIGGER trg_threads_accounts_updated_at
  BEFORE UPDATE ON public.threads_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3.3 分析任務與快取執行紀錄表
CREATE TABLE public.analysis_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.threads_accounts(id) ON DELETE CASCADE,
  input_query TEXT NOT NULL,               -- 使用者原始輸入（URL 或 Username）
  status public.task_status NOT NULL DEFAULT 'pending',
  data_source public.data_source_type NOT NULL DEFAULT 'playwright',
  is_fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,                    -- 觸發 Mock Fallback 時記錄異常原因供 UI 提示
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  cached_from_task_id UUID REFERENCES public.analysis_tasks(id) ON DELETE SET NULL,
  target_post_count INTEGER NOT NULL DEFAULT 30 CHECK (target_post_count >= 1),
  fetched_post_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_post_count >= 0),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_analysis_tasks_updated_at
  BEFORE UPDATE ON public.analysis_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3.4 貼文原始數據、清理特徵與 NLP 分群表
CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.analysis_tasks(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.threads_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- 原始貼文識別與內容
  external_post_id TEXT,                   -- Threads 貼文代碼（若有擷取到）
  post_url TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ NOT NULL,       -- 統一轉換為 UTC 時區儲存

  -- 互動數據（曝光數依需求設為 Nullable）
  like_count INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  reply_count INTEGER NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  repost_count INTEGER NOT NULL DEFAULT 0 CHECK (repost_count >= 0),
  quote_count INTEGER NOT NULL DEFAULT 0 CHECK (quote_count >= 0),
  view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0),

  -- 核心排序指標：總互動數（Generated Column 自動維護）
  total_engagement INTEGER GENERATED ALWAYS AS (
    like_count + reply_count + repost_count + quote_count
  ) STORED,

  -- 資料清理後之文字特徵
  char_count INTEGER NOT NULL DEFAULT 0 CHECK (char_count >= 0),
  hashtag_count INTEGER NOT NULL DEFAULT 0 CHECK (hashtag_count >= 0),
  mention_count INTEGER NOT NULL DEFAULT 0 CHECK (mention_count >= 0),
  url_count INTEGER NOT NULL DEFAULT 0 CHECK (url_count >= 0),
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  mentions TEXT[] NOT NULL DEFAULT '{}',

  -- NLP 三群組分群與抽樣標記
  engagement_tier public.engagement_tier_type,
  is_nlp_sample BOOLEAN NOT NULL DEFAULT FALSE,  -- 標記是否為該群組送入 LLM 分析的 3-5 篇樣本
  nlp_post_insights JSONB,                       -- 單篇結構化特徵標籤（如主題、語氣、Hook 類型）

  raw_payload JSONB,                             -- 保留原始爬取快照供除錯或重算
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 單一任務內去除重複貼文
  CONSTRAINT uq_posts_task_url UNIQUE (task_id, post_url)
);

-- 3.5 彙總報表與 LLM 策略建議表（1:1 對應 analysis_tasks）
CREATE TABLE public.aggregated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL UNIQUE REFERENCES public.analysis_tasks(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.threads_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- 總覽指標（供 Dashboard KPI 卡片與多帳號並排比較使用）
  total_posts INTEGER NOT NULL DEFAULT 0 CHECK (total_posts >= 0),
  total_likes INTEGER NOT NULL DEFAULT 0 CHECK (total_likes >= 0),
  total_replies INTEGER NOT NULL DEFAULT 0 CHECK (total_replies >= 0),
  total_reposts INTEGER NOT NULL DEFAULT 0 CHECK (total_reposts >= 0),
  total_quotes INTEGER NOT NULL DEFAULT 0 CHECK (total_quotes >= 0),
  total_engagement INTEGER NOT NULL DEFAULT 0 CHECK (total_engagement >= 0),
  avg_engagement NUMERIC(12, 2) NOT NULL DEFAULT 0,
  median_engagement NUMERIC(12, 2) NOT NULL DEFAULT 0,
  avg_char_count NUMERIC(10, 2) NOT NULL DEFAULT 0,

  -- 三分位／群組門檻與統計
  high_tier_threshold NUMERIC(12, 2),
  low_tier_threshold NUMERIC(12, 2),
  tier_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  /* 預期結構範例：
     {
       "high":   { "count": 10, "avg_engagement": 420.5, "reasons": ["..."] },
       "medium": { "count": 10, "avg_engagement": 150.2, "reasons": ["..."] },
       "low":    { "count": 10, "avg_engagement": 35.0,  "reasons": ["..."] }
     }
  */

  -- LLM 結構化分析產出
  success_factors JSONB NOT NULL DEFAULT '[]'::jsonb,      -- 高互動貼文成功歸因
  failure_factors JSONB NOT NULL DEFAULT '[]'::jsonb,      -- 低互動貼文失敗歸因
  content_observations JSONB NOT NULL DEFAULT '[]'::jsonb, -- 內容策略觀察
  ai_recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,   -- AI 行動建議
  chart_snapshots JSONB NOT NULL DEFAULT '{}'::jsonb,      -- Recharts 預計算序列資料（可選）

  llm_model TEXT,
  prompt_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_aggregated_reports_updated_at
  BEFORE UPDATE ON public.aggregated_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 4. 索引設計 (Indexes)
-- ============================================================================

-- threads_accounts：帳號列表查詢與快取過期檢查
CREATE INDEX idx_threads_accounts_user_id ON public.threads_accounts(user_id);
CREATE INDEX idx_threads_accounts_cache_lookup
  ON public.threads_accounts(user_id, username, cache_expires_at DESC);

-- analysis_tasks：使用者任務歷史、狀態篩選與快取命中搜尋
CREATE INDEX idx_analysis_tasks_user_created
  ON public.analysis_tasks(user_id, created_at DESC);
CREATE INDEX idx_analysis_tasks_account_status
  ON public.analysis_tasks(account_id, status, completed_at DESC);

-- posts：Top Posts 排序、時間趨勢圖表、三群組篩選與去重
CREATE INDEX idx_posts_task_engagement
  ON public.posts(task_id, total_engagement DESC);
CREATE INDEX idx_posts_task_published
  ON public.posts(task_id, published_at DESC);
CREATE INDEX idx_posts_task_tier
  ON public.posts(task_id, engagement_tier);
CREATE INDEX idx_posts_user_id
  ON public.posts(user_id);
CREATE UNIQUE INDEX uq_posts_task_external_id
  ON public.posts(task_id, external_post_id)
  WHERE external_post_id IS NOT NULL;

-- aggregated_reports：多帳號比較查詢加速
CREATE INDEX idx_aggregated_reports_user_account
  ON public.aggregated_reports(user_id, account_id, created_at DESC);

-- ============================================================================
-- 5. Row Level Security (RLS) 安全政策
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threads_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aggregated_reports ENABLE ROW LEVEL SECURITY;

-- 5.1 public.users 政策：僅能檢視與修改自己的個人資料
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 5.2 public.threads_accounts 政策：完全隔離不同使用者的追蹤帳號
CREATE POLICY "threads_accounts_select_own"
  ON public.threads_accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "threads_accounts_insert_own"
  ON public.threads_accounts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "threads_accounts_update_own"
  ON public.threads_accounts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "threads_accounts_delete_own"
  ON public.threads_accounts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5.3 public.analysis_tasks 政策：僅能操作自己的分析任務，且關聯帳號必須屬於本人
CREATE POLICY "analysis_tasks_select_own"
  ON public.analysis_tasks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "analysis_tasks_insert_own"
  ON public.analysis_tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.threads_accounts a
      WHERE a.id = account_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "analysis_tasks_update_own"
  ON public.analysis_tasks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "analysis_tasks_delete_own"
  ON public.analysis_tasks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5.4 public.posts 政策：僅能存取屬於自己任務的貼文
CREATE POLICY "posts_select_own"
  ON public.posts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "posts_insert_own"
  ON public.posts FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.analysis_tasks t
      WHERE t.id = task_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "posts_update_own"
  ON public.posts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "posts_delete_own"
  ON public.posts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5.5 public.aggregated_reports 政策：僅能存取自己的分析報表
CREATE POLICY "aggregated_reports_select_own"
  ON public.aggregated_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "aggregated_reports_insert_own"
  ON public.aggregated_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.analysis_tasks t
      WHERE t.id = task_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "aggregated_reports_update_own"
  ON public.aggregated_reports FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "aggregated_reports_delete_own"
  ON public.aggregated_reports FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);