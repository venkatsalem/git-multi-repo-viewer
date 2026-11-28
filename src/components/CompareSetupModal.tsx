import React, { useEffect, useMemo, useState } from 'react';
import { FolderTree, GitBranch, GitCompare, History, X } from 'lucide-react';
import { BranchListResult, FileEntry, RepoSummary } from '../../shared/types';
import { CompareSlot } from './DiffPane';

export interface CompareSetupSeed {
  mode: 'branches' | 'file';
  repoId?: string;
  filePath?: string;
  baseBranch?: string;
  targetBranch?: string;
}

interface CompareSetupModalProps {
  open: boolean;
  repos: RepoSummary[];
  initialSeed?: CompareSetupSeed | null;
  hasLastCustomCompare: boolean;
  onClose: () => void;
  onStartBranchCompare: (
    repo: RepoSummary,
    baseBranch: string,
    targetBranch: string
  ) => void;
  onStartFileCompare: (left: CompareSlot, right: CompareSlot) => void;
  onReopenLastCustomCompare: () => void;
}

function refValueToSlot(
  repo: RepoSummary,
  filePath: string,
  val: string
): CompareSlot {
  if (val === 'working' || val === 'staged' || val === 'HEAD') {
    return {
      repoPath: repo.path,
      repoName: repo.name,
      filePath,
      refMode: val,
      customRef: ''
    };
  }
  return {
    repoPath: repo.path,
    repoName: repo.name,
    filePath,
    refMode: 'custom',
    customRef: val.startsWith('ref:') ? val.slice(4) : val
  };
}

export const CompareSetupModal: React.FC<CompareSetupModalProps> = ({
  open,
  repos,
  initialSeed,
  hasLastCustomCompare,
  onClose,
  onStartBranchCompare,
  onStartFileCompare,
  onReopenLastCustomCompare
}) => {
  const initialRepo =
    (initialSeed?.repoId && repos.find((r) => r.id === initialSeed.repoId)) ||
    repos[0] ||
    null;

  const [mode, setMode] = useState<'branches' | 'file'>(
    () => initialSeed?.mode ?? 'branches'
  );
  const [selectedRepoId, setSelectedRepoId] = useState<string>(
    () => initialRepo?.id ?? ''
  );
  const [branches, setBranches] = useState<BranchListResult | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Branch vs Branch state ("" baseBranch means HEAD / current branch)
  const [baseBranch, setBaseBranch] = useState<string>(
    () => initialSeed?.baseBranch ?? ''
  );
  const [targetBranch, setTargetBranch] = useState<string>(
    () => initialSeed?.targetBranch ?? ''
  );

  // File A <-> B state
  const [repoFiles, setRepoFiles] = useState<FileEntry[]>([]);
  const [fileQuery, setFileQuery] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState(
    () => initialSeed?.filePath ?? initialRepo?.changes[0]?.path ?? ''
  );
  const [leftRefValue, setLeftRefValue] = useState('HEAD');
  const [rightRefValue, setRightRefValue] = useState(() =>
    initialSeed?.targetBranch ? `ref:${initialSeed.targetBranch}` : 'working'
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const selectedRepo = useMemo(
    () => repos.find((r) => r.id === selectedRepoId) ?? repos[0] ?? null,
    [repos, selectedRepoId]
  );

  useEffect(() => {
    if (!open || !selectedRepo) {
      setBranches(null);
      return;
    }
    let cancelled = false;
    setBranches(null);
    setLoadingBranches(true);
    void window.gitViewer
      .getRepoBranches(selectedRepo.path)
      .then((res) => {
        if (cancelled) return;
        setBranches(res);
        setRightRefValue((prev) => {
          if (prev && prev !== 'working') return prev;
          if (initialSeed?.mode === 'file') {
            const firstLocal = res.local.find((b) => b.name !== res.current);
            const firstRemote = res.remote[0];
            const best = firstLocal?.name || firstRemote?.name;
            return best ? `ref:${best}` : 'working';
          }
          return prev;
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedRepo?.path, initialSeed?.mode]);

  // Keep targetBranch synced to a valid available branch whenever branches or baseBranch updates
  useEffect(() => {
    if (!branches || !selectedRepo) return;
    const effectiveBase = baseBranch || branches.current || selectedRepo.branch;
    const existsInBranches =
      targetBranch &&
      targetBranch !== effectiveBase &&
      (branches.local.some((b) => b.name === targetBranch) ||
        branches.remote.some((b) => b.name === targetBranch));
    if (existsInBranches) return;

    const firstLocal = branches.local.find((b) => b.name !== effectiveBase);
    const firstRemote = branches.remote.find((b) => b.name !== effectiveBase);
    setTargetBranch(firstLocal?.name || firstRemote?.name || '');
  }, [branches, baseBranch, targetBranch, selectedRepo]);

  useEffect(() => {
    if (!open || !selectedRepo) {
      setRepoFiles([]);
      return;
    }
    let cancelled = false;
    void window.gitViewer.listRepoFiles(selectedRepo.path).then((files) => {
      if (cancelled) return;
      setRepoFiles(files);
      setSelectedFilePath((prev) => {
        if (prev && files.some((f) => f.path === prev)) return prev;
        if (initialSeed?.filePath && initialSeed.repoId === selectedRepo.id) {
          return initialSeed.filePath;
        }
        return selectedRepo.changes[0]?.path ?? files[0]?.path ?? '';
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, selectedRepo?.path, selectedRepo?.id, initialSeed?.filePath, initialSeed?.repoId]);

  const filteredFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    if (!q) return repoFiles;
    return repoFiles.filter((f) => f.path.toLowerCase().includes(q));
  }, [repoFiles, fileQuery]);

  if (!open) return null;

  const effectiveBaseName = baseBranch || branches?.current || selectedRepo?.branch || 'HEAD';
  const localTargets =
    branches?.local.filter((b) => b.name !== effectiveBaseName) ?? [];
  const remoteTargets =
    branches?.remote.filter((b) => b.name !== effectiveBaseName) ?? [];
  const hasAnyTargetBranch = localTargets.length > 0 || remoteTargets.length > 0;
  const branchCompareReady = Boolean(
    selectedRepo && targetBranch && targetBranch !== effectiveBaseName
  );
  const fileCompareReady = Boolean(selectedRepo && selectedFilePath.trim());

  const renderRefOptions = (repo: RepoSummary) => (
    <>
      <option value="HEAD">Current Branch (HEAD: {repo.branch})</option>
      <option value="working">Working Tree (Local edits)</option>
      <option value="staged">Staged (Index)</option>
      {branches && branches.local.length > 0 && (
        <optgroup label="Local Branches (recent first)">
          {branches.local.map((b) => (
            <option key={`l:${b.name}`} value={`ref:${b.name}`}>
              branch: {b.name}
              {b.relativeDate ? ` (${b.relativeDate})` : ''}
            </option>
          ))}
        </optgroup>
      )}
      {branches && branches.remote.length > 0 && (
        <optgroup label="Remote Branches (recent first)">
          {branches.remote.map((b) => (
            <option key={`r:${b.name}`} value={`ref:${b.name}`}>
              remote: {b.name}
              {b.relativeDate ? ` (${b.relativeDate})` : ''}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card commit-modal"
        style={{ maxWidth: 580 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <div className="modal-title">
            <GitCompare size={17} style={{ color: 'var(--accent)' }} />
            <span>Compare Repository, Branches, or Files</span>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="update-modal-body">
          <div
            className="theme-segmented"
            style={{ gridTemplateColumns: '1fr 1fr' }}
          >
            <button
              type="button"
              className={`theme-segment-btn ${mode === 'branches' ? 'active' : ''}`}
              onClick={() => setMode('branches')}
              title="Pick a repo and compare two branches across all changed files"
            >
              <GitBranch size={13} style={{ marginRight: 5 }} />
              Branch vs Branch
            </button>
            <button
              type="button"
              className={`theme-segment-btn ${mode === 'file' ? 'active' : ''}`}
              onClick={() => setMode('file')}
              title="Pick a repo and compare a specific file across branches or working tree"
            >
              <FolderTree size={13} style={{ marginRight: 5 }} />
              File Compare (A ↔ B)
            </button>
          </div>

          <label className="settings-field">
            <span>Repository</span>
            <select
              className="compare-select"
              style={{ width: '100%', maxWidth: '100%', padding: '6px 8px' }}
              value={selectedRepo?.id ?? ''}
              onChange={(e) => {
                setSelectedRepoId(e.target.value);
                setBaseBranch('');
                setTargetBranch('');
                setSelectedFilePath('');
              }}
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (current: {r.branch})
                </option>
              ))}
            </select>
          </label>

          {mode === 'branches' && selectedRepo && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10
                }}
              >
                <label className="settings-field">
                  <span>Base / Current Branch (Left)</span>
                  <select
                    className="compare-select"
                    style={{ width: '100%', maxWidth: '100%', padding: '6px 8px' }}
                    value={baseBranch}
                    disabled={loadingBranches}
                    onChange={(e) => setBaseBranch(e.target.value)}
                  >
                    <option value="">
                      Current: {selectedRepo.branch} (HEAD)
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
                </label>

                <label className="settings-field">
                  <span>Target Branch (Right)</span>
                  <select
                    className="compare-select"
                    style={{ width: '100%', maxWidth: '100%', padding: '6px 8px' }}
                    value={targetBranch}
                    disabled={loadingBranches}
                    onChange={(e) => setTargetBranch(e.target.value)}
                  >
                    {!branches && <option value="">Loading branches...</option>}
                    {branches && !hasAnyTargetBranch && (
                      <option value="">No other branches in this repo</option>
                    )}
                    {branches && localTargets.length > 0 && (
                      <optgroup label="Local Branches (recent first)">
                        {localTargets.map((b) => (
                          <option key={`tl:${b.name}`} value={b.name}>
                            {b.name}
                            {b.relativeDate ? ` (${b.relativeDate})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {branches && remoteTargets.length > 0 && (
                      <optgroup label="Remote Branches (recent first)">
                        {remoteTargets.map((b) => (
                          <option key={`tr:${b.name}`} value={b.name}>
                            {b.name}
                            {b.relativeDate ? ` (${b.relativeDate})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              </div>

              <div className="commit-branch-hint">
                Opens the <strong>Branch Compare</strong> view showing all changed
                files in Tree or List view, with checkboxes and file-by-file
                side-by-side comparison.
              </div>
            </>
          )}

          {mode === 'file' && selectedRepo && (
            <>
              <label className="settings-field">
                <span>File ({filteredFiles.length} matching)</span>
                <input
                  className="commit-new-branch-input-row"
                  style={{
                    width: '100%',
                    color: 'var(--text-primary)',
                    marginBottom: 4
                  }}
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="Filter files in repo..."
                />
                <select
                  className="compare-select"
                  style={{ width: '100%', maxWidth: '100%', padding: '6px 8px' }}
                  value={selectedFilePath}
                  onChange={(e) => setSelectedFilePath(e.target.value)}
                >
                  {selectedFilePath &&
                    !filteredFiles.some((f) => f.path === selectedFilePath) && (
                      <option value={selectedFilePath}>
                        {selectedFilePath}
                      </option>
                    )}
                  {filteredFiles.slice(0, 800).map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.path}
                    </option>
                  ))}
                </select>
              </label>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10
                }}
              >
                <label className="settings-field">
                  <span>Left (A)</span>
                  <select
                    className="compare-select"
                    style={{ width: '100%', maxWidth: '100%', padding: '6px 8px' }}
                    value={leftRefValue}
                    onChange={(e) => setLeftRefValue(e.target.value)}
                  >
                    {renderRefOptions(selectedRepo)}
                  </select>
                </label>

                <label className="settings-field">
                  <span>Right (B)</span>
                  <select
                    className="compare-select"
                    style={{ width: '100%', maxWidth: '100%', padding: '6px 8px' }}
                    value={rightRefValue}
                    onChange={(e) => setRightRefValue(e.target.value)}
                  >
                    {renderRefOptions(selectedRepo)}
                  </select>
                </label>
              </div>
            </>
          )}
        </div>

        <div className="settings-footer">
          <div>
            {hasLastCustomCompare && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onReopenLastCustomCompare();
                  onClose();
                }}
                title="Reopen the previous A ↔ B diff"
              >
                <History size={13} /> Open Last A ↔ B
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            {mode === 'branches' ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!branchCompareReady}
                onClick={() => {
                  if (!selectedRepo || !targetBranch) return;
                  onStartBranchCompare(selectedRepo, baseBranch, targetBranch);
                  onClose();
                }}
              >
                Compare Branches
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!fileCompareReady}
                onClick={() => {
                  if (!selectedRepo || !selectedFilePath.trim()) return;
                  const cleanPath = selectedFilePath.trim();
                  onStartFileCompare(
                    refValueToSlot(selectedRepo, cleanPath, leftRefValue),
                    refValueToSlot(selectedRepo, cleanPath, rightRefValue)
                  );
                  onClose();
                }}
              >
                Compare File
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
