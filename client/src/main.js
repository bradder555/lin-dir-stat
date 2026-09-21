import * as d3 from 'd3';

const svg = d3.select('#chart');
const treeContent = document.getElementById('tree-content');
const cleanupContent = document.getElementById('cleanup-content');
const freeSpaceCheckbox = document.getElementById('free-space-checkbox');
const refreshBtn = document.getElementById('refresh-btn');
const spinnerEl = document.getElementById('spinner');
const errorEl = document.getElementById('error');
const contextMenuEl = document.getElementById('context-menu');
const confirmModalEl = document.getElementById('confirm-modal');
const confirmModalBody = document.getElementById('confirm-modal-body');
const confirmCancelBtn = document.getElementById('confirm-cancel');
const confirmDeleteBtn = document.getElementById('confirm-delete');

const HEADER_H = 18;
const topColor = d3.scaleOrdinal(d3.schemeSet3);
const FILE_COLOR = '#dbe0e6';
const OTHER_COLOR = '#c7cad0';
const ROOT_COLOR = '#eef0f3';
const FREE_COLOR = '#eef2f7';

let rootNode = null;

const prefetchQueue = [];
let prefetchRunning = false;

function enqueuePrefetch(nodes) {
  if (!nodes) return;
  for (const n of nodes) {
    if (n.isDirectory && n.path !== null && !n._cache && !n._pending && !prefetchQueue.includes(n)) {
      prefetchQueue.push(n);
    }
  }
  runPrefetchWorker();
}

async function runPrefetchWorker() {
  if (prefetchRunning) return;
  prefetchRunning = true;
  while (prefetchQueue.length > 0) {
    const node = prefetchQueue.shift();
    try {
      await fetchChildren(node);
    } catch {
      // background prefetch failures are silent; a manual expand will surface the real error
    }
  }
  prefetchRunning = false;
}

// Fetches (and caches) a node's children, de-duped so a foreground double-click
// and a background prefetch for the same path share one in-flight request.
function fetchChildren(node) {
  if (node._pending) return node._pending;
  node._pending = fetchJSON(`/api/storage${node.path}`)
    .then((json) => {
      const children = json.children.map(makeNode);
      children.forEach((c) => (c._parent = node));
      node._cache = children;
      return children;
    })
    .finally(() => {
      node._pending = null;
    });
  return node._pending;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function showSpinner() {
  spinnerEl.classList.remove('hidden');
}
function hideSpinner() {
  spinnerEl.classList.add('hidden');
}
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
  setTimeout(() => errorEl.classList.add('hidden'), 4000);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed: ${url}`);
  return json;
}

function makeNode(raw) {
  return { ...raw, children: undefined, _cache: null, _pending: null };
}

function hideContextMenu() {
  contextMenuEl.classList.add('hidden');
  contextMenuEl.innerHTML = '';
}

function showContextMenu(x, y, items) {
  contextMenuEl.innerHTML = '';
  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      contextMenuEl.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = `ctx-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`;
    el.textContent = item.label;
    if (!item.disabled) {
      el.addEventListener('click', () => {
        hideContextMenu();
        item.onSelect();
      });
    }
    contextMenuEl.appendChild(el);
  });
  contextMenuEl.classList.remove('hidden');
  // clamp so the menu never renders off the right/bottom edge of the window
  const rect = contextMenuEl.getBoundingClientRect();
  contextMenuEl.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  contextMenuEl.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
}

async function openInFileBrowser(node) {
  try {
    const res = await fetch('/api/open-in-file-browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: node.path }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to open file browser');
  } catch (err) {
    showError(err.message);
  }
}

function removeNodeFromParent(node) {
  const parent = node._parent;
  if (!parent || !parent.children) return;
  const idx = parent.children.indexOf(node);
  if (idx !== -1) parent.children.splice(idx, 1);
}

function requestDelete(node) {
  confirmModalBody.textContent = `This will permanently delete:\n${node.path}\n\n(${formatBytes(node.size)})`;
  confirmModalEl.classList.remove('hidden');

  confirmDeleteBtn.onclick = async () => {
    confirmModalEl.classList.add('hidden');
    try {
      const res = await fetch('/api/delete-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: node.path }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      removeNodeFromParent(node);
      renderAll();
    } catch (err) {
      showError(err.message);
    }
  };
  confirmCancelBtn.onclick = () => confirmModalEl.classList.add('hidden');
}

function showContextMenuForNode(event, node) {
  event.preventDefault();
  if (!node.path || node.path === 'ROOT') return;

  const canDelete = !node.isDevice && !node.isFreeSpace;
  showContextMenu(event.clientX, event.clientY, [
    { label: 'Open in file browser', onSelect: () => openInFileBrowser(node) },
    { separator: true },
    {
      label: 'Delete…',
      danger: true,
      disabled: !canDelete,
      onSelect: () => requestDelete(node),
    },
  ]);
}

document.addEventListener('click', hideContextMenu);
window.addEventListener('blur', hideContextMenu);
window.addEventListener('resize', hideContextMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

async function toggleNode(node) {
  if (!node.isDirectory) return;

  if (node.children) {
    // already expanded: collapse back to a single box
    node._cache = node.children;
    node.children = undefined;
    renderAll();
    return;
  }

  if (node._cache) {
    // previously fetched (or eagerly prefetched): re-expand instantly, no request needed
    node.children = node._cache;
    enqueuePrefetch(node.children);
    renderAll();
    return;
  }

  showSpinner();
  try {
    node.children = await fetchChildren(node);
    enqueuePrefetch(node.children);
  } catch (err) {
    showError(err.message);
  } finally {
    hideSpinner();
    renderAll();
  }
}

async function init() {
  showSpinner();
  try {
    const json = await fetchJSON('/api/root_info');
    const devices = json.devices.map((d) =>
      makeNode({
        name: d.path,
        path: d.path,
        size: d.size,
        used: d.used,
        free: d.free,
        isDirectory: true,
        isDevice: true,
      })
    );
    rootNode = makeNode({ name: 'All Storage', path: 'ROOT', size: json.totalCapacity, isDirectory: true });
    devices.forEach((d) => (d._parent = rootNode));
    rootNode._cache = devices;
    enqueuePrefetch(devices);
  } catch (err) {
    showError(err.message);
    rootNode = makeNode({ name: 'All Storage', path: 'ROOT', size: 0, isDirectory: false });
  } finally {
    hideSpinner();
    renderAll();
  }
}

function renderAll() {
  renderTreePanel();
  renderTreemap();
}

let cleanupActions = [];

async function loadCleanupActions() {
  try {
    const json = await fetchJSON('/api/cleanup/actions');
    cleanupActions = json.actions;
  } catch {
    cleanupActions = [];
  }
  renderCleanupPanel();
}

function renderCleanupPanel() {
  cleanupContent.innerHTML = '';

  cleanupActions.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'cleanup-row';

    const top = document.createElement('div');
    top.className = 'cleanup-top';
    const name = document.createElement('span');
    name.textContent = a.label;
    const size = document.createElement('span');
    size.className = 'cleanup-size';
    size.textContent = formatBytes(a.size);
    top.append(name, size);

    const desc = document.createElement('div');
    desc.className = 'cleanup-desc';
    desc.textContent = a.description;

    const actionRow = document.createElement('div');
    actionRow.className = 'cleanup-action-row';
    const status = document.createElement('span');
    status.className = 'cleanup-status';

    if (a.manual) {
      const code = document.createElement('code');
      code.className = 'cleanup-command';
      code.textContent = a.command;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'cleanup-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(a.command);
        status.textContent = 'Copied — run it in a terminal';
      });
      actionRow.append(code, copyBtn, status);
    } else {
      const runBtn = document.createElement('button');
      runBtn.className = 'cleanup-btn';
      runBtn.textContent = 'Run';
      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        status.textContent = 'Running…';
        try {
          const res = await fetch(`/api/cleanup/actions/${a.id}/run`, { method: 'POST' });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed');
          status.textContent = `Done — freed ~${formatBytes(a.size)}`;
          setTimeout(loadCleanupActions, 1500);
        } catch (err) {
          status.textContent = `Error: ${err.message}`;
        } finally {
          runBtn.disabled = false;
        }
      });
      actionRow.append(runBtn, status);
    }

    row.append(top, desc, actionRow);
    cleanupContent.appendChild(row);
  });
}

function renderTreeRow(node, ul) {
  const li = document.createElement('li');
  const row = document.createElement('div');
  row.className = 'tree-row';
  const hasChildren = !!node.children;

  const marker = document.createElement('span');
  marker.className = 'marker';
  marker.textContent = node.isDirectory ? (hasChildren ? '▾' : '▸') : ' ';
  row.appendChild(marker);

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.name;
  row.appendChild(label);

  const size = document.createElement('span');
  size.className = 'size';
  size.textContent = formatBytes(node.size);
  row.appendChild(size);

  if (node.isDirectory) {
    row.classList.add('expandable');
    row.addEventListener('click', () => toggleNode(node));
  }
  row.addEventListener('contextmenu', (e) => showContextMenuForNode(e, node));

  li.appendChild(row);

  if (hasChildren) {
    const childUl = document.createElement('ul');
    [...node.children]
      .sort((a, b) => b.size - a.size)
      .forEach((c) => renderTreeRow(c, childUl));
    li.appendChild(childUl);
  }

  ul.appendChild(li);
}

function renderTreePanel() {
  treeContent.innerHTML = '';
  if (!rootNode) return;
  const rootUl = document.createElement('ul');
  rootUl.className = 'tree-root';
  renderTreeRow(rootNode, rootUl);
  treeContent.appendChild(rootUl);
}

function topAncestor(d) {
  let n = d;
  while (n.depth > 1) n = n.parent;
  return n;
}

function nodeColor(d) {
  if (d.depth === 0) return ROOT_COLOR;
  if (d.data.isFreeSpace) return FREE_COLOR;
  if (d.data.path === null) return OTHER_COLOR;
  if (!d.data.isDirectory) return FILE_COLOR;
  const anc = topAncestor(d);
  const base = d3.color(topColor(anc.data.name));
  const lighten = Math.min((d.depth - 1) * 0.12, 0.55);
  return d3.interpolateRgb(base, '#ffffff')(lighten);
}

// Free/used is only meaningful at the device level (from df), so the synthetic
// "Free space" leaf is injected only when expanding a device box, never persisted
// on the real node (the tree panel never sees it).
function childrenWithFreeSpace(d) {
  if (!d.children) return undefined;
  if (freeSpaceCheckbox.checked && d.isDevice && d.free > 0) {
    return [...d.children, { name: 'Free space', path: null, size: d.free, isDirectory: false, isFreeSpace: true }];
  }
  return d.children;
}

function renderTreemap() {
  if (!rootNode) return;
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  svg.selectAll('*').remove();

  const hierarchyRoot = d3
    .hierarchy(rootNode, childrenWithFreeSpace)
    .sum((d) => (d.children && d.children.length ? 0 : d.size || 0))
    .sort((a, b) => b.value - a.value);

  d3
    .treemap()
    .tile(d3.treemapSquarify)
    .size([width, height])
    .paddingTop((d) => (d.children && d.children.length ? HEADER_H : 0))
    .paddingInner(2)
    .round(true)(hierarchyRoot);

  const nodes = hierarchyRoot.descendants();

  const groups = svg
    .selectAll('g.box')
    .data(nodes)
    .join('g')
    .attr('class', 'box')
    .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

  groups
    .append('rect')
    .attr('class', (d) => `base${d.data.isFreeSpace ? ' free-space' : ''}`)
    .attr('width', (d) => Math.max(0, d.x1 - d.x0))
    .attr('height', (d) => Math.max(0, d.y1 - d.y0))
    .attr('rx', 3)
    .attr('fill', (d) => nodeColor(d))
    .on('dblclick', (event, d) => toggleNode(d.data))
    .on('contextmenu', (event, d) => showContextMenuForNode(event, d.data));

  groups
    .filter((d) => d.children && d.children.length)
    .append('rect')
    .attr('class', 'header-bg')
    .attr('width', (d) => Math.max(0, d.x1 - d.x0))
    .attr('height', (d) => Math.min(HEADER_H, d.y1 - d.y0))
    .attr('fill', '#1c1f24')
    .attr('fill-opacity', 0.8);

  groups.append('title').text((d) => {
    if (d.data.isDevice) {
      return `${d.data.name}\n${formatBytes(d.data.used)} used / ${formatBytes(d.data.size)} total`;
    }
    return `${d.data.name}\n${formatBytes(d.data.size)}${
      d.data.isDirectory && !d.data.children ? ' (double-click to expand)' : ''
    }${d.data.children ? ' (double-click to collapse)' : ''}`;
  });

  groups.each(function (d) {
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    const g = d3.select(this);
    const expanded = d.children && d.children.length;
    const expandable = d.data.isDirectory && !expanded && d.data.path !== null;

    if (expanded) {
      if (w < 30 || h < HEADER_H) return;
      const maxChars = Math.floor(w / 6);
      let label = `${d.data.name} — ${formatBytes(d.value)}`;
      if (label.length > maxChars) label = label.slice(0, Math.max(0, maxChars - 1)) + '…';
      g.append('text').attr('class', 'header').attr('x', 5).attr('y', 13).text(label);
    } else {
      if (w < 34 || h < 16) return;
      const maxChars = Math.floor(w / 6.2);
      let name = expandable ? `${d.data.name} ⋯` : d.data.name;
      if (name.length > maxChars) name = name.slice(0, Math.max(0, maxChars - 1)) + '…';
      g.append('text').attr('x', 5).attr('y', 14).text(name);
      if (h > 32) {
        const subLabel = d.data.isDevice
          ? `${formatBytes(d.data.used)} / ${formatBytes(d.data.size)}`
          : formatBytes(d.value);
        g.append('text').attr('class', 'sub').attr('x', 5).attr('y', 27).text(subLabel);
      }
    }
  });
}

window.addEventListener('resize', () => renderTreemap());
freeSpaceCheckbox.addEventListener('change', () => renderTreemap());
refreshBtn.addEventListener('click', () => {
  rootNode = null;
  prefetchQueue.length = 0;
  init();
  loadCleanupActions();
});

init();
loadCleanupActions();
