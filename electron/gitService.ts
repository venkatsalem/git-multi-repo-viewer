import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import {
  BranchCompareResult,
  BranchEntry,
  BranchListResult,
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
  limit = 60,
  branchRef?: string
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
    const args = ['log', `-n`, String(limit), '--date-order', `--format=${format}`];
    const ref = branchRef?.trim();
    if (ref === '--all') {
      args.push('--all');
    } else if (ref) {
      args.push(ref);
    }
    logOut = await runGit(repo.path, args);
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
        '--sort=-committerdate',
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
        .filter((s) => Boolean(s) && !s.endsWith('/HEAD')),
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

async function validateNewBranchName(
  repoPath: string,
  newBranchName?: string
): Promise<string | undefined> {
  const clean = newBranchName?.trim();
  if (!clean) return undefined;
  try {
    await runGit(repoPath, ['check-ref-format', '--branch', clean]);
  } catch {
    throw new Error(`Invalid branch name: "${clean}"`);
  }
  return clean;
}

export async function commitAcrossRepos(
  targets: CommitActionTarget[],
  message: string,
  newBranchName?: string
): Promise<CommitResultItem[]> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Commit message cannot be empty.');
  }
  const activeTargets = targets.filter((t) => t.paths.length > 0);
  if (activeTargets.length === 0) return [];

  const cleanNewBranch = await validateNewBranchName(
    activeTargets[0].repoPath,
    newBranchName
  );

  const results: CommitResultItem[] = [];
  for (const target of activeTargets) {
    try {
      if (cleanNewBranch) {
        await checkoutBranchInRepo(target.repoPath, cleanNewBranch, {
          createNew: true
        });
      }
      await runGit(target.repoPath, ['add', '-A', '--', ...target.paths]);
      await runGit(target.repoPath, [
        'commit',
        '-m',
        trimmed,
        '--',
        ...target.paths
      ]);
      const sha = (await runGit(target.repoPath, ['rev-parse', '--short', 'HEAD'])).trim();
      const branch = (
        await runGit(target.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      ).trim();
      results.push({
        repoPath: target.repoPath,
        repoName: target.repoName,
        ok: true,
        sha,
        branch
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

export async function commitStagedAcrossRepos(
  targets: { repoPath: string; repoName: string }[],
  message: string,
  newBranchName?: string
): Promise<CommitResultItem[]> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Commit message cannot be empty.');
  }
  if (targets.length === 0) return [];

  const cleanNewBranch = await validateNewBranchName(
    targets[0].repoPath,
    newBranchName
  );

  const results: CommitResultItem[] = [];
  for (const target of targets) {
    try {
      if (cleanNewBranch) {
        await checkoutBranchInRepo(target.repoPath, cleanNewBranch, {
          createNew: true
        });
      }
      await runGit(target.repoPath, ['commit', '-m', trimmed]);
      const sha = (
        await runGit(target.repoPath, ['rev-parse', '--short', 'HEAD'])
      ).trim();
      const branch = (
        await runGit(target.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      ).trim();
      results.push({
        repoPath: target.repoPath,
        repoName: target.repoName,
        ok: true,
        sha,
        branch
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

export async function stageAllInRepo(repoPath: string): Promise<void> {
  await runGit(repoPath, ['add', '-A']);
}

export async function unstageAllInRepo(repoPath: string): Promise<void> {
  try {
    await runGit(repoPath, ['reset', 'HEAD']);
  } catch {
    await runGit(repoPath, ['rm', '--cached', '-r', '.']);
  }
}

export async function ignorePatternInRepo(
  repoPath: string,
  rawPattern: string,
  target: IgnoreTarget,
  untrackPaths: string[] = []
): Promise<IgnoreFileResult> {
  const cleaned = toPosixPath(rawPattern).replace(/^\/+/, '').trim();
  if (!cleaned) {
    throw new Error('Ignore pattern cannot be empty.');
  }
  const entry = cleaned.startsWith('/') ? cleaned : `/${cleaned}`;

  let targetFilePath: string;
  if (target === 'gitignore') {
    targetFilePath = path.join(repoPath, '.gitignore');
  } else {
    const resolvedExclude = (
      await runGit(repoPath, ['rev-parse', '--git-path', 'info/exclude'])
    ).trim();
    targetFilePath = path.isAbsolute(resolvedExclude)
      ? resolvedExclude
      : path.join(repoPath, resolvedExclude);
  }

  await fs.mkdir(path.dirname(targetFilePath), { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(targetFilePath, 'utf8');
  } catch {
    existing = '';
  }

  const existingLines = existing
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const alreadyPresent =
    existingLines.includes(entry) || existingLines.includes(cleaned);

  if (!alreadyPresent) {
    const eol = existing.includes('\r\n') ? '\r\n' : '\n';
    const needsLeadingNewline =
      existing.length > 0 && !existing.endsWith('\n') && !existing.endsWith('\r');
    const addition = `${needsLeadingNewline ? eol : ''}${entry}${eol}`;
    await fs.appendFile(targetFilePath, addition, 'utf8');
  }

  if (untrackPaths.length > 0) {
    await runGit(repoPath, ['rm', '--cached', '-r', '--', ...untrackPaths]).catch(
      () => undefined
    );
  }

  return {
    alreadyPresent,
    pattern: entry,
    targetFile: toPosixPath(path.relative(repoPath, targetFilePath) || targetFilePath)
  };
}

export async function setSkipWorktree(
  repoPath: string,
  paths: string[],
  skip: boolean
): Promise<void> {
  if (paths.length === 0) return;
  await runGit(repoPath, [
    'update-index',
    skip ? '--skip-worktree' : '--no-skip-worktree',
    '--',
    ...paths
  ]);
}

export async function getSkipWorktreeFiles(repoPath: string): Promise<string[]> {
  const raw = await runGit(repoPath, ['ls-files', '-v']);
  const result: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.length > 2 && line[0] === 'S' && line[1] === ' ') {
      result.push(toPosixPath(line.slice(2)));
    }
  }
  return result;
}

export async function runGitRemoteAction(
  repoPath: string,
  action: 'fetch' | 'pull' | 'push'
): Promise<GitRemoteActionResult> {
  const args =
    action === 'fetch'
      ? ['fetch', '--prune']
      : action === 'pull'
        ? ['pull', '--no-edit']
        : ['push'];
  try {
    const { stdout, stderr } = await execFileAsync(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      {
        cwd: repoPath,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true
      }
    );
    const combined = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
    return {
      ok: true,
      output: combined || `git ${action} completed.`
    };
  } catch (err) {
    return {
      ok: false,
      output: '',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIdx = 0;
  async function runWorker(): Promise<void> {
    while (nextIdx < items.length) {
      const idx = nextIdx;
      nextIdx += 1;
      results[idx] = await worker(items[idx]);
    }
  }
  const workerCount = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function runGitWithPromptDisabled(
  repoPath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(
    'git',
    ['-c', 'core.quotepath=false', ...args],
    {
      cwd: repoPath,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    }
  );
  return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

export async function fetchAllRepos(
  repos: RepoBatchTarget[]
): Promise<RepoBatchResultItem[]> {
  return mapWithConcurrency(repos, 6, async (repo) => {
    try {
      const remotesRaw = (await runGit(repo.path, ['remote'])).trim();
      if (!remotesRaw) {
        return {
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
          status: 'skipped',
          summary: 'No git remotes configured'
        };
      }
      const { stdout, stderr } = await runGitWithPromptDisabled(repo.path, [
        'fetch',
        '--all',
        '--prune'
      ]);
      const combined = `${stdout}\n${stderr}`.trim();
      const updated = combined.length > 0;
      return {
        repoId: repo.id,
        repoName: repo.name,
        repoPath: repo.path,
        status: updated ? 'updated' : 'up-to-date',
        summary: updated ? combined.split(/\r?\n/)[0] : 'Already up to date'
      };
    } catch (err) {
      return {
        repoId: repo.id,
        repoName: repo.name,
        repoPath: repo.path,
        status: 'error',
        summary: 'Fetch failed',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });
}

export async function updateProjectRepos(
  repos: RepoBatchTarget[],
  options: UpdateProjectOptions
): Promise<RepoBatchResultItem[]> {
  return mapWithConcurrency(repos, 6, async (repo) => {
    try {
      let upstream = '';
      try {
        upstream = (
          await runGit(repo.path, [
            'rev-parse',
            '--abbrev-ref',
            '--symbolic-full-name',
            '@{u}'
          ])
        ).trim();
      } catch {
        upstream = '';
      }

      if (!upstream) {
        return {
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
          status: 'skipped',
          summary: 'No upstream tracking branch'
        };
      }

      await runGitWithPromptDisabled(repo.path, ['fetch', '--prune']);
      const behindCount = Number(
        (
          await runGit(repo.path, ['rev-list', '--count', 'HEAD..@{u}'])
        ).trim() || '0'
      );

      if (behindCount === 0) {
        return {
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
          status: 'up-to-date',
          summary: `Up to date with ${upstream}`
        };
      }

      const pullArgs = ['pull'];
      if (options.strategy === 'rebase') {
        pullArgs.push('--rebase');
      } else if (options.strategy === 'ff-only') {
        pullArgs.push('--ff-only');
      } else {
        pullArgs.push('--no-edit');
      }
      if (options.autoStash && options.strategy !== 'ff-only') {
        pullArgs.push('--autostash');
      }

      await runGitWithPromptDisabled(repo.path, pullArgs);
      return {
        repoId: repo.id,
        repoName: repo.name,
        repoPath: repo.path,
        status: 'updated',
        summary: `Pulled ${behindCount} commit(s) from ${upstream}`
      };
    } catch (err) {
      return {
        repoId: repo.id,
        repoName: repo.name,
        repoPath: repo.path,
        status: 'error',
        summary: 'Pull failed',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });
}

function formatTrackLabel(trackRaw: string): string {
  const parts: string[] = [];
  const aheadMatch = trackRaw.match(/ahead\s+(\d+)/i);
  const behindMatch = trackRaw.match(/behind\s+(\d+)/i);
  if (aheadMatch) parts.push(`↑${aheadMatch[1]}`);
  if (behindMatch) parts.push(`↓${behindMatch[1]}`);
  return parts.join(' ') || trackRaw;
}

export async function getRepoBranches(repoPath: string): Promise<BranchListResult> {
  const SEP = '\x1f';
  const [currentRaw, localRaw, remoteRaw] = await Promise.all([
    runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    runGit(repoPath, [
      'for-each-ref',
      `--format=%(refname:short)${SEP}%(committerdate:relative)${SEP}%(upstream:short)${SEP}%(upstream:track,nobracket)`,
      '--sort=-committerdate',
      'refs/heads'
    ]).catch(() => ''),
    runGit(repoPath, [
      'for-each-ref',
      `--format=%(refname:short)${SEP}%(committerdate:relative)`,
      '--sort=-committerdate',
      'refs/remotes'
    ]).catch(() => '')
  ]);

  const local: BranchEntry[] = [];
  for (const line of localRaw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name = '', relativeDate = '', upstream = '', trackRaw = ''] =
      line.split(SEP);
    const trimmedName = name.trim();
    if (!trimmedName) continue;
    const cleanUpstream = upstream.trim() || undefined;
    const cleanTrack = trackRaw.trim();

    let syncStatus: BranchEntry['syncStatus'] = 'local-only';
    let trackLabel: string | undefined;

    if (cleanUpstream) {
      if (cleanTrack.toLowerCase() === 'gone') {
        syncStatus = 'gone';
        trackLabel = 'remote gone';
      } else if (cleanTrack) {
        syncStatus = 'ahead-behind';
        trackLabel = formatTrackLabel(cleanTrack);
      } else {
        syncStatus = 'synced';
      }
    }

    local.push({
      name: trimmedName,
      relativeDate: relativeDate.trim(),
      upstream: cleanUpstream,
      syncStatus,
      trackLabel
    });
  }

  const remote: BranchEntry[] = [];
  for (const line of remoteRaw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name = '', relativeDate = ''] = line.split(SEP);
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.endsWith('/HEAD')) continue;
    remote.push({
      name: trimmedName,
      relativeDate: relativeDate.trim(),
      syncStatus: 'synced'
    });
  }

  return {
    current: currentRaw.trim(),
    local,
    remote
  };
}

async function runSwitchOrCheckout(
  repoPath: string,
  switchArgs: string[],
  checkoutArgs: string[]
): Promise<void> {
  try {
    await runGit(repoPath, switchArgs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("is not a git command") || msg.includes('unknown option')) {
      await runGit(repoPath, checkoutArgs);
    } else {
      throw err;
    }
  }
}

export async function checkoutBranchInRepo(
  repoPath: string,
  targetBranch: string,
  options?: { createNew?: boolean; isRemote?: boolean }
): Promise<{ branch: string; summary: string }> {
  const clean = targetBranch.trim();
  if (!clean) {
    throw new Error('Branch name cannot be empty.');
  }

  if (options?.createNew) {
    await runSwitchOrCheckout(
      repoPath,
      ['switch', '-c', clean],
      ['checkout', '-b', clean]
    );
    return { branch: clean, summary: `Created and switched to ${clean}` };
  }

  if (options?.isRemote) {
    const slashIdx = clean.indexOf('/');
    const localName = slashIdx >= 0 ? clean.slice(slashIdx + 1) : clean;
    const localExists = await runGit(repoPath, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${localName}`
    ])
      .then(() => true)
      .catch(() => false);

    if (localExists) {
      await runSwitchOrCheckout(
        repoPath,
        ['switch', localName],
        ['checkout', localName]
      );
      return { branch: localName, summary: `Switched to ${localName}` };
    }

    await runSwitchOrCheckout(
      repoPath,
      ['switch', '-c', localName, '--track', clean],
      ['checkout', '-t', clean]
    );
    return {
      branch: localName,
      summary: `Switched to ${localName} (tracking ${clean})`
    };
  }

  await runSwitchOrCheckout(repoPath, ['switch', clean], ['checkout', clean]);
  return { branch: clean, summary: `Switched to ${clean}` };
}

export async function checkoutBranchAcrossRepos(
  repos: RepoBatchTarget[],
  targetBranch: string,
  createIfMissing: boolean
): Promise<RepoBatchResultItem[]> {
  const clean = targetBranch.trim();
  if (!clean) {
    throw new Error('Target branch cannot be empty.');
  }

  return mapWithConcurrency(repos, 6, async (repo) => {
    try {
      const current = (
        await runGit(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(
          () => ''
        )
      ).trim();
      if (current === clean) {
        return {
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
          status: 'up-to-date',
          summary: `Already on ${clean}`
        };
      }

      const localExists = await runGit(repo.path, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${clean}`
      ])
        .then(() => true)
        .catch(() => false);

      if (localExists) {
        await runSwitchOrCheckout(
          repo.path,
          ['switch', clean],
          ['checkout', clean]
        );
        return {
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
          status: 'updated',
          summary: `Switched to ${clean}`
        };
      }

      const remotesRaw = (
        await runGit(repo.path, [
          'for-each-ref',
          '--format=%(refname:short)',
          'refs/remotes'
        ]).catch(() => '')
      )
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => Boolean(s) && !s.endsWith('/HEAD'));

      const remoteMatch =
        remotesRaw.find((r) => r === `origin/${clean}`) ??
        remotesRaw.find((r) => r.endsWith(`/${clean}`));

      if (remoteMatch) {
        await runSwitchOrCheckout(
          repo.path,
          ['switch', '-c', clean, '--track', remoteMatch],
          ['checkout', '-t', remoteMatch]
        );
        return {
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
          status: 'updated',
          summary: `Checked out ${clean} (tracking ${remoteMatch})`
        };
      }

      if (createIfMissing) {
        await runSwitchOrCheckout(
          repo.path,
          ['switch', '-c', clean],
          ['checkout', '-b', clean]
        );
        return {
          repoId: repo.id,
          repoName: repo.name,
          repoPath: repo.path,
          status: 'updated',
          summary: `Created new branch ${clean}`
        };
      }

      return {
        repoId: repo.id,
        repoName: repo.name,
        repoPath: repo.path,
        status: 'skipped',
        summary: `Branch "${clean}" not found`
      };
    } catch (err) {
      return {
        repoId: repo.id,
        repoName: repo.name,
        repoPath: repo.path,
        status: 'error',
        summary: 'Checkout failed',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });
}

export async function deleteLocalBranch(
  repoPath: string,
  branchName: string,
  force = false
): Promise<void> {
  const clean = branchName.trim();
  if (!clean) throw new Error('Branch name cannot be empty.');
  await runGit(repoPath, ['branch', force ? '-D' : '-d', clean]);
}

export async function cherryPickCommits(
  repoPath: string,
  shas: string[],
  noCommit = false
): Promise<{ ok: boolean; summary: string; error?: string }> {
  if (shas.length === 0) {
    return { ok: false, summary: 'No commits selected', error: 'No commits selected.' };
  }
  const args = ['cherry-pick'];
  if (noCommit) args.push('-n');
  args.push(...shas);
  try {
    await runGit(repoPath, args);
    return {
      ok: true,
      summary: noCommit
        ? `Applied ${shas.length} commit(s) to working tree (not committed)`
        : `Cherry-picked ${shas.length} commit(s) onto current branch`
    };
  } catch (err) {
    return {
      ok: false,
      summary: 'Cherry-pick failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function checkoutFileFromRef(
  repoPath: string,
  ref: string,
  filePath: string
): Promise<void> {
  await runGit(repoPath, ['checkout', ref, '--', filePath]);
}

export async function checkoutFilesFromRef(
  repoPath: string,
  ref: string,
  filePaths: string[]
): Promise<void> {
  if (filePaths.length === 0) return;
  await runGit(repoPath, ['checkout', ref, '--', ...filePaths]);
}

export async function compareBranchWithCurrent(
  repo: Pick<RepoSummary, 'id' | 'name' | 'path' | 'branch'>,
  targetBranch: string,
  mode: 'direct' | 'target-only' = 'direct',
  baseBranch?: string
): Promise<BranchCompareResult> {
  const cleanTarget = targetBranch.trim();
  if (!cleanTarget) {
    throw new Error('Target branch cannot be empty.');
  }
  const cleanBase = baseBranch?.trim();
  const baseRef = cleanBase || 'HEAD';

  // Commits reachable from targetBranch that are not on baseRef
  const commitsOnTarget = await getRepoCommits(
    repo,
    80,
    `${baseRef}..${cleanTarget}`
  );

  // Direct diff (baseRef vs targetBranch) vs Target-only (baseRef...targetBranch since merge-base)
  let nameStatusRaw = '';
  let numstatRaw = '';
  let directChangedPaths: Set<string> | null = null;
  if (mode === 'direct') {
    [nameStatusRaw, numstatRaw] = await Promise.all([
      runGit(repo.path, ['diff', '--name-status', '-M', '-z', baseRef, cleanTarget]).catch(
        () => ''
      ),
      runGit(repo.path, ['diff', '--numstat', '-M', '-z', baseRef, cleanTarget]).catch(
        () => ''
      )
    ]);
  } else {
    try {
      const [nsRaw, numRaw, directNamesRaw] = await Promise.all([
        runGit(repo.path, ['diff', '--name-status', '-M', '-z', `${baseRef}...${cleanTarget}`]),
        runGit(repo.path, ['diff', '--numstat', '-M', '-z', `${baseRef}...${cleanTarget}`]).catch(
          () => ''
        ),
        runGit(repo.path, ['diff', '--name-only', '-z', baseRef, cleanTarget]).catch(
          () => ''
        )
      ]);
      nameStatusRaw = nsRaw;
      numstatRaw = numRaw;
      directChangedPaths = new Set(
        directNamesRaw.split('\0').filter(Boolean).map(toPosixPath)
      );
    } catch {
      [nameStatusRaw, numstatRaw] = await Promise.all([
        runGit(repo.path, ['diff', '--name-status', '-M', '-z', baseRef, cleanTarget]).catch(
          () => ''
        ),
        runGit(repo.path, ['diff', '--numstat', '-M', '-z', baseRef, cleanTarget]).catch(
          () => ''
        )
      ]);
    }
  }

  const statMap = new Map<
    string,
    { additions: number | null; deletions: number | null }
  >();
  if (numstatRaw) {
    const tokens = numstatRaw.split('\0');
    let i = 0;
    while (i < tokens.length) {
      const line = tokens[i];
      i += 1;
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const addVal = parts[0] === '-' ? null : Number(parts[0]);
      const delVal = parts[1] === '-' ? null : Number(parts[1]);
      let filePath = parts[2];
      if (!filePath && i + 1 < tokens.length) {
        i += 1;
        filePath = tokens[i] ?? '';
        i += 1;
      }
      if (filePath) {
        statMap.set(toPosixPath(filePath), {
          additions: Number.isFinite(addVal as number) ? addVal : null,
          deletions: Number.isFinite(delVal as number) ? delVal : null
        });
      }
    }
  }

  const changedFiles: CommitFileChange[] = [];
  const tokens = nameStatusRaw.split('\0');
  let i = 0;
  while (i < tokens.length) {
    const statusTok = tokens[i];
    i += 1;
    if (!statusTok) continue;
    const code = statusTok[0];
    if (code === 'R' || code === 'C') {
      const oldP = toPosixPath(tokens[i] ?? '');
      const newP = toPosixPath(tokens[i + 1] ?? '');
      i += 2;
      if (newP) {
        const stats = statMap.get(newP) ?? { additions: null, deletions: null };
        const matchesBase = directChangedPaths
          ? !(directChangedPaths.has(newP) || (oldP ? directChangedPaths.has(oldP) : false))
          : false;
        changedFiles.push({
          path: newP,
          oldPath: oldP,
          status: mapStatusCode(code),
          ...stats,
          matchesBase
        });
      }
    } else {
      const filePath = toPosixPath(tokens[i] ?? '');
      i += 1;
      if (filePath) {
        const stats = statMap.get(filePath) ?? {
          additions: null,
          deletions: null
        };
        const matchesBase = directChangedPaths
          ? !directChangedPaths.has(filePath)
          : false;
        changedFiles.push({
          path: filePath,
          status: mapStatusCode(code),
          ...stats,
          matchesBase
        });
      }
    }
  }

  changedFiles.sort((a, b) => a.path.localeCompare(b.path));

  return {
    currentBranch: cleanBase || repo.branch,
    targetBranch: cleanTarget,
    commitsOnTarget,
    changedFiles
  };
}
