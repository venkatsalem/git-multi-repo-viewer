import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FoldVertical,
  FolderTree,
  GitBranch,
  List,
  Search,
  UnfoldVertical
} from 'lucide-react';
import { FileEntry, RepoSummary } from '../../shared/types';
import {
  getTreeDirKeys,
  TreeOrListRenderer,
  ViewMode
} from './TreeOrListRenderer';

interface FileExplorerSidebarProps {
  repos: RepoSummary[];
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  selectedFileKey: string | null;
  onSelectFile: (repo: RepoSummary, filePath: string) => void;
  onCompareVsHead: (repo: RepoSummary, filePath: string) => void;
  onCompareWithA: (repo: RepoSummary, filePath: string) => void;
  onCompareWithB: (repo: RepoSummary, filePath: string) => void;
}

export const FileExplorerSidebar: React.FC<FileExplorerSidebarProps> = ({
  repos,
  viewMode,
  onChangeViewMode,
  selectedFileKey,
  onSelectFile,
  onCompareVsHead,
  onCompareWithA,
  onCompareWithB
}) => {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('ALL');
  const [filterText, setFilterText] = useState('');
  const [filesByRepo, setFilesByRepo] = useState<Record<string, FileEntry[]>>({});
  const [loadingRepos, setLoadingRepos] = useState<Set<string>>(new Set());
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const loadRepoFiles = async (repo: RepoSummary): Promise<FileEntry[]> => {
    if (filesByRepo[repo.id]) return filesByRepo[repo.id];
    if (loadingRepos.has(repo.id)) return [];
    setLoadingRepos((prev) => new Set(prev).add(repo.id));
    try {
      const files = await window.gitViewer.listRepoFiles(repo.path);
      setFilesByRepo((prev) => ({ ...prev, [repo.id]: files }));
      return files;
    } finally {
      setLoadingRepos((prev) => {
        const next = new Set(prev);
        next.delete(repo.id);
        return next;
      });
    }
  };

  // Load files only when a repo is expanded or explicitly selected in dropdown
  useEffect(() => {
    for (const repo of repos) {
      if (selectedRepoId === repo.id || expandedRepos.has(repo.id)) {
        void loadRepoFiles(repo);
      }
    }
  }, [repos, selectedRepoId, expandedRepos]);

  const visibleRepos = useMemo(() => {
    if (selectedRepoId === 'ALL') return repos;
    return repos.filter((r) => r.id === selectedRepoId);
  }, [repos, selectedRepoId]);

  const toggleRepo = (repo: RepoSummary) => {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repo.id)) next.delete(repo.id);
      else next.add(repo.id);
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

  const handleExpandAll = async () => {
    const repoIds = new Set(visibleRepos.map((r) => r.id));
    setExpandedRepos(repoIds);

    const results = await Promise.all(
      visibleRepos.map(async (r) => ({
        repo: r,
        files: await loadRepoFiles(r)
      }))
    );

    const allDirKeys = new Set<string>();
    for (const { repo, files } of results) {
      for (const k of getTreeDirKeys(
        files.slice(0, 1500),
        (f) => f.path,
        `files:${repo.id}`
      )) {
        allDirKeys.add(k);
      }
    }
    setExpandedDirs(allDirKeys);
  };

  const handleCollapseAll = () => {
    setExpandedRepos(new Set());
    setExpandedDirs(new Set());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header">
        <span className="sidebar-title">File Explorer</span>
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
            onClick={() => void handleExpandAll()}
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
        </div>
      </div>

      <div style={{ padding: '6px 8px 0 8px' }}>
        <select
          className="compare-select"
          style={{ width: '100%', maxWidth: '100%' }}
          value={selectedRepoId}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedRepoId(val);
            if (val !== 'ALL') {
              setExpandedRepos((prev) => new Set(prev).add(val));
            }
          }}
        >
          <option value="ALL">All Repositories ({repos.length})</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.branch})
            </option>
          ))}
        </select>
      </div>

      <div className="search-box">
        <Search size={13} style={{ color: 'var(--text-muted)' }} />
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search files in expanded repos..."
        />
      </div>

      <div className="sidebar-scroll">
        {visibleRepos.map((repo) => {
          const isExpanded =
            selectedRepoId === repo.id || expandedRepos.has(repo.id);
          const allFiles = filesByRepo[repo.id] ?? [];
          const q = filterText.trim().toLowerCase();
          const filtered = q
            ? allFiles.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 400)
            : allFiles.slice(0, 1500);

          const statusLookup = new Map(
            repo.changes.map((c) => [c.path, c.status])
          );

          return (
            <div key={repo.id} className="repo-group">
              <div className="repo-header" onClick={() => toggleRepo(repo)}>
                {isExpanded ? (
                  <ChevronDown size={14} style={{ flexShrink: 0 }} />
                ) : (
                  <ChevronRight size={14} style={{ flexShrink: 0 }} />
                )}
                <span className="repo-name" title={repo.path}>
                  {repo.name}
                </span>
                <span className="branch-tag">
                  <GitBranch size={10} />
                  {repo.branch}
                </span>
                <span style={{ flex: 1 }} />
                {loadingRepos.has(repo.id) ? (
                  <span className="count-pill">...</span>
                ) : filesByRepo[repo.id] ? (
                  <span className="count-pill">{allFiles.length}</span>
                ) : null}
              </div>

              {isExpanded && (
                <TreeOrListRenderer
                  items={filtered}
                  viewMode={q ? 'list' : viewMode}
                  getKey={(f) => `${repo.id}::${f.path}`}
                  getPath={(f) => f.path}
                  selectedKey={selectedFileKey}
                  expandedDirs={expandedDirs}
                  onToggleDir={toggleDir}
                  dirKeyPrefix={`files:${repo.id}`}
                  onSelect={(f) => onSelectFile(repo, f.path)}
                  renderSuffix={(f) => {
                    const st = statusLookup.get(f.path);
                    return st ? (
                      <span className={`status-badge status-${st}`}>{st}</span>
                    ) : null;
                  }}
                  renderActions={(f) => (
                    <>
                      <button
                        className="mini-btn"
                        title="Diff against HEAD"
                        onClick={() => onCompareVsHead(repo, f.path)}
                      >
                        Diff
                      </button>
                      <button
                        className="mini-btn"
                        title="Set as Compare Left (A)"
                        onClick={() => onCompareWithA(repo, f.path)}
                      >
                        A
                      </button>
                      <button
                        className="mini-btn"
                        title="Set as Compare Right (B)"
                        onClick={() => onCompareWithB(repo, f.path)}
                      >
                        B
                      </button>
                    </>
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
