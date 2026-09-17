'use client';

export default function Error({ error }: { error: Error }) {
  return (
    <main style={{ padding: 32 }}>
      <h1 style={{ color: 'crimson' }}>Something went wrong!</h1>
      <pre style={{ color: '#ffb' }}>{error.message}</pre>
      <pre style={{ color: '#fbf' }}>{error.stack}</pre>
    </main>
  );
}
