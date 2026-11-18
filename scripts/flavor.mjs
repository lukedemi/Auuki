// Marks a build's page with its flavour (src/flavor.js reads it):
//   node scripts/flavor.mjs dist-public public
import { readFileSync, writeFileSync } from 'node:fs';

const [dist = 'dist', flavor = 'home'] = process.argv.slice(2);
const file = `${dist}/index.html`;
const html = readFileSync(file, 'utf8');
const re = /<meta name="?infergno-flavor"? content="?[a-z]+"?>/;
if(!re.test(html)) { console.error(`flavor.mjs: no infergno-flavor meta in ${file}`); process.exit(1); }
writeFileSync(file, html.replace(re, `<meta name="infergno-flavor" content="${flavor}">`));
console.log(`flavor: ${flavor} (${file})`);
