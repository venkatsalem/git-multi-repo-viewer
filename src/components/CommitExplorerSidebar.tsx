import React, { useEffect, useMemo, useState } from 'react';
import {
  FoldVertical,
  FolderTree,
  GitCommitHorizontal,
  List,
  Search,
  UnfoldVertical
} from 'lucide-react';
import { CommitFileChange, CommitInfo, RepoSummary } from '../../shared/types';
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
  onCompareWithA,
  onCompareWithB
}) => {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('ALL');
  const [filterMode, setFilterMode] = useState<CommitFilterMode>('all');
  const [searchText, setSearchText] = useState('');
  const [commitFiles, setCommitFiles] = useState<CommitFileChange[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

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

  const filteredCommits = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return commits.filter((c) => {
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
  }, [commits, selectedRepoId, filterMode, baselineTimestamp, searchText]);

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
            <UnfoldVertical size={14} />
          </button>
          <button
            className="icon-btn"
            title="Collapse All Commit File Folders"
            disabled={!selectedCommit || commitFiles.length === 0}
            onClick={handleCollapseAll}
          >
            <FoldVertical size={14} />
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

      <div className="split-vertical">
        <div className="split-top">
          {loadingCommits && filteredCommits.length === 0 ? (
            <div className="empty-state">Loading commits...</div>
          ) : filteredCommits.length === 0 ? (
            <div className="empty-state">No matching commits found.</div>
          ) : (
            filteredCommits.map((c) => {
              const isSelected =
                selectedCommit?.sha === c.sha &&
                selectedCommit?.repoId === c.repoId;
              const isNewSinceBaseline =
                baselineTimestamp !== null &&
                c.timestamp * 1000 >= baselineTimestamp;
              return (
                <div
                  key={`${c.repoId}::${c.sha}`}
                  className={`commit-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectCommit(c)}
                >
                  <div className="commit-subject" title={c.subject}>
                    {c.subject}
                  </div>
                  <div className="commit-meta">
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
