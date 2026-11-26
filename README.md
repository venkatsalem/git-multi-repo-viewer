# Git Multi-Repo Viewer

Lightweight IntelliJ-style multi-repository Git review, file explorer, commit explorer, and Monaco diff viewer built with **Electron + React + TypeScript + Monaco Editor**.

## Features

- **Nested Git Repo Discovery:** Scans a root workspace folder for all nested `.git` repositories and watches for live changes.
- **Changes / Commit Explorer (Tree & List Views):** Groups uncommitted changes by repository with staged/unstaged/untracked badges, checkboxes, stage/unstage, discard, and multi-repo commit support.
- **File Explorer (Tree & List Views):** Browse files across every discovered repository, view files in Monaco, diff against `HEAD`, or pick any file as **Compare A** or **Compare B**.
- **Commit Explorer (Tree & List Views):** Inspect commits across all repos (filter by **All**, **Unpushed**, or **Since Baseline**), view changed files in a commit, and click any file to diff against its parent.
- **Built-in Monaco Diff & Compare A ↔ B:** Side-by-side or inline diffs, hunk navigation, whitespace trim toggle, and arbitrary comparison between working tree, staged index, `HEAD`, branches, tags, or commits.
- **Harness Baseline Tracking:** Click **Set Baseline** to snapshot current `HEAD` SHAs across all repos before running an AI coding harness, then review everything modified or committed afterward.
- **Repo Ordering & Quick Actions:** Drag-and-drop repository headers to customize per-workspace order, and right-click files or repositories for **Show in Explorer**, **Open Terminal**, and **Open Repo in New Window**.
- **Theme & Font Customization:** Open **Settings** (gear icon at bottom-left) to switch System / Light / Dark themes and configure UI and Monaco diff fonts & sizes (bundled with Google Sans and JetBrains Mono).

## Run

```bash
npm install
npm start
```

For hot-reload development:

```bash
npm run dev
```

To package a standalone Windows executable and create Desktop / Start Menu shortcuts:

```bash
npm run package
npm run shortcut
```

## License

MIT — see [LICENSE](LICENSE).
