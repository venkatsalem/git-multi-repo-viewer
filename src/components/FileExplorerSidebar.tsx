import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
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
  RefreshCw,
  Search,
  SquareMinus,
  SquarePlus,
  Terminal,
  Upload
} from 'lucide-react';
import { FileEntry, IgnoreTarget, RepoSummary } from '../../shared/types';
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
  onOpenRepoInNewWindow: (repoPath: string) => void;
  onReorderRepo: (
    sourceRepoId: string,
    targetRepoId: string,
    position: 'before' | 'after'
  ) => void;
  onIgnorePattern: (
    repo: RepoSummary,
    pattern: string,
    target: IgnoreTarget,
    untrackPaths?: string[]
  ) => Promise<void>;
  onSkipWorktree: (
    repo: RepoSummary,
    paths: string[],
    skip: boolean
  ) => Promise<void>;
  onRemoteAction: (
    repo: RepoSummary,
    action: 'fetch' | 'pull' | 'push'
  ) => Promise<void>;
  onRestoreSkipWorktreeRepo: (repo: RepoSummary) => Promise<void>;
  onOpenBranchModal: (repo: RepoSummary) => void;
}

function joinRepoFilePath(repoPath: string, filePath: string): string {
  const base = repoPath.replace(/[\\/]+$/, '');
  return `${base}/${filePath}`;
}

export const FileExplorerSidebar: React.FC<FileExplorerSidebarProps> = ({
  repos,
  viewMode,
  onChangeViewMode,
  selectedFileKey,
  onSelectFile,
  onCompareVsHead,
  onCompareWithA,
  onCompareWithB,
  onOpenRepoInNewWindow,
  onReorderRepo,
  onIgnorePattern,
  onSkipWorktree,
  onRemoteAction,
  onRestoreSkipWorktreeRepo,
  onOpenBranchModal
}) => {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('ALL');
  const [filterText, setFilterText] = useState('');
  const [filesByRepo, setFilesByRepo] = useState<Record<string, FileEntry[]>>({});
  const [loadingRepos, setLoadingRepos] = useState<Set<string>>(new Set());
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    repo: RepoSummary;
    filePath: string;
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

  useEffect(() => {
    if (!fileContextMenu && !repoContextMenu) return;
    const close = () => {
      setFileContextMenu(null);
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
  }, [fileContextMenu, repoContextMenu]);

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
            <SquarePlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="Collapse All Repos & Folders"
            onClick={handleCollapseAll}
          >
            <SquareMinus size={14} />
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

          const isDirtyOrAhead = repo.changes.length > 0 || repo.ahead > 0;
          const dropClass =
            dropIndicator?.repoId === repo.id
              ? `drop-${dropIndicator.position}`
              : '';

          return (
            <div key={repo.id} className={`repo-group ${dropClass}`.trim()}>
              <div
                className={`repo-header ${isDirtyOrAhead ? 'repo-dirty' : 'repo-clean'}`}
                draggable={visibleRepos.length > 1}
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
                  setFileContextMenu(null);
                  const x = Math.min(e.clientX, window.innerWidth - 220);
                  const y = Math.min(e.clientY, window.innerHeight - 190);
                  setRepoContextMenu({ x, y, repo });
                }}
                onClick={() => toggleRepo(repo)}
              >
                {isExpanded ? (
                  <ChevronDown size={14} style={{ flexShrink: 0 }} />
                ) : (
                  <ChevronRight size={14} style={{ flexShrink: 0 }} />
                )}
                <span className="repo-name" title={repo.path}>
                  {repo.name}
                </span>
                <button
                  type="button"
                  className="branch-tag clickable"
                  title={`${repo.branch} — Click to switch or create branch`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenBranchModal(repo);
                  }}
                >
                  <GitBranch size={10} />
                  {repo.branch}
                </button>
                <span style={{ flex: 1 }} />
                {repo.behind > 0 && (
                  <span
                    className="count-pill behind"
                    title={`${repo.behind} incoming commit(s) behind upstream`}
                  >
                    ↓{repo.behind}
                  </span>
                )}
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
                  onItemContextMenu={(e, f) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setRepoContextMenu(null);
                    const x = Math.min(e.clientX, window.innerWidth - 220);
                    const y = Math.min(e.clientY, window.innerHeight - 250);
                    setFileContextMenu({ x, y, repo, filePath: f.path });
                  }}
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

      {fileContextMenu && (
        <div
          className="context-menu"
          style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              onSelectFile(fileContextMenu.repo, fileContextMenu.filePath);
              setFileContextMenu(null);
            }}
          >
            <Eye size={14} /> Open File
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              onCompareVsHead(fileContextMenu.repo, fileContextMenu.filePath);
              setFileContextMenu(null);
            }}
          >
            Diff against HEAD
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              onCompareWithA(fileContextMenu.repo, fileContextMenu.filePath);
              setFileContextMenu(null);
            }}
          >
            Set as Compare Left (A)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              onCompareWithB(fileContextMenu.repo, fileContextMenu.filePath);
              setFileContextMenu(null);
            }}
          >
            Set as Compare Right (B)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              void navigator.clipboard.writeText(fileContextMenu.filePath);
              setFileContextMenu(null);
            }}
          >
            <Copy size={14} /> Copy Relative Path
          </button>

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => {
              const { repo, filePath } = fileContextMenu;
              setFileContextMenu(null);
              void onIgnorePattern(repo, filePath, 'exclude', [filePath]);
            }}
          >
            <EyeOff size={14} /> Ignore Locally & Untrack (.git/info/exclude)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const { repo, filePath } = fileContextMenu;
              setFileContextMenu(null);
              void onIgnorePattern(repo, filePath, 'gitignore', [filePath]);
            }}
          >
            <FileX2 size={14} /> Add to .gitignore & Untrack
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const { repo, filePath } = fileContextMenu;
              setFileContextMenu(null);
              void onSkipWorktree(repo, [filePath], true);
            }}
          >
            <EyeOff size={14} /> Ignore Local Edits (--skip-worktree)
          </button>

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => {
              const target = joinRepoFilePath(
                fileContextMenu.repo.path,
                fileContextMenu.filePath
              );
              setFileContextMenu(null);
              void window.gitViewer.showInExplorer(target, true);
            }}
          >
            <FolderOpen size={14} /> Show in Explorer
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              const target = joinRepoFilePath(
                fileContextMenu.repo.path,
                fileContextMenu.filePath
              );
              setFileContextMenu(null);
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
              onOpenBranchModal(repo);
            }}
          >
            <GitBranch size={14} /> Switch / Create Branch...
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
              void onRemoteAction(repo, 'pull').then(() => {
                setFilesByRepo((prev) => {
                  if (!(repo.id in prev)) return prev;
                  const next = { ...prev };
                  delete next[repo.id];
                  return next;
                });
              });
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
    </div>
  );
};
