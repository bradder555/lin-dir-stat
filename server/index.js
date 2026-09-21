import express from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const MAX_CHILDREN = 150;
const CLIENT_DIST = path.join(__dirname, '../client/dist');
const HOME = os.homedir();

const IGNORED_FSTYPES = [
  'tmpfs', 'devtmpfs', 'squashfs', 'overlay', 'proc', 'sysfs',
  'cgroup', 'cgroup2', 'devpts', 'tracefs', 'debugfs', 'mqueue',
  'hugetlbfs', 'fuse.portal', 'autofs', 'binfmt_misc',
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 20, timeout: 60_000, ...opts }, (error, stdout) => {
      // du/df can exit non-zero on permission errors but still produce useful partial output
      if (stdout && stdout.trim().length > 0) resolve(stdout);
      else reject(error || new Error(`${cmd} produced no output`));
    });
  });
}

// For commands whose success is exit-code-only (no stdout to speak of), unlike
// run() above which requires stdout content (needed for du/df's partial-failure tolerance).
function runOk(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// Refuses to delete '/' or anything directly under it (/home, /usr, /etc, ...) as a
// backstop against a catastrophic misclick; everything at least one level deeper is fair game.
function isDangerousDeleteTarget(p) {
  const segments = path.posix.normalize(p).split('/').filter(Boolean);
  return segments.length < 2;
}

function clearDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

async function pathSize(p) {
  try {
    const stdout = await run('du', ['-sb', p]);
    return Number(stdout.split('\t')[0]) || 0;
  } catch {
    return 0;
  }
}

// Checked once at startup, not per-request: which package manager (if any) is
// actually installed doesn't change while the server is running.
function commandExists(cmd) {
  return (process.env.PATH || '').split(path.delimiter).some((dir) => {
    try {
      return fs.existsSync(path.join(dir, cmd));
    } catch {
      return false;
    }
  });
}

// Native package manager cache-cleaning commands, one entry per distro family.
// All require root, so — like journal vacuuming below — these are display-only:
// the server never invokes sudo itself, it just shows the command to run manually.
const PACKAGE_MANAGERS = [
  {
    id: 'pacman-cache',
    label: 'Pacman package cache',
    description: 'Removes cached package files for versions no longer installed.',
    binary: 'pacman',
    sizePaths: ['/var/cache/pacman/pkg'],
    command: 'sudo pacman -Sc --noconfirm',
  },
  {
    id: 'apt-cache',
    label: 'APT package cache',
    description: 'Removes downloaded .deb files from the local package cache.',
    binary: 'apt-get',
    sizePaths: ['/var/cache/apt/archives'],
    command: 'sudo apt-get clean',
  },
  {
    id: 'dnf-cache',
    label: 'DNF package cache',
    description: 'Removes cached package data and metadata.',
    binary: 'dnf',
    sizePaths: ['/var/cache/dnf'],
    command: 'sudo dnf clean all',
  },
  {
    id: 'zypper-cache',
    label: 'Zypper package cache',
    description: 'Removes cached package files.',
    binary: 'zypper',
    sizePaths: ['/var/cache/zypp/packages'],
    command: 'sudo zypper clean --all',
  },
  {
    id: 'apk-cache',
    label: 'APK package cache',
    description: 'Removes cached package files.',
    binary: 'apk',
    sizePaths: ['/var/cache/apk'],
    command: 'sudo apk cache clean',
  },
];

const packageManagerActions = PACKAGE_MANAGERS.filter((pm) => commandExists(pm.binary)).map((pm) => ({
  id: pm.id,
  label: pm.label,
  description: pm.description,
  sizePaths: pm.sizePaths,
  manual: true,
  command: pm.command,
}));

const journalAction = commandExists('journalctl')
  ? [
      {
        id: 'journal',
        label: 'Systemd journal logs',
        description: 'Vacuums journal logs older than 2 weeks.',
        sizePaths: ['/var/log/journal'],
        manual: true,
        command: 'sudo journalctl --vacuum-time=2weeks',
      },
    ]
  : [];

const npmCacheAction = commandExists('npm')
  ? [
      {
        id: 'npm-cache',
        label: 'npm cache',
        description: "Clears the current user's npm package cache.",
        sizePaths: [path.join(HOME, '.npm', '_cacache')],
        manual: false,
        run: () => runOk('npm', ['cache', 'clean', '--force']),
      },
    ]
  : [];

const CLEANUP_ACTIONS = [
  ...packageManagerActions,
  ...journalAction,
  ...npmCacheAction,
  {
    id: 'trash',
    label: 'Trash',
    description: 'Empties the Trash for the current user.',
    sizePaths: [path.join(HOME, '.local/share/Trash/files'), path.join(HOME, '.local/share/Trash/info')],
    manual: false,
    run: async () => {
      for (const p of ['/.local/share/Trash/files', '/.local/share/Trash/info']) {
        clearDir(path.join(HOME, p));
      }
    },
  },
  {
    id: 'thumbnails',
    label: 'Thumbnail cache',
    description: 'Clears cached image/video thumbnails (regenerated automatically as needed).',
    sizePaths: [path.join(HOME, '.cache/thumbnails')],
    manual: false,
    run: async () => clearDir(path.join(HOME, '.cache/thumbnails')),
  },
];

const app = express();

// Serves the production client build (created via `npm run build --prefix client`).
// A no-op during `npm run dev`, where Vite serves the client itself on its own port.
app.use(express.static(CLIENT_DIST));
app.use(express.json());

app.get('/api/root_info', async (req, res) => {
  try {
    const excludeArgs = IGNORED_FSTYPES.flatMap((fstype) => ['-x', fstype]);
    const stdout = await run('df', ['-B1', '--output=source,target,fstype,size,used,avail', ...excludeArgs]);
    const lines = stdout.trim().split('\n').slice(1); // drop header
    const devices = lines
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) return null;
        const [source, mount, fstype, size, used, avail] = parts;
        return {
          name: mount,
          path: mount,
          source,
          fstype,
          size: Number(size),
          used: Number(used),
          free: Number(avail),
        };
      })
      .filter((d) => d && d.size > 0);

    const totalCapacity = devices.reduce((sum, d) => sum + d.size, 0);
    res.json({ devices, totalCapacity });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/storage/*', async (req, res) => {
  const rawPath = '/' + (req.params[0] || '');
  const reqPath = rawPath === '/' ? '/' : path.posix.normalize(rawPath).replace(/\/+$/, '');

  let stat;
  try {
    stat = fs.statSync(reqPath);
  } catch {
    return res.status(404).json({ error: `Path not found: ${reqPath}` });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `Not a directory: ${reqPath}` });
  }

  try {
    const stdout = await run('du', ['-x', '-a', '-d1', '-B1', reqPath]);
    const rows = stdout
      .trim()
      .split('\n')
      .map((line) => {
        const tabIdx = line.indexOf('\t');
        const size = Number(line.slice(0, tabIdx));
        const entryPath = line.slice(tabIdx + 1);
        return { size, entryPath };
      });

    const totalRow = rows.find((r) => r.entryPath === reqPath);
    const childRows = rows.filter((r) => r.entryPath !== reqPath);
    const total = totalRow ? totalRow.size : childRows.reduce((s, r) => s + r.size, 0);

    childRows.sort((a, b) => b.size - a.size);
    const kept = childRows.slice(0, MAX_CHILDREN);
    const rest = childRows.slice(MAX_CHILDREN);

    const children = kept.map((r) => {
      let isDirectory = false;
      try {
        isDirectory = fs.statSync(r.entryPath).isDirectory();
      } catch {
        // inaccessible or gone since du ran; treat as file (non-expandable)
      }
      return {
        name: path.posix.basename(r.entryPath),
        path: r.entryPath,
        size: r.size,
        isDirectory,
      };
    });

    if (rest.length > 0) {
      children.push({
        name: `(${rest.length} more items)`,
        path: null,
        size: rest.reduce((s, r) => s + r.size, 0),
        isDirectory: false,
      });
    }

    res.json({ path: reqPath, total, children });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/cleanup/actions', async (req, res) => {
  const actions = await Promise.all(
    CLEANUP_ACTIONS.map(async (a) => {
      const sizes = await Promise.all(a.sizePaths.map(pathSize));
      return {
        id: a.id,
        label: a.label,
        description: a.description,
        manual: a.manual,
        command: a.command,
        size: sizes.reduce((sum, s) => sum + s, 0),
      };
    })
  );
  res.json({ actions });
});

app.post('/api/cleanup/actions/:id/run', async (req, res) => {
  const action = CLEANUP_ACTIONS.find((a) => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'Unknown action' });
  if (action.manual) {
    return res.status(400).json({ error: 'This action requires sudo — run the command manually.' });
  }
  try {
    await action.run();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/open-in-file-browser', async (req, res) => {
  const targetPath = req.body?.path;
  if (typeof targetPath !== 'string' || !targetPath.startsWith('/')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch {
    return res.status(404).json({ error: `Path not found: ${targetPath}` });
  }
  const dirToOpen = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  try {
    await runOk('xdg-open', [dirToOpen]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/delete-path', async (req, res) => {
  const targetPath = req.body?.path;
  if (typeof targetPath !== 'string' || !targetPath.startsWith('/')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (isDangerousDeleteTarget(targetPath)) {
    return res.status(400).json({ error: 'Refusing to delete a top-level system directory.' });
  }
  try {
    fs.lstatSync(targetPath);
  } catch {
    return res.status(404).json({ error: `Path not found: ${targetPath}` });
  }
  try {
    await fs.promises.rm(targetPath, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`lin-dir-stat server listening on http://localhost:${PORT}`);
});
