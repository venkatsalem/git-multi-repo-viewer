export type FileStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

export interface ChangedFile {
  repoId: string;
  path: string;
  oldPath?: string;
  status: FileStatusCode;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  branch: string;
  headSha: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: ChangedFile[];
  error?: string;
}

export interface WorkspaceScanResult {
  rootPath: string;
  repos: RepoSummary[];
  scannedAt: number;
}

export interface CommitInfo {
  repoId: string;
  repoName: string;
  repoPath: string;
  sha: string;
  shortSha: string;
  parentShas: string[];
  author: string;
  email: string;
  dateIso: string;
  timestamp: number;
  subject: string;
  body: string;
  refs: string[];
  unpushed: boolean;
}

export interface CommitFileChange {
  path: string;
  oldPath?: string;
  status: FileStatusCode;
  additions: number | null;
  deletions: number | null;
}

export interface FileEntry {
  path: string;
  name: string;
}

export type CompareSource =
  | { kind: 'working'; repoPath: string; filePath: string }
  | { kind: 'staged'; repoPath: string; filePath: string }
  | { kind: 'rev'; repoPath: string; filePath: string; ref: string }
  | { kind: 'empty'; label?: string };

export interface DiffContentResult {
  leftContent: string;
  rightContent: string;
  leftLabel: string;
  rightLabel: string;
  language: string;
  isBinary: boolean;
  error?: string;
}

export interface FileContentResult {
  content: string;
  language: string;
  isBinary: boolean;
  error?: string;
}

export interface CommitActionTarget {
  repoPath: string;
  repoName: string;
  paths: string[];
}

export interface CommitResultItem {
  repoPath: string;
  repoName: string;
  ok: boolean;
  sha?: string;
  error?: string;
}

export type IgnoreTarget = 'gitignore' | 'exclude';

export interface IgnoreFileResult {
  alreadyPresent: boolean;
  pattern: string;
  targetFile: string;
}

export interface GitRemoteActionResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface RepoRefs {
  branches: string[];
  tags: string[];
}
