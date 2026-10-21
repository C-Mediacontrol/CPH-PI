import React, { useState, useMemo } from 'react';
import {
  GitCompare,
  Copy,
  Check,
  FileCode,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import type { DiffFile, DiffHunk } from '../../types/protocol';
import css from './DiffViewer.module.css';

export function DiffViewer(): React.JSX.Element {
  const { diffFiles, activeDiffFileId, setActiveDiffFile } = useAppStore();
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [copied, setCopied] = useState<boolean>(false);

  const activeFile: DiffFile | undefined = useMemo(() => {
    if (!diffFiles || diffFiles.length === 0) return undefined;
    return diffFiles.find((f) => f.id === activeDiffFileId) || diffFiles[0];
  }, [diffFiles, activeDiffFileId]);

  const copyPatch = () => {
    if (!activeFile) return;
    let patchText = `--- a/${activeFile.filename}\n+++ b/${activeFile.filename}\n`;
    for (const hunk of activeFile.hunks) {
      patchText += `${hunk.header}\n`;
      for (const line of hunk.lines) {
        const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
        patchText += `${prefix}${line.content}\n`;
      }
    }
    navigator.clipboard?.writeText(patchText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={css.container}>
      <div className={css.header}>
        <div className={css.titleArea}>
          <span className={css.titleIcon}>
            <GitCompare size={15} />
          </span>
          <span className={css.title}>代码差异审查</span>
        </div>

        <div className={css.controlsArea}>
          <div className={css.modeToggle}>
            <button
              className={css.modeBtn}
              data-active={viewMode === 'unified'}
              onClick={() => setViewMode('unified')}
              type="button"
            >
              合并视图
            </button>
            <button
              className={css.modeBtn}
              data-active={viewMode === 'split'}
              onClick={() => setViewMode('split')}
              type="button"
            >
              分屏对比
            </button>
          </div>

          <button
            className={css.actionBtn}
            onClick={copyPatch}
            title="复制 Patch 补丁"
            type="button"
          >
            {copied ? <Check size={13} color="var(--dsw-static-green-500)" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {diffFiles && diffFiles.length > 0 && (
        <div className={css.fileSelectBar}>
          {diffFiles.map((file) => {
            const isActive = file.id === (activeFile?.id || '');
            return (
              <button
                key={file.id}
                className={css.fileChip}
                data-active={isActive}
                onClick={() => setActiveDiffFile(file.id)}
                type="button"
              >
                <FileCode size={12} />
                <span>{file.filename}</span>
                <span className={css.fileStats}>
                  <span className={css.statAdd}>+{file.additions}</span>
                  <span className={css.statDel}>-{file.deletions}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className={css.diffContent}>
        {!activeFile || activeFile.hunks.length === 0 ? (
          <div className={css.emptyState}>
            <GitCompare size={36} style={{ opacity: 0.3 }} />
            <span>暂无代码变更差异</span>
          </div>
        ) : viewMode === 'unified' ? (
          <div>
            {activeFile.hunks.map((hunk: DiffHunk, hIdx: number) => (
              <div key={hIdx}>
                <div className={css.hunkHeader}>{hunk.header}</div>
                {hunk.lines.map((line, lIdx) => {
                  const rowClass =
                    line.type === 'add'
                      ? css.rowAdd
                      : line.type === 'delete'
                      ? css.rowDelete
                      : css.rowContext;
                  const marker = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';

                  return (
                    <div key={lIdx} className={`${css.diffRow} ${rowClass}`}>
                      <span className={css.lineNum}>{line.oldLineNumber ?? ''}</span>
                      <span className={css.lineNum}>{line.newLineNumber ?? ''}</span>
                      <span className={css.marker}>{marker}</span>
                      <span className={css.lineText}>{line.content}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          /* Split View */
          <div className={css.splitContainer}>
            {/* Left: Old side */}
            <div className={css.splitPane}>
              {activeFile.hunks.map((hunk: DiffHunk, hIdx: number) => (
                <div key={hIdx}>
                  <div className={css.hunkHeader}>{hunk.header}</div>
                  {hunk.lines.map((line, lIdx) => {
                    if (line.type === 'add') {
                      return (
                        <div key={lIdx} className={css.diffRow} style={{ opacity: 0.25 }}>
                          <span className={css.lineNum}></span>
                          <span className={css.marker}></span>
                          <span className={css.lineText}></span>
                        </div>
                      );
                    }
                    const rowClass = line.type === 'delete' ? css.rowDelete : css.rowContext;
                    return (
                      <div key={lIdx} className={`${css.diffRow} ${rowClass}`}>
                        <span className={css.lineNum}>{line.oldLineNumber ?? ''}</span>
                        <span className={css.marker}>{line.type === 'delete' ? '-' : ' '}</span>
                        <span className={css.lineText}>{line.content}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Right: New side */}
            <div className={css.splitPane}>
              {activeFile.hunks.map((hunk: DiffHunk, hIdx: number) => (
                <div key={hIdx}>
                  <div className={css.hunkHeader}>{hunk.header}</div>
                  {hunk.lines.map((line, lIdx) => {
                    if (line.type === 'delete') {
                      return (
                        <div key={lIdx} className={css.diffRow} style={{ opacity: 0.25 }}>
                          <span className={css.lineNum}></span>
                          <span className={css.marker}></span>
                          <span className={css.lineText}></span>
                        </div>
                      );
                    }
                    const rowClass = line.type === 'add' ? css.rowAdd : css.rowContext;
                    return (
                      <div key={lIdx} className={`${css.diffRow} ${rowClass}`}>
                        <span className={css.lineNum}>{line.newLineNumber ?? ''}</span>
                        <span className={css.marker}>{line.type === 'add' ? '+' : ' '}</span>
                        <span className={css.lineText}>{line.content}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DiffViewer;
