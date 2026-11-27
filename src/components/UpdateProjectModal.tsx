import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  GitBranch,
  MinusCircle,
  RefreshCw,
  X
} from 'lucide-react';
import {
  RepoBatchResultItem,
  RepoSummary,
  UpdateStrategy
} from '../../shared/types';

interface UpdateProjectModalProps {
  repos: RepoSummary[];
  initialResults?: RepoBatchResultItem[] | null;
  onRunUpdate: (
    repos: RepoSummary[],
    options: { strategy: UpdateStrategy; autoStash: boolean }
  ) => Promise<RepoBatchResultItem[]>;
  onClose: () => void;
}

const EXCLUDED_STORAGE_KEY = 'gmrv.updateExcludedRepoIds';

function loadExcludedRepoIds(): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((x): x is string => typeof x === 'string'));
      }
    }
  } catch {
    // ignore malformed storage
  }
  return new Set();
}

export const UpdateProjectModal: React.FC<UpdateProjectModalProps> = ({
  repos,
  initialResults = null,
  onRunUpdate,
  onClose
}) => {
  const [strategy, setStrategy] = useState<UpdateStrategy>('merge');
  const [autoStash, setAutoStash] = useState(true);
  const [excludedRepoIds, setExcludedRepoIds] = useState<Set<string>>(() =>
    loadExcludedRepoIds()
  );
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<RepoBatchResultItem[] | null>(
    initialResults
  );

  useEffect(() => {
    localStorage.setItem(
      EXCLUDED_STORAGE_KEY,
      JSON.stringify([...excludedRepoIds])
    );
  }, [excludedRepoIds]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRunning) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRunning, onClose]);

  const behindRepos = useMemo(
    () => repos.filter((r) => r.behind > 0),
    [repos]
  );

  const selectedRepos = useMemo(
    () => repos.filter((r) => !excludedRepoIds.has(r.id)),
    [repos, excludedRepoIds]
  );

  const toggleRepo = (repoId: string) => {
    setExcludedRepoIds((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  };

  const selectAll = () => {
    setExcludedRepoIds((prev) => {
      const next = new Set(prev);
      for (const r of repos) next.delete(r.id);
      return next;
    });
  };

  const selectNone = () => {
    setExcludedRepoIds((prev) => {
      const next = new Set(prev);
      for (const r of repos) next.add(r.id);
      return next;
    });
  };

  const selectBehindOnly = () => {
    setExcludedRepoIds((prev) => {
      const next = new Set(prev);
      for (const r of repos) {
        if (r.behind > 0) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  };

  const selectCleanOnly = () => {
    setExcludedRepoIds((prev) => {
      const next = new Set(prev);
      for (const r of repos) {
        if (r.changes.length === 0) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  };

  const handleRun = async () => {
    if (selectedRepos.length === 0) return;
    setIsRunning(true);
    try {
      const res = await onRunUpdate(selectedRepos, {
        strategy,
        autoStash: strategy !== 'ff-only' ? autoStash : false
      });
      setResults(res);
    } finally {
      setIsRunning(false);
    }
  };

  const counts = results
    ? {
        updated: results.filter((r) => r.status === 'updated').length,
        upToDate: results.filter((r) => r.status === 'up-to-date').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        error: results.filter((r) => r.status === 'error').length
      }
    : null;

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!isRunning) onClose();
      }}
    >
      <div
        className="modal-card update-project-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <div className="modal-title">
            <Download size={17} style={{ color: 'var(--accent)' }} />
            <span>Update Project (Fetch &amp; Pull Repositories)</span>
          </div>
          <button
            className="icon-btn"
            disabled={isRunning}
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="update-modal-body">
          <div className="settings-section">
            <div className="settings-section-title">Update Strategy</div>
            <div className="theme-segmented">
              <button
                type="button"
                disabled={isRunning}
                className={`theme-segment-btn ${strategy === 'merge' ? 'active' : ''}`}
                onClick={() => setStrategy('merge')}
                title="Run git pull --no-edit (creates merge commit if diverged)"
              >
                Merge (Default)
              </button>
              <button
                type="button"
                disabled={isRunning}
                className={`theme-segment-btn ${strategy === 'rebase' ? 'active' : ''}`}
                onClick={() => setStrategy('rebase')}
                title="Run git pull --rebase (replays local commits on top of upstream)"
              >
                Rebase
              </button>
              <button
                type="button"
                disabled={isRunning}
                className={`theme-segment-btn ${strategy === 'ff-only' ? 'active' : ''}`}
                onClick={() => setStrategy('ff-only')}
                title="Run git pull --ff-only (safest: refuses if diverged)"
              >
                Fast-Forward Only
              </button>
            </div>
          </div>

          <div className="update-options-list">
            <label className="update-checkbox-row">
              <input
                type="checkbox"
                disabled={isRunning || strategy === 'ff-only'}
                checked={strategy !== 'ff-only' && autoStash}
                onChange={(e) => setAutoStash(e.target.checked)}
              />
              <span>
                Auto-stash dirty working changes before pulling (--autostash)
                {strategy === 'ff-only' ? ' — unavailable with FF-Only' : ''}
              </span>
            </label>
          </div>

          <div className="settings-section">
            <div className="update-repo-header">
              <span className="settings-section-title">
                Repositories ({selectedRepos.length} of {repos.length} selected)
              </span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={isRunning}
                  onClick={selectAll}
                >
                  All
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={isRunning}
                  onClick={selectNone}
                >
                  None
                </button>
                {behindRepos.length > 0 && (
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={isRunning}
                    onClick={selectBehindOnly}
                    title="Select only repos with incoming upstream commits"
                  >
                    Behind ({behindRepos.length})
                  </button>
                )}
                <button
                  type="button"
                  className="mini-btn"
                  disabled={isRunning}
                  onClick={selectCleanOnly}
                  title="Select only clean repos with no uncommitted changes"
                >
                  Clean Only
                </button>
              </div>
            </div>

            <div className="update-repo-list">
              {repos.map((repo) => {
                const checked = !excludedRepoIds.has(repo.id);
                return (
                  <label
                    key={repo.id}
                    className={`update-repo-row ${checked ? '' : 'excluded'}`}
                    title={repo.path}
                  >
                    <input
                      type="checkbox"
                      disabled={isRunning}
                      checked={checked}
                      onChange={() => toggleRepo(repo.id)}
                    />
                    <span className="update-repo-name">{repo.name}</span>
                    <span className="branch-tag">
                      <GitBranch size={10} />
                      {repo.branch}
                    </span>
                    <span style={{ flex: 1 }} />
                    {repo.behind > 0 && (
                      <span
                        className="count-pill behind"
                        title={`${repo.behind} incoming commit(s)`}
                      >
                        ↓{repo.behind}
                      </span>
                    )}
                    {repo.ahead > 0 && (
                      <span
                        className="count-pill ahead"
                        title={`${repo.ahead} unpushed commit(s)`}
                      >
                        ↑{repo.ahead}
                      </span>
                    )}
                    {repo.changes.length > 0 && (
                      <span
                        className="count-pill unstaged-pill"
                        title={`${repo.changes.length} uncommitted change(s)`}
                      >
                        {repo.changes.length} dirty
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {results && counts && (
            <div className="update-results-box">
              <div className="update-results-summary">
                <span className="stat-pill" style={{ color: 'var(--status-a)' }}>
                  Updated: {counts.updated}
                </span>
                <span className="stat-pill">Up to date: {counts.upToDate}</span>
                {counts.skipped > 0 && (
                  <span className="stat-pill">Skipped: {counts.skipped}</span>
                )}
                {counts.error > 0 && (
                  <span
                    className="stat-pill"
                    style={{ color: 'var(--status-d)' }}
                  >
                    Errors: {counts.error}
                  </span>
                )}
              </div>

              <div className="update-results-list">
                {results.map((item) => (
                  <div
                    key={item.repoId}
                    className={`update-result-row status-${item.status}`}
                  >
                    {item.status === 'updated' || item.status === 'up-to-date' ? (
                      <CheckCircle2
                        size={14}
                        style={{
                          flexShrink: 0,
                          color:
                            item.status === 'updated'
                              ? 'var(--status-a)'
                              : 'var(--text-muted)'
                        }}
                      />
                    ) : item.status === 'skipped' ? (
                      <MinusCircle
                        size={14}
                        style={{ flexShrink: 0, color: 'var(--text-muted)' }}
                      />
                    ) : (
                      <AlertTriangle
                        size={14}
                        style={{ flexShrink: 0, color: 'var(--status-d)' }}
                      />
                    )}
                    <strong className="update-result-repo">
                      {item.repoName}
                    </strong>
                    <span
                      className="update-result-summary"
                      title={item.error || item.summary}
                    >
                      {item.error || item.summary}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <span
            style={{
              fontSize: '0.885rem',
              color: 'var(--text-secondary)'
            }}
          >
            {isRunning
              ? `Fetching & pulling ${selectedRepos.length} repo(s)...`
              : `${selectedRepos.length} of ${repos.length} repo(s) selected`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              disabled={isRunning}
              onClick={onClose}
            >
              Close
            </button>
            <button
              className="btn btn-primary"
              disabled={isRunning || selectedRepos.length === 0}
              onClick={() => void handleRun()}
            >
              <RefreshCw size={13} className={isRunning ? 'spin' : ''} />
              {isRunning
                ? 'Updating...'
                : results
                  ? 'Run Update Again'
                  : `Fetch & Pull (${selectedRepos.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
