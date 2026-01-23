import { useRef, useCallback } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';

interface EditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onSave?: (value: string) => void;
}

export default function Editor({ value, language, onChange, onSave }: EditorProps) {
  const editorRef = useRef<any>(null);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Add keyboard shortcut for save (Ctrl/Cmd + S)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const currentValue = editor.getValue();
      onSave?.(currentValue);
    });

    // Configure editor theme
    monaco.editor.defineTheme('estro-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editor.lineHighlightBackground': '#2a2d2e',
        'editor.selectionBackground': '#264f78',
        'editorCursor.foreground': '#aeafad',
        'editorWhitespace.foreground': '#404040',
      },
    });

    monaco.editor.setTheme('estro-dark');
  };

  const handleChange = useCallback((value: string | undefined) => {
    onChange(value || '');
  }, [onChange]);

  return (
    <div className="h-full w-full">
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        onChange={handleChange}
        onMount={handleEditorMount}
        theme="vs-dark"
        options={{
          fontSize: 14,
          fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace",
          fontLigatures: true,
          minimap: { enabled: true, maxColumn: 80 },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          suggest: {
            showKeywords: true,
            showSnippets: true,
          },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
        }}
      />
    </div>
  );
}
