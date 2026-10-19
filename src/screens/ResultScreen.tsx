import type { ReactNode } from 'react';
import { recordStateOf, requeue, useOutbox } from '@/api/pendingRecords';
import type { StoredResult } from '@/app/matches';
import { formatClock } from '@/lib/format';

interface ResultScreenProps {
  result: StoredResult;
  onPlayAgain: () => void;
  onMenu: () => void;
}

function RecordStatus({ matchId }: { matchId: string }) {
  const outbox = useOutbox();
  const status = recordStateOf(outbox, matchId);

  let content: ReactNode;
  switch (status.state) {
    case 'saved':
      content = 'Saved to the Captain’s Log.';
      break;
    case 'pending':
    case 'syncing':
      content = status.attempts > 1 ? `Saving to the Captain’s Log… (attempt ${status.attempts})` : 'Saving to the Captain’s Log…';
      break;
    case 'failed':
      content = (
        <>
          <span>Not saved yet: {status.lastError ?? 'the server is unavailable'} It is kept on this device.</span>
          <button type="button" className="btn btn--tiny btn--secondary" onClick={() => requeue(matchId)}>
            Try again
          </button>
        </>
      );
      break;
    case 'unknown':
      content = 'Saved locally.';
      break;
  }

  return (
    <div className="record-status" role="status" data-state={status.state} data-testid="record-status">
      {content}
    </div>
  );
}

export function ResultScreen({ result, onPlayAgain, onMenu }: ResultScreenProps) {
  const { record, kills } = result;
  const reason = record.endReason === 'time_up' ? 'Time up' : 'Ship sunk';

  return (
    <main className="scene">
      <div className="panel" data-testid="result-screen">
        <div className="panel__content">
          <h1>{record.endReason === 'time_up' ? 'Battle complete' : 'Defeated'}</h1>
          <p className="score-big" data-testid="result-score">
            <span className="visually-hidden">Score: </span>
            {record.score}
          </p>
          <p className="result-meta" data-testid="result-meta">
            Points · <span data-testid="result-duration">{formatClock(record.durationMs / 1000)}</span> ·{' '}
            <span data-testid="result-reason">{reason}</span>
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Chasers sunk: {kills.chaser} · Shooters sunk: {kills.shooter}
          </p>
          <p className="hint" style={{ margin: 0 }}>
            {record.config.sessionDurationSec} s battle · {record.config.spawnIntervalSec} s spawn interval
          </p>
          <RecordStatus matchId={record.matchId} />
          <div className="stack">
            <button type="button" className="btn" onClick={onPlayAgain} autoFocus>
              Play again
            </button>
            <button type="button" className="btn" onClick={onMenu}>
              Main menu
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
