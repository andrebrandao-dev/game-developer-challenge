import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ApiError } from '@/api/client';
import type { MatchConfig, MatchRecord } from '@/api/contracts';
import { requeue, useOutbox } from '@/api/pendingRecords';
import { useHistoryQuery, useRankingQuery } from '@/api/queries';
import { useOptions, useProfile } from '@/app/preferences';
import type { LogTab } from '@/app/router';
import { formatClock } from '@/lib/format';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => String(n).padStart(2, '0');
/** "08 SEP · 21:42" in the viewer's local time. */
const formatPlayedAt = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()] ?? ''} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const KNOWN_CONFIGS: readonly MatchConfig[] = [
  { sessionDurationSec: 60, spawnIntervalSec: 3 },
  { sessionDurationSec: 120, spawnIntervalSec: 2 },
  { sessionDurationSec: 120, spawnIntervalSec: 3 },
  { sessionDurationSec: 180, spawnIntervalSec: 3 },
];

const configKey = (c: MatchConfig) => `${c.sessionDurationSec}:${c.spawnIntervalSec}`;
const describeConfig = (c: MatchConfig) => `${c.sessionDurationSec} s battles · ${c.spawnIntervalSec} s spawn interval`;

interface CaptainsLogProps {
  tab: LogTab;
  onTabChange: (tab: LogTab) => void;
  onMenu: () => void;
}

const TABS: { id: LogTab; label: string }[] = [
  { id: 'ranking', label: 'Ranking' },
  { id: 'history', label: 'Match history' },
];

export function CaptainsLog({ tab, onTabChange, onMenu }: CaptainsLogProps) {
  const baseId = useId();
  const tabRefs = useRef<Record<LogTab, HTMLButtonElement | null>>({ ranking: null, history: null });

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.id === tab);
    const nextIndex =
      event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    const next = TABS[nextIndex];
    if (!next) return;
    onTabChange(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <main className="scene">
      <div className="panel panel--wide" data-testid="captains-log">
        <div className="panel__content">
          <h1>Captain’s Log</h1>
          <div className="tabs" role="tablist" aria-label="Captain’s log sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`${baseId}-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className="btn btn--small btn--secondary"
                onClick={() => onTabChange(t.id)}
                onKeyDown={onTabKeyDown}
              >
                {t.label}
              </button>
            ))}
          </div>
          <section
            role="tabpanel"
            id={`${baseId}-panel-${tab}`}
            aria-labelledby={`${baseId}-tab-${tab}`}
            className="stack"
            tabIndex={0}
          >
            {tab === 'ranking' ? <RankingTab /> : <HistoryTab />}
          </section>
          <button type="button" className="btn" onClick={onMenu}>
            Main menu
          </button>
        </div>
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ shared

interface QueryViewProps {
  isPending: boolean;
  isError: boolean;
  error: ApiError | null;
  isFetching: boolean;
  isPlaceholderData: boolean;
  hasData: boolean;
  isEmpty: boolean;
  emptyText: string;
  onRetry: () => void;
  children: ReactNode;
  testId: string;
}

/** Common loading / error / empty / background-refresh handling. */
function QueryView(props: QueryViewProps) {
  const { isPending, isError, error, isFetching, isPlaceholderData, hasData, isEmpty, emptyText, onRetry, children, testId } = props;
  if (isPending && !hasData) {
    return (
      <div className="state-box" role="status" data-testid={`${testId}-loading`}>
        Loading…
      </div>
    );
  }
  if (isError && !hasData) {
    return (
      <div className="state-box" data-testid={`${testId}-error`}>
        <p className="error" role="alert">
          {error?.userMessage ?? 'Something went wrong.'}
        </p>
        <button type="button" className="btn btn--small" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="table-wrap" aria-busy={isFetching} data-testid={testId} data-stale={isPlaceholderData}>
      {isError && (
        <p className="error" role="alert">
          Could not refresh: {error?.userMessage}{' '}
          <button type="button" className="chip-btn" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {isEmpty ? (
        <div className="state-box" data-testid={`${testId}-empty`}>
          {emptyText}
        </div>
      ) : (
        <div style={{ opacity: isPlaceholderData ? 0.6 : 1 }}>{children}</div>
      )}
      <p className="refreshing" role="status">
        {isFetching ? 'Updating…' : ''}
      </p>
    </div>
  );
}

function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, totalPages);
  return (
    <nav className="pager" aria-label="Pagination">
      <button
        type="button"
        className="round-btn icon-turn-left"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      />
      <span data-testid="page-indicator">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className="round-btn icon-turn-right"
        aria-label="Next page"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      />
    </nav>
  );
}

// ----------------------------------------------------------------- ranking

function RankingTab() {
  const options = useOptions();
  const profile = useProfile();
  const selectId = useId();
  const [config, setConfig] = useState<MatchConfig>({
    sessionDurationSec: options.sessionDurationSec,
    spawnIntervalSec: options.spawnIntervalSec,
  });
  const [page, setPage] = useState(1);
  const query = useRankingQuery(config, page);
  const data = query.data;

  const configs = [config, options, ...KNOWN_CONFIGS].filter(
    (c, i, all) => all.findIndex((o) => configKey(o) === configKey(c)) === i,
  );

  return (
    <>
      <div className="field">
        <label htmlFor={selectId} className="hint">
          Battle settings
        </label>
        <select
          id={selectId}
          className="text-input"
          style={{ fontSize: '0.9rem', textTransform: 'uppercase' }}
          value={configKey(config)}
          onChange={(e) => {
            const next = configs.find((c) => configKey(c) === e.target.value);
            if (next) {
              setConfig({ sessionDurationSec: next.sessionDurationSec, spawnIntervalSec: next.spawnIntervalSec });
              setPage(1);
            }
          }}
        >
          {configs.map((c) => (
            <option key={configKey(c)} value={configKey(c)}>
              {describeConfig(c)}
            </option>
          ))}
        </select>
      </div>
      <QueryView
        testId="ranking"
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        isFetching={query.isFetching}
        isPlaceholderData={query.isPlaceholderData}
        hasData={data !== undefined}
        isEmpty={data?.items.length === 0}
        emptyText="No battles recorded with these settings yet. Be the first!"
        onRetry={() => void query.refetch()}
      >
        <table className="log-table">
          <caption className="visually-hidden">Ranking for {describeConfig(config)}</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Captain</th>
              <th scope="col">Points</th>
              <th scope="col">Time</th>
              <th scope="col">Played</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((entry) => {
              const me = entry.playerId === profile.playerId;
              return (
                <tr key={entry.matchId} data-me={me} data-testid="ranking-row">
                  <td className="num">{String(entry.rank).padStart(2, '0')}</td>
                  <td>
                    {entry.rank === 1 && <span aria-label="Top captain">★ </span>}
                    {entry.playerName}
                    {me && <span className="badge">YOU</span>}
                  </td>
                  <td className="num">{entry.score}</td>
                  <td className="when">{formatClock(entry.durationMs / 1000)}</td>
                  <td className="when">{formatPlayedAt(entry.playedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </QueryView>
      {data && data.totalPages > 0 && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </>
  );
}

// ----------------------------------------------------------------- history

function PendingNotice({ pending }: { pending: { record: MatchRecord; status: string }[] }) {
  if (pending.length === 0) return null;
  const failed = pending.some((p) => p.status === 'failed');
  return (
    <div className="record-status" role="status" data-state={failed ? 'failed' : 'pending'} data-testid="pending-notice">
      <span>
        {pending.length} {pending.length === 1 ? 'battle is' : 'battles are'} waiting to be saved
        {failed ? ' (the last attempt failed).' : '…'}
      </span>
      {failed && (
        <button type="button" className="btn btn--tiny btn--secondary" onClick={() => requeue()}>
          Try again
        </button>
      )}
    </div>
  );
}

function HistoryTab() {
  const profile = useProfile();
  const outbox = useOutbox();
  const [page, setPage] = useState(1);
  const query = useHistoryQuery(profile.playerId, page);
  const data = query.data;
  const pending = outbox.pending.filter((p) => p.record.playerId === profile.playerId);

  return (
    <>
      <p className="hint" style={{ margin: 0 }}>
        Battles of {profile.name}
      </p>
      <PendingNotice pending={pending} />
      <QueryView
        testId="history"
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        isFetching={query.isFetching}
        isPlaceholderData={query.isPlaceholderData}
        hasData={data !== undefined}
        isEmpty={data?.items.length === 0}
        emptyText="No battles yet. Set sail to start your log!"
        onRetry={() => void query.refetch()}
      >
        <table className="log-table">
          <caption className="visually-hidden">Your match history</caption>
          <thead>
            <tr>
              <th scope="col">Played</th>
              <th scope="col">Points</th>
              <th scope="col">Duration</th>
              <th scope="col">Result</th>
              <th scope="col">Settings</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.matchId} data-testid="history-row">
                <td className="when">{formatPlayedAt(r.playedAt)}</td>
                <td className="num">{r.score}</td>
                <td className="when">{formatClock(r.durationMs / 1000)}</td>
                <td>{r.endReason === 'time_up' ? 'Time up' : 'Sunk'}</td>
                <td className="when">
                  {r.config.sessionDurationSec} s · {r.config.spawnIntervalSec} s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryView>
      {data && data.totalPages > 0 && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </>
  );
}
