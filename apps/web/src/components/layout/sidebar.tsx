'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Radio,
  Tv,
  Film,
  Clapperboard,
  Cpu,
  KeyRound,
  FileText,
  Settings,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { BRANDING } from '@aspreen/shared';
import { useAuth } from '@/lib/auth-context';

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/oscar-tv', label: '⭐ قنوات أوسكار (Oscar TV)', icon: Sparkles },
  { href: '/channels', label: 'جميع القنوات (Channels)', icon: Tv },
  { href: '/sources', label: 'المصادر (Sources)', icon: Radio },
  { href: '/movies', label: 'الأفلام (Movies)', icon: Film },
  { href: '/series', label: 'المسلسلات (Series)', icon: Clapperboard },
  { href: '/transcoding', label: 'Transcoding', icon: Cpu },
  { href: '/tokens', label: 'Stream Links', icon: KeyRound },
  { href: '/logs', label: 'Activity Logs', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="w-64 bg-[#0A0A0A] border-r border-[#262626] flex flex-col h-screen fixed left-0 top-0 z-30 select-none">
      {/* Brand Header */}
      <div className="h-16 px-6 border-b border-[#262626] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-white text-black font-black text-xs flex items-center justify-center tracking-wider">
            {BRANDING.monogram}
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-[#F5F5F5]">{BRANDING.logoText}</span>
            <span className="text-[10px] text-[#71717A] tracking-wider uppercase font-mono">Stream Relay</span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-[#171717] text-white border border-[#333333]'
                  : 'text-[#A1A1AA] hover:text-[#F5F5F5] hover:bg-[#121212]'
              }`}
            >
              <Icon className="w-4 h-4 text-[#A1A1AA]" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer / User Session */}
      <div className="p-3 border-t border-[#262626] space-y-2">
        <div className="px-3 py-2 bg-[#101010] border border-[#262626] rounded flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <ShieldCheck className="w-3.5 h-3.5 text-[#A1A1AA] shrink-0" />
            <div className="flex flex-col truncate">
              <span className="text-[11px] font-medium text-[#F5F5F5] truncate">
                {user?.email || 'Administrator'}
              </span>
              <span className="text-[9px] text-[#71717A] font-mono">ADMIN ACCESS</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-medium text-[#A1A1AA] hover:text-white hover:bg-[#171717] border border-transparent hover:border-[#262626] transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
