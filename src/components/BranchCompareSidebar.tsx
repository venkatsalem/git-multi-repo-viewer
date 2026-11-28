import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderTree,
  GitCompare,
  List,
  RefreshCw,
  Search,
  Square,
  SquareMinus,
  SquarePlus
} from 'lucide-react';
import {
  BranchCompareResult,
  BranchListResult,
  CommitFileChange,
  RepoSummary
} from '../../shared/types';
import {
  getTreeDirKeys,
  TreeOrListRenderer,
  ViewMode
} from './TreeOrListRenderer';

interface BranchCompareSidebarProps {
  repos: RepoSummary[];
  initialRepoId?: string | null;
  initialBaseBranch?: string | null;
  initialTargetBranch?: string | null;
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  selectedCompareFile: string | null;
  onSelectCompareFile: (
    repo: RepoSummary,
    targetBranch: string,
    file: CommitFileChange,
    baseBranch?: string
  ) => void;
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
  onGetFilesFromRef: (
    repoPath: string,
    ref: string,
    filePaths: string[]
  ) => Promise<void>;
  onCompareWithA: (repoPath: string, filePath: string, ref: string) => void;
  onCompareWithB: (repoPath: string, filePath: string, ref: string) => void;
}

type CompareSubTab = 'files' | 'commits';
type DiffScope = 'direct' | 'target-only';
type FileSelectionFilter = 'all' | 'diff' | 'same' | 'selected';

export const BranchCompareSidebar: React.FC<BranchCompareSidebarProps> = ({
  repos,
  initialRepoId,
  initialBaseBranch,
  initialTargetBranch,
  viewMode,
  onChangeViewMode,
  selectedCompareFile,
  onSelectCompareFile,
  onCherryPickCommits,
  onGetFileFromRef,
  onGetFilesFromRef,
  onCompareWithA,
  onCompareWithB
}) => {
  const [selectedRepoId, setSelectedRepoId] = useState<string>(
    () => initialRepoId || repos[0]?.id || ''
  );
  const [branches, setBranches] = useState<BranchListResult | null>(null);
  const [baseBranch, setBaseBranch] = useState<string>(
    () => initialBaseBranch || ''
  );
  const [targetBranch, setTargetBranch] = useState<string>(
    () => initialTargetBranch || ''
  );
  const [diffScope, setDiffScope] = useState<DiffScope>('direct');
  const [subTab, setSubTab] = useState<CompareSubTab>('files');
  const [fileFilter, setFileFilter] = useState<FileSelectionFilter>('all');

  const [compareData, setCompareData] = useState<BranchCompareResult | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set());
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(new Set());
  const [checkedShas, setCheckedShas] = useState<Set<string>>(new Set());
  const [isCherryPicking, setIsCherryPicking] = useState(false);

  useEffect(() => {
    if (initialRepoId) {
      setSelectedRepoId(initialRepoId);
    } else if (!selectedRepoId && repos[0]) {
      setSelectedRepoId(repos[0].id);
    }
  }, [initialRepoId, repos, selectedRepoId]);

  useEffect(() => {
    if (initialBaseBranch !== undefined) {
      setBaseBranch(initialBaseBranch || '');
    }
  }, [initialBaseBranch]);

  useEffect(() => {
    if (initialTargetBranch) {
      setTargetBranch(initialTargetBranch);
    }
  }, [initialTargetBranch]);

  const selectedRepo = useMemo(
    () => repos.find((r) => r.id === selectedRepoId) ?? repos[0] ?? null,
    [repos, selectedRepoId]
  );

  useEffect(() => {
    if (!selectedRepo) {
      setBranches(null);
      return;
    }
    let cancelled = false;
    setCheckedShas(new Set());
    setCheckedFiles(new Set());
    setReviewedFiles(new Set());
    void window.gitViewer.getRepoBranches(selectedRepo.path).then((res) => {
      if (cancelled) return;
      setBranches(res);
      setTargetBranch((prev) => {
        const valid =
          prev &&
          prev !== res.current &&
          (res.local.some((b) => b.name === prev) ||
            res.remote.some((b) => b.name === prev));
        if (valid) return prev;
        const firstOtherLocal = res.local.find((b) => b.name !== res.current);
        const firstRemote = res.remote[0];
        return firstOtherLocal?.name || firstRemote?.name || '';
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo?.path]);

  const loadComparison = useCallback(async () => {
    if (!selectedRepo || !targetBranch) {
      setCompareData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await window.gitViewer.compareBranchWithCurrent(
        {
          id: selectedRepo.id,
          name: selectedRepo.name,
          path: selectedRepo.path,
          branch: selectedRepo.branch
        },
        targetBranch,
        diffScope,
        baseBranch || undefined
      );
      setCompareData(res);
      setExpandedDirs(
        new Set(
          getTreeDirKeys(
            res.changedFiles,
            (f) => f.path,
            `bcmp:${selectedRepo.id}:${baseBranch || 'HEAD'}:${targetBranch}`
          )
        )
      );
    } finally {
      setLoading(false);
    }
  }, [selectedRepo, baseBranch, targetBranch, diffScope]);

  useEffect(() => {
    void loadComparison();
  }, [loadComparison]);

  const allFiles = compareData?.changedFiles ?? [];

  const { diffFilesCount, sameFilesCount } = useMemo(() => {
    let diffCount = 0;
    let sameCount = 0;
    for (const f of allFiles) {
      if (f.matchesBase) sameCount += 1;
      else diffCount += 1;
    }
    return { diffFilesCount: diffCount, sameFilesCount: sameCount };
  }, [allFiles]);

  const filteredFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    return allFiles.filter((f) => {
      if (fileFilter === 'diff' && f.matchesBase) return false;
      if (fileFilter === 'same' && !f.matchesBase) return false;
      if (fileFilter === 'selected' && !checkedFiles.has(f.path)) {
        return false;
      }
      if (q && !f.path.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [allFiles, fileSearch, fileFilter, checkedFiles]);

  const toggleDir = (dirKey: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirKey)) next.delete(dirKey);
      else next.add(dirKey);
      return next;
    });
  };

  const toggleFileCheck = (filePath: string) => {
    setCheckedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const openFileDiff = (file: CommitFileChange) => {
    if (!selectedRepo || !targetBranch) return;
    setReviewedFiles((prev) => {
      const next = new Set(prev);
      next.add(file.path);
      return next;
    });
    onSelectCompareFile(
      selectedRepo,
      targetBranch,
      file,
      baseBranch || undefined
    );
  };

  const stepSelectedFile = (direction: 1 | -1) => {
    if (filteredFiles.length === 0) return;
    const currentIdx = filteredFiles.findIndex(
      (f) => f.path === selectedCompareFile
    );
    let nextIdx = 0;
    if (currentIdx === -1) {
      nextIdx = direction === 1 ? 0 : filteredFiles.length - 1;
    } else {
      nextIdx =
        (currentIdx + direction + filteredFiles.length) % filteredFiles.length;
    }
    openFileDiff(filteredFiles[nextIdx]);
  };

  const toggleSha = (sha: string) => {
    setCheckedShas((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) next.delete(sha);
      else next.add(sha);
      return next;
    });
  };

  const handleCherryPick = async (noCommit: boolean) => {
    if (!selectedRepo || checkedShas.size === 0 || isCherryPicking) return;
    const ordered = (compareData?.commitsOnTarget ?? [])
      .filter((c) => checkedShas.has(c.sha))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((c) => c.sha);
    if (ordered.length === 0) return;
    setIsCherryPicking(true);
    try {
      await onCherryPickCommits(selectedRepo.path, ordered, noCommit);
      setCheckedShas(new Set());
      await loadComparison();
    } finally {
      setIsCherryPicking(false);
    }
  };

  const selectedVisibleCount = allFiles.filter((f) =>
    checkedFiles.has(f.path)
  ).length;
  const currentStepIndex = filteredFiles.findIndex(
    (f) => f.path === selectedCompareFile
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header">
        <span className="sidebar-title">Branch Compare</span>
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
          {subTab === 'files' && (
            <>
              <button
                className="icon-btn"
                title="Expand All Folders"
                disabled={filteredFiles.length === 0}
                onClick={() => {
                  if (!selectedRepo || !targetBranch) return;
                  setExpandedDirs(
                    new Set(
                      getTreeDirKeys(
                        filteredFiles,
                        (f) => f.path,
                        `bcmp:${selectedRepo.id}:${baseBranch || 'HEAD'}:${targetBranch}`
                      )
                    )
                  );
                }}
              >
                <SquarePlus size={14} />
              </button>
              <button
                className="icon-btn"
                title="Collapse All Folders"
                disabled={filteredFiles.length === 0}
                onClick={() => setExpandedDirs(new Set())}
              >
                <SquareMinus size={14} />
              </button>
            </>
          )}
          <button
            className="icon-btn"
            title="Refresh Branch Comparison"
            disabled={loading || !targetBranch}
            onClick={() => void loadComparison()}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div
        style={{
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          borderBottom: '1px solid var(--border)'
        }}
      >
        <select
          className="compare-select"
          style={{ width: '100%', maxWidth: '100%' }}
          value={selectedRepo?.id ?? ''}
          onChange={(e) => {
            setSelectedRepoId(e.target.value);
            setBaseBranch('');
          }}
        >
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} (current: {r.branch})
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              fontSize: '0.808rem',
              color: 'var(--text-secondary)',
              width: 38,
              flexShrink: 0
            }}
          >
            Base:
          </span>
          <select
            className="compare-select"
            style={{ flex: 1, maxWidth: '100%' }}
            value={baseBranch}
            onChange={(e) => {
              const nextBase = e.target.value;
              setBaseBranch(nextBase);
              setCheckedShas(new Set());
              setCheckedFiles(new Set());
              setReviewedFiles(new Set());
              const eff = nextBase || selectedRepo?.branch || '';
              if (targetBranch === eff && branches) {
                const fallback =
                  branches.local.find((b) => b.name !== eff)?.name ||
                  branches.remote.find((b) => b.name !== eff)?.name ||
                  '';
                setTargetBranch(fallback);
              }
            }}
            title="Base / current branch to compare against"
          >
            <option value="">
              Current: {selectedRepo?.branch ?? 'HEAD'} (HEAD)
            </option>
            {branches && branches.local.length > 0 && (
              <optgroup label="Local Branches (recent first)">
                {branches.local.map((b) => (
                  <option key={`bl:${b.name}`} value={b.name}>
                    {b.name}
                    {b.relativeDate ? ` (${b.relativeDate})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {branches && branches.remote.length > 0 && (
              <optgroup label="Remote Branches (recent first)">
                {branches.remote.map((b) => (
                  <option key={`br:${b.name}`} value={b.name}>
                    {b.name}
                    {b.relativeDate ? ` (${b.relativeDate})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <GitCompare
            size={13}
            style={{ color: 'var(--accent)', flexShrink: 0 }}
          />
          <select
            className="compare-select"
            style={{ flex: 1, maxWidth: '100%' }}
            value={targetBranch}
            onChange={(e) => {
              setTargetBranch(e.target.value);
              setCheckedShas(new Set());
              setCheckedFiles(new Set());
              setReviewedFiles(new Set());
            }}
          >
            {!branches && <option value="">Loading branches...</option>}
            {branches && (
              <>
                {branches.local.length > 0 && (
                  <optgroup label="Local Branches (recent first)">
                    {branches.local
                      .filter(
                        (b) => b.name !== (baseBranch || branches.current)
                      )
                      .map((b) => (
                        <option key={`l:${b.name}`} value={b.name}>
                          {b.name}
                          {b.relativeDate ? ` (${b.relativeDate})` : ''}
                        </option>
                      ))}
                  </optgroup>
                )}
                {branches.remote.length > 0 && (
                  <optgroup label="Remote Branches (recent first)">
                    {branches.remote
                      .filter(
                        (b) => b.name !== (baseBranch || branches.current)
                      )
                      .map((b) => (
                        <option key={`r:${b.name}`} value={b.name}>
                          {b.name}
                          {b.relativeDate ? ` (${b.relativeDate})` : ''}
                        </option>
                      ))}
                  </optgroup>
                )}
              </>
            )}
          </select>
        </div>

        <div className="segmented" style={{ width: '100%' }}>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={diffScope === 'direct' ? 'active' : ''}
            onClick={() => {
              setDiffScope('direct');
              if (fileFilter === 'diff' || fileFilter === 'same') {
                setFileFilter('all');
              }
            }}
            title="Show only files that currently differ between Base/Current and Target (git diff base target)"
          >
            Current vs Target
          </button>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={diffScope === 'target-only' ? 'active' : ''}
            onClick={() => setDiffScope('target-only')}
            title="Show only edits introduced on Target branch since branching (git diff HEAD...<branch>)"
          >
            Only Target Edits
          </button>
        </div>

        <div className="segmented" style={{ width: '100%' }}>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={subTab === 'files' ? 'active' : ''}
            onClick={() => setSubTab('files')}
          >
            Changed Files ({allFiles.length})
          </button>
          <button
            style={{ flex: 1, justifyContent: 'center' }}
            className={subTab === 'commits' ? 'active' : ''}
            onClick={() => setSubTab('commits')}
          >
            Commits on Target ({compareData?.commitsOnTarget.length ?? 0})
          </button>
        </div>
      </div>

      {subTab === 'files' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0
          }}
        >
          <div className="search-box">
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
              placeholder="Filter changed files..."
            />
          </div>

          {allFiles.length > 0 && (
            <div className="cherry-pick-bar" style={{ flexWrap: 'wrap' }}>
              <div className="segmented">
                <button
                  className={fileFilter === 'all' ? 'active' : ''}
                  onClick={() => setFileFilter('all')}
                  title="Show all listed changed files"
                >
                  All ({allFiles.length})
                </button>
                {(diffScope === 'target-only' || sameFilesCount > 0) && (
                  <>
                    <button
                      className={fileFilter === 'diff' ? 'active' : ''}
                      disabled={diffFilesCount === 0}
                      onClick={() => setFileFilter('diff')}
                      title="Show only files whose contents still differ from Current/Base branch"
                    >
                      Diff ({diffFilesCount})
                    </button>
                    <button
                      className={fileFilter === 'same' ? 'active' : ''}
                      disabled={sameFilesCount === 0}
                      onClick={() => setFileFilter('same')}
                      title="Show files edited on Target that already match Current/Base branch (already merged)"
                    >
                      Same ({sameFilesCount})
                    </button>
                  </>
                )}
                <button
                  className={fileFilter === 'selected' ? 'active' : ''}
                  disabled={selectedVisibleCount === 0}
                  onClick={() => setFileFilter('selected')}
                  title="Show only your checked files so you can review them one by one"
                >
                  Selected ({selectedVisibleCount})
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginLeft: 'auto'
                }}
              >
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  disabled={filteredFiles.length === 0}
                  onClick={() => stepSelectedFile(-1)}
                  title="Compare Previous File in List"
                >
                  <ChevronLeft size={14} />
                </button>
                <span
                  style={{
                    fontSize: '0.808rem',
                    color: 'var(--text-secondary)',
                    minWidth: 36,
                    textAlign: 'center'
                  }}
                >
                  {currentStepIndex >= 0 ? currentStepIndex + 1 : 0}/
                  {filteredFiles.length}
                </span>
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  disabled={filteredFiles.length === 0}
                  onClick={() => stepSelectedFile(1)}
                  title="Compare Next File in List"
                >
                  <ChevronRight size={14} />
                </button>
                {selectedVisibleCount > 0 && (
                  <>
                    <button
                      className="mini-btn"
                      onClick={() => {
                        setCheckedFiles(new Set());
                        setFileFilter('all');
                      }}
                    >
                      Clear
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '2px 7px', fontSize: '0.808rem' }}
                      title={`Pull ${selectedVisibleCount} selected file(s) from ${targetBranch} into working tree`}
                      onClick={() => {
                        if (!selectedRepo || !targetBranch) return;
                        const paths = allFiles
                          .filter((f) => checkedFiles.has(f.path))
                          .map((f) => f.path);
                        void onGetFilesFromRef(
                          selectedRepo.path,
                          targetBranch,
                          paths
                        );
                      }}
                    >
                      <Download size={11} /> Get ({selectedVisibleCount})
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="sidebar-scroll">
            {!selectedRepo || !targetBranch ? (
              <div className="empty-state">Select a branch to compare.</div>
            ) : loading && !compareData ? (
              <div className="empty-state">Loading diff files...</div>
            ) : filteredFiles.length === 0 ? (
              <div className="empty-state">
                {fileFilter === 'selected'
                  ? 'No files checked. Switch to All and check the files you want to review.'
                  : `No file differences between ${baseBranch || selectedRepo.branch} and ${targetBranch}.`}
              </div>
            ) : (
              <TreeOrListRenderer
                items={filteredFiles}
                viewMode={viewMode}
                getKey={(f) => `${selectedRepo.id}:${targetBranch}:${f.path}`}
                getPath={(f) => f.path}
                selectedKey={
                  selectedCompareFile
                    ? `${selectedRepo.id}:${targetBranch}:${selectedCompareFile}`
                    : null
                }
                expandedDirs={expandedDirs}
                onToggleDir={toggleDir}
                dirKeyPrefix={`bcmp:${selectedRepo.id}:${baseBranch || 'HEAD'}:${targetBranch}`}
                onSelect={(f) => openFileDiff(f)}
                renderPrefix={(f) => {
                  const isChecked = checkedFiles.has(f.path);
                  return (
                    <span
                      className="checkbox-cell"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFileCheck(f.path);
                      }}
                      style={{
                        color: isChecked ? 'var(--accent)' : 'var(--text-muted)'
                      }}
                      title="Select/unselect file for focused review or Get"
                    >
                      {isChecked ? (
                        <CheckSquare size={14} />
                      ) : (
                        <Square size={14} />
                      )}
                    </span>
                  );
                }}
                renderSuffix={(f) => (
                  <>
                    {reviewedFiles.has(f.path) && (
                      <span
                        title="Compared / reviewed in this session"
                        style={{
                          color: 'var(--status-a)',
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                      >
                        <Check size={12} />
                      </span>
                    )}
                    {f.matchesBase ? (
                      <span
                        className="cmp-badge cmp-same"
                        title="Identical to Current/Base branch (already merged/applied)"
                      >
                        = Same
                      </span>
                    ) : (
                      <span
                        className="cmp-badge cmp-diff"
                        title="Currently differs from Current/Base branch"
                      >
                        ≠ Diff
                      </span>
                    )}
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
                      title={`Pull ${f.path} from ${targetBranch} into working tree`}
                      onClick={() =>
                        void onGetFileFromRef(
                          selectedRepo.path,
                          targetBranch,
                          f.path
                        )
                      }
                    >
                      <Download size={10} /> Get
                    </button>
                    <button
                      className="mini-btn"
                      title="Set as Compare Left (A)"
                      onClick={() =>
                        onCompareWithA(selectedRepo.path, f.path, targetBranch)
                      }
                    >
                      A
                    </button>
                    <button
                      className="mini-btn"
                      title="Set as Compare Right (B)"
                      onClick={() =>
                        onCompareWithB(selectedRepo.path, f.path, targetBranch)
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
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0
          }}
        >
          {checkedShas.size > 0 && (
            <div className="cherry-pick-bar">
              <span
                style={{ fontSize: '0.846rem', color: 'var(--text-secondary)' }}
              >
                {checkedShas.size} commit(s)
              </span>
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                <button
                  className="mini-btn"
                  disabled={isCherryPicking}
                  onClick={() => void handleCherryPick(true)}
                  title="Apply to working tree without committing (-n)"
                >
                  Apply (-n)
                </button>
                <button
                  className="btn btn-primary"
                  style={{ padding: '2px 8px', fontSize: '0.846rem' }}
                  disabled={isCherryPicking}
                  title="Cherry-pick checked commits onto current branch"
                  onClick={() => void handleCherryPick(false)}
                >
                  Cherry-Pick ({checkedShas.size})
                </button>
              </div>
            </div>
          )}

          <div className="sidebar-scroll">
            {loading && !compareData ? (
              <div className="empty-state">Loading commits...</div>
            ) : !compareData || compareData.commitsOnTarget.length === 0 ? (
              <div className="empty-state">
                No unmerged commits on {targetBranch || 'target branch'} relative
                to {selectedRepo?.branch || 'HEAD'}.
              </div>
            ) : (
              compareData.commitsOnTarget.map((c) => {
                const checked = checkedShas.has(c.sha);
                return (
                  <div
                    key={c.sha}
                    className="commit-item"
                    onClick={() => toggleSha(c.sha)}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span
                        className="checkbox-cell"
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
                      <div
                        className="commit-subject"
                        style={{ marginBottom: 0, flex: 1 }}
                        title={c.subject}
                      >
                        {c.subject}
                      </div>
                    </div>
                    <div
                      className="commit-meta"
                      style={{ paddingLeft: 20, marginTop: 3 }}
                    >
                      <span className="sha-pill">{c.shortSha}</span>
                      <span>{c.author}</span>
                      <span>• {c.dateIso.slice(0, 10)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
