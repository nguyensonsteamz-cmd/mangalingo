// Runs every (model, dtype, direction) in models.json: download pass, then the measured pass (separate processes).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const M = JSON.parse(fs.readFileSync(new URL('./models.json', import.meta.url), 'utf8'));
const only = process.argv[2];
for (const [key, cfg] of Object.entries(M)) {
  if (only && only !== key) continue;
  for (const dtype of cfg.dtypes) for (const dir of ['en-vi', 'vi-en']) {
    for (const mode of ['download', undefined]) {
      const r = spawnSync('node', ['bench.mjs', key, dtype, dir, ...(mode ? [mode] : [])], { stdio: 'inherit', cwd: new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
      if (r.status !== 0 && mode) console.log('download pass exit', r.status);
    }
  }
}
