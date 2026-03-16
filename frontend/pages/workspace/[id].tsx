import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import {
  Play,
  Square,
  RefreshCw,
  FolderTree,
  Terminal as TerminalIcon,
  Eye,
  Code,
  Sparkles,
  Send,
  User,
  Bot,
  FileCode,
  Command,
  X,
  Maximize2,
  Minimize2,
  PanelBottomClose,
  PanelBottom,
  Building,
  Check
} from 'lucide-react';
import FileTree from '../../components/FileTree';
import Preview from '../../components/Preview';
import api, { getChatMessages, addChatMessage } from '../../services/api';
import { useWorkspaceStore, useAuthStore } from '../../services/store';
import websocket from '../../services/websocket';

// Dynamic import for Monaco Editor (no SSR)
const Editor = dynamic(() => import('../../components/Editor'), { ssr: false });

// Dynamic import for Terminal
const Terminal = dynamic(() => import('../../components/Terminal'), { ssr: false });

export default function WorkspacePage() {
  const router = useRouter();
  const { id } = router.query;

  const {
    workspace,
    files,
    activeFile,
    agentStatus,
    setWorkspace,
    setFiles,
    setActiveFile,
    setAgentStatus,
    addAgentLog
  } = useWorkspaceStore();

  // View states
  const [activeView, setActiveView] = useState<'code' | 'preview'>('code');
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  // Chat states
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
    type?: 'text' | 'file' | 'files' | 'files_updated' | 'command' | 'error' | 'success';
    timestamp: Date;
  }>>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<string[]>([]);
  const processedEventsRef = useRef<Set<string>>(new Set());
  const createdFilesRef = useRef<string[]>([]);
  const fileContentCacheRef = useRef<Map<string, string>>(new Map());

  // Keep filesRef in sync with files
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Helper to generate event key for deduplication
  const getEventKey = (action: string, detail: string) => {
    return `${action}:${detail}`;
  };

  // Load workspace data
  useEffect(() => {
    if (!id) return;

    const loadWorkspace = async () => {
      try {
        const data = await api.getWorkspace(id as string);
        setWorkspace(data.workspace);

        // Set initial agent status based on workspace status
        if (data.workspace?.status === 'creating' || data.workspace?.status === 'running') {
          setAgentStatus('running');
        } else if (data.workspace?.status === 'ready') {
          setAgentStatus('completed');
        } else if (data.workspace?.status === 'error') {
          setAgentStatus('error');
        } else {
          setAgentStatus('idle');
        }

        // Load chat history from database
        try {
          const chatData = await getChatMessages(id as string);
          if (chatData.messages && chatData.messages.length > 0) {
            const loadedMessages = chatData.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            }));
            setChatMessages(loadedMessages);
          } else if (data.workspace?.prompt) {
            setChatMessages([{
              role: 'user',
              content: data.workspace.prompt,
              type: 'text',
              timestamp: new Date(data.workspace.createdAt || Date.now())
            }]);
          }
        } catch (chatError) {
          console.log('Error loading chat history:', chatError);
          if (data.workspace?.prompt) {
            setChatMessages([{
              role: 'user',
              content: data.workspace.prompt,
              type: 'text',
              timestamp: new Date(data.workspace.createdAt || Date.now())
            }]);
          }
        }

        // Load files (may be pending if container is starting)
        try {
          const filesData = await api.listFiles(id as string);
          if (filesData.pending) {
            console.log('Container not ready, files will load when available');
          }
          setFiles(filesData.files || []);
        } catch (fileError) {
          console.log('No files yet:', fileError);
          setFiles([]);
        }

        setLoading(false);
      } catch (error) {
        console.error('Failed to load workspace:', error);
        setLoading(false);
      }
    };

    loadWorkspace();

    // Connect WebSocket
    websocket.connect(id as string);

    websocket.on('agent:update', (update: any) => {
      addAgentLog(update);

      // Generate unique event key for deduplication
      const eventKey = getEventKey(update.action, update.path || update.command || update.result || '');

      // Skip if we've already processed this exact event
      if (processedEventsRef.current.has(eventKey)) {
        console.log('Skipping duplicate event:', eventKey);
        return;
      }

      // Mark event as processed
      processedEventsRef.current.add(eventKey);

      if (update.action === 'agentStart') {
        setAgentStatus('running');
        // Clear created files for new agent run (but keep processed events to avoid duplicates)
        createdFilesRef.current = [];

        // Only add "Working on your request..." if we don't already have one in recent messages
        setChatMessages(prev => {
          const recentMessages = prev.slice(-3);
          const hasWorkingMsg = recentMessages.some(m =>
            m.role === 'assistant' && m.content === 'Working on your request...'
          );
          if (hasWorkingMsg) {
            return prev; // Don't add duplicate
          }
          const newMsg = {
            role: 'assistant' as const,
            content: 'Working on your request...',
            type: 'text' as const,
            timestamp: new Date()
          };
          // Save to database
          addChatMessage(id as string, { role: 'assistant', content: newMsg.content, type: 'text' }).catch(console.error);
          return [...prev, newMsg];
        });
      } else if (update.action === 'agentComplete') {
        setAgentStatus('completed');
        const newContent = update.result || 'Done! Your project is ready.';

        // Save files created message to database if any files were created
        if (createdFilesRef.current.length > 0) {
          const filesContent = createdFilesRef.current.join('\n');
          addChatMessage(id as string, { role: 'assistant', content: filesContent, type: 'files' }).catch(console.error);
        }

        setChatMessages(prev => {
          // Check if we already have this success message in recent messages
          const recentMessages = prev.slice(-5);
          const hasThisSuccess = recentMessages.some(m => m.type === 'success' && m.content === newContent);
          if (hasThisSuccess) {
            return prev;
          }
          // Save success message to database
          addChatMessage(id as string, { role: 'assistant', content: newContent, type: 'success' }).catch(console.error);
          return [...prev, {
            role: 'assistant',
            content: newContent,
            type: 'success',
            timestamp: new Date()
          }];
        });
        // Reload files and refresh preview
        api.listFiles(id as string).then((data) => setFiles(data.files || [])).catch(console.error);
        setPreviewKey(prev => prev + 1);
      } else if (update.action === 'agentError') {
        setAgentStatus('error');
        const errorContent = update.message || 'An error occurred';
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: errorContent,
          type: 'error',
          timestamp: new Date()
        }]);
        // Save error to database
        addChatMessage(id as string, { role: 'assistant', content: errorContent, type: 'error' }).catch(console.error);
      } else if (update.action === 'writeFile') {
        setAgentStatus('running');

        // Track created files for saving to database later
        if (!createdFilesRef.current.includes(update.path)) {
          createdFilesRef.current.push(update.path);
        }

        setChatMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.type === 'files') {
            const existingFiles = lastMsg.content.split('\n');
            if (existingFiles.includes(update.path)) {
              return prev;
            }
            existingFiles.push(update.path);
            const updatedContent = existingFiles.join('\n');
            return [...prev.slice(0, -1), { ...lastMsg, content: updatedContent }];
          } else {
            return [...prev, {
              role: 'assistant',
              content: update.path,
              type: 'files',
              timestamp: new Date()
            }];
          }
        });

        // Add file to explorer using ref to get current files
        const filePath = update.path;
        const currentFiles = filesRef.current;
        if (!currentFiles.includes(filePath)) {
          const newFiles = [...currentFiles];
          const parts = filePath.replace(/^\/workspace\/?/, '').split('/').filter(Boolean);
          let currentPath = '/workspace';
          for (let i = 0; i < parts.length; i++) {
            currentPath += '/' + parts[i];
            if (!newFiles.includes(currentPath)) {
              newFiles.push(currentPath);
            }
          }
          setFiles(newFiles.sort());
        }
      } else if (update.action === 'updateFile') {
        // Handle file updates (modifications to existing files)
        setAgentStatus('running');

        // Track updated files
        if (!createdFilesRef.current.includes(update.path)) {
          createdFilesRef.current.push(update.path);
        }

        setChatMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          // Look for existing "files_updated" message to group updates
          if (lastMsg && lastMsg.type === 'files_updated') {
            const existingFiles = lastMsg.content.split('\n');
            if (existingFiles.includes(update.path)) {
              return prev;
            }
            existingFiles.push(update.path);
            const updatedContent = existingFiles.join('\n');
            return [...prev.slice(0, -1), { ...lastMsg, content: updatedContent }];
          } else {
            return [...prev, {
              role: 'assistant',
              content: update.path,
              type: 'files_updated',
              timestamp: new Date()
            }];
          }
        });

        // Invalidate cache for updated file so it reloads fresh
        fileContentCacheRef.current.delete(update.path);

        // Reload file if it's currently open
        if (activeFile === update.path) {
          api.readFile(id as string, update.path).then((response) => {
            setFileContent(response.content || '');
            setOriginalContent(response.content || '');
            fileContentCacheRef.current.set(update.path, response.content || '');
          }).catch(console.error);
        }
      } else if (update.action === 'readFile') {
        // Just log that we're reading a file - no chat message needed
        setAgentStatus('running');
      } else if (update.action === 'runCommand') {
        setChatMessages(prev => {
          // Check recent messages for duplicate commands
          const recentMessages = prev.slice(-5);
          const hasSameCommand = recentMessages.some(m => m.type === 'command' && m.content === update.command);
          if (hasSameCommand) {
            return prev;
          }
          // Save command to database
          addChatMessage(id as string, { role: 'assistant', content: update.command, type: 'command' }).catch(console.error);
          return [...prev, {
            role: 'assistant',
            content: update.command,
            type: 'command',
            timestamp: new Date()
          }];
        });
      }
    });

    websocket.on('workspace:updated', () => {
      api.listFiles(id as string).then((filesData) => {
        setFiles(filesData.files || []);
      }).catch(console.error);
      setPreviewKey(prev => prev + 1);
    });

    return () => {
      websocket.disconnect();
    };
  }, [id]);

  // Load file content when active file changes - with caching
  useEffect(() => {
    if (!activeFile || !id) return;

    const loadFile = async () => {
      // Check cache first for instant loading
      const cachedContent = fileContentCacheRef.current.get(activeFile);
      if (cachedContent !== undefined) {
        setFileContent(cachedContent);
        setOriginalContent(cachedContent);
        setActiveView('code');
        return;
      }

      setFileLoading(true);
      setFileContent(''); // Clear previous content
      try {
        const response = await api.readFile(id as string, activeFile);
        if (response.pending) {
          // Container not ready, show pending message
          setFileContent('// Loading... Container is starting up');
          // Retry after a delay
          setTimeout(() => {
            fileContentCacheRef.current.delete(activeFile);
            setFileLoading(true);
            api.readFile(id as string, activeFile).then((retryResponse) => {
              if (!retryResponse.pending && retryResponse.content) {
                setFileContent(retryResponse.content);
                setOriginalContent(retryResponse.content);
                fileContentCacheRef.current.set(activeFile, retryResponse.content);
              }
              setFileLoading(false);
            }).catch(() => setFileLoading(false));
          }, 2000);
        } else {
          const content = response.content || '';
          setFileContent(content);
          setOriginalContent(content);
          // Cache the content
          fileContentCacheRef.current.set(activeFile, content);
        }
        // Switch to code view when selecting a file
        setActiveView('code');
      } catch (error) {
        console.error('Failed to load file:', error);
        setFileContent('// Error loading file');
      } finally {
        setFileLoading(false);
      }
    };

    loadFile();
  }, [activeFile, id]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Save file and refresh preview
  const handleSaveFile = useCallback(async (content: string) => {
    if (!id || !activeFile || isSaving) return;

    setIsSaving(true);
    try {
      await api.writeFile(id as string, activeFile, content);
      setOriginalContent(content);
      // Update cache with new content
      fileContentCacheRef.current.set(activeFile, content);
      // Refresh preview after save
      setPreviewKey(prev => prev + 1);
    } catch (error) {
      console.error('Failed to save file:', error);
    } finally {
      setIsSaving(false);
    }
  }, [id, activeFile, isSaving]);

  // Send prompt
  const handleSendPrompt = async () => {
    if (!chatInput.trim() || !id || agentStatus === 'running') return;

    const userMessage = chatInput.trim();
    setChatInput('');

    setChatMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      type: 'text',
      timestamp: new Date()
    }]);

    // Save chat message (may fail if workspace is still creating, but that's OK)
    addChatMessage(id as string, {
      role: 'user',
      content: userMessage,
      type: 'text'
    }).catch((err) => {
      console.log('Chat message will sync later:', err);
    });

    setAgentStatus('running');
    try {
      await api.runPrompt(id as string, userMessage);
    } catch (error: any) {
      setAgentStatus('error');
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: error.message || 'Failed to process your request',
        type: 'error',
        timestamp: new Date()
      }]);
    }
  };

  const handleStartServer = async () => {
    if (!id) return;
    await api.startServer(id as string);
    setPreviewKey(prev => prev + 1);
  };

  const handleStopServer = async () => {
    if (!id) return;
    await api.stopServer(id as string);
  };

  const handleRefreshPreview = () => {
    setPreviewKey(prev => prev + 1);
  };

  const handleAssignToOrganization = async () => {
    if (!id || isAssigning || workspace?.assignedToOrganization) return;

    setIsAssigning(true);
    try {
      const result = await api.assignToOrganization(id as string);
      if (result.success) {
        // Update local workspace state
        if (workspace) {
          setWorkspace({
            ...workspace,
            assignedToOrganization: true
          });
        }
      }
    } catch (error) {
      console.error('Failed to assign to organization:', error);
    } finally {
      setIsAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0d1117]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading workspace...</p>
        </div>
      </div>
    );
  }

  const hasUnsavedChanges = fileContent !== originalContent;

  return (
    <div className="h-screen flex flex-col bg-[#0d1117] text-gray-200">
      {/* Top Bar */}
      <header className="h-12 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <h1 className="font-semibold text-white">{workspace?.name || 'Workspace'}</h1>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${agentStatus === 'running' ? 'bg-blue-500/20 text-blue-400' :
            agentStatus === 'completed' ? 'bg-green-500/20 text-green-400' :
              agentStatus === 'error' ? 'bg-red-500/20 text-red-400' :
                'bg-gray-700/50 text-gray-400'
            }`}>
            <Sparkles className={`w-3.5 h-3.5 ${agentStatus === 'running' ? 'animate-pulse' : ''}`} />
            {agentStatus === 'running' ? 'AI Working...' :
              agentStatus === 'completed' ? 'Ready' :
                agentStatus === 'error' ? 'Error' : 'Idle'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex bg-[#21262d] rounded-lg p-0.5">
            {user?.role === 'client' && (
              <button
                onClick={handleAssignToOrganization}
                disabled={isAssigning || workspace?.assignedToOrganization}
                className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${workspace?.assignedToOrganization
                  ? 'bg-green-500/10 text-green-400 cursor-default'
                  : 'text-gray-400 hover:text-white hover:bg-[#30363d]'
                  }`}
              >
                {isAssigning ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : workspace?.assignedToOrganization ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Building className="w-4 h-4" />
                )}
                {workspace?.assignedToOrganization ? 'Assigned' : 'Assign to organization'}
              </button>
            )}

            <button
              onClick={() => setActiveView('code')}
              className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${activeView === 'code' ? 'bg-[#30363d] text-white' : 'text-gray-400 hover:text-white'
                }`}
            >
              <Code className="w-4 h-4" />
              Code
            </button>
            <button
              onClick={() => setActiveView('preview')}
              className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${activeView === 'preview' ? 'bg-[#30363d] text-white' : 'text-gray-400 hover:text-white'
                }`}
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>
          </div>

          <div className="w-px h-6 bg-[#30363d] mx-2" />

          <button
            onClick={handleStartServer}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm flex items-center gap-2 transition-colors"
          >
            <Play className="w-4 h-4" />
            Run
          </button>
          <button
            onClick={handleStopServer}
            className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 rounded-lg text-sm flex items-center gap-2 transition-colors"
          >
            <Square className="w-4 h-4" />
            Stop
          </button>
          <button
            onClick={handleRefreshPreview}
            className="px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] rounded-lg text-sm flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - File Tree */}
        <aside className="w-64 bg-[#0d1117] border-r border-[#30363d] flex flex-col">
          <div className="p-3 border-b border-[#30363d] flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">Explorer</span>
          </div>
          <div className="flex-1 overflow-auto">
            <FileTree
              files={files}
              activeFile={activeFile}
              onFileSelect={setActiveFile}
            />
          </div>
        </aside>

        {/* Main Editor/Preview Area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Tab Bar */}
          {activeView === 'code' && (
            <div className="h-10 bg-[#161b22] border-b border-[#30363d] flex items-center px-2">
              {activeFile ? (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d1117] rounded-t-lg border border-b-0 border-[#30363d] text-sm">
                  <FileCode className="w-4 h-4 text-blue-400" />
                  <span>{activeFile.split('/').pop()}</span>
                  {hasUnsavedChanges && (
                    <span className="w-2 h-2 rounded-full bg-orange-400" title="Unsaved changes" />
                  )}
                  {isSaving && (
                    <RefreshCw className="w-3 h-3 animate-spin text-gray-400" />
                  )}
                </div>
              ) : (
                <span className="text-sm text-gray-500 px-3">Select a file to edit</span>
              )}
            </div>
          )}

          {/* Preview Header */}
          {activeView === 'preview' && (
            <div className="h-10 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-4">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Eye className="w-4 h-4" />
                <span>Live Preview</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  {workspace?.previewUrl || 'http://localhost:3000'}
                </span>
                <button
                  onClick={handleRefreshPreview}
                  className="p-1.5 hover:bg-[#30363d] rounded transition-colors"
                  title="Refresh Preview"
                >
                  <RefreshCw className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className={`flex-1 ${showTerminal ? '' : 'h-full'}`}>
              {activeView === 'code' ? (
                activeFile ? (
                  fileLoading ? (
                    <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
                      <div className="text-center">
                        <RefreshCw className="w-8 h-8 mx-auto mb-3 text-blue-500 animate-spin" />
                        <p className="text-sm text-gray-400">Loading file...</p>
                      </div>
                    </div>
                  ) : (
                    <Editor
                      value={fileContent}
                      language={getLanguage(activeFile)}
                      onChange={setFileContent}
                      onSave={handleSaveFile}
                    />
                  )
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <Code className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                      <p className="text-lg mb-2">No file selected</p>
                      <p className="text-sm text-gray-600">Select a file from the explorer to start editing</p>
                    </div>
                  </div>
                )
              ) : (
                <Preview key={previewKey} url={workspace?.previewUrl || ''} />
              )}
            </div>

            {/* Terminal Panel (Below Editor) */}
            {showTerminal && (
              <div
                className="border-t border-[#30363d] bg-[#0d1117]"
                style={{ height: terminalHeight }}
              >
                <div className="h-8 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-3">
                  <div className="flex items-center gap-2">
                    <TerminalIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-300">Terminal</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTerminalHeight(terminalHeight === 200 ? 400 : 200)}
                      className="p-1 hover:bg-[#30363d] rounded transition-colors"
                    >
                      {terminalHeight > 200 ? (
                        <Minimize2 className="w-4 h-4 text-gray-400" />
                      ) : (
                        <Maximize2 className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                    <button
                      onClick={() => setShowTerminal(false)}
                      className="p-1 hover:bg-[#30363d] rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                </div>
                <div style={{ height: terminalHeight - 32 }}>
                  <Terminal workspaceId={id as string} />
                </div>
              </div>
            )}
          </div>

          {/* Bottom Bar */}
          <div className="h-8 bg-[#161b22] border-t border-[#30363d] flex items-center justify-between px-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowTerminal(!showTerminal)}
                className={`flex items-center gap-1.5 text-xs transition-colors ${showTerminal ? 'text-blue-400' : 'text-gray-400 hover:text-gray-300'
                  }`}
              >
                {showTerminal ? <PanelBottomClose className="w-4 h-4" /> : <PanelBottom className="w-4 h-4" />}
                Terminal
              </button>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              {activeFile && (
                <>
                  <span>{getLanguage(activeFile).toUpperCase()}</span>
                  <span>UTF-8</span>
                </>
              )}
            </div>
          </div>
        </main>

        {/* AI Chat Panel */}
        <aside className="w-80 bg-[#0d1117] border-l border-[#30363d] flex flex-col">
          {/* Header */}
          <div className="p-3 border-b border-[#30363d] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className={`w-4 h-4 ${agentStatus === 'running' ? 'animate-pulse text-blue-400' : 'text-purple-400'}`} />
              <span className="text-sm font-medium">AI Assistant</span>
            </div>
            {agentStatus === 'running' && (
              <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Working
              </span>
            )}
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-auto p-3 space-y-3">
            {chatMessages.length === 0 ? (
              <div className="text-center text-gray-500 text-sm p-4">
                <Bot className="w-10 h-10 mx-auto mb-3 text-gray-600" />
                <p className="mb-1">AI Coding Assistant</p>
                <p className="text-xs text-gray-600">Ask me to modify your project</p>
              </div>
            ) : (
              chatMessages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-blue-600' : 'bg-[#21262d]'
                    }`}>
                    {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>

                  <div className={`max-w-[85%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`rounded-lg px-3 py-2 text-sm ${msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.type === 'error'
                        ? 'bg-red-500/10 text-red-300 border border-red-500/20'
                        : msg.type === 'success'
                          ? 'bg-green-500/10 text-green-300 border border-green-500/20'
                          : msg.type === 'files'
                            ? 'bg-[#161b22] border border-[#30363d]'
                            : msg.type === 'files_updated'
                              ? 'bg-[#161b22] border border-blue-500/30'
                              : msg.type === 'command'
                                ? 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20'
                                : 'bg-[#21262d]'
                      }`}>
                      {msg.type === 'files' && (
                        <div>
                          <div className="flex items-center gap-2 mb-2 text-green-400 text-xs font-medium">
                            <FileCode className="w-3.5 h-3.5" />
                            Files Created
                          </div>
                          <div className="space-y-0.5">
                            {msg.content.split('\n').map((file, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 text-xs text-gray-300 font-mono">
                                <span className="text-green-400">✓</span>
                                <span>{file.replace('/workspace', '')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {msg.type === 'files_updated' && (
                        <div>
                          <div className="flex items-center gap-2 mb-2 text-blue-400 text-xs font-medium">
                            <FileCode className="w-3.5 h-3.5" />
                            Files Updated
                          </div>
                          <div className="space-y-0.5">
                            {msg.content.split('\n').map((file, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 text-xs text-gray-300 font-mono">
                                <span className="text-blue-400">✎</span>
                                <span>{file.replace('/workspace', '')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {msg.type === 'command' && (
                        <div className="flex items-center gap-2">
                          <Command className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="font-mono text-xs">$ {msg.content}</span>
                        </div>
                      )}
                      {(msg.type === 'text' || msg.type === 'error' || msg.type === 'success' || !msg.type) && (
                        <span className="whitespace-pre-wrap text-[13px]">{msg.content}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-600 mt-1 px-1">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}

            {agentStatus === 'running' && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-[#21262d] flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="bg-[#21262d] rounded-lg px-3 py-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-[#30363d]">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendPrompt()}
                placeholder={agentStatus === 'running' ? 'AI is working...' : 'Ask AI...'}
                disabled={agentStatus === 'running'}
                className="flex-1 bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
              <button
                onClick={handleSendPrompt}
                disabled={!chatInput.trim() || agentStatus === 'running'}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    html: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql',
  };
  return langMap[ext || ''] || 'plaintext';
}
