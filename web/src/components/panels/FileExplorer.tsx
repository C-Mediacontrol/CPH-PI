import React, { useState, useMemo } from 'react';
import {
  Files,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  File,
  ChevronRight,
  Search,
  Copy,
  Check,
  Cloud,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import type { WorkspaceFile } from '../../types/protocol';
import css from './FileExplorer.module.css';

interface TreeNodeProps {
  node: WorkspaceFile;
  level: number;
  expandedFolders: Set<string>;
  toggleFolder: (id: string) => void;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  filterText: string;
}

function TreeNode({
  node,
  level,
  expandedFolders,
  toggleFolder,
  selectedFilePath,
  onSelectFile,
  filterText,
}: TreeNodeProps): React.JSX.Element | null {
  const isDirectory = node.type === 'directory';
  const isExpanded = expandedFolders.has(node.id);
  const isSelected = selectedFilePath === node.path;

  // Search filter
  const matchesFilter = (n: WorkspaceFile): boolean => {
    if (!filterText) return true;
    if (n.name.toLowerCase().includes(filterText.toLowerCase())) return true;
    if (n.children && n.children.some(matchesFilter)) return true;
    return false;
  };

  if (filterText && !matchesFilter(node)) {
    return null;
  }

  const getFileIcon = (name: string) => {
    if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js') || name.endsWith('.jsx')) {
      return <FileCode size={13} />;
    }
    if (name.endsWith('.json') || name.endsWith('.md') || name.endsWith('.css')) {
      return <FileText size={13} />;
    }
    return <File size={13} />;
  };

  const getStatusLetter = (status?: string) => {
    switch (status) {
      case 'modified':
        return 'M';
      case 'added':
        return 'A';
      case 'deleted':
        return 'D';
      case 'untracked':
        return 'U';
      default:
        return null;
    }
  };

  const statusLetter = getStatusLetter(node.status);

  return (
    <>
      <div
        className={css.nodeRow}
        data-selected={isSelected}
        style={{ paddingLeft: `${8 + level * 14}px` }}
        onClick={() => {
          if (isDirectory) {
            toggleFolder(node.id);
          } else {
            onSelectFile(node.path);
          }
        }}
      >
        {isDirectory ? (
          <span className={css.chevron} data-expanded={isExpanded}>
            <ChevronRight size={12} />
          </span>
        ) : (
          <span style={{ width: 12 }} />
        )}

        <span className={css.nodeIcon}>
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen size={13} color="var(--dsw-static-deepseek-400)" />
            ) : (
              <Folder size={13} />
            )
          ) : (
            getFileIcon(node.name)
          )}
        </span>

        <span className={css.nodeName} title={node.path}>
          {node.name}
        </span>

        {statusLetter && (
          <span className={css.statusIndicator} data-status={node.status} title={node.status}>
            {statusLetter}
          </span>
        )}
      </div>

      {isDirectory && isExpanded && node.children && (
        <>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
              filterText={filterText}
            />
          ))}
        </>
      )}
    </>
  );
}

export function FileExplorer(): React.JSX.Element {
  const {
    workspaceFiles,
    selectedFilePath,
    setSelectedFilePath,
    workspaceRoot,
    cloudWorkspace,
    cloudSyncing,
    syncCloudWorkspace,
    setWorkspaceModalOpen,
  } = useAppStore();
  const [filterText, setFilterText] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(['f-src', 'f-agent', 'f-session', 'f-ledger-dir', 'f-web', 'f-web-src', 'f-panels'])
  );
  const [copiedPath, setCopiedPath] = useState(false);

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyPath = () => {
    if (!selectedFilePath) return;
    navigator.clipboard?.writeText(selectedFilePath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1500);
  };

  // Calculate git status counts
  const statusCounts = useMemo(() => {
    let modified = 0;
    let added = 0;
    let deleted = 0;

    const traverse = (items: WorkspaceFile[]) => {
      for (const item of items) {
        if (item.status === 'modified') modified++;
        if (item.status === 'added') added++;
        if (item.status === 'deleted') deleted++;
        if (item.children) traverse(item.children);
      }
    };

    traverse(workspaceFiles);
    return { modified, added, deleted };
  }, [workspaceFiles]);

  return (
    <div className={css.container}>
      <div className={css.header}>
        <div className={css.titleRow}>
          <div className={css.titleArea}>
            <span className={css.titleIcon}>
              <Files size={15} />
            </span>
            <span className={css.title}>工作区文件</span>
          </div>

          <div className={css.gitSummary}>
            {statusCounts.modified > 0 && <span className={css.badgeM}>{statusCounts.modified} M</span>}
            {statusCounts.added > 0 && <span className={css.badgeA}>{statusCounts.added} A</span>}
            {statusCounts.deleted > 0 && <span className={css.badgeD}>{statusCounts.deleted} D</span>}
          </div>
        </div>

        {/* 当前工作区路径指示与切换按钮 */}
        {workspaceRoot && (
          <div
            className={css.workspaceBadge}
            onClick={() => setWorkspaceModalOpen(true)}
            title="点击切换工作区目录"
          >
            <Folder size={12} color="var(--dsw-static-deepseek-500, #4176e6)" />
            <span>{workspaceRoot}</span>
          </div>
        )}

        {/* SharePoint 云端镜像状态与同步 */}
        {cloudWorkspace ? (
          <div className={css.cloudRow}>
            <div
              className={css.cloudBadge}
              title={`SharePoint 云端镜像: ${cloudWorkspace.targetFolder}\n站点: ${cloudWorkspace.siteUrl}\n点击配置`}
              onClick={() => setWorkspaceModalOpen(true)}
            >
              <Cloud size={12} className={css.cloudIcon} />
              <span className={css.cloudFolderText}>{cloudWorkspace.targetFolder}</span>
            </div>
            <div className={css.cloudSyncArea}>
              {cloudWorkspace.lastSyncedAt && (
                <span
                  className={css.lastSyncedText}
                  title={`最后对账时间: ${new Date(cloudWorkspace.lastSyncedAt).toLocaleString()}`}
                >
                  上次同步: {new Date(cloudWorkspace.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button
                className={css.syncBtn}
                onClick={syncCloudWorkspace}
                disabled={cloudSyncing}
                type="button"
                title="立即发起 SharePoint 云端增量对账同步"
              >
                <RefreshCw size={11} className={cloudSyncing ? css.spinning : undefined} />
                <span>{cloudSyncing ? '正在对账同步...' : '立即同步'}</span>
              </button>
            </div>
          </div>
        ) : workspaceRoot ? (
          <div
            className={css.cloudUnlinkedBadge}
            onClick={() => setWorkspaceModalOpen(true)}
            title="点击配置 SharePoint 云端工作区镜像"
          >
            <Cloud size={12} />
            <span>☁️ 未关联云端镜像 (点击配置)</span>
          </div>
        ) : null}

        <div className={css.searchBar}>
          <Search size={12} style={{ position: 'absolute', left: 8, color: 'var(--dsw-alias-label-caption)' }} />
          <input
            type="text"
            className={css.searchInput}
            placeholder="搜索工作区文件..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
      </div>

      <div className={css.treeContainer}>
        {workspaceFiles.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--dsw-alias-label-caption)', fontSize: 12 }}>
            暂无文件或工作区为空
          </div>
        ) : (
          workspaceFiles.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              level={0}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              selectedFilePath={selectedFilePath}
              onSelectFile={setSelectedFilePath}
              filterText={filterText}
            />
          ))
        )}
      </div>

      {selectedFilePath && (
        <div className={css.footer}>
          <span className={css.selectedPath} title={selectedFilePath}>
            {selectedFilePath}
          </span>
          <button
            className={css.copyBtn}
            onClick={copyPath}
            title="复制文件路径"
            type="button"
          >
            {copiedPath ? <Check size={12} color="var(--dsw-static-green-500)" /> : <Copy size={12} />}
          </button>
        </div>
      )}
    </div>
  );
}

export default FileExplorer;
