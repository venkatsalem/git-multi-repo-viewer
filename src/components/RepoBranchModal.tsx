import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  GitBranch,
  Plus,
  Search,
  X
} from 'lucide-react';
import { BranchListResult, RepoSummary } from '../../shared/types';

interface RepoBranchModalProps {
  repo: RepoSummary;
  onCheckout: (
    repo: RepoSummary,
    targetBranch: string,
    options?: { createNew?: boolean; isRemote?: boolean }
  ) => Promise<boolean>;
  onClose: () => void;
}

export const RepoBranchModal: React.FC<RepoBranchModalProps> = ({
  repo,
  onCheckout,
  onClose
}) => {
  const [branches, setBranches] = useState<BranchListResult>({
    current: repo.branch,
    local: [],
    remote: []
  });
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.gitViewer
      .getRepoBranches(repo.path)
      .then((res) => {
        if (!cancelled) setBranches(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.path]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !switching) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [switching, onClose]);

  const q = query.trim();
  const qLower = q.toLowerCase();

  const filteredLocal = useMemo(
    () =>
      qLower
        ? branches.local.filter((b) => b.toLowerCase().includes(qLower))
        : branches.local,
    [branches.local, qLower]
  );

  const filteredRemote = useMemo(
    () =>
      qLower
        ? branches.remote.filter((b) => b.toLowerCase().includes(qLower))
        : branches.remote,
    [branches.remote, qLower]
  );

  const exactLocalExists = branches.local.some(
    (b) => b.toLowerCase() === qLower
  );

  const runSwitch = async (
    target: string,
    options?: { createNew?: boolean; isRemote?: boolean }
  ) => {
    if (switching) return;
    setSwitching(target);
    try {
      const ok = await onCheckout(repo, target, options);
      if (ok) onClose();
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!switching) onClose();
      }}
    >
      <div
        className="modal-card branch-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <div className="modal-title">
            <GitBranch size={17} style={{ color: 'var(--accent)' }} />
            <span>Switch Branch — {repo.name}</span>
          </div>
          <button
            className="icon-btn"
            disabled={Boolean(switching)}
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
              disabled={Boolean(switching)}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter branches or type a new branch name..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q && !exactLocalExists) {
                  if (filteredLocal.length === 1) {
                    void runSwitch(filteredLocal[0]);
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
              disabled={Boolean(switching)}
              onClick={() => void runSwitch(q, { createNew: true })}
            >
              <Plus size={13} />
              {switching === q
                ? `Creating ${q}...`
                : `Create & Checkout "${q}"`}
            </button>
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
                      Local Branches ({filteredLocal.length})
                    </div>
                    {filteredLocal.map((b) => {
                      const isCurrent = b === branches.current;
                      return (
                        <button
                          key={`local:${b}`}
                          type="button"
                          disabled={Boolean(switching)}
                          className={`branch-item-row ${isCurrent ? 'active' : ''}`}
                          onClick={() => {
                            if (!isCurrent) void runSwitch(b);
                          }}
                        >
                          <span className="workspace-recent-check">
                            {isCurrent && <Check size={12} />}
                          </span>
                          <GitBranch
                            size={13}
                            style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
                          />
                          <span className="workspace-recent-path">{b}</span>
                          {isCurrent && (
                            <span className="count-pill">current</span>
                          )}
                          {switching === b && (
                            <span className="count-pill">switching...</span>
                          )}
                        </button>
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
                      Remote Branches ({filteredRemote.length})
                    </div>
                    {filteredRemote.map((b) => (
                      <button
                        key={`remote:${b}`}
                        type="button"
                        disabled={Boolean(switching)}
                        className="branch-item-row"
                        onClick={() =>
                          void runSwitch(b, { isRemote: true })
                        }
                      >
                        <span className="workspace-recent-check" />
                        <GitBranch
                          size={13}
                          style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                        />
                        <span className="workspace-recent-path">{b}</span>
                        {switching === b && (
                          <span className="count-pill">switching...</span>
                        )}
                      </button>
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
            disabled={Boolean(switching)}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
