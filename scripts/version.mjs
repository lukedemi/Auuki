// Writes dist/version.json — the commit and build time of what was deployed,
// shown in the Power Match debug panel and fetchable at /version.json.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function git(cmd) {
    try { return execSync(`git ${cmd}`, {encoding: 'utf8'}).trim(); }
    catch { return ''; }
}

const sha   = git('rev-parse --short HEAD');
const dirty = git('status --porcelain -- src') ? '-dirty' : '';
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z';

writeFileSync('dist/version.json', JSON.stringify({sha: sha + dirty, built}) + '\n');
console.log(`version.json: ${sha}${dirty} ${built}`);
