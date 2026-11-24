import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import {
  ChangedFile,
  CommitActionTarget,
  CommitFileChange,
  CommitInfo,
  CommitResultItem,
  CompareSource,
  DiffContentResult,
  FileContentResult,
  FileEntry,
  FileStatusCode,
  RepoRefs,
  RepoSummary,
  WorkspaceScanResult
} from '../shared/types';
import { detectLanguage } from './language';

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  'dist',
  'dist-electron',
  'build',
  'target',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  '__pycache__',
  'bin',
  'obj',
  '.idea',
  '.vs'
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const GIT_MAX_BUFFER = 25 * 1024 * 1024;

function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function isBinaryBuffer(buf: Buffer): boolean {
  const sampleLen = Math.min(buf.length, 8192);
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'core.quotepath=false', ...args],
    {
      cwd: repoPath,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true
    }
  );
  return stdout;
}

async function runGitBuffer(repoPath: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'core.quotepath=false', ...args],
    {
      cwd: repoPath,
      encoding: 'buffer',
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true
    }
  );
  return stdout as unknown as Buffer;
}

export async function discoverGitRepos(
  rootPath: string,
  maxDepth = 5
): Promise<string[]> {
  const repos: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasGit = entries.some((e) => e.name === '.git');
    if (hasGit) {
      repos.push(dir);
    }

    const subdirs = entries.filter(
      (e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')
    );

    await Promise.all(
      subdirs.map((sub) => walk(path.join(dir, sub.name), depth + 1))
    );
  }

  await walk(rootPath, 0);
  repos.sort((a, b) => a.localeCompare(b));
  return repos;
}

function mapStatusCode(code: string): FileStatusCode {
  if (code === '?') return '?';
  if (code === 'A') return 'A';
  if (code === 'D') return 'D';
  if (code === 'R') return 'R';
  if (code === 'C') return 'C';
  if (code === 'U') return 'U';
  return 'M';
}

function parseBranchHeader(header: string): {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
} {
  const raw = header.startsWith('## ') ? header.slice(3) : header;
  if (raw.startsWith('No commits yet on ')) {
    return {
      branch: raw.slice('No commits yet on '.length).trim(),
      ahead: 0,
      behind: 0
    };
  }
  if (raw.startsWith('HEAD (no branch)')) {
    return { branch: 'HEAD (detached)', ahead: 0, behind: 0 };
  }

  let ahead = 0;
  let behind = 0;
  let mainPart = raw;

  const bracketMatch = raw.match(/\[(.+?)\]\s*$/);
  if (bracketMatch) {
    mainPart = raw.slice(0, bracketMatch.index).trim();
    const info = bracketMatch[1];
    const aheadMatch = info.match(/ahead (\d+)/);
    const behindMatch = info.match(/behind (\d+)/);
    if (aheadMatch) ahead = Number(aheadMatch[1]);
    if (behindMatch) behind = Number(behindMatch[1]);
  }

  const dotsIdx = mainPart.indexOf('...');
  if (dotsIdx >= 0) {
    return {
      branch: mainPart.slice(0, dotsIdx).trim(),
      upstream: mainPart.slice(dotsIdx + 3).trim(),
      ahead,
      behind
    };
  }

  return { branch: mainPart.trim() || 'HEAD', ahead, behind };
}

function parsePorcelainZ(repoId: string, raw: string): {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: ChangedFile[];
} {
  const tokens = raw.split('\0');
  let branchInfo = { branch: 'HEAD', ahead: 0, behind: 0 } as {
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
  };
  const changes: ChangedFile[] = [];

  let i = 0;
  if (tokens[0]?.startsWith('## ')) {
    branchInfo = parseBranchHeader(tokens[0]);
    i = 1;
  }

  while (i < tokens.length) {
    const entry = tokens[i];
    i += 1;
    if (!entry) continue;

    const indexStatus = entry[0] ?? ' ';
    const worktreeStatus = entry[1] ?? ' ';
    const filePath = toPosixPath(entry.slice(3));

    let oldPath: string | undefined;
    if (
      indexStatus === 'R' ||
      indexStatus === 'C' ||
      worktreeStatus === 'R' ||
      worktreeStatus === 'C'
    ) {
      if (i < tokens.length && tokens[i]) {
        oldPath = toPosixPath(tokens[i]);
        i += 1;
      }
    }

    const untracked = indexStatus === '?' && worktreeStatus === '?';
    const staged = !untracked && indexStatus !== ' ';
    const unstaged = !untracked && worktreeStatus !== ' ';

    const primaryChar = untracked
      ? '?'
      : worktreeStatus !== ' ' && indexStatus === ' '
        ? worktreeStatus
        : indexStatus !== ' '
          ? indexStatus
          : worktreeStatus;

    changes.push({
      repoId,
      path: filePath,
      oldPath,
      status: mapStatusCode(primaryChar),
      indexStatus,
      worktreeStatus,
      staged,
      unstaged,
      untracked
    });
  }

  changes.sort((a, b) => a.path.localeCompare(b.path));
  return { ...branchInfo, changes };
}

export async function getRepoSummary(
  rootPath: string,
  repoPath: string
): Promise<RepoSummary> {
  const relative = path.relative(rootPath, repoPath) || '.';
  const name = relative === '.' ? path.basename(repoPath) : relative;
  const id = toPosixPath(repoPath);

  try {
    const [statusRaw, headSha] = await Promise.all([
      runGit(repoPath, ['status', '--porcelain=v1', '-b', '-uall', '-z']),
      runGit(repoPath, ['rev-parse', 'HEAD']).then(
        (s) => s.trim(),
        () => ''
      )
    ]);

    const parsed = parsePorcelainZ(id, statusRaw);

    return {
      id,
      name: toPosixPath(name),
      path: repoPath,
      relativePath: toPosixPath(relative),
      branch: parsed.branch,
      headSha,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      changes: parsed.changes
    };
  } catch (err) {
    return {
      id,
      name: toPosixPath(name),
      path: repoPath,
      relativePath: toPosixPath(relative),
      branch: 'unknown',
      headSha: '',
      ahead: 0,
      behind: 0,
      changes: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function scanWorkspace(
  rootPath: string
): Promise<WorkspaceScanResult> {
  const repoPaths = await discoverGitRepos(rootPath, 5);
  const repos = await Promise.all(
    repoPaths.map((rp) => getRepoSummary(rootPath, rp))
  );

  // Sort dirty / ahead repos first, then alphabetically
  repos.sort((a, b) => {
    const aActive = a.changes.length > 0 || a.ahead > 0 ? 0 : 1;
    const bActive = b.changes.length > 0 || b.ahead > 0 ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.name.localeCompare(b.name);
  });

  return {
    rootPath,
    repos,
    scannedAt: Date.now()
  };
}

export async function getRepoCommits(
  repo: Pick<RepoSummary, 'id' | 'name' | 'path'>,
  limit = 60
): Promise<CommitInfo[]> {
  const RECORD_SEP = '\x1e';
  const FIELD_SEP = '\x1f';
  const format = [
    '%H',
    '%h',
    '%P',
    '%an',
    '%ae',
    '%aI',
    '%at',
    '%D',
    '%s',
    '%b'
  ].join(FIELD_SEP) + RECORD_SEP;

  let logOut = '';
  try {
    logOut = await runGit(repo.path, [
      'log',
      `-n`,
      String(limit),
      '--date-order',
      `--format=${format}`
    ]);
  } catch {
    return [];
  }

  const unpushedSet = new Set<string>();
  try {
    const unpushedRaw = await runGit(repo.path, ['rev-list', '@{u}..HEAD']);
    for (const line of unpushedRaw.split(/\r?\n/)) {
      const sha = line.trim();
      if (sha) unpushedSet.add(sha);
    }
  } catch {
    // No upstream configured; leave unpushedSet empty
  }

  const commits: CommitInfo[] = [];
  for (const record of logOut.split(RECORD_SEP)) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const fields = trimmed.split(FIELD_SEP);
    if (fields.length < 9) continue;

    const [
      sha,
      shortSha,
      parentsRaw,
      author,
      email,
      dateIso,
      tsRaw,
      refsRaw,
      subject,
      ...bodyParts
    ] = fields;

    const refs = refsRaw
      ? refsRaw
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean)
      : [];

    commits.push({
      repoId: repo.id,
      repoName: repo.name,
      repoPath: repo.path,
      sha: sha.trim(),
      shortSha: shortSha.trim(),
      parentShas: parentsRaw.trim() ? parentsRaw.trim().split(/\s+/) : [],
      author,
      email,
      dateIso,
      timestamp: Number(tsRaw) || 0,
      subject,
      body: bodyParts.join(FIELD_SEP).trim(),
      refs,
      unpushed: unpushedSet.has(sha.trim())
    });
  }

  return commits;
}

export async function getCommitFiles(
  repoPath: string,
  sha: string
): Promise<CommitFileChange[]> {
  const [nameStatusRaw, numstatRaw] = await Promise.all([
    runGit(repoPath, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-M',
      '-z',
      sha
    ]),
    runGit(repoPath, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--numstat',
      '-r',
      '-M',
      '-z',
      sha
    ])
  ]);

  const statMap = new Map<
    string,
    { additions: number | null; deletions: number | null }
  >();
  const numTokens = numstatRaw.split('\0');
  let ni = 0;
  while (ni < numTokens.length) {
    const tok = numTokens[ni++];
    if (!tok) continue;
    const parts = tok.split('\t');
    if (parts.length < 3) continue;
    const addRaw = parts[0];
    const delRaw = parts[1];
    let filePath = parts.slice(2).join('\t');
    if (filePath === '' && ni + 1 < numTokens.length) {
      // Rename in -z numstat: "\t\0old\0new\0"
      ni++; // skip old
      filePath = numTokens[ni++] ?? '';
    }
    statMap.set(toPosixPath(filePath), {
      additions: addRaw === '-' ? null : Number(addRaw),
      deletions: delRaw === '-' ? null : Number(delRaw)
    });
  }

  const results: CommitFileChange[] = [];
  const nsTokens = nameStatusRaw.split('\0');
  let i = 0;
  while (i < nsTokens.length) {
    const statusTok = nsTokens[i++];
    if (!statusTok) continue;
    const code = statusTok[0];
    if (code === 'R' || code === 'C') {
      const oldPath = toPosixPath(nsTokens[i++] ?? '');
      const newPath = toPosixPath(nsTokens[i++] ?? '');
      const stats = statMap.get(newPath) ?? {
        additions: null,
        deletions: null
      };
      results.push({
        path: newPath,
        oldPath,
        status: mapStatusCode(code),
        ...stats
      });
    } else {
      const filePath = toPosixPath(nsTokens[i++] ?? '');
      const stats = statMap.get(filePath) ?? {
        additions: null,
        deletions: null
      };
      results.push({
        path: filePath,
        status: mapStatusCode(code),
        ...stats
      });
    }
  }

  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

export async function listRepoFiles(repoPath: string): Promise<FileEntry[]> {
  try {
    const out = await runGit(repoPath, [
      'ls-files',
      '-co',
      '--exclude-standard',
      '-z'
    ]);
    const files: FileEntry[] = [];
    for (const raw of out.split('\0')) {
      if (!raw) continue;
      const normalized = toPosixPath(raw);
      files.push({
        path: normalized,
        name: path.posix.basename(normalized)
      });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
  } catch {
    return [];
  }
}

export async function getRepoRefs(repoPath: string): Promise<RepoRefs> {
  try {
    const [branchesRaw, tagsRaw] = await Promise.all([
      runGit(repoPath, [
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads',
        'refs/remotes'
      ]),
      runGit(repoPath, ['tag', '--sort=-creatordate'])
    ]);
    return {
      branches: branchesRaw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      tags: tagsRaw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50)
    };
  } catch {
    return { branches: [], tags: [] };
  }
}

async function readCompareSource(
  source: CompareSource
): Promise<{ content: string; label: string; filePath: string; isBinary: boolean }> {
  if (source.kind === 'empty') {
    return {
      content: '',
      label: source.label ?? '(empty)',
      filePath: '',
      isBinary: false
    };
  }

  if (source.kind === 'working') {
    const absPath = path.join(source.repoPath, source.filePath);
    try {
      const stat = await fs.stat(absPath);
      if (stat.size > MAX_FILE_BYTES) {
        return {
          content: `[File too large to display (${(stat.size / 1024 / 1024).toFixed(2)} MB)]`,
          label: `Working Tree (${source.filePath})`,
          filePath: source.filePath,
          isBinary: true
        };
      }
      const buf = await fs.readFile(absPath);
      if (isBinaryBuffer(buf)) {
        return {
          content: '[Binary file]',
          label: `Working Tree (${source.filePath})`,
          filePath: source.filePath,
          isBinary: true
        };
      }
      return {
        content: buf.toString('utf8'),
        label: `Working Tree (${source.filePath})`,
        filePath: source.filePath,
        isBinary: false
      };
    } catch {
      return {
        content: '',
        label: `Working Tree (${source.filePath} — deleted/missing)`,
        filePath: source.filePath,
        isBinary: false
      };
    }
  }

  if (source.kind === 'staged') {
    try {
      const buf = await runGitBuffer(source.repoPath, [
        'show',
        `:${source.filePath}`
      ]);
      if (buf.length > MAX_FILE_BYTES || isBinaryBuffer(buf)) {
        return {
          content: '[Binary or oversized file]',
          label: `Staged (${source.filePath})`,
          filePath: source.filePath,
          isBinary: true
        };
      }
      return {
        content: buf.toString('utf8'),
        label: `Staged (${source.filePath})`,
        filePath: source.filePath,
        isBinary: false
      };
    } catch {
      return {
        content: '',
        label: `Staged (${source.filePath} — not in index)`,
        filePath: source.filePath,
        isBinary: false
      };
    }
  }

  // rev
  try {
    const buf = await runGitBuffer(source.repoPath, [
      'show',
      `${source.ref}:${source.filePath}`
    ]);
    if (buf.length > MAX_FILE_BYTES || isBinaryBuffer(buf)) {
      return {
        content: '[Binary or oversized file]',
        label: `${source.ref} (${source.filePath})`,
        filePath: source.filePath,
        isBinary: true
      };
    }
    return {
      content: buf.toString('utf8'),
      label: `${source.ref} (${source.filePath})`,
      filePath: source.filePath,
      isBinary: false
    };
  } catch {
    return {
      content: '',
      label: `${source.ref} (${source.filePath} — absent)`,
      filePath: source.filePath,
      isBinary: false
    };
  }
}

export async function getDiffContent(
  left: CompareSource,
  right: CompareSource
): Promise<DiffContentResult> {
  try {
    const [l, r] = await Promise.all([
      readCompareSource(left),
      readCompareSource(right)
    ]);
    const refPath = r.filePath || l.filePath;
    return {
      leftContent: l.content,
      rightContent: r.content,
      leftLabel: l.label,
      rightLabel: r.label,
      language: detectLanguage(refPath),
      isBinary: l.isBinary || r.isBinary
    };
  } catch (err) {
    return {
      leftContent: '',
      rightContent: '',
      leftLabel: 'Left',
      rightLabel: 'Right',
      language: 'plaintext',
      isBinary: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function readFileContent(
  repoPath: string,
  filePath: string
): Promise<FileContentResult> {
  const res = await readCompareSource({
    kind: 'working',
    repoPath,
    filePath
  });
  return {
    content: res.content,
    language: detectLanguage(filePath),
    isBinary: res.isBinary
  };
}

export async function stageFiles(
  repoPath: string,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  await runGit(repoPath, ['add', '-A', '--', ...paths]);
}

export async function unstageFiles(
  repoPath: string,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  try {
    await runGit(repoPath, ['reset', 'HEAD', '--', ...paths]);
  } catch {
    // Repo with no commits yet: fall back to git rm --cached
    await runGit(repoPath, ['rm', '--cached', '-r', '--', ...paths]);
  }
}

export async function discardFiles(
  repoPath: string,
  paths: string[],
  untrackedPaths: string[]
): Promise<void> {
  if (paths.length > 0) {
    await runGit(repoPath, [
      'checkout',
      'HEAD',
      '--',
      ...paths
    ]).catch(async () => {
      // Handle staged-only new files in repos without HEAD or newly added
      await runGit(repoPath, ['restore', '--staged', '--worktree', '--', ...paths]);
    });
  }
  if (untrackedPaths.length > 0) {
    await runGit(repoPath, ['clean', '-fd', '--', ...untrackedPaths]);
  }
}

export async function commitAcrossRepos(
  targets: CommitActionTarget[],
  message: string
): Promise<CommitResultItem[]> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Commit message cannot be empty.');
  }

  const results: CommitResultItem[] = [];
  for (const target of targets) {
    if (target.paths.length === 0) continue;
    try {
      await runGit(target.repoPath, ['add', '-A', '--', ...target.paths]);
      await runGit(target.repoPath, [
        'commit',
        '-m',
        trimmed,
        '--',
        ...target.paths
      ]);
      const sha = (await runGit(target.repoPath, ['rev-parse', '--short', 'HEAD'])).trim();
      results.push({
        repoPath: target.repoPath,
        repoName: target.repoName,
        ok: true,
        sha
      });
    } catch (err) {
      results.push({
        repoPath: target.repoPath,
        repoName: target.repoName,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return results;
}
