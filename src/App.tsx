import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Flag,
  FolderOpen,
  FolderTree,
  GitCommitHorizontal,
  GitCompare,
  GitPullRequest,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sun,
  Timer,
  X
} from 'lucide-react';
import {
  ChangedFile,
  CommitFileChange,
  CommitInfo,
  RepoSummary
} from '../shared/types';
import { ChangesSidebar, makeChangeKey } from './components/ChangesSidebar';
import { CommitExplorerSidebar } from './components/CommitExplorerSidebar';
import {
  ActiveViewerState,
  CompareSlot,
  DiffPane
} from './components/DiffPane';
import { FileExplorerSidebar } from './components/FileExplorerSidebar';
import { ViewMode } from './components/TreeOrListRenderer';

type SidebarTab = 'changes' | 'files' | 'commits';
type ThemePreference = 'system' | 'light' | 'dark';

const AUTO_SCAN_INTERVAL_MS = 15_000;

interface ToastState {
  kind: 'success' | 'error';
  message: string;
}

export const App: React.FC = () => {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem('gmrv.themePreference');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
  });
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    themePreference === 'system'
      ? systemIsDark
        ? 'dark'
        : 'light'
      : themePreference;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    localStorage.setItem('gmrv.themePreference', themePreference);
    void window.gitViewer.setThemeSource(themePreference);
  }, [resolvedTheme, themePreference]);

  const cycleTheme = () => {
    setThemePreference((prev) =>
      prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'
    );
  };
  const [rootPath, setRootPath] = useState<string>('');
  const [suggestedRoot, setSuggestedRoot] = useState<string>('');
  const [manualPath, setManualPath] = useState<string>('');
  const [recentRoots, setRecentRoots] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('gmrv.recentRoots');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((x): x is string => typeof x === 'string');
        }
      }
    } catch {
      // ignore malformed storage
    }
    const legacy = localStorage.getItem('gmrv.rootPath');
    return legacy ? [legacy] : [];
  });
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const isScanningRef = useRef(false);

  const [activeTab, setActiveTab] = useState<SidebarTab>('changes');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const raw = Number(localStorage.getItem('gmrv.sidebarWidth'));
    if (Number.isFinite(raw) && raw >= 260 && raw <= 680) return raw;
    return 390;
  });

  useEffect(() => {
    localStorage.setItem('gmrv.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);
  const [windowWidth, setWindowWidth] = useState<number>(() => window.innerWidth);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const effectiveSidebarWidth = Math.min(
    sidebarWidth,
    Math.max(240, windowWidth - 46 - 340)
  );

  const handleRailTabClick = (tab: SidebarTab) => {
    if (activeTab === tab) {
      setSidebarOpen((v) => !v);
    } else {
      setActiveTab(tab);
      setSidebarOpen(true);
    }
  };

  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [isCommitting, setIsCommitting] = useState(false);

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(
    null
  );

  const [viewerState, setViewerState] = useState<ActiveViewerState | null>(null);
  const [compareLeft, setCompareLeft] = useState<CompareSlot | null>(null);
  const [compareRight, setCompareRight] = useState<CompareSlot | null>(null);

  const [baselineMap, setBaselineMap] = useState<Record<string, string>>({});
  const [baselineTimestamp, setBaselineTimestamp] = useState<number | null>(
    null
  );
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((kind: 'success' | 'error', message: string) => {
    setToast({ kind, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadCommitsForRepos = useCallback(async (repoList: RepoSummary[]) => {
    if (repoList.length === 0) {
      setCommits([]);
      return;
    }
    setLoadingCommits(true);
    try {
      const perRepo = await Promise.all(
        repoList.map((r) =>
          window.gitViewer.getRepoCommits(
            { id: r.id, name: r.name, path: r.path },
            40
          )
        )
      );
      const merged = perRepo.flat().sort((a, b) => b.timestamp - a.timestamp);
      setCommits(merged);
    } finally {
      setLoadingCommits(false);
    }
  }, []);

  const refreshWorkspace = useCallback(
    async (targetRoot?: string, alsoLoadCommits = true) => {
      const pathToScan = targetRoot ?? rootPath;
      if (!pathToScan || isScanningRef.current) return;
      isScanningRef.current = true;
      setIsScanning(true);
      try {
        const res = await window.gitViewer.scanWorkspace(pathToScan);
        setRepos(res.repos);
        // Prune checkedKeys that no longer exist
        const validKeys = new Set<string>();
        for (const r of res.repos) {
          for (const c of r.changes) {
            validKeys.add(makeChangeKey(r.id, c.path));
          }
        }
        setCheckedKeys((prev) => {
          const next = new Set<string>();
          for (const k of prev) {
            if (validKeys.has(k)) next.add(k);
          }
          return next;
        });

        if (alsoLoadCommits) {
          await loadCommitsForRepos(res.repos);
        }
      } catch (err) {
        showToast(
          'error',
          err instanceof Error ? err.message : 'Failed to scan workspace'
        );
      } finally {
        isScanningRef.current = false;
        setIsScanning(false);
      }
    },
    [rootPath, loadCommitsForRepos, showToast]
  );

  const recordRecentRoot = useCallback((pathToSave: string) => {
    setRecentRoots((prev) => {
      const next = [
        pathToSave,
        ...prev.filter((p) => p.toLowerCase() !== pathToSave.toLowerCase())
      ].slice(0, 10);
      localStorage.setItem('gmrv.recentRoots', JSON.stringify(next));
      return next;
    });
  }, []);

  const removeRecentRoot = useCallback((pathToRemove: string) => {
    setRecentRoots((prev) => {
      const next = prev.filter((p) => p !== pathToRemove);
      localStorage.setItem('gmrv.recentRoots', JSON.stringify(next));
      return next;
    });
  }, []);

  const openRootInCurrentWindow = useCallback(
    async (targetRoot: string) => {
      const clean = targetRoot.trim();
      if (!clean) return;
      setRootPath(clean);
      recordRecentRoot(clean);
      document.title = `Git Multi-Repo Viewer — ${clean}`;
      setSelectedCommit(null);
      setSelectedCommitFile(null);
      setViewerState(null);
      setBaselineMap({});
      setBaselineTimestamp(null);
      await refreshWorkspace(clean, true);
    },
    [recordRecentRoot, refreshWorkspace]
  );

  // Initial startup: open explicit new-window/CLI root immediately, otherwise prompt user to choose
  useEffect(() => {
    const init = async () => {
      const info = await window.gitViewer.getInitialRoot();
      if (info.isExplicit) {
        await openRootInCurrentWindow(info.rootPath);
      } else {
        setSuggestedRoot(info.rootPath);
        setManualPath(info.rootPath);
      }
    };
    void init();
  }, []);

  // Periodic scan every 15 seconds + on window focus
  useEffect(() => {
    if (!rootPath) return;
    const shouldRefreshCommits =
      activeTab === 'commits' || baselineTimestamp !== null;

    const timer = autoScanEnabled
      ? setInterval(() => {
          void refreshWorkspace(rootPath, shouldRefreshCommits);
        }, AUTO_SCAN_INTERVAL_MS)
      : null;

    const onFocus = () => {
      void refreshWorkspace(rootPath, shouldRefreshCommits);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [
    rootPath,
    activeTab,
    baselineTimestamp,
    autoScanEnabled,
    refreshWorkspace
  ]);

  // Reload commits when switching to Commits tab
  useEffect(() => {
    if (activeTab === 'commits' && repos.length > 0) {
      void loadCommitsForRepos(repos);
    }
  }, [activeTab]);

  // Sidebar resize drag handler
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const nextWidth = Math.min(680, Math.max(260, e.clientX - 46));
      setSidebarWidth(nextWidth);
    };
    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleOpenFolder = async () => {
    const picked = await window.gitViewer.pickFolder();
    if (!picked) return;
    if (rootPath) {
      recordRecentRoot(picked);
      await window.gitViewer.openRootInNewWindow(picked);
      return;
    }
    await openRootInCurrentWindow(picked);
  };

  const handleSetBaseline = () => {
    const map: Record<string, string> = {};
    for (const r of repos) {
      if (r.headSha) map[r.id] = r.headSha;
    }
    setBaselineMap(map);
    setBaselineTimestamp(Date.now());
    showToast(
      'success',
      `Harness baseline captured across ${Object.keys(map).length} repo(s).`
    );
  };

  const handleClearBaseline = () => {
    setBaselineMap({});
    setBaselineTimestamp(null);
  };

  const totals = useMemo(() => {
    let dirtyFiles = 0;
    let dirtyRepos = 0;
    let unpushedCommits = 0;
    for (const r of repos) {
      if (r.changes.length > 0) {
        dirtyRepos += 1;
        dirtyFiles += r.changes.length;
      }
      unpushedCommits += r.ahead;
    }
    return { dirtyFiles, dirtyRepos, unpushedCommits };
  }, [repos]);

  const toggleCheck = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleRepoCheck = (repo: RepoSummary) => {
    const keys = repo.changes.map((c) => makeChangeKey(repo.id, c.path));
    const allChecked = keys.every((k) => checkedKeys.has(k));
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allChecked) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const getCheckedByRepo = () => {
    const grouped: {
      repo: RepoSummary;
      paths: string[];
      untrackedPaths: string[];
      trackedPaths: string[];
    }[] = [];

    for (const repo of repos) {
      const paths: string[] = [];
      const untrackedPaths: string[] = [];
      const trackedPaths: string[] = [];
      for (const c of repo.changes) {
        if (checkedKeys.has(makeChangeKey(repo.id, c.path))) {
          paths.push(c.path);
          if (c.untracked) untrackedPaths.push(c.path);
          else trackedPaths.push(c.path);
        }
      }
      if (paths.length > 0) {
        grouped.push({ repo, paths, untrackedPaths, trackedPaths });
      }
    }
    return grouped;
  };

  const handleCommitChecked = async (message: string) => {
    const grouped = getCheckedByRepo();
    if (grouped.length === 0) return;
    setIsCommitting(true);
    try {
      const results = await window.gitViewer.commitAcrossRepos(
        grouped.map((g) => ({
          repoPath: g.repo.path,
          repoName: g.repo.name,
          paths: g.paths
        })),
        message
      );
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        showToast(
          'error',
          `Committed ${okCount} repo(s). Failed in ${failed[0].repoName}: ${failed[0].error}`
        );
      } else {
        showToast(
          'success',
          `Committed across ${okCount} repo(s): ${results
            .map((r) => `${r.repoName}@${r.sha}`)
            .join(', ')}`
        );
      }
      await refreshWorkspace(rootPath, true);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleStageChecked = async () => {
    const grouped = getCheckedByRepo();
    for (const g of grouped) {
      await window.gitViewer.stageFiles(g.repo.path, g.paths);
    }
    await refreshWorkspace(rootPath, false);
  };

  const handleUnstageChecked = async () => {
    const grouped = getCheckedByRepo();
    for (const g of grouped) {
      await window.gitViewer.unstageFiles(g.repo.path, g.paths);
    }
    await refreshWorkspace(rootPath, false);
  };

  const handleDiscardChecked = async () => {
    const grouped = getCheckedByRepo();
    try {
      for (const g of grouped) {
        await window.gitViewer.discardFiles(
          g.repo.path,
          g.trackedPaths,
          g.untrackedPaths
        );
      }
      showToast('success', 'Discarded selected changes.');
      await refreshWorkspace(rootPath, false);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to discard changes'
      );
    }
  };

  const handleStageFile = async (repo: RepoSummary, file: ChangedFile) => {
    await window.gitViewer.stageFiles(repo.path, [file.path]);
    await refreshWorkspace(rootPath, false);
  };

  const handleUnstageFile = async (repo: RepoSummary, file: ChangedFile) => {
    await window.gitViewer.unstageFiles(repo.path, [file.path]);
    await refreshWorkspace(rootPath, false);
  };

  const handleRevertFile = async (repo: RepoSummary, file: ChangedFile) => {
    try {
      await window.gitViewer.discardFiles(
        repo.path,
        file.untracked ? [] : [file.path],
        file.untracked ? [file.path] : []
      );
      if (
        viewerState?.mode === 'working-diff' &&
        viewerState.repo.id === repo.id &&
        viewerState.filePath === file.path
      ) {
        setViewerState(null);
      }
      showToast(
        'success',
        file.untracked
          ? `Deleted untracked file: ${file.path}`
          : `Reverted changes: ${file.path}`
      );
      await refreshWorkspace(rootPath, false);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to revert file'
      );
    }
  };

  const openCustomCompare = (
    side: 'A' | 'B',
    slot: CompareSlot
  ) => {
    const fallbackSlot: CompareSlot =
      side === 'A'
        ? compareRight ?? { ...slot, refMode: 'HEAD' }
        : compareLeft ?? { ...slot, refMode: 'HEAD' };

    const nextLeft = side === 'A' ? slot : fallbackSlot;
    const nextRight = side === 'B' ? slot : fallbackSlot;
    setCompareLeft(nextLeft);
    setCompareRight(nextRight);
    setViewerState({
      mode: 'custom-compare',
      left: nextLeft,
      right: nextRight
    });
  };

  const openEmptyCompare = () => {
    if (compareLeft && compareRight) {
      setViewerState({
        mode: 'custom-compare',
        left: compareLeft,
        right: compareRight
      });
      return;
    }
    const firstRepo = repos[0];
    if (!firstRepo) return;
    const firstPath = firstRepo.changes[0]?.path ?? '';
    const left: CompareSlot = {
      repoPath: firstRepo.path,
      repoName: firstRepo.name,
      filePath: firstPath,
      refMode: 'HEAD',
      customRef: ''
    };
    const right: CompareSlot = {
      repoPath: firstRepo.path,
      repoName: firstRepo.name,
      filePath: firstPath,
      refMode: 'working',
      customRef: ''
    };
    setCompareLeft(left);
    setCompareRight(right);
    setViewerState({ mode: 'custom-compare', left, right });
  };

  const selectedChangeKey =
    viewerState?.mode === 'working-diff'
      ? makeChangeKey(viewerState.repo.id, viewerState.filePath)
      : null;

  const selectedFileKey =
    viewerState?.mode === 'file-view'
      ? `${viewerState.repo.id}::${viewerState.filePath}`
      : null;

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div className="top-bar-left">
          <div className="app-title">
            <GitCompare size={16} style={{ color: 'var(--accent)' }} />
            <span>Git Multi-Repo Viewer</span>
          </div>
          <button className="btn" onClick={() => void handleOpenFolder()}>
            <FolderOpen size={13} /> Open Root
          </button>
          <div className="root-path-pill" title={rootPath}>
            {rootPath || 'No folder selected'}
          </div>
        </div>

        <div className="top-bar-right">
          <span className="stat-pill">{repos.length} repos</span>
          <span className="stat-pill">
            {totals.dirtyFiles} changed ({totals.dirtyRepos} repos)
          </span>
          {totals.unpushedCommits > 0 && (
            <span className="stat-pill" style={{ color: 'var(--badge-unpushed)' }}>
              ↑{totals.unpushedCommits} unpushed
            </span>
          )}

          {baselineTimestamp ? (
            <span className="stat-pill highlight">
              <Flag size={11} />
              Baseline active
              <X
                size={12}
                style={{ cursor: 'pointer', marginLeft: 2 }}
                onClick={handleClearBaseline}
              />
            </span>
          ) : (
            <button
              className="btn"
              onClick={handleSetBaseline}
              disabled={repos.length === 0}
              title="Snapshot current HEAD across all repos to track what your AI harness commits next"
            >
              <Flag size={13} /> Set Baseline
            </button>
          )}

          <button
            className={`btn ${autoScanEnabled ? 'btn-primary' : ''}`}
            onClick={() => setAutoScanEnabled((v) => !v)}
            title={
              autoScanEnabled
                ? 'Auto-scanning every 15s (click to pause)'
                : 'Auto-scan paused (click to resume 15s scan)'
            }
          >
            <Timer size={13} />
            {autoScanEnabled ? '15s' : 'Paused'}
          </button>

          <button
            className="btn"
            onClick={() => void refreshWorkspace(rootPath, true)}
            disabled={isScanning || !rootPath}
            title="Rescan nested repositories and git status"
          >
            <RefreshCw size={13} className={isScanning ? 'spin' : ''} />
            {isScanning ? 'Scanning...' : 'Refresh'}
          </button>

          <button
            className="btn"
            onClick={cycleTheme}
            title={`Theme: ${themePreference} (click to switch System / Light / Dark)`}
          >
            {themePreference === 'system' ? (
              <Monitor size={13} />
            ) : themePreference === 'light' ? (
              <Sun size={13} />
            ) : (
              <Moon size={13} />
            )}
            <span style={{ textTransform: 'capitalize' }}>{themePreference}</span>
          </button>
        </div>
      </div>

      {!rootPath ? (
        <div className="welcome-screen">
          <div className="welcome-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <GitCompare size={24} style={{ color: 'var(--accent)' }} />
              <div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>
                  Choose Workspace Root
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  Select a folder to discover and review all nested Git repositories
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                style={{ padding: '8px 14px', fontSize: 13 }}
                onClick={() => void handleOpenFolder()}
              >
                <FolderOpen size={15} /> Browse Folder...
              </button>
            </div>

            <form
              className="welcome-path-form"
              onSubmit={(e) => {
                e.preventDefault();
                void openRootInCurrentWindow(manualPath);
              }}
            >
              <input
                className="welcome-path-input"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="Or enter / paste folder path (e.g. d:\Venkat\Apps)"
              />
              <button
                type="submit"
                className="btn"
                disabled={!manualPath.trim()}
              >
                Open
              </button>
            </form>

            {(recentRoots.length > 0 || suggestedRoot) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--text-secondary)'
                  }}
                >
                  {recentRoots.length > 0 ? 'Recent Roots' : 'Suggested Root'}
                </div>
                <div className="recent-list">
                  {(recentRoots.length > 0 ? recentRoots : [suggestedRoot]).map(
                    (p) => (
                      <div
                        key={p}
                        className="recent-item"
                        onClick={() => void openRootInCurrentWindow(p)}
                        title={`Open ${p}`}
                      >
                        <FolderOpen
                          size={15}
                          style={{ color: 'var(--folder-color)', flexShrink: 0 }}
                        />
                        <span
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: 12.5
                          }}
                        >
                          {p}
                        </span>
                        {recentRoots.length > 0 && (
                          <button
                            className="icon-btn"
                            title="Remove from recent"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecentRoot(p);
                            }}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="main-workspace">
        <div className="activity-rail">
          <button
            className={`rail-btn ${sidebarOpen && activeTab === 'changes' ? 'active' : ''}`}
            onClick={() => handleRailTabClick('changes')}
            title="Changes / Commit Window (All Nested Repos)"
          >
            <GitPullRequest size={18} />
            {totals.dirtyFiles > 0 && (
              <span className="rail-badge">
                {totals.dirtyFiles > 99 ? '99+' : totals.dirtyFiles}
              </span>
            )}
          </button>

          <button
            className={`rail-btn ${sidebarOpen && activeTab === 'files' ? 'active' : ''}`}
            onClick={() => handleRailTabClick('files')}
            title="File Explorer (Browse & Pick Files to Compare)"
          >
            <FolderTree size={18} />
          </button>

          <button
            className={`rail-btn ${sidebarOpen && activeTab === 'commits' ? 'active' : ''}`}
            onClick={() => handleRailTabClick('commits')}
            title="Commit Explorer (Recent, Unpushed & Since Baseline)"
          >
            <GitCommitHorizontal size={18} />
            {totals.unpushedCommits > 0 && (
              <span
                className="rail-badge"
                style={{ background: 'var(--badge-unpushed)', color: '#fff' }}
              >
                {totals.unpushedCommits}
              </span>
            )}
          </button>

          <button
            className={`rail-btn ${
              viewerState?.mode === 'custom-compare' ? 'active' : ''
            }`}
            onClick={openEmptyCompare}
            title="Compare A ↔ B (Any File, Commit, or Branch)"
          >
            <GitCompare size={18} />
          </button>

          <div style={{ flex: 1 }} />

          <button
            className="rail-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? 'Collapse Sidebar (Maximize Diff)' : 'Expand Sidebar'}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeftOpen size={18} />
            )}
          </button>
        </div>

        {sidebarOpen && (
          <>
            <div className="sidebar" style={{ width: effectiveSidebarWidth }}>
          {activeTab === 'changes' && (
            <ChangesSidebar
              repos={repos}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              selectedChangeKey={selectedChangeKey}
              checkedKeys={checkedKeys}
              onToggleCheck={toggleCheck}
              onToggleRepoCheck={toggleRepoCheck}
              onSelectChange={(repo, file: ChangedFile) => {
                setViewerState({
                  mode: 'working-diff',
                  repo,
                  filePath: file.path,
                  oldPath: file.oldPath,
                  preset: 'head-working'
                });
              }}
              onCompareWithA={(repo, filePath) =>
                openCustomCompare('A', {
                  repoPath: repo.path,
                  repoName: repo.name,
                  filePath,
                  refMode: 'working',
                  customRef: ''
                })
              }
              onCompareWithB={(repo, filePath) =>
                openCustomCompare('B', {
                  repoPath: repo.path,
                  repoName: repo.name,
                  filePath,
                  refMode: 'working',
                  customRef: ''
                })
              }
              onCommitChecked={handleCommitChecked}
              onDiscardChecked={handleDiscardChecked}
              onStageChecked={handleStageChecked}
              onUnstageChecked={handleUnstageChecked}
              onStageFile={handleStageFile}
              onUnstageFile={handleUnstageFile}
              onRevertFile={handleRevertFile}
              isCommitting={isCommitting}
              baselineMap={baselineMap}
            />
          )}

          {activeTab === 'files' && (
            <FileExplorerSidebar
              repos={repos}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              selectedFileKey={selectedFileKey}
              onSelectFile={(repo, filePath) =>
                setViewerState({ mode: 'file-view', repo, filePath })
              }
              onCompareVsHead={(repo, filePath) =>
                setViewerState({
                  mode: 'working-diff',
                  repo,
                  filePath,
                  preset: 'head-working'
                })
              }
              onCompareWithA={(repo, filePath) =>
                openCustomCompare('A', {
                  repoPath: repo.path,
                  repoName: repo.name,
                  filePath,
                  refMode: 'working',
                  customRef: ''
                })
              }
              onCompareWithB={(repo, filePath) =>
                openCustomCompare('B', {
                  repoPath: repo.path,
                  repoName: repo.name,
                  filePath,
                  refMode: 'working',
                  customRef: ''
                })
              }
            />
          )}

          {activeTab === 'commits' && (
            <CommitExplorerSidebar
              repos={repos}
              commits={commits}
              loadingCommits={loadingCommits}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              baselineTimestamp={baselineTimestamp}
              selectedCommit={selectedCommit}
              onSelectCommit={(c) => {
                setSelectedCommit(c);
                setSelectedCommitFile(null);
              }}
              selectedCommitFile={selectedCommitFile}
              onSelectCommitFile={(c, file: CommitFileChange) => {
                setSelectedCommitFile(file.path);
                setViewerState({
                  mode: 'commit-diff',
                  repoName: c.repoName,
                  repoPath: c.repoPath,
                  sha: c.sha,
                  parentSha: c.parentShas[0],
                  subject: c.subject,
                  filePath: file.path,
                  oldPath: file.oldPath
                });
              }}
              onCompareWithA={(repoPath, filePath, ref) => {
                const repo = repos.find((r) => r.path === repoPath);
                openCustomCompare('A', {
                  repoPath,
                  repoName: repo?.name ?? repoPath,
                  filePath,
                  refMode: 'custom',
                  customRef: ref
                });
              }}
              onCompareWithB={(repoPath, filePath, ref) => {
                const repo = repos.find((r) => r.path === repoPath);
                openCustomCompare('B', {
                  repoPath,
                  repoName: repo?.name ?? repoPath,
                  filePath,
                  refMode: 'custom',
                  customRef: ref
                });
              }}
            />
          )}
            </div>

            <div
              className="resizer-x"
              onMouseDown={() => {
                isResizingRef.current = true;
                document.body.style.cursor = 'col-resize';
              }}
            />
          </>
        )}

        <DiffPane
          viewerState={viewerState}
          repos={repos}
          baselineMap={baselineMap}
          resolvedTheme={resolvedTheme}
          onChangeViewerState={setViewerState}
          onUpdateCompareSlots={(left, right) => {
            setCompareLeft(left);
            setCompareRight(right);
            setViewerState({ mode: 'custom-compare', left, right });
          }}
        />
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
};
