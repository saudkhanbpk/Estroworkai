import axios from 'axios';

// Determine API URL dynamically
function getApiUrl(): string {
  // Use environment variable if set
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  
  // In browser, derive from current location for production
  if (typeof window !== 'undefined') {
    const { protocol, host } = window.location;
    // In production, API is proxied through nginx on /api
    return `${protocol}//${host}`;
  }
  
  // Default for SSR
  return 'http://localhost:5000';
}

const api = axios.create({
  baseURL: `${getApiUrl()}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Auth
export const login = async (email: string, password: string) => {
  const response = await api.post('/auth/login', { email, password });
  if (response.data.token) {
    localStorage.setItem('token', response.data.token);
  }
  return response.data;
};

export const register = async (name: string, email: string, password: string) => {
  const response = await api.post('/auth/register', { name, email, password });
  if (response.data.token) {
    localStorage.setItem('token', response.data.token);
  }
  return response.data;
};

export const getProfile = async () => {
  const response = await api.get('/auth/profile');
  return response.data;
};

// Workspace
export const createWorkspace = async (name: string, prompt: string) => {
  const response = await api.post('/workspace/create', { name, prompt });
  return response.data;
};

export const getWorkspace = async (id: string) => {
  const response = await api.get(`/workspace/${id}`);
  return response.data;
};

export const getUserWorkspaces = async () => {
  const response = await api.get('/workspace');
  return response.data;
};

export const getWorkspaceStatus = async (id: string) => {
  const response = await api.get(`/workspace/${id}/status`);
  return response.data;
};

export const startAgent = async (id: string) => {
  const response = await api.post(`/workspace/${id}/start-agent`);
  return response.data;
};

export const runPrompt = async (id: string, prompt: string) => {
  const response = await api.post(`/workspace/${id}/run-prompt`, { prompt });
  return response.data;
};

export const destroyWorkspace = async (id: string) => {
  const response = await api.delete(`/workspace/${id}`);
  return response.data;
};

export const assignToOrganization = async (id: string) => {
  const response = await api.post(`/workspace/${id}/assign`);
  return response.data;
};

// Files
export const listFiles = async (workspaceId: string, path?: string) => {
  const response = await api.get(`/file/${workspaceId}/list`, {
    params: { path },
  });
  return response.data;
};

export const readFile = async (workspaceId: string, path: string) => {
  const response = await api.get(`/file/${workspaceId}/read`, {
    params: { path },
  });
  return response.data;
};

export const writeFile = async (workspaceId: string, path: string, content: string) => {
  const response = await api.post(`/file/${workspaceId}/write`, { path, content });
  return response.data;
};

export const deleteFile = async (workspaceId: string, path: string) => {
  const response = await api.delete(`/file/${workspaceId}/delete`, {
    params: { path },
  });
  return response.data;
};

export const createDirectory = async (workspaceId: string, path: string) => {
  const response = await api.post(`/file/${workspaceId}/mkdir`, { path });
  return response.data;
};

// Terminal
export const executeCommand = async (workspaceId: string, command: string) => {
  const response = await api.post(`/terminal/${workspaceId}/exec`, { command });
  return response.data;
};

export const startServer = async (workspaceId: string) => {
  const response = await api.post(`/terminal/${workspaceId}/start`);
  return response.data;
};

export const stopServer = async (workspaceId: string) => {
  const response = await api.post(`/terminal/${workspaceId}/stop`);
  return response.data;
};

export const getServerLogs = async (workspaceId: string, lines?: number) => {
  const response = await api.get(`/terminal/${workspaceId}/logs`, {
    params: { lines },
  });
  return response.data;
};

export const installPackages = async (workspaceId: string, packages?: string[]) => {
  const response = await api.post(`/terminal/${workspaceId}/install`, { packages });
  return response.data;
};

// Chat Messages
export const getChatMessages = async (workspaceId: string) => {
  const response = await api.get(`/workspace/${workspaceId}/chat`);
  return response.data;
};

export const addChatMessage = async (workspaceId: string, message: { role: string; content: string; type?: string }) => {
  const response = await api.post(`/workspace/${workspaceId}/chat`, message);
  return response.data;
};

// Validation & Error Handling
export const validateWorkspace = async (workspaceId: string) => {
  const response = await api.get(`/workspace/${workspaceId}/validate`);
  return response.data;
};

export const autoFixWorkspace = async (workspaceId: string, fixes: { command: string; description: string }[]) => {
  const response = await api.post(`/workspace/${workspaceId}/autofix`, { fixes });
  return response.data;
};

export const getWorkspaceLogs = async (workspaceId: string) => {
  const response = await api.get(`/workspace/${workspaceId}/logs`);
  return response.data;
};

export default {
  login,
  register,
  getProfile,
  createWorkspace,
  getWorkspace,
  getUserWorkspaces,
  getWorkspaceStatus,
  startAgent,
  runPrompt,
  destroyWorkspace,
  assignToOrganization,
  listFiles,
  readFile,
  writeFile,
  deleteFile,
  createDirectory,
  executeCommand,
  startServer,
  stopServer,
  getServerLogs,
  installPackages,
  getChatMessages,
  addChatMessage,
  validateWorkspace,
  autoFixWorkspace,
  getWorkspaceLogs,
};
