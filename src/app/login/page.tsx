// src/app/login/page.tsx
"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  LogIn,
  UserPlus,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  Mail,
  Lock,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

type AuthMode = "login" | "signup";

// 建議於 .env.local 設定實際測試帳號；未設定時使用以下預設值
const DEMO_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "reviewer.demo@gmail.com";
const DEMO_PASSWORD =
  process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "DemoPass123!";

const BLOCKED_DOMAINS = ["@example.com", "@test.com"];

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // 同步鎖：防止極短時間內雙擊在 React 尚未 re-render 前送出重複請求
  const submitLockRef = useRef(false);

  function switchMode(nextMode: AuthMode) {
    if (isSubmitting) return;
    setMode(nextMode);
    setErrorMsg(null);
    setInfoMsg(null);
  }

  function handleFillDemoAccount() {
    if (isSubmitting) return;
    setMode("login");
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setErrorMsg(null);
    setInfoMsg("已自動填入評審測試帳號，請直接點擊「登入」進入儀表板。");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    // 防呆二：雙重防連按檢查
    if (submitLockRef.current || isSubmitting) return;

    const trimmedEmail = email.trim();
    const lowerEmail = trimmedEmail.toLowerCase();

    if (!trimmedEmail || !password) {
      setErrorMsg("請輸入電子信箱與密碼。");
      return;
    }

    // 防呆一：註冊模式擋掉假網域
    if (
      mode === "signup" &&
      BLOCKED_DOMAINS.some((domain) => lowerEmail.includes(domain))
    ) {
      setInfoMsg(null);
      setErrorMsg(
        "系統安全限制不支援 example.com 假網域，請改用 @gmail.com 等格式，或直接點擊下方測試帳號登入。"
      );
      return;
    }

    if (mode === "signup" && password.length < 6) {
      setErrorMsg("密碼長度至少需 6 個字元。");
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (error) {
          throw error;
        }

        router.push("/dashboard");
        router.refresh();
        return;
      }

      // 註冊流程
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });

      if (error) {
        throw error;
      }

      // 若專案關閉信箱驗證並直接核發 session，直接導向儀表板
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
        return;
      }

      setInfoMsg(
        "註冊成功！若系統有開啟信箱驗證，請先至信箱點擊驗證連結，或直接切換至登入模式。"
      );
      setMode("login");
    } catch (err) {
      const rawMessage =
        err instanceof Error ? err.message : "驗證過程發生未知錯誤";

      if (/rate limit|too many requests|429/i.test(rawMessage)) {
        setErrorMsg(
          "操作過於頻繁，請稍候片刻再試，或直接使用下方測試帳號登入。"
        );
      } else if (/invalid login credentials/i.test(rawMessage)) {
        setErrorMsg("帳號或密碼錯誤，請重新確認。");
      } else if (/user already registered/i.test(rawMessage)) {
        setErrorMsg("此信箱已註冊過，請直接切換至「登入」模式。");
      } else {
        setErrorMsg(rawMessage);
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        {/* 標題 */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Threads Analytics
          </h1>
          <p className="mt-1.5 text-xs text-slate-500">
            {mode === "login"
              ? "登入以查看 Threads 數據分析與 AI 策略儀表板"
              : "建立新帳號以開始使用 Threads 數據分析儀表板"}
          </p>
        </div>

        {/* 登入 / 註冊切換頁籤（預設登入） */}
        <div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => switchMode("login")}
            className={`rounded-lg py-2 text-xs font-semibold transition disabled:opacity-60 ${
              mode === "login"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            登入模式
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => switchMode("signup")}
            className={`rounded-lg py-2 text-xs font-semibold transition disabled:opacity-60 ${
              mode === "signup"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            註冊帳號
          </button>
        </div>

        {/* 提示訊息區 */}
        {errorMsg && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-relaxed text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{infoMsg}</span>
          </div>
        )}

        {/* 主表單 */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium text-slate-700"
            >
              電子信箱
            </label>
            <div className="relative mt-1.5">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                disabled={isSubmitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@gmail.com"
                className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium text-slate-700"
            >
              密碼
            </label>
            <div className="relative mt-1.5">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                disabled={isSubmitting}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入至少 6 碼密碼"
                className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {mode === "login" ? "登入中..." : "註冊中..."}
              </>
            ) : mode === "login" ? (
              <>
                <LogIn className="h-4 w-4" />
                登入
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                建立帳號
              </>
            )}
          </button>
        </form>

        {/* 評審專用一鍵填入區 */}
        <div className="mt-6 border-t border-slate-200 pt-5">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleFillDemoAccount}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-indigo-200 bg-indigo-50 py-2.5 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <KeyRound className="h-4 w-4" />
            填入測試帳號（評審專用）
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            點擊後將自動填入預設帳號密碼並切換至登入模式
          </p>
        </div>
      </div>
    </main>
  );
}