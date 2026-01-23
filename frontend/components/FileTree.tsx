import { useState, useMemo } from 'react';
import {
  File,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileCode,
  FileJson,
  FileType,
  Image,
  FileText,
  Settings
} from 'lucide-react';

interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onFileSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: Map<string, TreeNode>;
}

export default function FileTree({ files, activeFile, onFileSelect }: FileTreeProps) {
  // Ensure files is always a valid array
  const safeFiles = Array.isArray(files) ? files : [];
  const tree = useMemo(() => buildTree(safeFiles), [safeFiles]);

  if (safeFiles.length === 0) {
    return (
      <div className="text-sm text-gray-500 p-4 text-center">
        <Folder className="w-8 h-8 mx-auto mb-2 text-gray-600" />
        <p>No files yet</p>
        <p className="text-xs text-gray-600 mt-1">AI is generating code...</p>
      </div>
    );
  }

  return (
    <div className="text-sm select-none">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
          depth={0}
        />
      ))}
    </div>
  );
}

interface TreeItemProps {
  node: TreeNode;
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  depth: number;
}

function TreeItem({ node, activeFile, onFileSelect, depth }: TreeItemProps) {
  // Auto-expand first 2 levels
  const [isOpen, setIsOpen] = useState(depth < 2);
  const isActive = node.path === activeFile;
  const isDirectory = node.type === 'directory';
  const children = Array.from(node.children.values());

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDirectory) {
      setIsOpen(!isOpen);
    } else {
      onFileSelect(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        className={`
          flex items-center gap-1.5 py-1 px-2 cursor-pointer
          transition-colors duration-150 rounded-sm mx-1
          ${isActive
            ? 'bg-blue-600/30 text-white'
            : 'hover:bg-gray-700/50 text-gray-300 hover:text-white'
          }
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDirectory ? (
          <>
            <span className="flex-shrink-0 transition-transform duration-150">
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
            </span>
            <span className="flex-shrink-0">
              {isOpen ? (
                <FolderOpen className="w-4 h-4 text-yellow-400" />
              ) : (
                <Folder className="w-4 h-4 text-yellow-400" />
              )}
            </span>
          </>
        ) : (
          <>
            <span className="w-4 flex-shrink-0" />
            <FileIcon filename={node.name} />
          </>
        )}
        <span className="truncate text-[13px]">{node.name}</span>
        {isDirectory && children.length > 0 && (
          <span className="text-[10px] text-gray-500 ml-auto">
            {children.length}
          </span>
        )}
      </div>

      {isDirectory && isOpen && children.length > 0 && (
        <div className="relative">
          {/* Tree line indicator */}
          <div
            className="absolute left-0 top-0 bottom-0 border-l border-gray-700"
            style={{ marginLeft: `${depth * 16 + 20}px` }}
          />
          {sortNodes(children).map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              activeFile={activeFile}
              onFileSelect={onFileSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const name = filename.toLowerCase();

  // Special files
  if (name === 'package.json') {
    return <FileJson className="w-4 h-4 text-green-400" />;
  }
  if (name === 'vite.config.js' || name === 'vite.config.ts') {
    return <Settings className="w-4 h-4 text-purple-400" />;
  }
  if (name === 'tsconfig.json') {
    return <FileJson className="w-4 h-4 text-blue-400" />;
  }

  switch (ext) {
    case 'js':
      return <FileCode className="w-4 h-4 text-yellow-400" />;
    case 'jsx':
      return <FileCode className="w-4 h-4 text-cyan-400" />;
    case 'ts':
      return <FileCode className="w-4 h-4 text-blue-500" />;
    case 'tsx':
      return <FileCode className="w-4 h-4 text-blue-400" />;
    case 'html':
      return <FileCode className="w-4 h-4 text-orange-500" />;
    case 'css':
      return <FileCode className="w-4 h-4 text-blue-300" />;
    case 'scss':
    case 'sass':
      return <FileCode className="w-4 h-4 text-pink-400" />;
    case 'json':
      return <FileJson className="w-4 h-4 text-yellow-300" />;
    case 'md':
    case 'mdx':
      return <FileText className="w-4 h-4 text-gray-400" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return <Image className="w-4 h-4 text-purple-400" />;
    case 'txt':
      return <FileText className="w-4 h-4 text-gray-400" />;
    default:
      return <File className="w-4 h-4 text-gray-400" />;
  }
}

// Files and folders to hide from the explorer
const HIDDEN_PATTERNS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.cache',
  '.npm',
  '.yarn',
  'dist',
  'build',
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.local',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

function shouldHide(name: string): boolean {
  return HIDDEN_PATTERNS.has(name);
}

function buildTree(paths: string[]): TreeNode[] {
  // Ensure paths is a valid array
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return [];
  }

  const root = new Map<string, TreeNode>();

  for (const fullPath of paths) {
    if (!fullPath || typeof fullPath !== 'string') continue;

    // Remove /workspace prefix and split into parts
    const relativePath = fullPath.replace(/^\/workspace\/?/, '');
    if (!relativePath) continue;

    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    // Skip hidden files/folders
    if (parts.some(part => shouldHide(part))) continue;

    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLastPart = i === parts.length - 1;
      const currentPath = '/workspace/' + parts.slice(0, i + 1).join('/');

      // Determine if this is a file or directory
      // It's a file if it's the last part AND the original path doesn't end with /
      const isFile = isLastPart && !fullPath.endsWith('/');

      if (!currentLevel.has(part)) {
        currentLevel.set(part, {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          children: new Map(),
        });
      } else if (!isFile && currentLevel.get(part)!.type === 'file') {
        // If we previously thought this was a file but now we're adding children,
        // convert it to a directory
        currentLevel.get(part)!.type = 'directory';
      }

      if (!isFile) {
        currentLevel = currentLevel.get(part)!.children;
      }
    }
  }

  return sortNodes(Array.from(root.values()));
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    // Directories first
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    // Then alphabetically
    return a.name.localeCompare(b.name);
  });
}
