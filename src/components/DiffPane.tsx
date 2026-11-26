import React, { useEffect, useRef, useState } from 'react';
import { DiffEditor, Editor } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Columns2,
  FileCode2,
  GitCompare,
  Rows2
} from 'lucide-react';
import {
  CompareSource,
  DiffContentResult,
  FileContentResult,
  FileEntry,
  RepoRefs,
  RepoSummary
} from '../../shared/types';

export type WorkingDiffPreset =
  | 'head-working'
  | 'head-staged'
  | 'staged-working'
  | 'baseline-working';

export interface CompareSlot {
  repoPath: string;
  repoName: string;
  filePath: string;
  refMode: 'working' | 'staged' | 'HEAD' | 'custom';
  customRef: string;
}

export type ActiveViewerState =
  | {
      mode: 'working-diff';
      repo: RepoSummary;
      filePath: string;
      oldPath?: string;
      preset: WorkingDiffPreset;
    }
  | {
      mode: 'commit-diff';
      repoName: string;
      repoPath: string;
      sha: string;
      parentSha?: string;
      subject: string;
      filePath: string;
      oldPath?: string;
    }
  | {
      mode: 'file-view';
      repo: RepoSummary;
      filePath: string;
    }
  | {
      mode: 'custom-compare';
      left: CompareSlot;
      right: CompareSlot;
    };

interface DiffPaneProps {
  viewerState: ActiveViewerState | null;
  repos: RepoSummary[];
  baselineMap: Record<string, string>;
  resolvedTheme: 'light' | 'dark';
  editorFont?: string;
  editorFontSize?: number;
  onChangeViewerState: (next: ActiveViewerState) => void;
  onUpdateCompareSlots: (left: CompareSlot, right: CompareSlot) => void;
}

function slotToSource(slot: CompareSlot): CompareSource {
  if (slot.refMode === 'working') {
    return { kind: 'working', repoPath: slot.repoPath, filePath: slot.filePath };
  }
  if (slot.refMode === 'staged') {
    return { kind: 'staged', repoPath: slot.repoPath, filePath: slot.filePath };
  }
  const ref = slot.refMode === 'HEAD' ? 'HEAD' : slot.customRef || 'HEAD';
  return {
    kind: 'rev',
    repoPath: slot.repoPath,
    filePath: slot.filePath,
    ref
  };
}

export const DiffPane: React.FC<DiffPaneProps> = ({
  viewerState,
  repos,
  baselineMap,
  resolvedTheme,
  editorFont,
  editorFontSize,
  onChangeViewerState,
  onUpdateCompareSlots
}) => {
  const [sideBySide, setSideBySide] = useState(true);
  const [ignoreTrimWhitespace, setIgnoreTrimWhitespace] = useState(false);
  const [wordWrap, setWordWrap] = useState<'auto' | 'on' | 'off'>('auto');
  const [paneWidth, setPaneWidth] = useState(900);
  const [diffData, setDiffData] = useState<DiffContentResult | null>(null);
  const [fileData, setFileData] = useState<FileContentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refsByRepo, setRefsByRepo] = useState<Record<string, RepoRefs>>({});
  const [filesByRepo, setFilesByRepo] = useState<Record<string, FileEntry[]>>({});

  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPaneWidth(entry.contentRect.width);
      }
      diffEditorRef.current?.layout();
      editorRef.current?.layout();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load diff or file content whenever viewerState changes
  useEffect(() => {
    if (!viewerState) {
      setDiffData(null);
      setFileData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    if (viewerState.mode === 'file-view') {
      void window.gitViewer
        .readFile(viewerState.repo.path, viewerState.filePath)
        .then((res) => {
          if (!cancelled) {
            setFileData(res);
            setDiffData(null);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    let left: CompareSource;
    let right: CompareSource;

    if (viewerState.mode === 'working-diff') {
      const rp = viewerState.repo.path;
      const fp = viewerState.filePath;
      const oldFp = viewerState.oldPath ?? fp;
      const baselineSha = baselineMap[viewerState.repo.id];
      if (viewerState.preset === 'head-staged') {
        left = { kind: 'rev', repoPath: rp, filePath: oldFp, ref: 'HEAD' };
        right = { kind: 'staged', repoPath: rp, filePath: fp };
      } else if (viewerState.preset === 'staged-working') {
        left = { kind: 'staged', repoPath: rp, filePath: oldFp };
        right = { kind: 'working', repoPath: rp, filePath: fp };
      } else if (viewerState.preset === 'baseline-working' && baselineSha) {
        left = { kind: 'rev', repoPath: rp, filePath: oldFp, ref: baselineSha };
        right = { kind: 'working', repoPath: rp, filePath: fp };
      } else {
        left = { kind: 'rev', repoPath: rp, filePath: oldFp, ref: 'HEAD' };
        right = { kind: 'working', repoPath: rp, filePath: fp };
      }
    } else if (viewerState.mode === 'commit-diff') {
      left = viewerState.parentSha
        ? {
            kind: 'rev',
            repoPath: viewerState.repoPath,
            filePath: viewerState.oldPath ?? viewerState.filePath,
            ref: viewerState.parentSha
          }
        : { kind: 'empty', label: '(initial commit)' };
      right = {
        kind: 'rev',
        repoPath: viewerState.repoPath,
        filePath: viewerState.filePath,
        ref: viewerState.sha
      };
    } else {
      left = slotToSource(viewerState.left);
      right = slotToSource(viewerState.right);
    }

    void window.gitViewer
      .getDiff(left, right)
      .then((res) => {
        if (!cancelled) {
          setDiffData(res);
          setFileData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewerState, baselineMap]);

  // Fetch refs & file list when in custom-compare mode
  useEffect(() => {
    if (viewerState?.mode !== 'custom-compare') return;
    const needed = new Set([
      viewerState.left.repoPath,
      viewerState.right.repoPath
    ]);
    for (const rp of needed) {
      if (!rp) continue;
      if (!refsByRepo[rp]) {
        void window.gitViewer.getRepoRefs(rp).then((refs) => {
          setRefsByRepo((prev) => ({ ...prev, [rp]: refs }));
        });
      }
      if (!filesByRepo[rp]) {
        void window.gitViewer.listRepoFiles(rp).then((files) => {
          setFilesByRepo((prev) => ({ ...prev, [rp]: files }));
        });
      }
    }
  }, [viewerState]);

  const navigateDiff = (direction: 'next' | 'previous') => {
    const editor = diffEditorRef.current;
    if (!editor) return;
    editor.goToDiff(direction);
  };

  if (!viewerState) {
    return (
      <div className="editor-area">
        <div className="empty-state">
          <GitCompare size={36} style={{ color: 'var(--accent)', opacity: 0.7 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            Select a file or commit to inspect
          </div>
          <div style={{ maxWidth: 460, lineHeight: 1.5 }}>
            Use <strong>Changes</strong> to review uncommitted edits across all
            nested repositories, <strong>File Explorer</strong> to browse or
            pick files for A/B compare, or <strong>Commit Explorer</strong> to
            audit recent and unpushed commits.
          </div>
        </div>
      </div>
    );
  }

  const renderSlotControls = (
    label: string,
    slot: CompareSlot,
    onChange: (updated: CompareSlot) => void
  ) => {
    const refs = refsByRepo[slot.repoPath];
    const files = filesByRepo[slot.repoPath] ?? [];
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{label}:</span>
        <select
          className="compare-select"
          value={slot.repoPath}
          onChange={(e) => {
            const repo = repos.find((r) => r.path === e.target.value);
            if (!repo) return;
            onChange({
              ...slot,
              repoPath: repo.path,
              repoName: repo.name,
              filePath: filesByRepo[repo.path]?.[0]?.path ?? slot.filePath
            });
          }}
        >
          {repos.map((r) => (
            <option key={r.id} value={r.path}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          className="compare-select"
          value={slot.filePath}
          onChange={(e) => onChange({ ...slot, filePath: e.target.value })}
        >
          {!files.some((f) => f.path === slot.filePath) && slot.filePath && (
            <option value={slot.filePath}>{slot.filePath}</option>
          )}
          {files.slice(0, 800).map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>

        <select
          className="compare-select"
          value={
            slot.refMode === 'custom' ? `ref:${slot.customRef}` : slot.refMode
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'working' || val === 'staged' || val === 'HEAD') {
              onChange({ ...slot, refMode: val });
            } else if (val.startsWith('ref:')) {
              onChange({
                ...slot,
                refMode: 'custom',
                customRef: val.slice(4)
              });
            }
          }}
        >
          <option value="working">Working Tree</option>
          <option value="staged">Staged (Index)</option>
          <option value="HEAD">HEAD</option>
          {refs?.branches.map((b) => (
            <option key={`b:${b}`} value={`ref:${b}`}>
              branch: {b}
            </option>
          ))}
          {refs?.tags.map((t) => (
            <option key={`t:${t}`} value={`ref:${t}`}>
              tag: {t}
            </option>
          ))}
          {slot.refMode === 'custom' &&
            slot.customRef &&
            !refs?.branches.includes(slot.customRef) &&
            !refs?.tags.includes(slot.customRef) && (
              <option value={`ref:${slot.customRef}`}>
                commit: {slot.customRef.slice(0, 8)}
              </option>
            )}
        </select>
      </div>
    );
  };

  return (
    <div className="editor-area">
      <div className="diff-toolbar">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            flex: 1
          }}
        >
          <FileCode2 size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          {viewerState.mode === 'working-diff' && (
            <>
              <span className="tag-pill repo">{viewerState.repo.name}</span>
              <span
                style={{
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {viewerState.filePath}
              </span>
            </>
          )}
          {viewerState.mode === 'commit-diff' && (
            <>
              <span className="tag-pill repo">{viewerState.repoName}</span>
              <span className="sha-pill">{viewerState.sha.slice(0, 7)}</span>
              <span
                style={{
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {viewerState.filePath}
              </span>
            </>
          )}
          {viewerState.mode === 'file-view' && (
            <>
              <span className="tag-pill repo">{viewerState.repo.name}</span>
              <span style={{ fontWeight: 500 }}>{viewerState.filePath}</span>
            </>
          )}
          {viewerState.mode === 'custom-compare' && (
            <span style={{ fontWeight: 600 }}>Compare A ↔ B</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {viewerState.mode === 'working-diff' && (
            <div className="segmented">
              <button
                className={
                  viewerState.preset === 'head-working' ? 'active' : ''
                }
                onClick={() =>
                  onChangeViewerState({
                    ...viewerState,
                    preset: 'head-working'
                  })
                }
              >
                HEAD ↔ Work
              </button>
              <button
                className={viewerState.preset === 'head-staged' ? 'active' : ''}
                onClick={() =>
                  onChangeViewerState({
                    ...viewerState,
                    preset: 'head-staged'
                  })
                }
              >
                HEAD ↔ Staged
              </button>
              <button
                className={
                  viewerState.preset === 'staged-working' ? 'active' : ''
                }
                onClick={() =>
                  onChangeViewerState({
                    ...viewerState,
                    preset: 'staged-working'
                  })
                }
              >
                Staged ↔ Work
              </button>
              {baselineMap[viewerState.repo.id] && (
                <button
                  className={
                    viewerState.preset === 'baseline-working' ? 'active' : ''
                  }
                  onClick={() =>
                    onChangeViewerState({
                      ...viewerState,
                      preset: 'baseline-working'
                    })
                  }
                >
                  Baseline ↔ Work
                </button>
              )}
            </div>
          )}

          {viewerState.mode === 'file-view' && (
            <button
              className="btn"
              onClick={() =>
                onChangeViewerState({
                  mode: 'working-diff',
                  repo: viewerState.repo,
                  filePath: viewerState.filePath,
                  preset: 'head-working'
                })
              }
            >
              <GitCompare size={13} /> Diff vs HEAD
            </button>
          )}

          {viewerState.mode !== 'file-view' && (
            <>
              <button
                className="icon-btn"
                title="Previous Diff Hunk"
                onClick={() => navigateDiff('previous')}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="icon-btn"
                title="Next Diff Hunk"
                onClick={() => navigateDiff('next')}
              >
                <ArrowDown size={14} />
              </button>
              <button
                className={`icon-btn ${sideBySide ? 'active' : ''}`}
                title={
                  sideBySide
                    ? paneWidth < 720
                      ? 'Side-by-Side (auto-inline below 720px)'
                      : 'Side-by-Side Diff'
                    : 'Inline Diff'
                }
                onClick={() => setSideBySide((v) => !v)}
              >
                {sideBySide && paneWidth >= 720 ? (
                  <Columns2 size={14} />
                ) : (
                  <Rows2 size={14} />
                )}
              </button>
              <button
                className={`btn ${
                  wordWrap === 'on' || (wordWrap === 'auto' && paneWidth < 680)
                    ? 'btn-primary'
                    : ''
                }`}
                style={{ padding: '2px 7px', fontSize: 11 }}
                onClick={() =>
                  setWordWrap((prev) =>
                    prev === 'auto' ? 'on' : prev === 'on' ? 'off' : 'auto'
                  )
                }
                title={`Word Wrap: ${wordWrap} (auto wraps below 680px)`}
              >
                Wrap{wordWrap === 'auto' ? ' (Auto)' : ''}
              </button>
              <button
                className={`btn ${ignoreTrimWhitespace ? 'btn-primary' : ''}`}
                style={{ padding: '2px 7px', fontSize: 11 }}
                onClick={() => setIgnoreTrimWhitespace((v) => !v)}
                title="Toggle ignoring leading/trailing whitespace"
              >
                Trim WS
              </button>
            </>
          )}
        </div>
      </div>

      {viewerState.mode === 'custom-compare' && (
        <div className="compare-bar">
          {renderSlotControls('A (Left)', viewerState.left, (nextLeft) =>
            onUpdateCompareSlots(nextLeft, viewerState.right)
          )}
          <button
            className="icon-btn"
            title="Swap Left and Right"
            onClick={() =>
              onUpdateCompareSlots(viewerState.right, viewerState.left)
            }
          >
            <ArrowLeftRight size={14} />
          </button>
          {renderSlotControls('B (Right)', viewerState.right, (nextRight) =>
            onUpdateCompareSlots(viewerState.left, nextRight)
          )}
        </div>
      )}

      {diffData && viewerState.mode !== 'file-view' && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: '2px 12px',
            padding: '3px 12px',
            background: 'var(--bg-subbar)',
            borderBottom: '1px solid var(--border)',
            fontSize: 11,
            color: 'var(--text-secondary)'
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
            Original: {diffData.leftLabel}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
            Modified: {diffData.rightLabel}
          </span>
        </div>
      )}

      <div className="editor-container" ref={containerRef}>
        {loading ? (
          <div className="empty-state">Loading content...</div>
        ) : viewerState.mode === 'file-view' && fileData ? (
          fileData.isBinary ? (
            <div className="empty-state">{fileData.content}</div>
          ) : (
            <Editor
              height="100%"
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
              language={fileData.language}
              value={fileData.content}
              onMount={(editor) => {
                editorRef.current = editor;
              }}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                wordWrap:
                  wordWrap === 'on' || (wordWrap === 'auto' && paneWidth < 680)
                    ? 'on'
                    : 'off',
                fontFamily: editorFont,
                fontSize: editorFontSize ?? 13,
                scrollBeyondLastLine: false,
                automaticLayout: true
              }}
            />
          )
        ) : diffData ? (
          diffData.isBinary ? (
            <div className="empty-state">
              Binary or oversized file cannot be diffed in text view.
            </div>
          ) : (
            <DiffEditor
              height="100%"
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
              language={diffData.language}
              original={diffData.leftContent}
              modified={diffData.rightContent}
              onMount={(editor) => {
                diffEditorRef.current = editor;
              }}
              options={{
                readOnly: true,
                renderSideBySide: sideBySide,
                useInlineViewWhenSpaceIsLimited: true,
                renderSideBySideInlineBreakpoint: 720,
                compactMode: paneWidth > 0 && paneWidth < 680,
                wordWrap:
                  wordWrap === 'on' || (wordWrap === 'auto' && paneWidth < 680)
                    ? 'on'
                    : 'off',
                ignoreTrimWhitespace,
                minimap: { enabled: false },
                fontFamily: editorFont,
                fontSize: editorFontSize ?? 13,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                renderOverviewRuler: true
              }}
            />
          )
        ) : null}
      </div>
    </div>
  );
};
