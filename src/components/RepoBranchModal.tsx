import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  GitBranch,
  GitCompare,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { BranchEntry, BranchListResult, RepoSummary } from '../../shared/types';

interface RepoBranchModalProps {
  repo: RepoSummary;
  onCheckout: (
    repo: RepoSummary,
    targetBranch: string,
    options?: { createNew?: boolean; isRemote?: boolean }
  ) => Promise<boolean>;
  onDeleteBranch: (
    repo: RepoSummary,
    branchName: string,
    force: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  onCompareBranch: (repo: RepoSummary, targetBranch: string) => void;
  onClose: () => void;
}

export const RepoBranchModal: React.FC<RepoBranchModalProps> = ({
  repo,
  onCheckout,
  onDeleteBranch,
  onCompareBranch,
  onClose
}) => {
  const [branches, setBranches] = useState<BranchListResult>({
    current: repo.branch,
    local: [],
    remote: []
  });
  const [loading, setLoading] = useState(true);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [forceDeletePrompt, setForceDeletePrompt] = useState<{
    branch: string;
    reason: string;
  } | null>(null);

  const loadBranches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.gitViewer.getRepoBranches(repo.path);
      setBranches(res);
    } finally {
      setLoading(false);
    }
  }, [repo.path]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyBranch) {
        if (forceDeletePrompt) setForceDeletePrompt(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busyBranch, forceDeletePrompt, onClose]);

  const q = query.trim();
  const qLower = q.toLowerCase();

  const filteredLocal = useMemo(
    () =>
      qLower
        ? branches.local.filter((b) => b.name.toLowerCase().includes(qLower))
        : branches.local,
    [branches.local, qLower]
  );

  const filteredRemote = useMemo(
    () =>
      qLower
        ? branches.remote.filter((b) => b.name.toLowerCase().includes(qLower))
        : branches.remote,
    [branches.remote, qLower]
  );

  const exactLocalExists = branches.local.some(
    (b) => b.name.toLowerCase() === qLower
  );

  const runSwitch = async (
    target: string,
    options?: { createNew?: boolean; isRemote?: boolean }
  ) => {
    if (busyBranch) return;
    setBusyBranch(target);
    try {
      const ok = await onCheckout(repo, target, options);
      if (ok) onClose();
    } finally {
      setBusyBranch(null);
    }
  };

  const runDelete = async (branchName: string, force = false) => {
    if (busyBranch) return;
    setBusyBranch(branchName);
    try {
      const res = await onDeleteBranch(repo, branchName, force);
      if (res.ok) {
        setForceDeletePrompt(null);
        await loadBranches();
      } else if (!force) {
        setForceDeletePrompt({
          branch: branchName,
          reason:
            res.error ||
            `Branch "${branchName}" may contain unmerged commits.`
        });
      }
    } finally {
      setBusyBranch(null);
    }
  };

  const renderSyncPill = (b: BranchEntry) => {
    if (b.syncStatus === 'local-only') {
      return (
        <span
          className="branch-sync-pill local-only"
          title="No upstream remote tracking branch — local only"
        >
          local-only
        </span>
      );
    }
    if (b.syncStatus === 'gone') {
      return (
        <span
          className="branch-sync-pill gone"
          title={`Remote tracking branch (${b.upstream}) was deleted`}
        >
          remote gone
        </span>
      );
    }
    if (b.syncStatus === 'ahead-behind') {
      return (
        <span
          className="branch-sync-pill ahead-behind"
          title={`Tracking ${b.upstream}: ${b.trackLabel}`}
        >
          {b.trackLabel}
        </span>
      );
    }
    return (
      <span
        className="branch-sync-pill synced"
        title={`In sync with ${b.upstream}`}
      >
        synced
      </span>
    );
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busyBranch) onClose();
      }}
    >
      <div
        className="modal-card branch-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <div className="modal-title">
            <GitBranch size={17} style={{ color: 'var(--accent)' }} />
            <span>Switch / Manage Branches — {repo.name}</span>
          </div>
          <button
            className="icon-btn"
            disabled={Boolean(busyBranch)}
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="branch-modal-body">
          <div className="search-box" style={{ margin: 0 }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              autoFocus
              value={query}
              disabled={Boolean(busyBranch)}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter branches (sorted most-recent first) or type new name..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q && !exactLocalExists) {
                  if (filteredLocal.length === 1) {
                    void runSwitch(filteredLocal[0].name);
                  } else {
                    void runSwitch(q, { createNew: true });
                  }
                }
              }}
            />
          </div>

          {q && !exactLocalExists && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ justifyContent: 'flex-start' }}
              disabled={Boolean(busyBranch)}
              onClick={() => void runSwitch(q, { createNew: true })}
            >
              <Plus size={13} />
              {busyBranch === q
                ? `Creating ${q}...`
                : `Create & Checkout "${q}"`}
            </button>
          )}

          {forceDeletePrompt && (
            <div className="branch-force-banner">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} style={{ color: 'var(--status-d)' }} />
                <strong>
                  Cannot safely delete &ldquo;{forceDeletePrompt.branch}&rdquo;
                </strong>
              </div>
              <div
                style={{
                  fontSize: '0.846rem',
                  color: 'var(--text-secondary)',
                  wordBreak: 'break-word'
                }}
              >
                {forceDeletePrompt.reason}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={Boolean(busyBranch)}
                  onClick={() => setForceDeletePrompt(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={Boolean(busyBranch)}
                  onClick={() =>
                    void runDelete(forceDeletePrompt.branch, true)
                  }
                >
                  Force Delete (-D)
                </button>
              </div>
            </div>
          )}

          <div className="branch-list-scroll">
            {loading ? (
              <div className="empty-state" style={{ padding: 20 }}>
                Loading branches...
              </div>
            ) : filteredLocal.length === 0 && filteredRemote.length === 0 ? (
              <div className="empty-state" style={{ padding: 20 }}>
                No matching branches found.
              </div>
            ) : (
              <>
                {filteredLocal.length > 0 && (
                  <>
                    <div className="workspace-dropdown-label">
                      Local Branches ({filteredLocal.length} · newest first)
                    </div>
                    {filteredLocal.map((b) => {
                      const isCurrent = b.name === branches.current;
                      return (
                        <div
                          key={`local:${b.name}`}
                          className={`branch-item-row ${isCurrent ? 'active' : ''}`}
                          onClick={() => {
                            if (!isCurrent && !busyBranch) void runSwitch(b.name);
                          }}
                          title={
                            b.upstream
                              ? `Tracks ${b.upstream} (${b.relativeDate})`
                              : `Local-only branch (${b.relativeDate})`
                          }
                        >
                          <span className="workspace-recent-check">
                            {isCurrent && <Check size={12} />}
                          </span>
                          <GitBranch
                            size={13}
                            style={{
                              color: isCurrent
                                ? 'var(--accent)'
                                : 'var(--text-secondary)',
                              flexShrink: 0
                            }}
                          />
                          <span className="workspace-recent-path">{b.name}</span>
                          {renderSyncPill(b)}
                          {b.relativeDate && (
                            <span className="branch-date-label">
                              {b.relativeDate}
                            </span>
                          )}
                          {isCurrent ? (
                            <span className="count-pill">current</span>
                          ) : (
                            <div
                              className="branch-row-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="icon-btn"
                                style={{ width: 22, height: 22 }}
                                disabled={Boolean(busyBranch)}
                                title={`Compare "${b.name}" with current branch`}
                                onClick={() => {
                                  onClose();
                                  onCompareBranch(repo, b.name);
                                }}
                              >
                                <GitCompare size={12} />
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                style={{
                                  width: 22,
                                  height: 22,
                                  color: 'var(--status-d)'
                                }}
                                disabled={Boolean(busyBranch)}
                                title={`Delete local branch "${b.name}" (git branch -d)`}
                                onClick={() => void runDelete(b.name, false)}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {filteredRemote.length > 0 && (
                  <>
                    <div
                      className="workspace-dropdown-label"
                      style={{ marginTop: 6 }}
                    >
                      Remote Branches ({filteredRemote.length} · newest first)
                    </div>
                    {filteredRemote.map((b) => (
                      <div
                        key={`remote:${b.name}`}
                        className="branch-item-row"
                        onClick={() => {
                          if (!busyBranch) {
                            void runSwitch(b.name, { isRemote: true });
                          }
                        }}
                        title={`Remote branch ${b.name} (${b.relativeDate}) — click to checkout & track`}
                      >
                        <span className="workspace-recent-check" />
                        <GitBranch
                          size={13}
                          style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                        />
                        <span className="workspace-recent-path">{b.name}</span>
                        {b.relativeDate && (
                          <span className="branch-date-label">
                            {b.relativeDate}
                          </span>
                        )}
                        <div
                          className="branch-row-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ width: 22, height: 22 }}
                            disabled={Boolean(busyBranch)}
                            title={`Compare "${b.name}" with current branch`}
                            onClick={() => {
                              onClose();
                              onCompareBranch(repo, b.name);
                            }}
                          >
                            <GitCompare size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <span
            style={{
              fontSize: '0.885rem',
              color: 'var(--text-secondary)'
            }}
          >
            Current: <strong>{branches.current || repo.branch}</strong>
          </span>
          <button
            className="btn"
            disabled={Boolean(busyBranch)}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
