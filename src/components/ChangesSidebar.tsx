import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileX2,
  FolderOpen,
  FolderTree,
  GitBranch,
  List,
  MinusCircle,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  SquareMinus,
  SquarePlus,
  Terminal,
  Upload
} from 'lucide-react';
import { ChangedFile, IgnoreTarget, RepoSummary } from '../../shared/types';
import {
  getTreeDirKeys,
  TreeOrListRenderer,
  ViewMode
} from './TreeOrListRenderer';

type ChangeFilter = 'all' | 'staged' | 'unstaged' | 'held';
type DiffPreset = 'head-staged' | 'staged-working' | 'head-working';

interface ChangesSidebarProps {
  repos: RepoSummary[];
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  selectedChangeKey: string | null;
  selectedChangePreset?: string;
  checkedKeys: Set<string>;
  heldKeys: Set<string>;
  onToggleCheck: (key: string) => void;
  onToggleRepoCheck: (repo: RepoSummary) => void;
  onToggleHold: (key: string) => void;
  onToggleHoldMany: (keys: string[], hold: boolean) => void;
  onSelectChange: (
    repo: RepoSummary,
    file: ChangedFile,
    preferredPreset?: DiffPreset
  ) => void;
  onCompareWithA: (repo: RepoSummary, filePath: string) => void;
  onCompareWithB: (repo: RepoSummary, filePath: string) => void;
  onCommitChecked: (message: string) => Promise<void>;
  onCommitStaged: (message: string) => Promise<void>;
  onDiscardChecked: () => Promise<void>;
  onStageChecked: () => Promise<void>;
  onUnstageChecked: () => Promise<void>;
  onStageFile: (repo: RepoSummary, file: ChangedFile) => Promise<void>;
  onUnstageFile: (repo: RepoSummary, file: ChangedFile) => Promise<void>;
  onStageAllRepo: (repo: RepoSummary) => Promise<void>;
  onUnstageAllRepo: (repo: RepoSummary) => Promise<void>;
  onStageManyFiles: (repo: RepoSummary, paths: string[]) => Promise<void>;
  onUnstageManyFiles: (repo: RepoSummary, paths: string[]) => Promise<void>;
  onRevertFile: (repo: RepoSummary, file: ChangedFile) => Promise<void>;
  onIgnorePattern: (
    repo: RepoSummary,
    pattern: string,
    target: IgnoreTarget,
    untrackPaths?: string[],
    heldKeyToClear?: string
  ) => Promise<void>;
  onSkipWorktree: (
    repo: RepoSummary,
    paths: string[],
    skip: boolean,
    heldKeyToClear?: string
  ) => Promise<void>;
  onRestoreSkipWorktreeRepo: (repo: RepoSummary) => Promise<void>;
  onRemoteAction: (
    repo: RepoSummary,
    action: 'fetch' | 'pull' | 'push'
  ) => Promise<void>;
  onCopyHarnessPlan: (repoScope?: RepoSummary) => void;
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
  selectedChangePreset,
  checkedKeys,
  heldKeys,
  onToggleCheck,
  onToggleRepoCheck,
  onToggleHold,
  onToggleHoldMany,
  onSelectChange,
  onCompareWithA,
  onCompareWithB,
  onCommitChecked,
  onCommitStaged,
  onDiscardChecked,
  onStageChecked,
  onUnstageChecked,
  onStageFile,
  onUnstageFile,
  onStageAllRepo,
  onUnstageAllRepo,
  onStageManyFiles,
  onUnstageManyFiles,
  onRevertFile,
  onIgnorePattern,
  onSkipWorktree,
  onRestoreSkipWorktreeRepo,
  onRemoteAction,
  onCopyHarnessPlan,
  onOpenRepoInNewWindow,
  onReorderRepo,
  isCommitting,
  baselineMap
}) => {
  const [filterText, setFilterText] = useState('');
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all');
  const [onlyDirtyRepos, setOnlyDirtyRepos] = useState(true);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [isDiscardingChecked, setIsDiscardingChecked] = useState(false);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    repo: RepoSummary;
    file: ChangedFile;
    section: 'staged' | 'unstaged' | 'held';
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
    if (!revertTarget && !confirmDiscard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (revertTarget && !isRevertingSingle) setRevertTarget(null);
        if (confirmDiscard && !isDiscardingChecked) setConfirmDiscard(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [revertTarget, isRevertingSingle, confirmDiscard, isDiscardingChecked]);

  const filterCounts = useMemo(() => {
    let all = 0;
    let staged = 0;
    let unstaged = 0;
    let held = 0;
    for (const repo of repos) {
      for (const c of repo.changes) {
        all += 1;
        if (heldKeys.has(makeChangeKey(repo.id, c.path))) {
          held += 1;
        } else {
          if (c.staged) staged += 1;
          if (c.unstaged || c.untracked) unstaged += 1;
        }
      }
    }
    return { all, staged, unstaged, held };
  }, [repos, heldKeys]);

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

        const stagedChanges = filteredChanges.filter(
          (c) => c.staged && !heldKeys.has(makeChangeKey(repo.id, c.path))
        );
        const unstagedChanges = filteredChanges.filter(
          (c) =>
            (c.unstaged || c.untracked) &&
            !heldKeys.has(makeChangeKey(repo.id, c.path))
        );
        const heldChanges = filteredChanges.filter((c) =>
          heldKeys.has(makeChangeKey(repo.id, c.path))
        );

        return {
          repo,
          filteredChanges,
          stagedChanges,
          unstagedChanges,
          heldChanges
        };
      })
      .filter(
        ({
          repo,
          filteredChanges,
          stagedChanges,
          unstagedChanges,
          heldChanges
        }) => {
          if (changeFilter === 'staged') return stagedChanges.length > 0;
          if (changeFilter === 'unstaged') return unstagedChanges.length > 0;
          if (changeFilter === 'held') return heldChanges.length > 0;
          if (q) return filteredChanges.length > 0;
          if (onlyDirtyRepos) return repo.changes.length > 0 || repo.ahead > 0;
          return true;
        }
      );
  }, [repos, filterText, onlyDirtyRepos, changeFilter, heldKeys]);

  const checkedSummary = useMemo(() => {
    let fileCount = 0;
    let untrackedCount = 0;
    const repoIds = new Set<string>();
    const checkedKeyList: string[] = [];
    const items: Array<{ repoName: string; path: string; untracked: boolean }> =
      [];
    for (const r of repos) {
      for (const c of r.changes) {
        const key = makeChangeKey(r.id, c.path);
        if (checkedKeys.has(key) && !heldKeys.has(key)) {
          fileCount += 1;
          if (c.untracked) untrackedCount += 1;
          repoIds.add(r.id);
          checkedKeyList.push(key);
          items.push({
            repoName: r.name,
            path: c.path,
            untracked: c.untracked
          });
        }
      }
    }
    return {
      fileCount,
      untrackedCount,
      trackedCount: fileCount - untrackedCount,
      repoCount: repoIds.size,
      checkedKeyList,
      items
    };
  }, [repos, checkedKeys, heldKeys]);

  const stagedRepoCount = useMemo(() => {
    let count = 0;
    for (const r of repos) {
      if (
        r.changes.some(
          (c) => c.staged && !heldKeys.has(makeChangeKey(r.id, c.path))
        )
      ) {
        count += 1;
      }
    }
    return count;
  }, [repos, heldKeys]);

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
    for (const {
      repo,
      stagedChanges,
      unstagedChanges,
      heldChanges
    } of visibleRepos) {
      repoIds.add(repo.id);
      for (const k of getTreeDirKeys(
        stagedChanges,
        (c) => c.path,
        `staged:${repo.id}`
      )) {
        dirKeys.add(k);
      }
      for (const k of getTreeDirKeys(
        unstagedChanges,
        (c) => c.path,
        `unstaged:${repo.id}`
      )) {
        dirKeys.add(k);
      }
      for (const k of getTreeDirKeys(
        heldChanges,
        (c) => c.path,
        `held:${repo.id}`
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

  const handleCommitStagedOnly = async () => {
    if (!commitMessage.trim() || filterCounts.staged === 0) return;
    await onCommitStaged(commitMessage);
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
        <span className="sidebar-title">Changes</span>
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
            <SquarePlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="Collapse All Repos & Folders"
            onClick={handleCollapseAll}
          >
            <SquareMinus size={14} />
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

      <div className="change-filter-strip">
        <div className="segmented" style={{ width: '100%' }}>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={changeFilter === 'all' ? 'active' : ''}
            onClick={() => setChangeFilter('all')}
            title="Show staged, unstaged, and held changes"
          >
            All ({filterCounts.all})
          </button>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={changeFilter === 'staged' ? 'active' : ''}
            onClick={() => setChangeFilter('staged')}
            title="Show only staged changes (ready in Git index)"
          >
            Staged ({filterCounts.staged})
          </button>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={changeFilter === 'unstaged' ? 'active' : ''}
            onClick={() => setChangeFilter('unstaged')}
            title="Show only unstaged & untracked changes"
          >
            Unstaged ({filterCounts.unstaged})
          </button>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={changeFilter === 'held' ? 'active' : ''}
            onClick={() => setChangeFilter('held')}
            title="Show files flagged as Hold / Do Not Commit"
          >
            Held ({filterCounts.held})
          </button>
        </div>
      </div>

      <div className="sidebar-scroll">
        {visibleRepos.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>
            <div style={{ fontSize: '0.962rem' }}>
              {repos.length === 0
                ? 'No Git repositories found under this root.'
                : changeFilter === 'staged'
                  ? 'No staged changes across repositories.'
                  : changeFilter === 'unstaged'
                    ? 'No unstaged changes across repositories.'
                    : changeFilter === 'held'
                      ? 'No files are currently flagged as Hold (Do Not Commit).'
                      : 'Working trees are clean across all discovered repos.'}
            </div>
            {changeFilter !== 'all' ? (
              <button className="btn" onClick={() => setChangeFilter('all')}>
                Show All Changes
              </button>
            ) : (
              repos.length > 0 &&
              onlyDirtyRepos && (
                <button className="btn" onClick={() => setOnlyDirtyRepos(false)}>
                  Show all {repos.length} clean repos
                </button>
              )
            )}
          </div>
        ) : (
          visibleRepos.map(
            ({
              repo,
              filteredChanges,
              stagedChanges,
              unstagedChanges,
              heldChanges
            }) => {
              const isExpanded =
                expandedRepos.has(repo.id) || changeFilter !== 'all';
              const selectableChanges = filteredChanges.filter(
                (c) => !heldKeys.has(makeChangeKey(repo.id, c.path))
              );
              const allChecked =
                selectableChanges.length > 0 &&
                selectableChanges.every((c) =>
                  checkedKeys.has(makeChangeKey(repo.id, c.path))
                );
              const someChecked =
                !allChecked &&
                selectableChanges.some((c) =>
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

              const showStagedSection =
                stagedChanges.length > 0 &&
                (changeFilter === 'all' || changeFilter === 'staged');
              const showUnstagedSection =
                unstagedChanges.length > 0 &&
                (changeFilter === 'all' || changeFilter === 'unstaged');
              const showHeldSection =
                heldChanges.length > 0 &&
                (changeFilter === 'all' || changeFilter === 'held');

              const openContextFor = (
                e: React.MouseEvent,
                file: ChangedFile,
                section: 'staged' | 'unstaged' | 'held'
              ) => {
                e.preventDefault();
                e.stopPropagation();
                setRepoContextMenu(null);
                const x = Math.min(e.clientX, window.innerWidth - 260);
                const y = Math.min(e.clientY, window.innerHeight - 380);
                setContextMenu({ x, y, repo, file, section });
              };

              const stagedSelectedKey =
                selectedChangePreset === 'head-staged'
                  ? selectedChangeKey
                  : selectedChangePreset !== 'staged-working' &&
                      unstagedChanges.length === 0
                    ? selectedChangeKey
                    : null;
              const unstagedSelectedKey =
                selectedChangePreset === 'staged-working' ||
                (selectedChangePreset !== 'head-staged' &&
                  unstagedChanges.length > 0)
                  ? selectedChangeKey
                  : null;

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
                  {stagedChanges.length > 0 && (
                    <span
                      className="count-pill staged-pill"
                      title={`${stagedChanges.length} staged change(s)`}
                    >
                      S:{stagedChanges.length}
                    </span>
                  )}
                  {unstagedChanges.length > 0 && (
                    <span
                      className="count-pill unstaged-pill"
                      title={`${unstagedChanges.length} unstaged/untracked change(s)`}
                    >
                      U:{unstagedChanges.length}
                    </span>
                  )}
                  {heldChanges.length > 0 && (
                    <span
                      className="count-pill held-pill"
                      title={`${heldChanges.length} held (do not commit)`}
                    >
                      H:{heldChanges.length}
                    </span>
                  )}
                  {stagedChanges.length === 0 &&
                    unstagedChanges.length === 0 &&
                    heldChanges.length === 0 && (
                      <span className="count-pill">0</span>
                    )}
                </div>

                {isExpanded && showStagedSection && (
                  <div className="change-section">
                    <div className="change-section-header staged">
                      <CheckCircle2 size={12} />
                      <span>STAGED CHANGES</span>
                      <span className="count-pill staged-pill">
                        {stagedChanges.length}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button
                        className="mini-btn"
                        title="Unstage all staged files in this repo"
                        onClick={() =>
                          void onUnstageManyFiles(
                            repo,
                            stagedChanges.map((c) => c.path)
                          )
                        }
                      >
                        Unstage All
                      </button>
                    </div>
                    <TreeOrListRenderer
                      items={stagedChanges}
                      viewMode={viewMode}
                      getKey={(c) => makeChangeKey(repo.id, c.path)}
                      getPath={(c) => c.path}
                      selectedKey={stagedSelectedKey}
                      expandedDirs={expandedDirs}
                      onToggleDir={toggleDir}
                      dirKeyPrefix={`staged:${repo.id}`}
                      onSelect={(c) => onSelectChange(repo, c, 'head-staged')}
                      onItemContextMenu={(e, file) =>
                        openContextFor(e, file, 'staged')
                      }
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
                          <span
                            className="state-pill state-staged"
                            title="Staged in Git index"
                          >
                            S
                          </span>
                          {c.unstaged && (
                            <span
                              className="state-pill state-partial"
                              title="Also has unstaged edits in working tree"
                            >
                              +W
                            </span>
                          )}
                          <span className={`status-badge status-${c.indexStatus === ' ' ? c.status : c.indexStatus}`}>
                            {c.indexStatus !== ' ' ? c.indexStatus : c.status}
                          </span>
                        </>
                      )}
                      renderActions={(c) => {
                        const k = makeChangeKey(repo.id, c.path);
                        return (
                          <>
                            <button
                              className="mini-btn"
                              title="Unstage file"
                              onClick={() => void onUnstageFile(repo, c)}
                            >
                              −
                            </button>
                            <button
                              className="mini-btn"
                              title="Hold / Do Not Commit"
                              onClick={() => onToggleHold(k)}
                            >
                              Hold
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
                        );
                      }}
                    />
                  </div>
                )}

                {isExpanded && showUnstagedSection && (
                  <div className="change-section">
                    <div className="change-section-header unstaged">
                      <CircleDot size={12} />
                      <span>UNSTAGED CHANGES</span>
                      <span className="count-pill unstaged-pill">
                        {unstagedChanges.length}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button
                        className="mini-btn"
                        title="Stage all unstaged/untracked files in this repo"
                        onClick={() =>
                          void onStageManyFiles(
                            repo,
                            unstagedChanges.map((c) => c.path)
                          )
                        }
                      >
                        Stage All
                      </button>
                    </div>
                    <TreeOrListRenderer
                      items={unstagedChanges}
                      viewMode={viewMode}
                      getKey={(c) => makeChangeKey(repo.id, c.path)}
                      getPath={(c) => c.path}
                      selectedKey={unstagedSelectedKey}
                      expandedDirs={expandedDirs}
                      onToggleDir={toggleDir}
                      dirKeyPrefix={`unstaged:${repo.id}`}
                      onSelect={(c) =>
                        onSelectChange(
                          repo,
                          c,
                          c.staged ? 'staged-working' : 'head-working'
                        )
                      }
                      onItemContextMenu={(e, file) =>
                        openContextFor(e, file, 'unstaged')
                      }
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
                      renderSuffix={(c) => {
                        const wtChar = c.untracked
                          ? '?'
                          : c.worktreeStatus !== ' '
                            ? c.worktreeStatus
                            : c.status;
                        return (
                          <>
                            <span
                              className={`state-pill ${c.untracked ? 'state-untracked' : 'state-unstaged'}`}
                              title={
                                c.untracked
                                  ? 'Untracked file (not in Git index)'
                                  : 'Unstaged working tree changes'
                              }
                            >
                              {c.untracked ? '?' : 'U'}
                            </span>
                            {c.staged && (
                              <span
                                className="state-pill state-partial"
                                title="Also has staged changes in index"
                              >
                                +S
                              </span>
                            )}
                            <span className={`status-badge status-${wtChar}`}>
                              {wtChar}
                            </span>
                          </>
                        );
                      }}
                      renderActions={(c) => {
                        const k = makeChangeKey(repo.id, c.path);
                        return (
                          <>
                            <button
                              className="mini-btn"
                              title="Stage file"
                              onClick={() => void onStageFile(repo, c)}
                            >
                              +
                            </button>
                            <button
                              className="mini-btn"
                              title="Hold / Do Not Commit"
                              onClick={() => onToggleHold(k)}
                            >
                              Hold
                            </button>
                            <button
                              className="mini-btn"
                              title="Revert or delete file"
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
                        );
                      }}
                    />
                  </div>
                )}

                {isExpanded && showHeldSection && (
                  <div className="change-section held-section">
                    <div className="change-section-header held">
                      <Ban size={12} />
                      <span>HELD (DO NOT COMMIT)</span>
                      <span className="count-pill held-pill">
                        {heldChanges.length}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button
                        className="mini-btn"
                        title="Resume all held files back to normal changes"
                        onClick={() =>
                          onToggleHoldMany(
                            heldChanges.map((c) => makeChangeKey(repo.id, c.path)),
                            false
                          )
                        }
                      >
                        Unhold All
                      </button>
                    </div>
                    <TreeOrListRenderer
                      items={heldChanges}
                      viewMode={viewMode}
                      getKey={(c) => makeChangeKey(repo.id, c.path)}
                      getPath={(c) => c.path}
                      selectedKey={selectedChangeKey}
                      expandedDirs={expandedDirs}
                      onToggleDir={toggleDir}
                      dirKeyPrefix={`held:${repo.id}`}
                      onSelect={(c) =>
                        onSelectChange(
                          repo,
                          c,
                          c.staged && !c.unstaged
                            ? 'head-staged'
                            : 'head-working'
                        )
                      }
                      onItemContextMenu={(e, file) =>
                        openContextFor(e, file, 'held')
                      }
                      renderPrefix={(c) => {
                        const k = makeChangeKey(repo.id, c.path);
                        return (
                          <span
                            className="checkbox-cell"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleHold(k);
                            }}
                            style={{ color: 'var(--status-m)' }}
                            title="Flagged as Hold / Do Not Commit (click to unhold)"
                          >
                            <Ban size={13} />
                          </span>
                        );
                      }}
                      renderSuffix={(c) => (
                        <>
                          <span
                            className="state-pill state-held"
                            title="Flagged as Do Not Commit"
                          >
                            HOLD
                          </span>
                          {c.staged && (
                            <span
                              className="state-pill state-staged"
                              title="Warning: still staged in Git index (click Unstage to clear)"
                            >
                              S
                            </span>
                          )}
                          <span className={`status-badge status-${c.status}`}>
                            {c.status}
                          </span>
                        </>
                      )}
                      renderActions={(c) => {
                        const k = makeChangeKey(repo.id, c.path);
                        return (
                          <>
                            <button
                              className="mini-btn"
                              title="Resume / Unhold file"
                              onClick={() => onToggleHold(k)}
                            >
                              Resume
                            </button>
                            <button
                              className="mini-btn"
                              title="Revert or delete file"
                              onClick={() => setRevertTarget({ repo, file: c })}
                            >
                              ↺
                            </button>
                          </>
                        );
                      }}
                    />
                  </div>
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
        <div className="commit-box-footer" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
            <button
              className="btn"
              disabled={checkedSummary.fileCount === 0 || isCommitting}
              onClick={() =>
                onToggleHoldMany(checkedSummary.checkedKeyList, true)
              }
              title="Flag checked files as Hold (Do Not Commit)"
            >
              <Ban size={12} /> Hold
            </button>
            <button
              className="btn btn-danger"
              disabled={checkedSummary.fileCount === 0 || isCommitting}
              onClick={() => setConfirmDiscard(true)}
              title="Discard changes for checked files..."
            >
              <RotateCcw size={12} />
            </button>
            <button
              className="btn"
              disabled={repos.length === 0}
              onClick={() => onCopyHarnessPlan()}
              title="Copy structured commit / ignore list for AI Harness to clipboard"
            >
              <ClipboardList size={12} /> Plan
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            {filterCounts.staged > 0 && (
              <button
                className="btn"
                disabled={!commitMessage.trim() || isCommitting}
                onClick={() => void handleCommitStagedOnly()}
                title={`Commit ONLY staged changes across ${stagedRepoCount} repo(s) without adding unstaged files`}
              >
                Commit Staged ({filterCounts.staged})
              </button>
            )}
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
              onSelectChange(
                contextMenu.repo,
                contextMenu.file,
                contextMenu.section === 'staged'
                  ? 'head-staged'
                  : contextMenu.file.staged
                    ? 'staged-working'
                    : 'head-working'
              );
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

          {heldKeys.has(
            makeChangeKey(contextMenu.repo.id, contextMenu.file.path)
          ) ? (
            <button
              className="context-menu-item"
              onClick={() => {
                const k = makeChangeKey(
                  contextMenu.repo.id,
                  contextMenu.file.path
                );
                setContextMenu(null);
                onToggleHold(k);
              }}
            >
              <PlayCircle size={14} /> Unhold (Include in Changes)
            </button>
          ) : (
            <button
              className="context-menu-item"
              onClick={() => {
                const k = makeChangeKey(
                  contextMenu.repo.id,
                  contextMenu.file.path
                );
                setContextMenu(null);
                onToggleHold(k);
              }}
            >
              <PauseCircle size={14} /> Hold (Do Not Commit)
            </button>
          )}

          <div className="context-menu-divider" />

          {contextMenu.file.untracked ? (
            <>
              <button
                className="context-menu-item"
                onClick={() => {
                  const { repo, file } = contextMenu;
                  setContextMenu(null);
                  void onIgnorePattern(
                    repo,
                    file.path,
                    'exclude',
                    undefined,
                    makeChangeKey(repo.id, file.path)
                  );
                }}
              >
                <EyeOff size={14} /> Ignore Locally (.git/info/exclude)
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  const { repo, file } = contextMenu;
                  setContextMenu(null);
                  void onIgnorePattern(
                    repo,
                    file.path,
                    'gitignore',
                    undefined,
                    makeChangeKey(repo.id, file.path)
                  );
                }}
              >
                <FileX2 size={14} /> Add to .gitignore
              </button>
            </>
          ) : (
            <>
              <button
                className="context-menu-item"
                onClick={() => {
                  const { repo, file } = contextMenu;
                  setContextMenu(null);
                  void onSkipWorktree(
                    repo,
                    [file.path],
                    true,
                    makeChangeKey(repo.id, file.path)
                  );
                }}
              >
                <EyeOff size={14} /> Ignore Local Edits (--skip-worktree)
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  const { repo, file } = contextMenu;
                  setContextMenu(null);
                  void onIgnorePattern(
                    repo,
                    file.path,
                    'exclude',
                    [file.path],
                    makeChangeKey(repo.id, file.path)
                  );
                }}
              >
                <FileX2 size={14} /> Untrack & Ignore Locally (rm --cached)
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  const { repo, file } = contextMenu;
                  setContextMenu(null);
                  void onIgnorePattern(
                    repo,
                    file.path,
                    'gitignore',
                    [file.path],
                    makeChangeKey(repo.id, file.path)
                  );
                }}
              >
                <FileX2 size={14} /> Untrack & Add to .gitignore
              </button>
            </>
          )}

          {contextMenu.file.path.includes('/') && (
            <button
              className="context-menu-item"
              onClick={() => {
                const { repo, file } = contextMenu;
                const folder = file.path.slice(
                  0,
                  file.path.lastIndexOf('/') + 1
                );
                setContextMenu(null);
                void onIgnorePattern(
                  repo,
                  folder,
                  'exclude',
                  file.untracked ? undefined : [folder.replace(/\/$/, '')]
                );
              }}
            >
              <FolderOpen size={14} /> Ignore &ldquo;
              {contextMenu.file.path.slice(
                0,
                contextMenu.file.path.lastIndexOf('/') + 1
              )}
              &rdquo; Locally
            </button>
          )}

          <div className="context-menu-divider" />

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
              const repo = repoContextMenu.repo;
              setRepoContextMenu(null);
              void onStageAllRepo(repo);
            }}
          >
            <PlusCircle size={14} /> Stage All Changes
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const repo = repoContextMenu.repo;
              setRepoContextMenu(null);
              void onUnstageAllRepo(repo);
            }}
          >
            <MinusCircle size={14} /> Unstage All Changes
          </button>

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => {
              const repo = repoContextMenu.repo;
              setRepoContextMenu(null);
              void onRemoteAction(repo, 'fetch');
            }}
          >
            <RefreshCw size={14} /> Git Fetch (--prune)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const repo = repoContextMenu.repo;
              setRepoContextMenu(null);
              void onRemoteAction(repo, 'pull');
            }}
          >
            <Download size={14} /> Git Pull
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const repo = repoContextMenu.repo;
              setRepoContextMenu(null);
              void onRemoteAction(repo, 'push');
            }}
          >
            <Upload size={14} /> Git Push
          </button>

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => {
              const repo = repoContextMenu.repo;
              setRepoContextMenu(null);
              void onRestoreSkipWorktreeRepo(repo);
            }}
          >
            <Eye size={14} /> Restore Skip-Worktree Files
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const repo = repoContextMenu.repo;
              setRepoContextMenu(null);
              onCopyHarnessPlan(repo);
            }}
          >
            <ClipboardList size={14} /> Copy Harness Commit Plan
          </button>

          <div className="context-menu-divider" />

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

      {confirmDiscard && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!isDiscardingChecked) setConfirmDiscard(false);
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <AlertTriangle size={18} style={{ color: 'var(--status-d)' }} />
              <span>
                Discard {checkedSummary.fileCount} Checked File
                {checkedSummary.fileCount === 1 ? '' : 's'}?
              </span>
            </div>

            <div
              style={{
                fontSize: '0.962rem',
                color: 'var(--text-secondary)'
              }}
            >
              {checkedSummary.trackedCount > 0 &&
                `${checkedSummary.trackedCount} tracked file(s) will be restored to HEAD. `}
              {checkedSummary.untrackedCount > 0 &&
                `${checkedSummary.untrackedCount} untracked file(s) will be permanently deleted from disk.`}
            </div>

            <div
              className="modal-path"
              style={{
                maxHeight: 210,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}
            >
              {checkedSummary.items.map((item) => (
                <div key={`${item.repoName}::${item.path}`}>
                  <strong>{item.repoName}</strong> / {item.path}
                  {item.untracked && (
                    <span
                      style={{
                        color: 'var(--status-d)',
                        marginLeft: 6
                      }}
                    >
                      (delete untracked)
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button
                className="btn"
                disabled={isDiscardingChecked}
                onClick={() => setConfirmDiscard(false)}
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
                disabled={isDiscardingChecked}
                onClick={() => {
                  setIsDiscardingChecked(true);
                  void onDiscardChecked().finally(() => {
                    setIsDiscardingChecked(false);
                    setConfirmDiscard(false);
                  });
                }}
              >
                {isDiscardingChecked
                  ? 'Discarding...'
                  : `Discard ${checkedSummary.fileCount} File${checkedSummary.fileCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
