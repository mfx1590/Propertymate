import type { ReactNode } from 'react';

// Root layout is a pass-through; the [locale] layout renders <html> with
// the correct lang/dir (RTL for Farsi).
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
