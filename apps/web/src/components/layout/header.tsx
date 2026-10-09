'use client';

import React from 'react';
import { Activity } from 'lucide-react';

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function Header({ title, subtitle, action }: HeaderProps) {
  return (
    <header className="h-16 px-8 border-b border-[#262626] bg-[#080808]/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between">
      <div>
        <h1 className="text-base font-semibold text-[#F5F5F5] tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-[#71717A]">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-4">
        {/* System Health Indicators */}
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-[#101010] border border-[#262626] text-[11px] font-mono text-[#A1A1AA]">
          <Activity className="w-3.5 h-3.5 text-[#F5F5F5]" />
          <span>FIREBASE: OK</span>
          <span className="text-[#333333]">|</span>
          <span>FFMPEG: READY</span>
        </div>

        {action && <div>{action}</div>}
      </div>
    </header>
  );
}
