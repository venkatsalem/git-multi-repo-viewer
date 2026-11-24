import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen
} from 'lucide-react';
import {
  buildCompactTree,
  collectAllDirIds,
  GenericTreeNode
} from '../utils/treeBuilder';

export type ViewMode = 'tree' | 'list';

export function getTreeDirKeys<T>(
  items: T[],
  getPath: (item: T) => string,
  dirKeyPrefix: string
): string[] {
  const tree = buildCompactTree(items, getPath, true);
  return collectAllDirIds(tree).map((id) => `${dirKeyPrefix}:${id}`);
}

interface TreeOrListRendererProps<T> {
  items: T[];
  viewMode: ViewMode;
  getKey: (item: T) => string;
  getPath: (item: T) => string;
  selectedKey: string | null;
  expandedDirs: Set<string>;
  onToggleDir: (dirKey: string) => void;
  dirKeyPrefix: string;
  onSelect: (item: T) => void;
  onItemContextMenu?: (e: React.MouseEvent, item: T) => void;
  renderPrefix?: (item: T) => React.ReactNode;
  renderSuffix?: (item: T) => React.ReactNode;
  renderActions?: (item: T) => React.ReactNode;
}

export function TreeOrListRenderer<T>({
  items,
  viewMode,
  getKey,
  getPath,
  selectedKey,
  expandedDirs,
  onToggleDir,
  dirKeyPrefix,
  onSelect,
  onItemContextMenu,
  renderPrefix,
  renderSuffix,
  renderActions
}: TreeOrListRendererProps<T>): React.ReactElement {
  if (viewMode === 'list') {
    return (
      <div>
        {items.map((item) => {
          const fullPath = getPath(item);
          const slashIdx = fullPath.lastIndexOf('/');
          const fileName = slashIdx >= 0 ? fullPath.slice(slashIdx + 1) : fullPath;
          const dirPart = slashIdx >= 0 ? fullPath.slice(0, slashIdx) : '';
          const key = getKey(item);
          return (
            <div
              key={key}
              className={`tree-row ${selectedKey === key ? 'selected' : ''}`}
              style={{ paddingLeft: 28 }}
              onClick={() => onSelect(item)}
              onContextMenu={(e) => onItemContextMenu?.(e, item)}
              title={fullPath}
            >
              {renderPrefix?.(item)}
              <FileCode2
                size={14}
                style={{ flexShrink: 0, color: 'var(--text-secondary)' }}
              />
              <span className="tree-label">
                {fileName}
                {dirPart && <span className="tree-subpath">{dirPart}</span>}
              </span>
              {renderSuffix?.(item)}
              {renderActions && (
                <div
                  className="row-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {renderActions(item)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const tree = buildCompactTree(items, getPath, true);

  function renderNode(node: GenericTreeNode<T>, depth: number): React.ReactNode {
    const indent = 12 + depth * 14;
    if (node.kind === 'dir') {
      const fullDirKey = `${dirKeyPrefix}:${node.id}`;
      const isExpanded = expandedDirs.has(fullDirKey);
      return (
        <div key={fullDirKey}>
          <div
            className="tree-row"
            style={{ paddingLeft: indent }}
            onClick={() => onToggleDir(fullDirKey)}
            title={node.path}
          >
            {isExpanded ? (
              <ChevronDown
                size={13}
                style={{ flexShrink: 0, color: 'var(--text-secondary)' }}
              />
            ) : (
              <ChevronRight
                size={13}
                style={{ flexShrink: 0, color: 'var(--text-secondary)' }}
              />
            )}
            {isExpanded ? (
              <FolderOpen
                size={14}
                style={{ flexShrink: 0, color: 'var(--folder-color)' }}
              />
            ) : (
              <Folder
                size={14}
                style={{ flexShrink: 0, color: 'var(--folder-color)' }}
              />
            )}
            <span className="tree-label" style={{ color: 'var(--text-primary)' }}>
              {node.name}
            </span>
          </div>
          {isExpanded &&
            node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const item = node.item!;
    const key = getKey(item);
    return (
      <div
        key={key}
        className={`tree-row ${selectedKey === key ? 'selected' : ''}`}
        style={{ paddingLeft: indent + 16 }}
        onClick={() => onSelect(item)}
        onContextMenu={(e) => onItemContextMenu?.(e, item)}
        title={node.path}
      >
        {renderPrefix?.(item)}
        <FileCode2
          size={14}
          style={{ flexShrink: 0, color: 'var(--text-secondary)' }}
        />
        <span className="tree-label">{node.name}</span>
        {renderSuffix?.(item)}
        {renderActions && (
          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            {renderActions(item)}
          </div>
        )}
      </div>
    );
  }

  return <div>{tree.map((n) => renderNode(n, 0))}</div>;
}
