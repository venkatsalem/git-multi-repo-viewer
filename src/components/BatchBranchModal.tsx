import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  MinusCircle,
  RefreshCw,
  X
} from 'lucide-react';
import { RepoBatchResultItem, RepoSummary } from '../../shared/types';

interface BatchBranchModalProps {
  repos: RepoSummary[];
  onRunSwitchAll: (
    repos: RepoSummary[],
    targetBranch: string,
    createIfMissing: boolean
  ) => Promise<RepoBatchResultItem[]>;
  onClose: () => void;
}

const COMMON_PRESETS = ['main', 'master', 'develop'];

export const BatchBranchModal: React.FC<BatchBranchModalProps> = ({
  repos,
  onRunSwitchAll,
  onClose
}) => {
  const [targetBranch, setTargetBranch] = useState('main');
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(repos.map((r) => r.id))
  );
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<RepoBatchResultItem[] | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRunning) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRunning, onClose]);

  const branchSuggestions = useMemo(() => {
    const seen = new Set<string>(COMMON_PRESETS);
    for (const r of repos) {
      if (r.branch && r.branch !== 'HEAD (detached)') {
        seen.add(r.branch);
      }
    }
    return [...seen];
  }, [repos]);

  const selectedRepos = useMemo(
    () => repos.filter((r) => selectedIds.has(r.id)),
    [repos, selectedIds]
  );

  const toggleRepo = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(repos.map((r) => r.id)));
  const selectNone = () => setSelectedIds(new Set());
  const selectDifferent = () => {
    const clean = targetBranch.trim();
    setSelectedIds(
      new Set(repos.filter((r) => r.branch !== clean).map((r) => r.id))
    );
  };

  const handleRun = async () => {
    const clean = targetBranch.trim();
    if (!clean || selectedRepos.length === 0) return;
    setIsRunning(true);
    try {
      const res = await onRunSwitchAll(selectedRepos, clean, createIfMissing);
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
            <GitBranch size={17} style={{ color: 'var(--accent)' }} />
            <span>Switch Branches Across Repositories</span>
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
            <label className="settings-field">
              <span>Target Branch Name</span>
              <input
                autoFocus
                type="text"
                disabled={isRunning}
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder="e.g. main, develop, feature/xyz"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && targetBranch.trim()) {
                    void handleRun();
                  }
                }}
              />
            </label>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {branchSuggestions.slice(0, 10).map((b) => (
                <button
                  key={b}
                  type="button"
                  disabled={isRunning}
                  className={`mini-btn ${targetBranch.trim() === b ? 'active-preset' : ''}`}
                  onClick={() => setTargetBranch(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <label className="update-checkbox-row">
            <input
              type="checkbox"
              disabled={isRunning}
              checked={createIfMissing}
              onChange={(e) => setCreateIfMissing(e.target.checked)}
            />
            <span>
              Create branch (git switch -c) in selected repos where it does not
              exist yet
            </span>
          </label>

          <div className="settings-section">
            <div className="update-repo-header">
              <span className="settings-section-title">
                Repositories ({selectedRepos.length} of {repos.length} selected)
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
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
                <button
                  type="button"
                  className="mini-btn"
                  disabled={isRunning || !targetBranch.trim()}
                  onClick={selectDifferent}
                  title="Select repos not currently on the target branch"
                >
                  Not on {targetBranch.trim() || '...'}
                </button>
              </div>
            </div>

            <div className="update-repo-list">
              {repos.map((repo) => {
                const checked = selectedIds.has(repo.id);
                const onTarget = repo.branch === targetBranch.trim();
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
                    {onTarget && <span className="count-pill">on target</span>}
                    {repo.changes.length > 0 && (
                      <span className="count-pill unstaged-pill">
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
                  Switched: {counts.updated}
                </span>
                <span className="stat-pill">
                  Already on branch: {counts.upToDate}
                </span>
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
              ? `Switching ${selectedRepos.length} repo(s)...`
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
              disabled={
                isRunning ||
                selectedRepos.length === 0 ||
                !targetBranch.trim()
              }
              onClick={() => void handleRun()}
            >
              <RefreshCw size={13} className={isRunning ? 'spin' : ''} />
              {isRunning
                ? 'Switching...'
                : `Switch (${selectedRepos.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
