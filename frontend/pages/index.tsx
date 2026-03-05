import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Sparkles, Code, Rocket, LogOut } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../services/store';

export default function Home() {
  const router = useRouter();
  const { user, isAuthenticated, logout, initFromStorage } = useAuthStore();
  const [prompt, setPrompt] = useState('create a portfolio webiste in react');
  const [projectName, setProjectName] = useState('React');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    initFromStorage();
    setCheckingAuth(false);
  }, []);

  // If `q` is present in the URL and user is authenticated, prefill prompt and auto-submit
  useEffect(() => {
    const qParam = router.query.q;
    if (!qParam) return;

    const qString = Array.isArray(qParam) ? qParam.join(' ') : String(qParam);

    // If still checking auth, wait until done
    if (checkingAuth) return;

    // If not authenticated, do nothing (existing effect will redirect to login)
    if (!isAuthenticated) return;

    // Prefill and auto-submit once
    setPrompt(qString);

    // small delay to ensure state has updated
    setTimeout(() => {
      // call handleSubmit programmatically (mock event)
      handleSubmit({ preventDefault: () => {} } as any);
    }, 200);
  }, [router.query.q, checkingAuth, isAuthenticated]);

  useEffect(() => {
    if (!checkingAuth && !isAuthenticated) {
      router.push('/login');
    }
  }, [checkingAuth, isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !projectName.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await api.createWorkspace(projectName, prompt);
      router.push(`/workspace/${response.workspace.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create workspace');
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  if (checkingAuth || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      {/* User info & logout */}
      <div className="absolute top-4 right-4 flex items-center gap-4">
        <span className="text-gray-400 text-sm">
          {user?.email}
        </span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-sm transition"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>

      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Code className="w-10 h-10 text-blue-500" />
            <h1 className="text-4xl font-bold text-white">Estro AI</h1>
          </div>
          <p className="text-gray-400 text-lg">
            Describe your project and let AI build it for you
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Enter Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-awesome-app"
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Describe your project
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Build a todo app with React that has a modern dark theme, ability to add/edit/delete tasks, mark as complete, and filter by status..."
              rows={6}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition resize-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !prompt.trim() || !projectName.trim()}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg flex items-center justify-center gap-2 transition"
          >
            {loading ? (
              <>
                <Sparkles className="w-5 h-5 animate-pulse" />
                Creating workspace...
              </>
            ) : (
              <>
                <Rocket className="w-5 h-5" />
                Generate Project
              </>
            )}
          </button>
        </form>

        {/* Features */}
        <div className="mt-12 grid grid-cols-3 gap-4 text-center">
          <div className="p-4">
            <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
              <Code className="w-6 h-6 text-blue-400" />
            </div>
            <h3 className="text-white font-medium mb-1">AI Code Generation</h3>
            <p className="text-gray-500 text-sm">Complete project structure</p>
          </div>
          <div className="p-4">
            <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-green-400" />
            </div>
            <h3 className="text-white font-medium mb-1">Live Preview</h3>
            <p className="text-gray-500 text-sm">See changes instantly</p>
          </div>
          <div className="p-4">
            <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
              <Rocket className="w-6 h-6 text-purple-400" />
            </div>
            <h3 className="text-white font-medium mb-1">Isolated Sandbox</h3>
            <p className="text-gray-500 text-sm">Safe execution environment</p>
          </div>
        </div>
      </div>
    </div>
  );
}
