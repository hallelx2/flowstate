import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LoadingScreen } from './components/splash/loading-screen';
import { Shell } from './components/shell/shell';
import { HomeView } from './components/home/home-view';
import { ToolsPane } from './components/tools/tools-pane';
import { AgentsView } from './components/agents/agents-view';
import { RunsView } from './components/runs/runs-view';
import { SettingsView } from './components/settings/settings-view';
import { hydrateSettings, settingsStore } from './lib/settings-store';
import { hydrateWorkspaces } from './lib/workspace-store';

export type View = 'home' | 'agents' | 'tools' | 'runs' | 'settings';

export function App() {
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>('home');

  useEffect(() => {
    // Hydrate the settings store from disk in parallel with the boot
    // animation. The animation gives the SSD a few hundred ms of cover —
    // the store is ready well before the user can do anything with it.
    void hydrateSettings();
    void hydrateWorkspaces();
    const t = setTimeout(() => setBooting(false), 2400);

    // Best-effort flush before the renderer process shuts down. Keeps the
    // last keystroke from being lost if the user closes the window mid-debounce.
    const onBeforeUnload = () => {
      void settingsStore.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
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
              {view === 'home' && (
                <HomeView
                  onOpenTools={() => setView('tools')}
                  onOpenRuns={() => setView('runs')}
                  onRunStarted={() => setView('runs')}
                />
              )}
              {view === 'agents' && <AgentsView onRunStarted={() => setView('runs')} />}
              {view === 'tools' && <ToolsPane />}
              {view === 'runs' && <RunsView />}
              {view === 'settings' && <SettingsView />}
            </Shell>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
