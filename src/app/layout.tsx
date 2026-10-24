import type { Metadata, Viewport } from 'next';

import './code-fonts.css';
import './globals.css';
import { IdentityProvider } from '@/features/identity/identity-provider';
import { AppAlertProvider } from '@/components/app-alert-provider';
import { LanguageProvider } from '@/lib/i18n/react';
import { ApplicationMetadata } from './application-metadata';
import { GlobalCompanion } from '@/features/companion/global-companion';

export const metadata: Metadata = {
  title: 'Fob · Fusion One Book',
  icons: { icon: '/brand/fob-mark.png' },
  description: '面向个人与团队的知识创作、协作与复用平台。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#111111' },
  ],
};

/* 首帧运行时脚本：从 localStorage 恢复外观偏好（主题 / 字体族 / 字号），
   避免深色闪白。与 lib/appearance.ts 的键名与应用逻辑保持同步。 */
const BOOT_SCRIPT = `
try{var p=JSON.parse(localStorage.getItem("fob.appearance")||"null")||{};var h=document.documentElement;var r=p.theme==="dark"||p.theme==="light"?p.theme:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");h.dataset.theme=r;h.style.colorScheme=r;if(p.uiFont)h.dataset.uiFont=p.uiFont;if(p.codeFont)h.dataset.codeFont=p.codeFont;if(p.uiFontSize)h.style.setProperty("--ui-size",p.uiFontSize+"px");if(p.codeFontSize)h.style.setProperty("--code-size",p.codeFontSize+"px");}catch(e){}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <LanguageProvider>
          <ApplicationMetadata />
          <AppAlertProvider>
            <IdentityProvider>{children}</IdentityProvider>
            <GlobalCompanion />
          </AppAlertProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
