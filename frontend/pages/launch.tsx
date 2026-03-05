import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import api from '../services/api';
import { useAuthStore } from '../services/store';

export default function LaunchPage() {
  const router = useRouter();
  const { q } = router.query;
  const { isAuthenticated, initFromStorage } = useAuthStore();
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    initFromStorage();
  }, [initFromStorage]);

  useEffect(() => {
    if (started) return;
    const query = typeof q === 'string' ? q : Array.isArray(q) ? q.join(' ') : '';
    if (!query) return;

    // Wait until authenticated (SSOHandler in _app will handle sso_token login)
    if (!isAuthenticated) return;

    setStarted(true);
    setLoading(true);

    (async () => {
      try {
        // Create a new workspace using the passed query as prompt
        const resp = await api.createWorkspace('AI Workspace', query);
        if (resp && resp.workspace && resp.workspace.id) {
          router.replace(`/workspace/${resp.workspace.id}`);
        } else if (resp && resp.workspace && resp.workspace._id) {
          router.replace(`/workspace/${resp.workspace._id}`);
        } else {
          // fallback: go to home
          router.replace('/');
        }
      } catch (err) {
        console.error('Launch flow failed:', err);
        router.replace('/');
      } finally {
        setLoading(false);
      }
    })();
  }, [q, isAuthenticated, router, started, initFromStorage]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      {loading ? (
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div>Preparing your AI workspace…</div>
        </div>
      ) : (
        <div className="text-center">
          <p className="mb-2">Waiting for authentication or query...</p>
          <p className="text-sm text-gray-400">If you are not redirected, go to <a href="/" className="underline">home</a>.</p>
        </div>
      )}
    </div>
  );
}
