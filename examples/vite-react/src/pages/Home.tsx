export function Home() {
  return (
    <main>
      <h1 style={{ color: '#cba6f7' }}>windotwatchr showcase</h1>
      <p style={{ color: '#bac2de' }}>
        Real browser E2E demos for windotwatchr — zero-polling window.*
        property detection.
      </p>
      <nav>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li style={{ marginBottom: '0.75rem' }}>
            <a href="#/payments" style={{ color: '#89b4fa', textDecoration: 'none' }}>
              Payments
            </a>
            <span style={{ color: '#6c7086' }}> — Affirm-like BNPL promo (before/after)</span>
          </li>
          <li>
            <a href="#/dashboard" style={{ color: '#89b4fa', textDecoration: 'none' }}>
              Dashboard
            </a>
            <span style={{ color: '#6c7086' }}> — Multi-SDK status dashboard</span>
          </li>
        </ul>
      </nav>
    </main>
  );
}
