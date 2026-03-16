import { create } from 'zustand';

interface Workspace {
  _id: string;
  name: string;
  prompt: string;
  status: string;
  previewUrl: string | null;
  containerId: string | null;
  assignedToOrganization?: boolean;
  files: Array<{ path: string; type: string; lastModified: Date }>;
}

interface AgentLog {
  action: string;
  path?: string;
  message?: string;
  timestamp?: Date;
}

interface WorkspaceState {
  workspace: Workspace | null;
  files: string[];
  activeFile: string | null;
  agentStatus: 'idle' | 'running' | 'completed' | 'error';
  agentLogs: AgentLog[];
  setWorkspace: (workspace: Workspace) => void;
  setFiles: (files: string[]) => void;
  setActiveFile: (file: string | null) => void;
  setAgentStatus: (status: 'idle' | 'running' | 'completed' | 'error') => void;
  addAgentLog: (log: AgentLog) => void;
  clearAgentLogs: () => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspace: null,
  files: [],
  activeFile: null,
  agentStatus: 'idle',
  agentLogs: [],

  setWorkspace: (workspace) => set({ workspace }),

  setFiles: (files) => set({ files }),

  setActiveFile: (activeFile) => set({ activeFile }),

  setAgentStatus: (agentStatus) => set({ agentStatus }),

  addAgentLog: (log) =>
    set((state) => ({
      agentLogs: [...state.agentLogs, { ...log, timestamp: new Date() }],
    })),

  clearAgentLogs: () => set({ agentLogs: [] }),

  reset: () =>
    set({
      workspace: null,
      files: [],
      activeFile: null,
      agentStatus: 'idle',
      agentLogs: [],
    }),
}));

// Auth store
interface AuthState {
  user: { id: string; name: string; email: string; role: string } | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: { id: string; name: string; email: string; role: string }, token: string) => void;
  logout: () => void;
  initFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,

  setAuth: (user, token) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    set({ user: null, token: null, isAuthenticated: false });
  },

  initFromStorage: () => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      const userStr = localStorage.getItem('user');
      if (token && userStr) {
        try {
          const user = JSON.parse(userStr);
          set({ user, token, isAuthenticated: true });
        } catch {
          // Invalid stored data
        }
      }
    }
  },
}));
