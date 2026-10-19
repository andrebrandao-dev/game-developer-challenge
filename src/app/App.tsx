import { useEffect, type ReactNode } from 'react';
import { RecordSyncAgent } from '@/api/RecordSyncAgent';
import { audio } from '@/game/audio/AudioManager';
import { BattleScreen } from '@/screens/BattleScreen';
import { CaptainsLog } from '@/screens/CaptainsLog';
import { MainMenu } from '@/screens/MainMenu';
import { ResultScreen } from '@/screens/ResultScreen';
import { CornerTools } from '@/ui/CornerTools';
import { OptionsPanel } from '@/ui/OptionsPanel';
import { abandonMatch, startMatch, useActiveMatch, useLastResult } from './matches';
import { navigate, useRoute } from './router';

function OptionsScreen() {
  return (
    <main className="scene">
      <div className="panel" data-testid="options-screen">
        <div className="panel__content">
          <h1>Options</h1>
          <OptionsPanel onClose={() => navigate({ name: 'menu' })} />
        </div>
      </div>
    </main>
  );
}

export function App() {
  const route = useRoute();
  const match = useActiveMatch();
  const lastResult = useLastResult();

  // Browsers only allow audio after a user gesture.
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // A battle cannot survive a refresh, and a result needs a finished match.
  const invalidBattle = route.name === 'battle' && !match;
  const invalidResult = route.name === 'result' && !lastResult;
  useEffect(() => {
    if (invalidBattle || invalidResult) navigate({ name: 'menu' }, { replace: true });
  }, [invalidBattle, invalidResult]);

  // Leaving the battle route by any means (back button, menu) abandons the match.
  useEffect(() => {
    if (route.name !== 'battle' && match) abandonMatch();
  }, [route.name, match]);

  const play = () => {
    audio.play('ui_click', 0.6);
    // Route first, then match: both updates land in the same render.
    navigate({ name: 'battle' });
    startMatch();
  };

  let screen: ReactNode;
  switch (route.name) {
    case 'battle':
      screen = match ? (
        <BattleScreen
          match={match}
          onFinished={() => navigate({ name: 'result' }, { replace: true })}
          onAbandon={() => {
            abandonMatch();
            navigate({ name: 'menu' }, { replace: true });
          }}
        />
      ) : null;
      break;
    case 'result':
      screen = lastResult ? (
        <ResultScreen result={lastResult} onPlayAgain={play} onMenu={() => navigate({ name: 'menu' })} />
      ) : null;
      break;
    case 'options':
      screen = <OptionsScreen />;
      break;
    case 'log':
      screen = (
        <CaptainsLog
          tab={route.tab}
          onTabChange={(tab) => navigate({ name: 'log', tab }, { replace: true })}
          onMenu={() => navigate({ name: 'menu' })}
        />
      );
      break;
    case 'menu':
      screen = (
        <MainMenu
          onPlay={play}
          onOptions={() => {
            audio.play('ui_open', 0.5);
            navigate({ name: 'options' });
          }}
          onLog={(tab) => {
            audio.play('ui_open', 0.5);
            navigate({ name: 'log', tab });
          }}
        />
      );
      break;
  }

  return (
    <>
      <RecordSyncAgent />
      {screen}
      {route.name !== 'battle' && (
        <>
          <CornerTools />
          <img className="brand-logo" src="/game/ui/logo_jungle_gaming.svg" alt="" width={120} height={40} />
        </>
      )}
    </>
  );
}
