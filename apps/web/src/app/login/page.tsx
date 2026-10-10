'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BRANDING } from '@aspreen/shared';
import { useAuth } from '@/lib/auth-context';
import { ShieldCheck, ArrowRight, Lock, Mail, Key } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { user, login, loginDemoAdmin, resetPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);

  useEffect(() => {
    if (user) {
      router.push('/');
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setIsSubmitting(true);

    try {
      if (isResetMode) {
        if (!email) throw new Error('Please enter your administrator email address.');
        await resetPassword(email);
        setInfo('Password reset email sent. Please check your inbox.');
        setIsResetMode(false);
      } else {
        await login(email, password);
        router.push('/');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoLogin = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await loginDemoAdmin();
      router.push('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-white text-black font-black text-sm mb-4 tracking-wider shadow-lg">
            {BRANDING.monogram}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#F5F5F5]">{BRANDING.loginHeading}</h1>
          <p className="text-xs text-[#71717A] mt-1.5">{BRANDING.loginSubheading}</p>
        </div>

        {/* Login Card */}
        <div className="bg-[#111111] border border-[#262626] rounded-lg p-6 shadow-xl">
          {error && (
            <div className="mb-4 p-3 bg-[#1A1A1A] border border-neutral-700 rounded text-xs text-[#E4E4E7]">
              {error}
            </div>
          )}

          {info && (
            <div className="mb-4 p-3 bg-[#171717] border border-[#333333] rounded text-xs text-[#F5F5F5]">
              {info}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Administrator Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#71717A] absolute left-3 top-2.5" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="admin@aspreen.tv"
                  className="form-input pl-9"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Administrator Password / Access Code
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#71717A] absolute left-3 top-2.5" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter ADMIN_PASSWORD"
                  className="form-input pl-9"
                />
              </div>
              <p className="text-[11px] text-[#71717A] mt-1">
                Configured via <code className="text-[#A1A1AA]">ADMIN_PASSWORD</code> in Railway (default: <code className="text-[#A1A1AA]">admin123456</code>)
              </p>
            </div>

            {/* Primary Action Button: White with Black Text */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full btn-primary py-2.5 mt-2 gap-2"
            >
              <span>{isResetMode ? 'Send Reset Link' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {isResetMode && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setIsResetMode(false)}
                className="text-xs text-[#A1A1AA] hover:text-[#F5F5F5] transition-colors"
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* Quick Demo Access for Testing */}
          <div className="mt-6 pt-6 border-t border-[#262626]">
            <button
              type="button"
              onClick={handleDemoLogin}
              disabled={isSubmitting}
              className="w-full btn-secondary py-2 gap-2 text-xs"
            >
              <Key className="w-3.5 h-3.5 text-[#A1A1AA]" />
              <span>Launch Demo Console (Admin Mode)</span>
            </button>
            <p className="text-[10px] text-[#71717A] text-center mt-2">
              For initial development verification before configuring production Firebase keys.
            </p>
          </div>
        </div>

        {/* Security Notice */}
        <div className="mt-6 text-center flex items-center justify-center gap-2 text-[11px] text-[#71717A]">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Private Administrator Portal — Access strictly monitored</span>
        </div>
      </div>
    </div>
  );
}
