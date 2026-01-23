import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

interface TerminalProps {
  workspaceId: string;
}

export default function Terminal({ workspaceId }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<Array<{ type: 'input' | 'output' | 'error'; content: string }>>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    // Scroll to bottom when history changes
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [history]);

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && currentInput.trim() && !isExecuting) {
      const command = currentInput.trim();
      setCurrentInput('');
      setHistory(prev => [...prev, { type: 'input', content: `$ ${command}` }]);
      setIsExecuting(true);

      try {
        const result = await api.executeCommand(workspaceId, command);

        if (result.output) {
          setHistory(prev => [...prev, { type: 'output', content: result.output }]);
        }
        if (result.error) {
          setHistory(prev => [...prev, { type: 'error', content: result.error }]);
        }
      } catch (error: any) {
        setHistory(prev => [...prev, { type: 'error', content: error.message || 'Command failed' }]);
      }

      setIsExecuting(false);
    }
  };

  const handleTerminalClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      ref={terminalRef}
      className="h-full bg-black text-green-400 font-mono text-sm p-4 overflow-auto cursor-text"
      onClick={handleTerminalClick}
    >
      {/* Welcome message */}
      <div className="text-gray-500 mb-2">
        Estro AI Terminal - Type commands to interact with your workspace
      </div>

      {/* History */}
      {history.map((entry, i) => (
        <div
          key={i}
          className={`whitespace-pre-wrap mb-1 ${
            entry.type === 'input'
              ? 'text-white'
              : entry.type === 'error'
              ? 'text-red-400'
              : 'text-green-400'
          }`}
        >
          {entry.content}
        </div>
      ))}

      {/* Current input line */}
      <div className="flex items-center">
        <span className="text-white mr-2">$</span>
        <input
          ref={inputRef}
          type="text"
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isExecuting}
          className="flex-1 bg-transparent text-white outline-none border-none"
          autoFocus
        />
        {isExecuting && (
          <span className="text-yellow-400 ml-2 animate-pulse">Running...</span>
        )}
      </div>
    </div>
  );
}
