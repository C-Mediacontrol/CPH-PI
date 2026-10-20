import React, { useState, useMemo } from "react";
import {
  buildWorkspaceTree,
  type WorkspaceTreeNode,
  type FileNodeStatus,
} from "../../utils/panelHelpers.ts";
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  File,
  ChevronRight,
  ChevronDown,
  Search,
  Maximize2,
  Minimize2,
  FileCheck,
  FileEdit,
} from "lucide-react";

export interface WorkspaceTreeProps {
  files?: string[];
  treeNodes?: WorkspaceTreeNode[];
  modifiedFiles?: string[];
  readFiles?: string[];
  selectedFile?: string | null;
  onSelectFile?: (path: string) => void;
  className?: string;
}

export function WorkspaceTree({
  files = [],
  treeNodes: explicitTreeNodes,
  modifiedFiles = [],
  readFiles = [],
  selectedFile,
  onSelectFile,
  className = "",
}: WorkspaceTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    // Default expand all top-level directories
    const initial = new Set<string>();
    for (const f of files) {
      const parts = f.split(/[\/\\]/);
      if (parts.length > 1) {
        initial.add(parts[0]);
      }
    }
    return initial;
  });

  // Generate tree
  const fullTree = useMemo(() => {
    if (explicitTreeNodes && explicitTreeNodes.length > 0) {
      return explicitTreeNodes;
    }
    return buildWorkspaceTree(files, {
      modifiedPaths: modifiedFiles,
      readPaths: readFiles,
    });
  }, [files, explicitTreeNodes, modifiedFiles, readFiles]);

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allDirs = new Set<string>();
    const collect = (nodes: WorkspaceTreeNode[]) => {
      for (const n of nodes) {
        if (n.isDirectory) {
          allDirs.add(n.path);
          if (n.children) collect(n.children);
        }
      }
    };
    collect(fullTree);
    setExpandedPaths(allDirs);
  };

  const collapseAll = () => {
    setExpandedPaths(new Set());
  };

  const getFileIcon = (fileName: string, status?: FileNodeStatus) => {
    if (status === "modified") {
      return <FileEdit className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    if (status === "read") {
      return <FileCheck className="w-3.5 h-3.5 text-deepseek-400 shrink-0" />;
    }
    if (/\.(ts|tsx|js|jsx|json)$/i.test(fileName)) {
      return <FileCode className="w-3.5 h-3.5 text-neutral-400 shrink-0" />;
    }
    if (/\.(md|txt|log)$/i.test(fileName)) {
      return <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />;
    }
    return <File className="w-3.5 h-3.5 text-neutral-400 shrink-0" />;
  };

  // Render a node recursively
  const renderNode = (node: WorkspaceTreeNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedFile === node.path;
    const paddingLeft = `${depth * 14 + 8}px`;

    // Filter check for search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchesSelf = node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
      const matchesChild = (n: WorkspaceTreeNode): boolean =>
        (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) ||
        (n.children ? n.children.some(matchesChild) : false);

      if (!matchesSelf && !matchesChild(node)) {
        return null;
      }
    }

    if (node.isDirectory) {
      return (
        <div key={node.path} className="select-none">
          <div
            onClick={() => toggleExpand(node.path)}
            style={{ paddingLeft }}
            className="flex items-center gap-1.5 py-1 px-2 rounded hover:bg-[#1b1b1c] text-neutral-300 hover:text-white cursor-pointer text-xs group transition"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-deepseek-400" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-deepseek-400/80" />
            )}
            <span className="font-mono truncate">{node.name}</span>
            {node.status === "modified" && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-auto" title="Contains modified files" />
            )}
            {node.status === "read" && (
              <span className="w-1.5 h-1.5 rounded-full bg-deepseek-400 ml-auto" title="Contains read files" />
            )}
          </div>
          {isExpanded && node.children && (
            <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      );
    }

    // File Node
    return (
      <div
        key={node.path}
        onClick={() => onSelectFile?.(node.path)}
        style={{ paddingLeft }}
        className={`flex items-center justify-between py-1 px-2 rounded cursor-pointer text-xs transition font-mono ${
          isSelected
            ? "bg-deepseek-500/20 border border-deepseek-500/50 text-deepseek-300"
            : "hover:bg-[#1b1b1c] text-neutral-300 hover:text-white"
        }`}
        title={node.path}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {getFileIcon(node.name, node.status)}
          <span className="truncate">{node.name}</span>
        </div>

        {/* Status Tag */}
        {node.status === "modified" && (
          <span className="text-[9px] font-bold px-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/70 shrink-0">
            MODIFIED
          </span>
        )}
        {node.status === "read" && (
          <span className="text-[9px] font-bold px-1 rounded bg-deepseek-500/20 text-deepseek-400 border border-deepseek-500/40 shrink-0">
            READ
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full text-neutral-300 ${className}`}>
      {/* Search and Tree Controls */}
      <div className="p-2 border-b border-[#2c2c2e] flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full bg-[#1b1b1c] border border-[#2c2c2e] rounded-lg pl-7 pr-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-deepseek-500 font-mono"
          />
        </div>
        <button
          onClick={expandAll}
          title="Expand All"
          className="p-1 rounded hover:bg-[#232326] text-neutral-400 hover:text-neutral-200"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={collapseAll}
          title="Collapse All"
          className="p-1 rounded hover:bg-[#232326] text-neutral-400 hover:text-neutral-200"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {fullTree.length === 0 ? (
          <div className="py-8 text-center text-neutral-500 text-xs">
            No files in workspace
          </div>
        ) : (
          fullTree.map((node) => renderNode(node, 0))
        )}
      </div>

      {/* Footer Summary */}
      <div className="px-3 py-1.5 border-t border-[#2c2c2e] bg-[#151517] text-[10px] text-neutral-500 flex items-center justify-between font-mono font-tabular">
        <span>Files: {files.length}</span>
        <div className="flex items-center gap-2">
          {modifiedFiles.length > 0 && (
            <span className="text-emerald-400">{modifiedFiles.length} modified</span>
          )}
          {readFiles.length > 0 && (
            <span className="text-deepseek-400">{readFiles.length} read</span>
          )}
        </div>
      </div>
    </div>
  );
}
export default WorkspaceTree;
