import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LoadingScreen } from './components/splash/loading-screen';
import { Shell } from './components/shell/shell';
import { HomeView } from './components/home/home-view';
import { ToolsPane } from './components/tools/tools-pane';
import { AgentFlowView } from './components/flow/agent-flow-view';
import { AgentsView } from './components/agents/agents-view';

export type View = 'home' | 'agents' | 'tools' | 'flow';

export function App() {
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>('home');

  useEffect(() => {
    // Mock boot sequence — replaced by real subsystem warm-up later
    // (loading registry, MCP pool warm-up, auth checks, etc.)
    const t = setTimeout(() => setBooting(false), 2400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-paper text-ink">
      <AnimatePresence mode="wait">
        {booting ? (
          <motion.div
            key="boot"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, filter: 'blur(8px)' }}
            transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-0"
          >
            <LoadingScreen />
          </motion.div>
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0, scale: 1.01 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-0"
          >
            <Shell active={view} onNavigate={setView}>
              {view === 'home' && <HomeView onOpenTools={() => setView('tools')} onOpenFlow={() => setView('flow')} />}
              {view === 'agents' && <AgentsView />}
              {view === 'tools' && <ToolsPane />}
              {view === 'flow' && <AgentFlowView />}
            </Shell>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
