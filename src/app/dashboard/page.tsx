// src/app/dashboard/page.tsx
import { Suspense } from 'react';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { SignOutButton } from '@/components/SignOutButton';

async function DashboardContent() {
  // 明確告知 Next.js 16 此元件需在請求當下動態渲染，避免 Supabase 內部的 Date.now() 觸發預渲染錯誤
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
          <p className="text-sm text-zinc-500">登入帳號：{user.email}</p>
        </div>
        <SignOutButton />
      </header>

      <section className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
        認證模組運作正常，後續可在此整合 Threads 帳號管理與數據分析儀表板。
      </section>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-8">
      <Suspense
        fallback={
          <div className="mx-auto max-w-5xl text-sm text-zinc-500">
            載入儀表板中...
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </main>
  );
}