// src/app/login/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

export type AuthActionResult = {
  error?: string;
  message?: string;
};

function formatAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return '電子郵件或密碼錯誤，請重新確認。';
  }
  if (lower.includes('email not confirmed')) {
    return '此帳號尚未完成信箱驗證，請先前往信箱點擊驗證連結。';
  }
  if (lower.includes('user already registered')) {
    return '此電子郵件已被註冊，請直接登入。';
  }
  if (lower.includes('password should be at least')) {
    return '密碼長度至少需要 6 個字元。';
  }
  if (lower.includes('rate limit')) {
    return '操作過於頻繁，請稍候再試。';
  }
  return `認證失敗：${message}`;
}

export async function login(formData: FormData): Promise<AuthActionResult> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: '請完整輸入電子郵件與密碼。' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: formatAuthError(error.message) };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signup(formData: FormData): Promise<AuthActionResult> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: '請完整輸入電子郵件與密碼。' };
  }
  if (password.length < 6) {
    return { error: '密碼長度至少需要 6 個字元。' };
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    return { error: formatAuthError(error.message) };
  }

  // 若 Supabase 後台開啟了「Confirm email」，session 會是 null，提示使用者收信
  if (!data.session) {
    return {
      message: '註冊成功！請前往您的信箱點擊驗證連結，完成後即可登入。',
    };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}