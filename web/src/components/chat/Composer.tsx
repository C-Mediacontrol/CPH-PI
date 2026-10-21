import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowUp, Square, Paperclip, X, FileText, Sparkles, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../services/store';
import { wsClient } from '../../services/client-ws';
import css from './Composer.module.css';

interface StagedAttachment {
  name: string;
  path: string;
  size?: number;
}

export function Composer(): React.JSX.Element {
  const {
    running,
    submitPrompt,
    interrupt,
    availableSkills,
    workspaceRoot,
    setWorkspaceModalOpen,
  } = useAppStore();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if text is currently typing a slash command (allowing optional leading spaces)
  const trimmedLeft = text.trimStart();
  const isTypingSlash = trimmedLeft.startsWith('/') && !trimmedLeft.includes(' ') && !trimmedLeft.includes('\n');
  const slashQuery = isTypingSlash ? trimmedLeft.slice(1).toLowerCase() : '';

  // Proactively request skills list if typing slash and skills not loaded yet
  useEffect(() => {
    if (isTypingSlash && (!availableSkills || availableSkills.length === 0)) {
      wsClient.send('skills:list');
    }
  }, [isTypingSlash, availableSkills]);

  useEffect(() => {
    setSlashDismissed(false);
    setSelectedSkillIndex(0);
  }, [slashQuery]);

  const matchingSkills = useMemo(() => {
    if (!isTypingSlash || slashDismissed) return [];
    if (!availableSkills || availableSkills.length === 0) return [];

    const list = availableSkills.filter((s) => {
      if (!slashQuery) return true;
      return (
        s.name.toLowerCase().includes(slashQuery) ||
        (s.description && s.description.toLowerCase().includes(slashQuery))
      );
    });

    list.sort((a, b) => {
      if (!slashQuery) {
        // Built-in mounted skills first, then alphabetical
        if (a.isAgentMounted && !b.isAgentMounted) return -1;
        if (!a.isAgentMounted && b.isAgentMounted) return 1;
        return a.name.localeCompare(b.name);
      }
      const aStarts = a.name.toLowerCase().startsWith(slashQuery);
      const bStarts = b.name.toLowerCase().startsWith(slashQuery);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.localeCompare(b.name);
    });

    return list.slice(0, 8);
  }, [isTypingSlash, slashDismissed, availableSkills, slashQuery]);

  const selectSkill = (skillName: string) => {
    setText(`/${skillName} `);
    setSlashDismissed(true);
    setSelectedSkillIndex(0);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // 自动根据文本内容调整高度
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, 220);
    el.style.height = `${Math.max(24, nextHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) {
      return;
    }
    if (running) {
      return;
    }

    submitPrompt(trimmed, attachments.length > 0 ? attachments : undefined);
    setText('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (matchingSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSkillIndex((prev) => (prev + 1) % matchingSkills.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSkillIndex((prev) => (prev - 1 + matchingSkills.length) % matchingSkills.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const chosen = matchingSkills[selectedSkillIndex];
        if (chosen) {
          selectSkill(chosen.name);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    if (e.key === 'Enter') {
      if (isComposingRef.current) {
        return;
      }
      if (!e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: StagedAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      newAttachments.push({
        name: file.name,
        path: file.name,
        size: file.size,
      });
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    // Reset file input value so user can re-select same file if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const canSubmit = Boolean(workspaceRoot) && (text.trim().length > 0 || attachments.length > 0) && !running;

  return (
    <div className={css.composerWrap}>
      <div className={css.composerCard}>
        {matchingSkills.length > 0 && (
          <div className={css.suggestionsPopover}>
            <div className={css.suggestionsHeader}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Sparkles size={12} style={{ color: 'var(--dsw-static-deepseek-500, #4176e6)' }} />
                工程技能 (Skill) 建议 (Tab / Enter 选中)
              </span>
              <span>共 {matchingSkills.length} 个匹配</span>
            </div>
            {matchingSkills.map((skill, idx) => (
              <button
                key={skill.name}
                type="button"
                className={`${css.suggestionItem} ${idx === selectedSkillIndex ? css.suggestionItemActive : ''}`}
                onClick={() => selectSkill(skill.name)}
                onMouseEnter={() => setSelectedSkillIndex(idx)}
              >
                <div className={css.suggestionTop}>
                  <ShieldCheck
                    size={13}
                    style={{
                      color: skill.isAgentMounted ? 'var(--dsw-static-deepseek-500, #4176e6)' : '#16a34a',
                      flexShrink: 0,
                    }}
                  />
                  <span className={css.suggestionName}>/{skill.name}</span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: '10.5px',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: skill.isAgentMounted
                        ? 'var(--dsw-static-deepseek-50, #edf3fe)'
                        : 'rgba(22, 163, 74, 0.08)',
                      color: skill.isAgentMounted
                        ? 'var(--dsw-static-deepseek-600, #3461c2)'
                        : '#16a34a',
                      border: skill.isAgentMounted
                        ? '1px solid var(--dsw-static-deepseek-200, #bfdbfe)'
                        : '1px solid rgba(22, 163, 74, 0.2)',
                      fontWeight: 500,
                    }}
                  >
                    {skill.isAgentMounted ? 'Agent 内置' : '动态挂载'}
                  </span>
                </div>
                {skill.description && (
                  <div className={css.suggestionDesc} title={skill.description}>
                    {skill.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className={css.attachmentsList}>
            {attachments.map((att, idx) => (
              <div key={`${att.name}-${idx}`} className={css.attachmentChip}>
                <FileText size={13} color="var(--dsw-static-deepseek-400, #7aaaff)" />
                <span className={css.attachmentName} title={att.name}>
                  {att.name}
                </span>
                {att.size !== undefined && (
                  <span className={css.attachmentSize}>({formatFileSize(att.size)})</span>
                )}
                <button
                  type="button"
                  className={css.removeAttachmentBtn}
                  onClick={() => removeAttachment(idx)}
                  title="移除附件"
                  aria-label="移除附件"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={css.textareaWrap}>
          <textarea
            ref={textareaRef}
            className={css.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder={
              !workspaceRoot
                ? '请先选择工作区以开始编程...'
                : '给 CPH-PI 发送任务指令... (可输入 / 调用工程技能，如 /thermo-nuclear-code-quality-review)'
            }
            disabled={!workspaceRoot}
            rows={1}
          />
        </div>

        <div className={css.actionBar}>
          <div className={css.actionLeft}>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
              multiple
            />
            <button
              type="button"
              className={css.iconButton}
              onClick={() => {
                if (!workspaceRoot) {
                  setWorkspaceModalOpen(true);
                  return;
                }
                fileInputRef.current?.click();
              }}
              title={!workspaceRoot ? '请先选择工作区' : '添加附件 / 代码文件'}
              aria-label="添加附件"
            >
              <Paperclip size={16} />
            </button>
            <span className={css.hintText}>Enter 发送 / Shift + Enter 换行</span>
          </div>

          <div className={css.actionRight}>
            {running ? (
              <button
                type="button"
                className={css.stopBtn}
                onClick={interrupt}
                title="中断生成 (Interrupt)"
                aria-label="中断生成"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className={css.submitBtn}
                onClick={!workspaceRoot ? () => setWorkspaceModalOpen(true) : handleSubmit}
                disabled={!workspaceRoot ? false : !canSubmit}
                title={!workspaceRoot ? '请先选择工作区以开始编程 (点击选择)' : '发送'}
                aria-label={!workspaceRoot ? '请先选择工作区' : '发送'}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={css.disclaimer}>
        Copilot M365 Agent 控制核驱动 · 工业级工具链与沙盒执行
      </div>
    </div>
  );
}

export default Composer;
