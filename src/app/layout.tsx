import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AppProviders } from '@/components/app/AppProviders';
import { PREFERENCES_KEY } from '@/lib/editor/uiState';
import './globals.css';

/**
 * The product typeface.
 *
 * Geist: a grotesque drawn for interfaces and code, with the even rhythm and
 * generous x-height that keep 12px chrome legible and a display cut that holds
 * a headline. Self-hosted by `next/font`, so it costs no third-party request
 * and cannot flash unstyled text, and one identical shape on every OS — which
 * matters for an editor whose chrome sits at 11–13px, where system fonts
 * disagree about metrics enough to shift every panel.
 */
const sans = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
});

/** Code, keycaps and any number that has to line up in a column. */
const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});

export const metadata: Metadata = {
  title: 'AC Graph',
  description: 'Cloud architecture diagrams for developers: draw them, or write them.',
};

/** `color-scheme` makes native scrollbars and form controls follow the theme. */
export const viewport: Viewport = {
  // The chrome is dark unless the reader has asked for light, so the browser's
  // own furniture matches by default.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0b1020' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1020' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`dark ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* The theme, before the first paint.
            The class is applied by React once it has hydrated, which is far too
            late: every load flashed white before turning dark. This reads the
            same stored choice the app does — the system's unless one was made
            by name; a `dark: false` from older builds was a choice for light —
            and corrects the markup, which ships dark, while the parser is
            still in <head>. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)})||'{}');var t=p.theme==='light'||p.theme==='dark'?p.theme:(p.dark===false?'light':'system');var d=t==='system'?!(window.matchMedia&&!window.matchMedia('(prefers-color-scheme: dark)').matches):t==='dark';if(!d)document.documentElement.classList.remove('dark');if(p&&typeof p.accent==='string')document.documentElement.setAttribute('data-accent',p.accent)}catch(e){}`,
          }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
