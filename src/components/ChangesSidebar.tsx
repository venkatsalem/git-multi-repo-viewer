import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  FoldVertical,
  FolderTree,
  GitBranch,
  List,
  MinusCircle,
  PlusCircle,
  RotateCcw,
  Search,
  Square,
  Terminal,
  UnfoldVertical
} from 'lucide-react';
import { ChangedFile, RepoSummary } from '../../shared/types';
import {
  getTreeDirKeys,
  TreeOrListRenderer,
  ViewMode
} from './TreeOrListRenderer';

interface ChangesSidebarProps {
  repos: RepoSummary[];
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  selectedChangeKey: string | null;
  checkedKeys: Set<string>;
  onToggleCheck: (key: string) => void;
  onToggleRepoCheck: (repo: RepoSummary) => void;
  onSelectChange: (repo: RepoSummary, file: ChangedFile) => void;
  onCompareWithA: (repo: RepoSummary, filePath: string) => void;
  onCompareWithB: (repo: RepoSummary, filePath: string) => void;
  onCommitChecked: (message: string) => Promise<void>;
  onDiscardChecked: () => Promise<void>;
  onStageChecked: () => Promise<void>;
  onUnstageChecked: () => Promise<void>;
  onStageFile: (repo: RepoSummary, file: ChangedFile) => Promise<void>;
  onUnstageFile: (repo: RepoSummary, file: ChangedFile) => Promise<void>;
  onRevertFile: (repo: RepoSummary, file: ChangedFile) => Promise<void>;
  onOpenRepoInNewWindow: (repoPath: string) => void;
  onReorderRepo: (
    sourceRepoId: string,
    targetRepoId: string,
    position: 'before' | 'after'
  ) => void;
  isCommitting: boolean;
  baselineMap: Record<string, string>;
}

function joinRepoFilePath(repoPath: string, filePath: string): string {
  const base = repoPath.replace(/[\\/]+$/, '');
  return `${base}/${filePath}`;
}

export function makeChangeKey(repoId: string, filePath: string): string {
  return `${repoId}::${filePath}`;
}

export const ChangesSidebar: React.FC<ChangesSidebarProps> = ({
  repos,
  viewMode,
  onChangeViewMode,
  selectedChangeKey,
  checkedKeys,
  onToggleCheck,
  onToggleRepoCheck,
  onSelectChange,
  onCompareWithA,
  onCompareWithB,
  onCommitChecked,
  onDiscardChecked,
  onStageChecked,
  onUnstageChecked,
  onStageFile,
  onUnstageFile,
  onRevertFile,
  onOpenRepoInNewWindow,
  onReorderRepo,
  isCommitting,
  baselineMap
}) => {
  const [filterText, setFilterText] = useState('');
  const [onlyDirtyRepos, setOnlyDirtyRepos] = useState(true);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    repo: RepoSummary;
    file: ChangedFile;
  } | null>(null);
  const [repoContextMenu, setRepoContextMenu] = useState<{
    x: number;
    y: number;
    repo: RepoSummary;
  } | null>(null);
  const [draggedRepoId, setDraggedRepoId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    repoId: string;
    position: 'before' | 'after';
  } | null>(null);

  const [revertTarget, setRevertTarget] = useState<{
    repo: RepoSummary;
    file: ChangedFile;
  } | null>(null);
  const [isRevertingSingle, setIsRevertingSingle] = useState(false);

  useEffect(() => {
    if (!contextMenu && !repoContextMenu) return;
    const close = () => {
      setContextMenu(null);
      setRepoContextMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, repoContextMenu]);

  useEffect(() => {
    if (!revertTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRevertingSingle) {
        setRevertTarget(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [revertTarget, isRevertingSingle]);

  const visibleRepos = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return repos
      .map((repo) => {
        const filteredChanges = q
          ? repo.changes.filter(
              (c) =>
                c.path.toLowerCase().includes(q) ||
                repo.name.toLowerCase().includes(q)
            )
          : repo.changes;
        return { repo, filteredChanges };
      })
      .filter(({ repo, filteredChanges }) => {
        if (q) return filteredChanges.length > 0;
        if (onlyDirtyRepos) return repo.changes.length > 0 || repo.ahead > 0;
        return true;
      });
  }, [repos, filterText, onlyDirtyRepos]);

  const checkedSummary = useMemo(() => {
    let fileCount = 0;
    const repoIds = new Set<string>();
    for (const r of repos) {
      for (const c of r.changes) {
        if (checkedKeys.has(makeChangeKey(r.id, c.path))) {
          fileCount += 1;
          repoIds.add(r.id);
        }
      }
    }
    return { fileCount, repoCount: repoIds.size };
  }, [repos, checkedKeys]);

  const toggleRepoExpand = (repoId: string) => {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  };

  const toggleDir = (dirKey: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirKey)) next.delete(dirKey);
      else next.add(dirKey);
      return next;
    });
  };

  const handleExpandAll = () => {
    const repoIds = new Set<string>();
    const dirKeys = new Set<string>();
    for (const { repo, filteredChanges } of visibleRepos) {
      repoIds.add(repo.id);
      for (const k of getTreeDirKeys(
        filteredChanges,
        (c) => c.path,
        `chg:${repo.id}`
      )) {
        dirKeys.add(k);
      }
    }
    setExpandedRepos(repoIds);
    setExpandedDirs(dirKeys);
  };

  const handleCollapseAll = () => {
    setExpandedRepos(new Set());
    setExpandedDirs(new Set());
  };

  const handleCommit = async () => {
    if (!commitMessage.trim() || checkedSummary.fileCount === 0) return;
    await onCommitChecked(commitMessage);
    setCommitMessage('');
  };

  const handleConfirmSingleRevert = async () => {
    if (!revertTarget) return;
    setIsRevertingSingle(true);
    try {
      await onRevertFile(revertTarget.repo, revertTarget.file);
      setRevertTarget(null);
    } finally {
      setIsRevertingSingle(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header">
        <span className="sidebar-title">Commit / Changes</span>
        <div className="sidebar-toolbar">
          <div className="segmented" title="Switch Tree / List view">
            <button
              className={viewMode === 'tree' ? 'active' : ''}
              onClick={() => onChangeViewMode('tree')}
            >
              <FolderTree size={12} /> Tree
            </button>
            <button
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => onChangeViewMode('list')}
            >
              <List size={12} /> List
            </button>
          </div>
          <button
            className="icon-btn"
            title="Expand All Repos & Folders"
            onClick={handleExpandAll}
          >
            <UnfoldVertical size={14} />
          </button>
          <button
            className="icon-btn"
            title="Collapse All Repos & Folders"
            onClick={handleCollapseAll}
          >
            <FoldVertical size={14} />
          </button>
          <button
            className={`icon-btn ${onlyDirtyRepos ? 'active' : ''}`}
            title={
              onlyDirtyRepos
                ? 'Showing active/dirty repos (click to show all)'
                : 'Showing all repos (click to hide clean repos)'
            }
            onClick={() => setOnlyDirtyRepos((v) => !v)}
          >
            <GitBranch size={14} />
          </button>
        </div>
      </div>

      <div className="search-box">
        <Search size={13} style={{ color: 'var(--text-muted)' }} />
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter changed files or repos..."
        />
      </div>

      <div className="sidebar-scroll">
        {visibleRepos.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>
            <div style={{ fontSize: 12.5 }}>
              {repos.length === 0
                ? 'No Git repositories found under this root.'
                : 'Working trees are clean across all discovered repos.'}
            </div>
            {repos.length > 0 && onlyDirtyRepos && (
              <button className="btn" onClick={() => setOnlyDirtyRepos(false)}>
                Show all {repos.length} clean repos
              </button>
            )}
          </div>
        ) : (
          visibleRepos.map(({ repo, filteredChanges }) => {
            const isExpanded = expandedRepos.has(repo.id);
            const allChecked =
              filteredChanges.length > 0 &&
              filteredChanges.every((c) =>
                checkedKeys.has(makeChangeKey(repo.id, c.path))
              );
            const someChecked =
              !allChecked &&
              filteredChanges.some((c) =>
                checkedKeys.has(makeChangeKey(repo.id, c.path))
              );
            const baselineChanged =
              baselineMap[repo.id] &&
              repo.headSha &&
              baselineMap[repo.id] !== repo.headSha;

            const isDirtyOrAhead =
              repo.changes.length > 0 || repo.ahead > 0;
            const dropClass =
              dropIndicator?.repoId === repo.id
                ? `drop-${dropIndicator.position}`
                : '';

            return (
              <div
                key={repo.id}
                className={`repo-group ${dropClass}`.trim()}
              >
                <div
                  className={`repo-header ${isDirtyOrAhead ? 'repo-dirty' : 'repo-clean'}`}
                  draggable={!filterText.trim() && visibleRepos.length > 1}
                  onDragStart={(e) => {
                    setDraggedRepoId(repo.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', repo.id);
                  }}
                  onDragOver={(e) => {
                    if (!draggedRepoId || draggedRepoId === repo.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = e.currentTarget.getBoundingClientRect();
                    const position =
                      e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    setDropIndicator((prev) =>
                      prev?.repoId === repo.id && prev.position === position
                        ? prev
                        : { repoId: repo.id, position }
                    );
                  }}
                  onDragLeave={(e) => {
                    if (
                      e.relatedTarget instanceof Node &&
                      e.currentTarget.contains(e.relatedTarget)
                    ) {
                      return;
                    }
                    setDropIndicator((prev) =>
                      prev?.repoId === repo.id ? null : prev
                    );
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const sourceId =
                      draggedRepoId || e.dataTransfer.getData('text/plain');
                    const rect = e.currentTarget.getBoundingClientRect();
                    const position =
                      e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    setDraggedRepoId(null);
                    setDropIndicator(null);
                    if (sourceId && sourceId !== repo.id) {
                      onReorderRepo(sourceId, repo.id, position);
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedRepoId(null);
                    setDropIndicator(null);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu(null);
                    const x = Math.min(e.clientX, window.innerWidth - 220);
                    const y = Math.min(e.clientY, window.innerHeight - 190);
                    setRepoContextMenu({ x, y, repo });
                  }}
                  onClick={() => toggleRepoExpand(repo.id)}
                >
                  {isExpanded ? (
                    <ChevronDown size={14} style={{ flexShrink: 0 }} />
                  ) : (
                    <ChevronRight size={14} style={{ flexShrink: 0 }} />
                  )}
                  <span
                    className="checkbox-cell"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleRepoCheck(repo);
                    }}
                    style={{
                      color:
                        allChecked || someChecked
                          ? 'var(--accent)'
                          : 'var(--text-muted)'
                    }}
                    title="Select/deselect all changes in this repo"
                  >
                    {allChecked ? (
                      <CheckSquare size={14} />
                    ) : (
                      <Square size={14} />
                    )}
                  </span>
                  <span className="repo-name" title={repo.path}>
                    {repo.name}
                  </span>
                  <span className="branch-tag" title={repo.branch}>
                    <GitBranch size={10} />
                    {repo.branch}
                  </span>
                  <span style={{ flex: 1 }} />
                  {baselineChanged && (
                    <span
                      className="count-pill baseline"
                      title="HEAD moved since Harness Baseline"
                    >
                      new commits
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
                  <span className="count-pill">{filteredChanges.length}</span>
                </div>

                {isExpanded && filteredChanges.length > 0 && (
                  <TreeOrListRenderer
                    items={filteredChanges}
                    viewMode={viewMode}
                    getKey={(c) => makeChangeKey(repo.id, c.path)}
                    getPath={(c) => c.path}
                    selectedKey={selectedChangeKey}
                    expandedDirs={expandedDirs}
                    onToggleDir={toggleDir}
                    dirKeyPrefix={`chg:${repo.id}`}
                    onSelect={(c) => onSelectChange(repo, c)}
                    onItemContextMenu={(e, file) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setRepoContextMenu(null);
                      const x = Math.min(e.clientX, window.innerWidth - 220);
                      const y = Math.min(e.clientY, window.innerHeight - 310);
                      setContextMenu({ x, y, repo, file });
                    }}
                    renderPrefix={(c) => {
                      const k = makeChangeKey(repo.id, c.path);
                      const checked = checkedKeys.has(k);
                      return (
                        <span
                          className="checkbox-cell"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleCheck(k);
                          }}
                          style={{
                            color: checked
                              ? 'var(--accent)'
                              : 'var(--text-muted)'
                          }}
                        >
                          {checked ? (
                            <CheckSquare size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                        </span>
                      );
                    }}
                    renderSuffix={(c) => (
                      <>
                        {c.staged && (
                          <span
                            className="tag-pill"
                            style={{
                              background: 'rgba(89,179,114,0.16)',
                              color: 'var(--status-a)'
                            }}
                            title="Staged in index"
                          >
                            S
                          </span>
                        )}
                        <span className={`status-badge status-${c.status}`}>
                          {c.status}
                        </span>
                      </>
                    )}
                    renderActions={(c) => (
                      <>
                        <button
                          className="mini-btn"
                          title="Revert changes to this file"
                          onClick={() => setRevertTarget({ repo, file: c })}
                        >
                          ↺
                        </button>
                        <button
                          className="mini-btn"
                          title="Set as Compare Left (A)"
                          onClick={() => onCompareWithA(repo, c.path)}
                        >
                          A
                        </button>
                        <button
                          className="mini-btn"
                          title="Set as Compare Right (B)"
                          onClick={() => onCompareWithB(repo, c.path)}
                        >
                          B
                        </button>
                      </>
                    )}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="commit-box">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Commit message for checked files..."
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              void handleCommit();
            }
          }}
        />
        <div className="commit-box-footer">
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn"
              disabled={checkedSummary.fileCount === 0 || isCommitting}
              onClick={() => void onStageChecked()}
              title="Stage checked files"
            >
              Stage
            </button>
            <button
              className="btn"
              disabled={checkedSummary.fileCount === 0 || isCommitting}
              onClick={() => void onUnstageChecked()}
              title="Unstage checked files"
            >
              Unstage
            </button>
            {!confirmDiscard ? (
              <button
                className="btn btn-danger"
                disabled={checkedSummary.fileCount === 0 || isCommitting}
                onClick={() => setConfirmDiscard(true)}
                title="Discard working changes for checked files"
              >
                <RotateCcw size={12} />
              </button>
            ) : (
              <button
                className="btn btn-danger"
                onClick={() => {
                  setConfirmDiscard(false);
                  void onDiscardChecked();
                }}
                onMouseLeave={() => setConfirmDiscard(false)}
              >
                Confirm Discard?
              </button>
            )}
          </div>
          <button
            className="btn btn-primary"
            disabled={
              checkedSummary.fileCount === 0 ||
              !commitMessage.trim() ||
              isCommitting
            }
            onClick={() => void handleCommit()}
            title="Ctrl+Enter to commit checked files per repo"
          >
            Commit ({checkedSummary.fileCount}
            {checkedSummary.repoCount > 1
              ? ` / ${checkedSummary.repoCount} repos`
              : ''}
            )
          </button>
        </div>
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              onSelectChange(contextMenu.repo, contextMenu.file);
              setContextMenu(null);
            }}
          >
            <Eye size={14} /> View Diff
          </button>

          {(!contextMenu.file.staged || contextMenu.file.unstaged) && (
            <button
              className="context-menu-item"
              onClick={() => {
                const { repo, file } = contextMenu;
                setContextMenu(null);
                void onStageFile(repo, file);
              }}
            >
              <PlusCircle size={14} /> Stage File
            </button>
          )}

          {contextMenu.file.staged && (
            <button
              className="context-menu-item"
              onClick={() => {
                const { repo, file } = contextMenu;
                setContextMenu(null);
                void onUnstageFile(repo, file);
              }}
            >
              <MinusCircle size={14} /> Unstage File
            </button>
          )}

          <button
            className="context-menu-item danger"
            onClick={() => {
              const { repo, file } = contextMenu;
              setContextMenu(null);
              setRevertTarget({ repo, file });
            }}
          >
            <RotateCcw size={14} />
            {contextMenu.file.untracked
              ? 'Delete Untracked File...'
              : 'Revert Changes...'}
          </button>

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => {
              onCompareWithA(contextMenu.repo, contextMenu.file.path);
              setContextMenu(null);
            }}
          >
            Set as Compare Left (A)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              onCompareWithB(contextMenu.repo, contextMenu.file.path);
              setContextMenu(null);
            }}
          >
            Set as Compare Right (B)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              void navigator.clipboard.writeText(contextMenu.file.path);
              setContextMenu(null);
            }}
          >
            <Copy size={14} /> Copy Relative Path
          </button>

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => {
              const target = joinRepoFilePath(
                contextMenu.repo.path,
                contextMenu.file.path
              );
              setContextMenu(null);
              void window.gitViewer.showInExplorer(target, true);
            }}
          >
            <FolderOpen size={14} /> Show in Explorer
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const target = joinRepoFilePath(
                contextMenu.repo.path,
                contextMenu.file.path
              );
              setContextMenu(null);
              void window.gitViewer.openTerminal(target);
            }}
          >
            <Terminal size={14} /> Open Terminal Here
          </button>
        </div>
      )}

      {repoContextMenu && (
        <div
          className="context-menu"
          style={{ left: repoContextMenu.x, top: repoContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              const target = repoContextMenu.repo.path;
              setRepoContextMenu(null);
              void window.gitViewer.showInExplorer(target, false);
            }}
          >
            <FolderOpen size={14} /> Show in Explorer
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const target = repoContextMenu.repo.path;
              setRepoContextMenu(null);
              void window.gitViewer.openTerminal(target);
            }}
          >
            <Terminal size={14} /> Open Terminal in Repo
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const target = repoContextMenu.repo.path;
              setRepoContextMenu(null);
              onOpenRepoInNewWindow(target);
            }}
          >
            <ExternalLink size={14} /> Open Repo in New Window
          </button>

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => {
              void navigator.clipboard.writeText(repoContextMenu.repo.path);
              setRepoContextMenu(null);
            }}
          >
            <Copy size={14} /> Copy Repo Path
          </button>
        </div>
      )}

      {revertTarget && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!isRevertingSingle) setRevertTarget(null);
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <AlertTriangle size={18} style={{ color: 'var(--status-d)' }} />
              <span>
                {revertTarget.file.untracked
                  ? 'Delete Untracked File?'
                  : 'Revert File Changes?'}
              </span>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {revertTarget.file.untracked
                ? 'This untracked file will be permanently deleted from disk:'
                : 'This will discard all staged and unstaged changes and restore the file to HEAD:'}
            </div>

            <div className="modal-path">
              <strong>{revertTarget.repo.name}</strong> / {revertTarget.file.path}
            </div>

            <div className="modal-actions">
              <button
                className="btn"
                disabled={isRevertingSingle}
                onClick={() => setRevertTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                style={{
                  background: 'var(--status-d)',
                  borderColor: 'var(--status-d)',
                  color: '#fff'
                }}
                disabled={isRevertingSingle}
                onClick={() => void handleConfirmSingleRevert()}
              >
                {isRevertingSingle
                  ? 'Reverting...'
                  : revertTarget.file.untracked
                    ? 'Delete File'
                    : 'Revert File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
