import { contextBridge, ipcRenderer } from 'electron';
import {
  BranchCompareResult,
  BranchListResult,
  CommitActionTarget,
  CommitFileChange,
  CommitInfo,
  CommitResultItem,
  CompareSource,
  DiffContentResult,
  FileContentResult,
  FileEntry,
  GitRemoteActionResult,
  IgnoreFileResult,
  IgnoreTarget,
  RepoBatchResultItem,
  RepoBatchTarget,
  RepoRefs,
  RepoSummary,
  UpdateProjectOptions,
  WorkspaceScanResult
} from '../shared/types';

export interface GitViewerApi {
  pickFolder: () => Promise<string | null>;
  openRootInNewWindow: (rootPath: string) => Promise<void>;
  getInitialRoot: () => Promise<{ rootPath: string; isExplicit: boolean }>;
  scanWorkspace: (rootPath: string) => Promise<WorkspaceScanResult>;
  watchWorkspace: (rootPath: string) => Promise<void>;
  getRepoCommits: (
    repo: Pick<RepoSummary, 'id' | 'name' | 'path'>,
    limit?: number,
    branchRef?: string
  ) => Promise<CommitInfo[]>;
  getCommitFiles: (repoPath: string, sha: string) => Promise<CommitFileChange[]>;
  listRepoFiles: (repoPath: string) => Promise<FileEntry[]>;
  getRepoRefs: (repoPath: string) => Promise<RepoRefs>;
  getDiff: (left: CompareSource, right: CompareSource) => Promise<DiffContentResult>;
  readFile: (repoPath: string, filePath: string) => Promise<FileContentResult>;
  stageFiles: (repoPath: string, paths: string[]) => Promise<void>;
  unstageFiles: (repoPath: string, paths: string[]) => Promise<void>;
  discardFiles: (
    repoPath: string,
    paths: string[],
    untrackedPaths: string[]
  ) => Promise<void>;
  commitAcrossRepos: (
    targets: CommitActionTarget[],
    message: string,
    newBranchName?: string
  ) => Promise<CommitResultItem[]>;
  commitStagedAcrossRepos: (
    targets: { repoPath: string; repoName: string }[],
    message: string,
    newBranchName?: string
  ) => Promise<CommitResultItem[]>;
  stageAll: (repoPath: string) => Promise<void>;
  unstageAll: (repoPath: string) => Promise<void>;
  ignorePattern: (
    repoPath: string,
    pattern: string,
    target: IgnoreTarget,
    untrackPaths?: string[]
  ) => Promise<IgnoreFileResult>;
  setSkipWorktree: (
    repoPath: string,
    paths: string[],
    skip: boolean
  ) => Promise<void>;
  getSkipWorktreeFiles: (repoPath: string) => Promise<string[]>;
  remoteAction: (
    repoPath: string,
    action: 'fetch' | 'pull' | 'push'
  ) => Promise<GitRemoteActionResult>;
  fetchAllRepos: (repos: RepoBatchTarget[]) => Promise<RepoBatchResultItem[]>;
  updateProjectRepos: (
    repos: RepoBatchTarget[],
    options: UpdateProjectOptions
  ) => Promise<RepoBatchResultItem[]>;
  getRepoBranches: (repoPath: string) => Promise<BranchListResult>;
  checkoutBranch: (
    repoPath: string,
    targetBranch: string,
    options?: { createNew?: boolean; isRemote?: boolean }
  ) => Promise<{ branch: string; summary: string }>;
  checkoutBranchAcrossRepos: (
    repos: RepoBatchTarget[],
    targetBranch: string,
    createIfMissing: boolean
  ) => Promise<RepoBatchResultItem[]>;
  deleteLocalBranch: (
    repoPath: string,
    branchName: string,
    force?: boolean
  ) => Promise<void>;
  cherryPickCommits: (
    repoPath: string,
    shas: string[],
    noCommit?: boolean
  ) => Promise<{ ok: boolean; summary: string; error?: string }>;
  checkoutFileFromRef: (
    repoPath: string,
    ref: string,
    filePath: string
  ) => Promise<void>;
  checkoutFilesFromRef: (
    repoPath: string,
    ref: string,
    filePaths: string[]
  ) => Promise<void>;
  compareBranchWithCurrent: (
    repo: Pick<RepoSummary, 'id' | 'name' | 'path' | 'branch'>,
    targetBranch: string,
    mode?: 'direct' | 'target-only',
    baseBranch?: string
  ) => Promise<BranchCompareResult>;
  onWorkspaceChanged: (callback: () => void) => () => void;
  setThemeSource: (source: 'system' | 'light' | 'dark') => Promise<void>;
  showInExplorer: (targetPath: string, isFile?: boolean) => Promise<void>;
  openTerminal: (targetPath: string) => Promise<void>;
}

const api: GitViewerApi = {
  pickFolder: () => ipcRenderer.invoke('workspace:pickFolder'),
  openRootInNewWindow: (rootPath) =>
    ipcRenderer.invoke('workspace:openRootInNewWindow', rootPath),
  getInitialRoot: () => ipcRenderer.invoke('workspace:getInitialRoot'),
  scanWorkspace: (rootPath) => ipcRenderer.invoke('workspace:scan', rootPath),
  watchWorkspace: (rootPath) => ipcRenderer.invoke('workspace:watch', rootPath),
  getRepoCommits: (repo, limit, branchRef) =>
    ipcRenderer.invoke('repo:getCommits', repo, limit, branchRef),
  getCommitFiles: (repoPath, sha) =>
    ipcRenderer.invoke('repo:getCommitFiles', repoPath, sha),
  listRepoFiles: (repoPath) => ipcRenderer.invoke('repo:listFiles', repoPath),
  getRepoRefs: (repoPath) => ipcRenderer.invoke('repo:getRefs', repoPath),
  getDiff: (left, right) => ipcRenderer.invoke('git:getDiff', left, right),
  readFile: (repoPath, filePath) =>
    ipcRenderer.invoke('git:readFile', repoPath, filePath),
  stageFiles: (repoPath, paths) =>
    ipcRenderer.invoke('git:stage', repoPath, paths),
  unstageFiles: (repoPath, paths) =>
    ipcRenderer.invoke('git:unstage', repoPath, paths),
  discardFiles: (repoPath, paths, untrackedPaths) =>
    ipcRenderer.invoke('git:discard', repoPath, paths, untrackedPaths),
  commitAcrossRepos: (targets, message, newBranchName) =>
    ipcRenderer.invoke('git:commitAcrossRepos', targets, message, newBranchName),
  commitStagedAcrossRepos: (targets, message, newBranchName) =>
    ipcRenderer.invoke(
      'git:commitStagedAcrossRepos',
      targets,
      message,
      newBranchName
    ),
  stageAll: (repoPath) => ipcRenderer.invoke('git:stageAll', repoPath),
  unstageAll: (repoPath) => ipcRenderer.invoke('git:unstageAll', repoPath),
  ignorePattern: (repoPath, pattern, target, untrackPaths) =>
    ipcRenderer.invoke('git:ignorePattern', repoPath, pattern, target, untrackPaths),
  setSkipWorktree: (repoPath, paths, skip) =>
    ipcRenderer.invoke('git:setSkipWorktree', repoPath, paths, skip),
  getSkipWorktreeFiles: (repoPath) =>
    ipcRenderer.invoke('git:getSkipWorktreeFiles', repoPath),
  remoteAction: (repoPath, action) =>
    ipcRenderer.invoke('git:remoteAction', repoPath, action),
  fetchAllRepos: (repos) => ipcRenderer.invoke('git:fetchAllRepos', repos),
  updateProjectRepos: (repos, options) =>
    ipcRenderer.invoke('git:updateProjectRepos', repos, options),
  getRepoBranches: (repoPath) =>
    ipcRenderer.invoke('git:getRepoBranches', repoPath),
  checkoutBranch: (repoPath, targetBranch, options) =>
    ipcRenderer.invoke('git:checkoutBranch', repoPath, targetBranch, options),
  checkoutBranchAcrossRepos: (repos, targetBranch, createIfMissing) =>
    ipcRenderer.invoke(
      'git:checkoutBranchAcrossRepos',
      repos,
      targetBranch,
      createIfMissing
    ),
  deleteLocalBranch: (repoPath, branchName, force) =>
    ipcRenderer.invoke('git:deleteLocalBranch', repoPath, branchName, force),
  cherryPickCommits: (repoPath, shas, noCommit) =>
    ipcRenderer.invoke('git:cherryPickCommits', repoPath, shas, noCommit),
  checkoutFileFromRef: (repoPath, ref, filePath) =>
    ipcRenderer.invoke('git:checkoutFileFromRef', repoPath, ref, filePath),
  checkoutFilesFromRef: (repoPath, ref, filePaths) =>
    ipcRenderer.invoke('git:checkoutFilesFromRef', repoPath, ref, filePaths),
  compareBranchWithCurrent: (repo, targetBranch, mode, baseBranch) =>
    ipcRenderer.invoke(
      'git:compareBranchWithCurrent',
      repo,
      targetBranch,
      mode,
      baseBranch
    ),
  onWorkspaceChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('workspace:changed', handler);
    return () => {
      ipcRenderer.removeListener('workspace:changed', handler);
    };
  },
  setThemeSource: (source) => ipcRenderer.invoke('theme:setSource', source),
  showInExplorer: (targetPath, isFile) =>
    ipcRenderer.invoke('shell:showInExplorer', targetPath, isFile),
  openTerminal: (targetPath) =>
    ipcRenderer.invoke('shell:openTerminal', targetPath)
};

contextBridge.exposeInMainWorld('gitViewer', api);
