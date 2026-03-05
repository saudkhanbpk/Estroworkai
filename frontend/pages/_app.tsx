import { useEffect } from 'react';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import '../styles/globals.css';
import { useAuthStore } from '../services/store';

// Smart backend URL for SSO — EstroworkAI frontend is on :3001, backend on :5000 locally.
// In production (nginx proxy), same origin handles routing.
function getSSOApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:5000';
  const { protocol, hostname, port } = window.location;
  // Local dev: frontend on 3001, backend on 5000
  if (port === '3001') return `${protocol}//${hostname}:5000`;
  // Production (nginx or same-origin): use relative path via same host
  return `${protocol}//${hostname}`;
}

function SSOHandler() {
  const router = useRouter();
  const { setAuth, initFromStorage } = useAuthStore();

  useEffect(() => {
    // Always restore persisted session from localStorage on first load
    initFromStorage();

    const { sso_token } = router.query;
    if (!sso_token || typeof sso_token !== 'string') return;

    // We have an SSO token from Estrowork — verify it silently
    (async () => {
      try {
        const res = await fetch(`${getSSOApiUrl()}/api/auth/sso/verify-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ssoToken: sso_token }),
        });

        if (!res.ok) {
          console.warn('[SSO] Token verification failed:', res.status);
          return;
        }

        const data = await res.json();
        if (data.success && data.token && data.user) {
          // Log the user in — same as a normal login
          setAuth(data.user, data.token);
          console.log('[SSO] Auto-login successful for:', data.user.email);
        }
      } catch (err) {
        console.error('[SSO] Error during SSO verification:', err);
      } finally {
        // Remove sso_token from URL so it's not visible or reused
        const { sso_token: _removed, ...restQuery } = router.query;
        router.replace({ pathname: router.pathname, query: restQuery }, undefined, {
          shallow: true,
        });
      }
    })();
  }, [router.query.sso_token]);

  return null;
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <SSOHandler />
      <Component {...pageProps} />
    </>
  );
}
