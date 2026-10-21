import React, { useEffect } from 'react';
import { AppFrame } from './components/layout/AppFrame';
import { Sidebar } from './components/layout/Sidebar';
import { Rightbar } from './components/layout/Rightbar';
import { ChatView } from './components/chat/ChatView';
import {
  FileExplorer,
  TerminalPanel,
  DiffViewer,
  LedgerWALViewer,
  ContextInspector,
} from './components/panels';
import { useAppStore } from './services/store';
import { wsClient } from './services/client-ws';

import { WorkspaceDialog } from './components/layout/WorkspaceDialog';
import { AccountDialog } from './components/layout/AccountDialog';
import { AgentDialog } from './components/layout/AgentDialog';
import { SkillDialog } from './components/layout/SkillDialog';

export function App(): React.JSX.Element {
  const { activeRightbarTab } = useAppStore();

  useEffect(() => {
    wsClient.connect();
  }, []);

  const renderRightbarPanel = () => {
    switch (activeRightbarTab) {
      case 'files':
        return <FileExplorer />;
      case 'terminal':
        return <TerminalPanel />;
      case 'diff':
        return <DiffViewer />;
      case 'ledger':
        return <LedgerWALViewer />;
      case 'context':
        return <ContextInspector />;
      default:
        return <FileExplorer />;
    }
  };

  return (
    <>
      <AppFrame
        sidebar={<Sidebar />}
        center={<ChatView />}
        rightbar={<Rightbar>{renderRightbarPanel()}</Rightbar>}
      />
      <WorkspaceDialog />
      <AccountDialog />
      <AgentDialog />
      <SkillDialog />
    </>
  );
}


export default App;
