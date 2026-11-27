import { contextBridge, ipcRenderer } from 'electron';
import {
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
  RepoRefs,
  RepoSummary,
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
    limit?: number
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
    message: string
  ) => Promise<CommitResultItem[]>;
  commitStagedAcrossRepos: (
    targets: { repoPath: string; repoName: string }[],
    message: string
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
  getRepoCommits: (repo, limit) =>
    ipcRenderer.invoke('repo:getCommits', repo, limit),
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
  commitAcrossRepos: (targets, message) =>
    ipcRenderer.invoke('git:commitAcrossRepos', targets, message),
  commitStagedAcrossRepos: (targets, message) =>
    ipcRenderer.invoke('git:commitStagedAcrossRepos', targets, message),
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
