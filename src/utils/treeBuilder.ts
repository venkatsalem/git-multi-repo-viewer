export interface GenericTreeNode<T> {
  id: string;
  name: string;
  path: string;
  kind: 'dir' | 'file';
  children: GenericTreeNode<T>[];
  item?: T;
}

/**
 * Builds a directory tree from flat posix-path items, compacting single-child
 * directory chains (e.g. `src/components/ui`) just like IntelliJ's Commit/Project tree.
 */
export function buildCompactTree<T>(
  items: T[],
  getPath: (item: T) => string,
  compactSingleDirs = true
): GenericTreeNode<T>[] {
  interface MutableDir {
    name: string;
    path: string;
    dirs: Map<string, MutableDir>;
    files: { name: string; path: string; item: T }[];
  }

  const root: MutableDir = {
    name: '',
    path: '',
    dirs: new Map(),
    files: []
  };

  for (const item of items) {
    const fullPath = getPath(item).replace(/\\/g, '/');
    const parts = fullPath.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = current.dirs.get(seg);
      if (!next) {
        next = {
          name: seg,
          path: current.path ? `${current.path}/${seg}` : seg,
          dirs: new Map(),
          files: []
        };
        current.dirs.set(seg, next);
      }
      current = next;
    }

    const fileName = parts[parts.length - 1];
    current.files.push({ name: fileName, path: fullPath, item });
  }

  function convert(dir: MutableDir): GenericTreeNode<T>[] {
    const dirNodes: GenericTreeNode<T>[] = [];

    const sortedDirs = Array.from(dir.dirs.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (let sub of sortedDirs) {
      let displayName = sub.name;
      while (
        compactSingleDirs &&
        sub.dirs.size === 1 &&
        sub.files.length === 0
      ) {
        const onlyChild = Array.from(sub.dirs.values())[0];
        displayName = `${displayName}/${onlyChild.name}`;
        sub = onlyChild;
      }

      dirNodes.push({
        id: `dir:${sub.path}`,
        name: displayName,
        path: sub.path,
        kind: 'dir',
        children: convert(sub)
      });
    }

    const sortedFiles = [...dir.files].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const fileNodes: GenericTreeNode<T>[] = sortedFiles.map((f) => ({
      id: `file:${f.path}`,
      name: f.name,
      path: f.path,
      kind: 'file',
      children: [],
      item: f.item
    }));

    return [...dirNodes, ...fileNodes];
  }

  return convert(root);
}

export function collectAllDirIds<T>(nodes: GenericTreeNode<T>[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    if (n.kind === 'dir') {
      ids.push(n.id);
      ids.push(...collectAllDirIds(n.children));
    }
  }
  return ids;
}
