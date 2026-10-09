import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { BRANDING } from '@aspreen/shared';

export const metadata: Metadata = {
  title: BRANDING.browserTitle,
  description: BRANDING.tagline,
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#080808] text-[#F5F5F5] min-h-screen antialiased selection:bg-neutral-800 selection:text-white">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
