import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import React from 'react';
import MotionProvider from '@/features/shared/MotionProvider';

const sans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Queryroom',
  description: 'Ask questions about your database with a human-approved, read-only SQL agent.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a1011',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang='en'
      className={`${sans.variable} ${mono.variable}`}
      data-scroll-behavior='smooth'
      suppressHydrationWarning
    >
      <head>
        {/* Applies the saved theme (dark by default) before first paint so the page never flashes. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t;try{t=localStorage.getItem('queryroom.theme')}catch(e){}if(t!=='light'&&t!=='dark')t='dark';document.documentElement.dataset.theme=t})()`,
          }}
        />
      </head>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
