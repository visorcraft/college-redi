import type { Metadata } from 'next';
import './globals.css';
import { RediWidget } from '@/components/redi/RediWidget';

export const metadata: Metadata = {
  title: 'Redi',
  description: 'Your degree-planning cloud companion',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <RediWidget />
      </body>
    </html>
  );
}
