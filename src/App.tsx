import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  Flag,
  FolderOpen,
  FolderTree,
  GitCommitHorizontal,
  GitCompare,
  GitPullRequest,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Timer,
  X
} from 'lucide-react';
import {
  ChangedFile,
  CommitFileChange,
  CommitInfo,
  IgnoreTarget,
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
import { SettingsModal, ThemePreference } from './components/SettingsModal';
import { ViewMode } from './components/TreeOrListRenderer';
import {
  FontPreferences,
  loadFontPreferences,
  saveAndApplyFontPreferences
} from './utils/fontPreferences';

type SidebarTab = 'changes' | 'files' | 'commits';

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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontPreferences, setFontPreferences] = useState<FontPreferences>(() =>
    loadFontPreferences()
  );

  useLayoutEffect(() => {
    saveAndApplyFontPreferences(fontPreferences);
  }, [fontPreferences]);

  const [repoOrderByRoot, setRepoOrderByRoot] = useState<
    Record<string, string[]>
  >(() => {
    try {
      const raw = localStorage.getItem('gmrv.repoOrderByRoot');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, string[]>;
        }
      }
    } catch {
      // ignore malformed storage
    }
    return {};
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'gmrv.fontPreferences') {
        setFontPreferences(loadFontPreferences());
      } else if (
        e.key === 'gmrv.themePreference' &&
        (e.newValue === 'system' ||
          e.newValue === 'light' ||
          e.newValue === 'dark')
      ) {
        setThemePreference(e.newValue);
      } else if (e.key === 'gmrv.repoOrderByRoot' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && typeof parsed === 'object') {
            setRepoOrderByRoot(parsed as Record<string, string[]>);
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
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
  const [heldKeys, setHeldKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('gmrv.heldKeys');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((x): x is string => typeof x === 'string'));
        }
      }
    } catch {
      // ignore malformed storage
    }
    return new Set();
  });
  const [isCommitting, setIsCommitting] = useState(false);

  useEffect(() => {
    localStorage.setItem('gmrv.heldKeys', JSON.stringify([...heldKeys]));
  }, [heldKeys]);

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

  const handleOpenRepoInNewWindow = useCallback(
    (repoPath: string) => {
      recordRecentRoot(repoPath);
      void window.gitViewer.openRootInNewWindow(repoPath);
    },
    [recordRecentRoot]
  );

  const orderedRepos = useMemo(() => {
    if (!rootPath) return repos;
    const order = repoOrderByRoot[rootPath];
    if (!order || order.length === 0) return repos;
    const indexMap = new Map(order.map((id, idx) => [id, idx]));
    return [...repos].sort((a, b) => {
      const ia = indexMap.get(a.id);
      const ib = indexMap.get(b.id);
      if (ia !== undefined && ib !== undefined) return ia - ib;
      if (ia !== undefined) return -1;
      if (ib !== undefined) return 1;
      return 0;
    });
  }, [repos, rootPath, repoOrderByRoot]);

  const handleReorderRepo = useCallback(
    (
      sourceRepoId: string,
      targetRepoId: string,
      position: 'before' | 'after'
    ) => {
      if (!rootPath || sourceRepoId === targetRepoId) return;
      const currentIds = orderedRepos.map((r) => r.id);
      const filtered = currentIds.filter((id) => id !== sourceRepoId);
      const targetIdx = filtered.indexOf(targetRepoId);
      if (targetIdx === -1) return;
      const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
      filtered.splice(insertIdx, 0, sourceRepoId);
      setRepoOrderByRoot((prev) => {
        const next = { ...prev, [rootPath]: filtered };
        localStorage.setItem('gmrv.repoOrderByRoot', JSON.stringify(next));
        return next;
      });
    },
    [rootPath, orderedRepos]
  );

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
    if (heldKeys.has(key)) return;
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleHold = (key: string) => {
    setHeldKeys((prev) => {
      const next = new Set(prev);
      const willHold = !next.has(key);
      if (willHold) {
        next.add(key);
      } else {
        next.delete(key);
      }
      if (willHold) {
        setCheckedKeys((cPrev) => {
          if (!cPrev.has(key)) return cPrev;
          const cNext = new Set(cPrev);
          cNext.delete(key);
          return cNext;
        });
      }
      return next;
    });
  };

  const toggleHoldMany = (keys: string[], hold: boolean) => {
    if (keys.length === 0) return;
    setHeldKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (hold) next.add(k);
        else next.delete(k);
      }
      return next;
    });
    if (hold) {
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.delete(k);
        return next;
      });
    }
  };

  const toggleRepoCheck = (repo: RepoSummary) => {
    const keys = repo.changes
      .map((c) => makeChangeKey(repo.id, c.path))
      .filter((k) => !heldKeys.has(k));
    if (keys.length === 0) return;
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
        const key = makeChangeKey(repo.id, c.path);
        if (checkedKeys.has(key) && !heldKeys.has(key)) {
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

  const handleCommitStaged = async (message: string) => {
    const targets = orderedRepos
      .filter((r) =>
        r.changes.some(
          (c) => c.staged && !heldKeys.has(makeChangeKey(r.id, c.path))
        )
      )
      .map((r) => ({ repoPath: r.path, repoName: r.name }));
    if (targets.length === 0) return;
    setIsCommitting(true);
    try {
      const results = await window.gitViewer.commitStagedAcrossRepos(
        targets,
        message
      );
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        showToast(
          'error',
          `Committed staged in ${okCount} repo(s). Failed in ${failed[0].repoName}: ${failed[0].error}`
        );
      } else {
        showToast(
          'success',
          `Committed staged changes across ${okCount} repo(s): ${results
            .map((r) => `${r.repoName}@${r.sha}`)
            .join(', ')}`
        );
      }
      await refreshWorkspace(rootPath, true);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleStageAllRepo = async (repo: RepoSummary) => {
    try {
      await window.gitViewer.stageAll(repo.path);
      showToast('success', `Staged all changes in ${repo.name}`);
      await refreshWorkspace(rootPath, false);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to stage all changes'
      );
    }
  };

  const handleUnstageAllRepo = async (repo: RepoSummary) => {
    try {
      await window.gitViewer.unstageAll(repo.path);
      showToast('success', `Unstaged all changes in ${repo.name}`);
      await refreshWorkspace(rootPath, false);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to unstage all changes'
      );
    }
  };

  const handleStageManyFiles = async (repo: RepoSummary, paths: string[]) => {
    if (paths.length === 0) return;
    await window.gitViewer.stageFiles(repo.path, paths);
    await refreshWorkspace(rootPath, false);
  };

  const handleUnstageManyFiles = async (repo: RepoSummary, paths: string[]) => {
    if (paths.length === 0) return;
    await window.gitViewer.unstageFiles(repo.path, paths);
    await refreshWorkspace(rootPath, false);
  };

  const handleIgnorePattern = async (
    repo: RepoSummary,
    pattern: string,
    target: IgnoreTarget,
    untrackPaths?: string[],
    heldKeyToClear?: string
  ) => {
    try {
      const res = await window.gitViewer.ignorePattern(
        repo.path,
        pattern,
        target,
        untrackPaths
      );
      if (heldKeyToClear) {
        setHeldKeys((prev) => {
          if (!prev.has(heldKeyToClear)) return prev;
          const next = new Set(prev);
          next.delete(heldKeyToClear);
          return next;
        });
      }
      showToast(
        'success',
        res.alreadyPresent
          ? `${res.pattern} is already in ${res.targetFile}`
          : `Added ${res.pattern} to ${res.targetFile}`
      );
      await refreshWorkspace(rootPath, false);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to update ignore rules'
      );
    }
  };

  const handleSkipWorktree = async (
    repo: RepoSummary,
    paths: string[],
    skip: boolean,
    heldKeyToClear?: string
  ) => {
    try {
      await window.gitViewer.setSkipWorktree(repo.path, paths, skip);
      if (heldKeyToClear) {
        setHeldKeys((prev) => {
          if (!prev.has(heldKeyToClear)) return prev;
          const next = new Set(prev);
          next.delete(heldKeyToClear);
          return next;
        });
      }
      showToast(
        'success',
        skip
          ? `Marked ${paths.join(', ')} as --skip-worktree (local changes ignored)`
          : `Cleared --skip-worktree for ${paths.length} file(s)`
      );
      await refreshWorkspace(rootPath, false);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to update skip-worktree flag'
      );
    }
  };

  const handleRestoreSkipWorktreeRepo = async (repo: RepoSummary) => {
    try {
      const files = await window.gitViewer.getSkipWorktreeFiles(repo.path);
      if (files.length === 0) {
        showToast('success', `No --skip-worktree files found in ${repo.name}`);
        return;
      }
      await window.gitViewer.setSkipWorktree(repo.path, files, false);
      showToast(
        'success',
        `Restored ${files.length} --skip-worktree file(s) in ${repo.name}`
      );
      await refreshWorkspace(rootPath, false);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to restore skip-worktree files'
      );
    }
  };

  const handleRemoteAction = async (
    repo: RepoSummary,
    action: 'fetch' | 'pull' | 'push'
  ) => {
    try {
      const res = await window.gitViewer.remoteAction(repo.path, action);
      if (res.ok) {
        showToast('success', `${repo.name}: git ${action} succeeded`);
        await refreshWorkspace(rootPath, true);
      } else {
        showToast('error', `${repo.name} git ${action} failed: ${res.error}`);
      }
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : `git ${action} failed`
      );
    }
  };

  const handleCopyHarnessPlan = (repoScope?: RepoSummary) => {
    const scope = repoScope
      ? [repoScope]
      : orderedRepos.filter((r) => r.changes.length > 0);
    if (scope.length === 0) {
      showToast('error', 'No changed files to export for Harness.');
      return;
    }

    const blocks: string[] = [];
    for (const repo of scope) {
      const includeList: string[] = [];
      const excludeList: string[] = [];
      for (const c of repo.changes) {
        const key = makeChangeKey(repo.id, c.path);
        const isHeld = heldKeys.has(key);
        const isChecked = checkedKeys.has(key);
        if (isHeld) {
          excludeList.push(`${c.path} (held / do not commit)`);
        } else if (c.staged || isChecked) {
          includeList.push(`${c.path}${c.staged ? ' [staged]' : ''}`);
        } else {
          excludeList.push(`${c.path} (unstaged / leave untouched)`);
        }
      }
      if (includeList.length === 0 && excludeList.length === 0) continue;
      const lines: string[] = [`Repo: ${repo.name} (${repo.path})`];
      lines.push(
        includeList.length > 0
          ? `  COMMIT ONLY:\n${includeList.map((f) => `    - ${f}`).join('\n')}`
          : '  COMMIT ONLY: (none)'
      );
      if (excludeList.length > 0) {
        lines.push(
          `  DO NOT COMMIT / LEAVE UNTOUCHED:\n${excludeList.map((f) => `    - ${f}`).join('\n')}`
        );
      }
      blocks.push(lines.join('\n'));
    }

    const promptText = `Git commit instructions — commit ONLY the approved files listed below and leave all excluded files untouched:\n\n${blocks.join('\n\n')}`;
    void navigator.clipboard.writeText(promptText);
    showToast('success', 'Copied Harness commit / ignore instructions to clipboard.');
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
        </div>
      </div>

      {!rootPath ? (
        <div className="welcome-screen">
          <div className="welcome-card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <GitCompare size={24} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontSize: '1.308rem', fontWeight: 600 }}>
                    Choose Workspace Root
                  </div>
                  <div
                    style={{
                      fontSize: '0.962rem',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    Select a folder to discover and review all nested Git repositories
                  </div>
                </div>
              </div>
              <button
                className="icon-btn"
                onClick={() => setSettingsOpen(true)}
                title="Settings (Theme & Fonts)"
              >
                <Settings size={16} />
              </button>
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

          <button
            className="rail-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings (Theme & Fonts)"
          >
            <Settings size={18} />
          </button>
        </div>

        {sidebarOpen && (
          <>
            <div className="sidebar" style={{ width: effectiveSidebarWidth }}>
          {activeTab === 'changes' && (
            <ChangesSidebar
              repos={orderedRepos}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              selectedChangeKey={selectedChangeKey}
              selectedChangePreset={
                viewerState?.mode === 'working-diff'
                  ? viewerState.preset
                  : undefined
              }
              checkedKeys={checkedKeys}
              heldKeys={heldKeys}
              onToggleCheck={toggleCheck}
              onToggleRepoCheck={toggleRepoCheck}
              onToggleHold={toggleHold}
              onToggleHoldMany={toggleHoldMany}
              onSelectChange={(repo, file: ChangedFile, preferredPreset) => {
                setViewerState({
                  mode: 'working-diff',
                  repo,
                  filePath: file.path,
                  oldPath: file.oldPath,
                  preset:
                    preferredPreset ??
                    (file.staged && !file.unstaged
                      ? 'head-staged'
                      : 'head-working')
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
              onCommitStaged={handleCommitStaged}
              onDiscardChecked={handleDiscardChecked}
              onStageChecked={handleStageChecked}
              onUnstageChecked={handleUnstageChecked}
              onStageFile={handleStageFile}
              onUnstageFile={handleUnstageFile}
              onStageAllRepo={handleStageAllRepo}
              onUnstageAllRepo={handleUnstageAllRepo}
              onStageManyFiles={handleStageManyFiles}
              onUnstageManyFiles={handleUnstageManyFiles}
              onRevertFile={handleRevertFile}
              onIgnorePattern={handleIgnorePattern}
              onSkipWorktree={handleSkipWorktree}
              onRestoreSkipWorktreeRepo={handleRestoreSkipWorktreeRepo}
              onRemoteAction={handleRemoteAction}
              onCopyHarnessPlan={handleCopyHarnessPlan}
              onOpenRepoInNewWindow={handleOpenRepoInNewWindow}
              onReorderRepo={handleReorderRepo}
              isCommitting={isCommitting}
              baselineMap={baselineMap}
            />
          )}

          {activeTab === 'files' && (
            <FileExplorerSidebar
              repos={orderedRepos}
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
              onOpenRepoInNewWindow={handleOpenRepoInNewWindow}
              onReorderRepo={handleReorderRepo}
              onIgnorePattern={(repo, pattern, target, untrackPaths) =>
                handleIgnorePattern(repo, pattern, target, untrackPaths)
              }
              onSkipWorktree={(repo, paths, skip) =>
                handleSkipWorktree(repo, paths, skip)
              }
            />
          )}

          {activeTab === 'commits' && (
            <CommitExplorerSidebar
              repos={orderedRepos}
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
          repos={orderedRepos}
          baselineMap={baselineMap}
          resolvedTheme={resolvedTheme}
          editorFont={fontPreferences.editorFont}
          editorFontSize={fontPreferences.editorFontSize}
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

      {settingsOpen && (
        <SettingsModal
          themePreference={themePreference}
          onChangeTheme={setThemePreference}
          fontPreferences={fontPreferences}
          onChangeFonts={setFontPreferences}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};
