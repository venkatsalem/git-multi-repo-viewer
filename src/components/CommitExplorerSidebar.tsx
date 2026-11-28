import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Download,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  List,
  Search,
  Square,
  SquareMinus,
  SquarePlus
} from 'lucide-react';
import {
  BranchListResult,
  CommitFileChange,
  CommitInfo,
  RepoSummary
} from '../../shared/types';
import {
  getTreeDirKeys,
  TreeOrListRenderer,
  ViewMode
} from './TreeOrListRenderer';

interface CommitExplorerSidebarProps {
  repos: RepoSummary[];
  commits: CommitInfo[];
  loadingCommits: boolean;
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  baselineTimestamp: number | null;
  selectedCommit: CommitInfo | null;
  onSelectCommit: (commit: CommitInfo) => void;
  selectedCommitFile: string | null;
  onSelectCommitFile: (commit: CommitInfo, file: CommitFileChange) => void;
  onCherryPickCommits: (
    repoPath: string,
    shas: string[],
    noCommit: boolean
  ) => Promise<void>;
  onGetFileFromRef: (
    repoPath: string,
    ref: string,
    filePath: string
  ) => Promise<void>;
  onCompareWithA: (repoPath: string, filePath: string, ref: string) => void;
  onCompareWithB: (repoPath: string, filePath: string, ref: string) => void;
}

type CommitFilterMode = 'all' | 'unpushed' | 'baseline';

function formatRelativeTime(tsSeconds: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000 - tsSeconds));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export const CommitExplorerSidebar: React.FC<CommitExplorerSidebarProps> = ({
  repos,
  commits,
  loadingCommits,
  viewMode,
  onChangeViewMode,
  baselineTimestamp,
  selectedCommit,
  onSelectCommit,
  selectedCommitFile,
  onSelectCommitFile,
  onCherryPickCommits,
  onGetFileFromRef,
  onCompareWithA,
  onCompareWithB
}) => {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('ALL');
  const [selectedBranchRef, setSelectedBranchRef] = useState<string>('');
  const [repoBranches, setRepoBranches] = useState<BranchListResult | null>(
    null
  );
  const [branchCommits, setBranchCommits] = useState<CommitInfo[]>([]);
  const [loadingBranchCommits, setLoadingBranchCommits] = useState(false);
  const [checkedCommitKeys, setCheckedCommitKeys] = useState<Set<string>>(
    new Set()
  );
  const [isCherryPicking, setIsCherryPicking] = useState(false);
  const [filterMode, setFilterMode] = useState<CommitFilterMode>('all');
  const [searchText, setSearchText] = useState('');
  const [commitFiles, setCommitFiles] = useState<CommitFileChange[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const selectedRepo = useMemo(
    () => repos.find((r) => r.id === selectedRepoId) ?? null,
    [repos, selectedRepoId]
  );

  useEffect(() => {
    setSelectedBranchRef('');
    setCheckedCommitKeys(new Set());
    if (!selectedRepo) {
      setRepoBranches(null);
      return;
    }
    let cancelled = false;
    void window.gitViewer.getRepoBranches(selectedRepo.path).then((res) => {
      if (!cancelled) setRepoBranches(res);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo?.path]);

  useEffect(() => {
    if (!selectedRepo || !selectedBranchRef) {
      setBranchCommits([]);
      return;
    }
    let cancelled = false;
    setLoadingBranchCommits(true);
    void window.gitViewer
      .getRepoCommits(
        {
          id: selectedRepo.id,
          name: selectedRepo.name,
          path: selectedRepo.path
        },
        100,
        selectedBranchRef
      )
      .then((res) => {
        if (!cancelled) setBranchCommits(res);
      })
      .finally(() => {
        if (!cancelled) setLoadingBranchCommits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selectedBranchRef]);

  useEffect(() => {
    if (!selectedCommit) {
      setCommitFiles([]);
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    void window.gitViewer
      .getCommitFiles(selectedCommit.repoPath, selectedCommit.sha)
      .then((files) => {
        if (!cancelled) {
          setCommitFiles(files);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCommit]);

  const sourceCommits = useMemo(() => {
    if (selectedRepo && selectedBranchRef) return branchCommits;
    return commits;
  }, [selectedRepo, selectedBranchRef, branchCommits, commits]);

  const filteredCommits = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return sourceCommits.filter((c) => {
      if (selectedRepoId !== 'ALL' && c.repoId !== selectedRepoId) return false;
      if (filterMode === 'unpushed' && !c.unpushed) return false;
      if (
        filterMode === 'baseline' &&
        baselineTimestamp !== null &&
        c.timestamp * 1000 < baselineTimestamp
      ) {
        return false;
      }
      if (q) {
        return (
          c.subject.toLowerCase().includes(q) ||
          c.shortSha.toLowerCase().includes(q) ||
          c.repoName.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [
    sourceCommits,
    selectedRepoId,
    filterMode,
    baselineTimestamp,
    searchText
  ]);

  const checkedCommitsByRepo = useMemo(() => {
    const map = new Map<string, CommitInfo[]>();
    for (const c of sourceCommits) {
      const k = `${c.repoId}::${c.sha}`;
      if (!checkedCommitKeys.has(k)) continue;
      const list = map.get(c.repoPath) ?? [];
      list.push(c);
      map.set(c.repoPath, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.timestamp - b.timestamp);
    }
    return map;
  }, [sourceCommits, checkedCommitKeys]);

  const checkedCommitCount = checkedCommitKeys.size;

  const toggleCommitCheck = (key: string) => {
    setCheckedCommitKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRunCherryPick = async (noCommit: boolean) => {
    if (checkedCommitsByRepo.size === 0 || isCherryPicking) return;
    setIsCherryPicking(true);
    try {
      for (const [repoPath, list] of checkedCommitsByRepo.entries()) {
        await onCherryPickCommits(
          repoPath,
          list.map((c) => c.sha),
          noCommit
        );
      }
      setCheckedCommitKeys(new Set());
    } finally {
      setIsCherryPicking(false);
    }
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
    if (!selectedCommit) return;
    setExpandedDirs(
      new Set(
        getTreeDirKeys(commitFiles, (f) => f.path, `cmt:${selectedCommit.sha}`)
      )
    );
  };

  const handleCollapseAll = () => {
    setExpandedDirs(new Set());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header">
        <span className="sidebar-title">Commit Explorer</span>
        <div className="sidebar-toolbar">
          <div className="segmented" title="Switch Tree / List view for commit files">
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
            title="Expand All Commit File Folders"
            disabled={!selectedCommit || commitFiles.length === 0}
            onClick={handleExpandAll}
          >
            <SquarePlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="Collapse All Commit File Folders"
            disabled={!selectedCommit || commitFiles.length === 0}
            onClick={handleCollapseAll}
          >
            <SquareMinus size={14} />
          </button>
        </div>
      </div>

      <div
        style={{
          padding: '6px 8px 0 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        <select
          className="compare-select"
          style={{ width: '100%', maxWidth: '100%' }}
          value={selectedRepoId}
          onChange={(e) => setSelectedRepoId(e.target.value)}
        >
          <option value="ALL">All Repositories ({repos.length})</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.branch})
            </option>
          ))}
        </select>

        {selectedRepo && repoBranches && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <GitBranch
              size={13}
              style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
            />
            <select
              className="compare-select"
              style={{ flex: 1, maxWidth: '100%' }}
              value={selectedBranchRef}
              onChange={(e) => {
                setSelectedBranchRef(e.target.value);
                setCheckedCommitKeys(new Set());
              }}
              title="Browse commits on another branch without checking it out"
            >
              <option value="">
                Current Branch ({selectedRepo.branch})
              </option>
              <option value="--all">All Branches (--all)</option>
              {repoBranches.local.length > 0 && (
                <optgroup label="Local Branches (recent first)">
                  {repoBranches.local.map((b) => (
                    <option key={`l:${b.name}`} value={b.name}>
                      {b.name}
                      {b.relativeDate ? ` (${b.relativeDate})` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {repoBranches.remote.length > 0 && (
                <optgroup label="Remote Branches (recent first)">
                  {repoBranches.remote.map((b) => (
                    <option key={`r:${b.name}`} value={b.name}>
                      {b.name}
                      {b.relativeDate ? ` (${b.relativeDate})` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}

        <div className="segmented" style={{ width: '100%' }}>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={filterMode === 'all' ? 'active' : ''}
            onClick={() => setFilterMode('all')}
          >
            All
          </button>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={filterMode === 'unpushed' ? 'active' : ''}
            onClick={() => setFilterMode('unpushed')}
          >
            Unpushed
          </button>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={filterMode === 'baseline' ? 'active' : ''}
            disabled={baselineTimestamp === null}
            onClick={() => setFilterMode('baseline')}
            title={
              baselineTimestamp === null
                ? 'Click "Set Baseline" in top bar first'
                : 'Commits created after Harness Baseline'
            }
          >
            Since Baseline
          </button>
        </div>
      </div>

      <div className="search-box">
        <Search size={13} style={{ color: 'var(--text-muted)' }} />
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search commits, SHA, repo, author..."
        />
      </div>

      {checkedCommitCount > 0 && (
        <div className="cherry-pick-bar">
          <span style={{ fontSize: '0.846rem', color: 'var(--text-secondary)' }}>
            {checkedCommitCount} selected
          </span>
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <button
              className="mini-btn"
              disabled={isCherryPicking}
              onClick={() => setCheckedCommitKeys(new Set())}
            >
              Clear
            </button>
            <button
              className="mini-btn"
              disabled={isCherryPicking}
              title="Apply selected commit changes to working tree WITHOUT committing (git cherry-pick -n)"
              onClick={() => void handleRunCherryPick(true)}
            >
              Apply (-n)
            </button>
            <button
              className="btn btn-primary"
              style={{ padding: '2px 8px', fontSize: '0.846rem' }}
              disabled={isCherryPicking}
              title="Cherry-pick selected commits onto each repo's current branch"
              onClick={() => void handleRunCherryPick(false)}
            >
              {isCherryPicking
                ? 'Picking...'
                : `Cherry-Pick (${checkedCommitCount})`}
            </button>
          </div>
        </div>
      )}

      <div className="split-vertical">
        <div className="split-top">
          {(loadingCommits || loadingBranchCommits) &&
          filteredCommits.length === 0 ? (
            <div className="empty-state">Loading commits...</div>
          ) : filteredCommits.length === 0 ? (
            <div className="empty-state">No matching commits found.</div>
          ) : (
            filteredCommits.map((c) => {
              const rowKey = `${c.repoId}::${c.sha}`;
              const isSelected =
                selectedCommit?.sha === c.sha &&
                selectedCommit?.repoId === c.repoId;
              const isChecked = checkedCommitKeys.has(rowKey);
              const isNewSinceBaseline =
                baselineTimestamp !== null &&
                c.timestamp * 1000 >= baselineTimestamp;
              return (
                <div
                  key={rowKey}
                  className={`commit-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectCommit(c)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      className="checkbox-cell"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCommitCheck(rowKey);
                      }}
                      style={{
                        color: isChecked
                          ? 'var(--accent)'
                          : 'var(--text-muted)'
                      }}
                      title="Select commit to cherry-pick onto current working branch"
                    >
                      {isChecked ? (
                        <CheckSquare size={14} />
                      ) : (
                        <Square size={14} />
                      )}
                    </span>
                    <div
                      className="commit-subject"
                      style={{ marginBottom: 0, flex: 1 }}
                      title={c.subject}
                    >
                      {c.subject}
                    </div>
                  </div>
                  <div className="commit-meta" style={{ paddingLeft: 20, marginTop: 3 }}>
                    <span className="tag-pill repo">{c.repoName}</span>
                    <span className="sha-pill">{c.shortSha}</span>
                    <span>{c.author}</span>
                    <span>• {formatRelativeTime(c.timestamp)}</span>
                    {c.unpushed && (
                      <span className="tag-pill unpushed">UNPUSHED</span>
                    )}
                    {isNewSinceBaseline && (
                      <span className="tag-pill baseline">NEW</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="split-bottom">
          <div className="sidebar-header" style={{ padding: '6px 10px' }}>
            <span
              className="sidebar-title"
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <GitCommitHorizontal size={13} />
              {selectedCommit
                ? `Files in ${selectedCommit.shortSha} (${commitFiles.length})`
                : 'Commit Files'}
            </span>
          </div>
          <div className="sidebar-scroll">
            {!selectedCommit ? (
              <div className="empty-state">
                Select a commit above to inspect its changed files.
              </div>
            ) : loadingFiles ? (
              <div className="empty-state">Loading commit files...</div>
            ) : commitFiles.length === 0 ? (
              <div className="empty-state">No file changes in this commit.</div>
            ) : (
              <TreeOrListRenderer
                items={commitFiles}
                viewMode={viewMode}
                getKey={(f) => `${selectedCommit.sha}::${f.path}`}
                getPath={(f) => f.path}
                selectedKey={
                  selectedCommitFile
                    ? `${selectedCommit.sha}::${selectedCommitFile}`
                    : null
                }
                expandedDirs={expandedDirs}
                onToggleDir={toggleDir}
                dirKeyPrefix={`cmt:${selectedCommit.sha}`}
                onSelect={(f) => onSelectCommitFile(selectedCommit, f)}
                renderSuffix={(f) => (
                  <>
                    {f.additions !== null && f.additions > 0 && (
                      <span style={{ color: 'var(--status-a)', fontSize: 11 }}>
                        +{f.additions}
                      </span>
                    )}
                    {f.deletions !== null && f.deletions > 0 && (
                      <span style={{ color: 'var(--status-d)', fontSize: 11 }}>
                        -{f.deletions}
                      </span>
                    )}
                    <span className={`status-badge status-${f.status}`}>
                      {f.status}
                    </span>
                  </>
                )}
                renderActions={(f) => (
                  <>
                    <button
                      className="mini-btn"
                      title="Bring this file's commit version into current working tree (git checkout <sha> -- file)"
                      onClick={() =>
                        void onGetFileFromRef(
                          selectedCommit.repoPath,
                          selectedCommit.sha,
                          f.path
                        )
                      }
                    >
                      <Download size={10} /> Get
                    </button>
                    <button
                      className="mini-btn"
                      title="Set this commit version as Compare A"
                      onClick={() =>
                        onCompareWithA(
                          selectedCommit.repoPath,
                          f.path,
                          selectedCommit.sha
                        )
                      }
                    >
                      A
                    </button>
                    <button
                      className="mini-btn"
                      title="Set this commit version as Compare B"
                      onClick={() =>
                        onCompareWithB(
                          selectedCommit.repoPath,
                          f.path,
                          selectedCommit.sha
                        )
                      }
                    >
                      B
                    </button>
                  </>
                )}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
