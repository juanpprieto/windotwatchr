import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1 style={{ color: '#cba6f7' }}>windotwatchr showcase</h1>
      <p style={{ color: '#bac2de' }}>
        Real browser E2E demos for windotwatchr — zero-polling window.* property detection.
      </p>
      <nav>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li style={{ marginBottom: '0.75rem' }}>
            <Link href="/payments" style={{ color: '#89b4fa', textDecoration: 'none' }}>
              Payments
            </Link>
            <span style={{ color: '#6c7086' }}> — Affirm-like BNPL promo (before/after)</span>
          </li>
          <li>
            <Link href="/dashboard" style={{ color: '#89b4fa', textDecoration: 'none' }}>
              Dashboard
            </Link>
            <span style={{ color: '#6c7086' }}> — Multi-SDK status dashboard</span>
          </li>
        </ul>
      </nav>
    </main>
  );
}
