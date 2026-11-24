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
  onWorkspaceChanged: (callback: () => void) => () => void;
  setThemeSource: (source: 'system' | 'light' | 'dark') => Promise<void>;
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
  onWorkspaceChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('workspace:changed', handler);
    return () => {
      ipcRenderer.removeListener('workspace:changed', handler);
    };
  },
  setThemeSource: (source) => ipcRenderer.invoke('theme:setSource', source)
};

contextBridge.exposeInMainWorld('gitViewer', api);
