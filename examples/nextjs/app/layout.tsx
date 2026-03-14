import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'windotwatchr — Next.js Showcase',
  description: 'E2E showcase for windotwatchr in Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          padding: '2rem',
          backgroundColor: '#1e1e2e',
          color: '#cdd6f4',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
