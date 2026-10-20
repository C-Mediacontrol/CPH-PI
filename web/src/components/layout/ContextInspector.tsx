import React, { useState } from "react";
import type { SubagentState, LedgerItem } from "../../types/protocol.ts";
import type { WorkspaceTreeNode } from "../../utils/panelHelpers.ts";
import { WorkspaceTree } from "../workspace/WorkspaceTree.tsx";
import { LedgerWALViewer } from "../monitor/LedgerWALViewer.tsx";
import { SubagentGraph } from "../monitor/SubagentGraph.tsx";
import {
  FolderTree,
  Database,
  Layers,
  ChevronRight,
  ChevronLeft,
  PanelRightClose,
  PanelRightOpen,
  Activity,
} from "lucide-react";

export type InspectorTab = "files" | "ledger" | "subagents";

export interface ContextInspectorProps {
  subagents: SubagentState[];
  ledger: LedgerItem[];
  files?: string[];
  treeNodes?: WorkspaceTreeNode[];
  modifiedFiles?: string[];
  readFiles?: string[];
  selectedFile?: string | null;
  onSelectFile?: (path: string) => void;
  initialTab?: InspectorTab;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

export function ContextInspector({
  subagents = [],
  ledger = [],
  files = [],
  treeNodes,
  modifiedFiles = [],
  readFiles = [],
  selectedFile,
  onSelectFile,
  initialTab = "files",
  isCollapsed: controlledCollapsed,
  onToggleCollapse,
  className = "",
}: ContextInspectorProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>(initialTab);

  const isCollapsed =
    controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const toggleCollapse = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  };

  const handleTabClick = (tab: InspectorTab) => {
    setActiveTab(tab);
    if (isCollapsed) {
      if (onToggleCollapse) onToggleCollapse();
      else setInternalCollapsed(false);
    }
  };

  const activeSubagentsCount = subagents.filter(
    (s) => s.status === "running" || s.status === "started"
  ).length;

  // Render Collapsed Strip
  if (isCollapsed) {
    return (
      <aside
        className={`w-12 flex flex-col items-center py-3 bg-[#151517] border-l border-[#2c2c2e] text-neutral-400 select-none ${className}`}
      >
        {/* Expand button */}
        <button
          onClick={toggleCollapse}
          title="Expand Context Inspector"
          className="p-2 rounded-lg hover:bg-[#232326] text-neutral-400 hover:text-deepseek-400 transition"
        >
          <PanelRightOpen className="w-5 h-5" />
        </button>

        <div className="w-6 h-px bg-[#2c2c2e] my-2" />

        {/* Vertical Tab Quick Launchers */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleTabClick("files")}
            title={`Files (${files.length})`}
            className={`p-2 rounded-lg transition relative ${
              activeTab === "files"
                ? "bg-deepseek-500/20 text-deepseek-400 border border-deepseek-500/40"
                : "hover:bg-[#232326] text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <FolderTree className="w-4 h-4" />
            {modifiedFiles.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1 right-1" />
            )}
          </button>

          <button
            onClick={() => handleTabClick("ledger")}
            title={`Ledger WAL (${ledger.length})`}
            className={`p-2 rounded-lg transition ${
              activeTab === "ledger"
                ? "bg-deepseek-500/20 text-deepseek-400 border border-deepseek-500/40"
                : "hover:bg-[#232326] text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Database className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleTabClick("subagents")}
            title={`Subagents (${subagents.length})`}
            className={`p-2 rounded-lg transition relative ${
              activeTab === "subagents"
                ? "bg-deepseek-500/20 text-deepseek-400 border border-deepseek-500/40"
                : "hover:bg-[#232326] text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Layers className="w-4 h-4" />
            {activeSubagentsCount > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-deepseek-400 absolute top-1 right-1 animate-pulse" />
            )}
          </button>
        </div>
      </aside>
    );
  }

  // Render Full 3-tab Inspector Panel (320px - 360px)
  return (
    <aside
      className={`w-80 md:w-88 flex flex-col h-full bg-[#151517] border-l border-[#2c2c2e] text-neutral-200 select-none overflow-hidden ${className}`}
    >
      {/* Top Tab Bar & Collapse Button */}
      <div className="flex items-center justify-between border-b border-[#2c2c2e] bg-[#151517] text-xs px-2">
        <div className="flex items-center gap-1">
          {/* Files Tab */}
          <button
            onClick={() => setActiveTab("files")}
            className={`flex items-center gap-1.5 px-3 py-2.5 font-medium border-b-2 transition ${
              activeTab === "files"
                ? "border-deepseek-500 text-deepseek-400 bg-[#1b1b1c]"
                : "border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-[#1b1b1c]"
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Files</span>
            {modifiedFiles.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
            )}
          </button>

          {/* Ledger Tab */}
          <button
            onClick={() => setActiveTab("ledger")}
            className={`flex items-center gap-1.5 px-3 py-2.5 font-medium border-b-2 transition ${
              activeTab === "ledger"
                ? "border-deepseek-500 text-deepseek-400 bg-[#1b1b1c]"
                : "border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-[#1b1b1c]"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Ledger</span>
            <span className="text-[10px] font-mono font-tabular text-neutral-500">
              {ledger.length}
            </span>
          </button>

          {/* Subagents Tab */}
          <button
            onClick={() => setActiveTab("subagents")}
            className={`flex items-center gap-1.5 px-3 py-2.5 font-medium border-b-2 transition ${
              activeTab === "subagents"
                ? "border-deepseek-500 text-deepseek-400 bg-[#1b1b1c]"
                : "border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-[#1b1b1c]"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Subagents</span>
            {activeSubagentsCount > 0 ? (
              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-tabular bg-deepseek-500/20 text-deepseek-400 border border-deepseek-500/40">
                {activeSubagentsCount}
              </span>
            ) : (
              <span className="text-[10px] font-mono font-tabular text-neutral-500">
                {subagents.length}
              </span>
            )}
          </button>
        </div>

        {/* Collapse button */}
        <button
          onClick={toggleCollapse}
          title="Collapse Inspector"
          className="p-1.5 rounded hover:bg-[#232326] text-neutral-400 hover:text-neutral-200 transition"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "files" && (
          <WorkspaceTree
            files={files}
            treeNodes={treeNodes}
            modifiedFiles={modifiedFiles}
            readFiles={readFiles}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
          />
        )}

        {activeTab === "ledger" && <LedgerWALViewer ledger={ledger} />}

        {activeTab === "subagents" && <SubagentGraph subagents={subagents} />}
      </div>
    </aside>
  );
}
export default ContextInspector;
