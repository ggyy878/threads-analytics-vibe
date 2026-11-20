// src/app/login/page.tsx
'use client';

import { useState, useTransition } from 'react';
import { login, signup } from './actions';

type AuthMode = 'login' | 'signup';

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const action = mode === 'login' ? login : signup;
      const result = await action(formData);

      if (result?.error) {
        setError(result.error);
      } else if (result?.message) {
        setMessage(result.message);
      }
    });
  };

  const toggleMode = () => {
    setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
    setError(null);
    setMessage(null);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-zinc-900">
            {mode === 'login' ? '登入帳號' : '建立新帳號'}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {mode === 'login'
              ? '輸入您的 Email 與密碼以進入數據分析儀表板'
              : '註冊帳號以開始追蹤與分析 Threads 貼文數據'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
              電子郵件
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={isPending}
              placeholder="name@example.com"
              className="w-full rounded-lg border border-zinc-300 px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-100"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
              密碼
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              disabled={isPending}
              placeholder="至少 6 個字元"
              className="w-full rounded-lg border border-zinc-300 px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-100"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role="status"
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700"
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending
              ? mode === 'login'
                ? '登入中...'
                : '註冊中...'
              : mode === 'login'
                ? '登入'
                : '註冊'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-zinc-600">
          {mode === 'login' ? '還沒有帳號？' : '已經有帳號了？'}{' '}
          <button
            type="button"
            onClick={toggleMode}
            disabled={isPending}
            className="font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-700 disabled:opacity-50"
          >
            {mode === 'login' ? '立即註冊' : '返回登入'}
          </button>
        </div>
      </div>
    </main>
  );
}