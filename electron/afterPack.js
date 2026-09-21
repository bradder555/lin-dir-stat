const fs = require('node:fs');
const path = require('node:path');

// electron-builder's extraResources copy silently drops node_modules from
// ../server (observed with electron-builder 26.x; worked fine on 25.x), so
// this hook copies it directly after packaging, bypassing whatever internal
// filtering is responsible.
module.exports = async function afterPack(context) {
  const src = path.join(__dirname, '../server/node_modules');
  const dest = path.join(context.appOutDir, 'resources', 'server', 'node_modules');
  fs.cpSync(src, dest, { recursive: true });
};
