// The source of the build being released, as <dist>/source.tar.gz: the AGPL
// (section 13) has a network service offer its users the Corresponding Source
// of exactly the version they use, and Settings > About links to this file.
//
//   node scripts/source.mjs [dist] [home|public]
//
// home    the whole repository at HEAD (the household copy, behind Access)
// public  what builds and runs the public app: src/, its one server
//         function (the Strava relay), the build configuration and the
//         licence (not the household's other functions, deploy notes or tests)
//
// It refuses to package a tree with uncommitted changes under src/, so the
// download always matches what was built.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const dist   = process.argv[2] ?? 'dist';
const flavor = process.argv[3] ?? 'home';
const git = (cmd) => execSync(`git ${cmd}`, {encoding: 'utf8'}).trim();

if(git('status --porcelain -- src')) {
    console.error('source.mjs: src/ has uncommitted changes; commit before releasing, so the source matches the build');
    process.exit(1);
}
const sha = git('rev-parse --short HEAD');
const tracked = new Set(git('ls-files').split('\n'));
const PUBLIC = ['src', 'functions/api/strava', 'scripts/version.mjs', 'scripts/flavor.mjs', 'scripts/source.mjs', 'LICENSE.txt', 'package.json', 'package-lock.json',
                '.babelrc', '.htmlnanorc', 'robots.txt', 'sitemap.xml'];
const paths = flavor === 'public'
    ? PUBLIC.filter((p) => p === 'src' || p === 'functions/api/strava' || tracked.has(p))
    : [];

if(!existsSync(dist)) { console.error(`source.mjs: no ${dist}/`); process.exit(1); }
execSync(`git archive --format=tar.gz --prefix=ergatory-${sha}/ -o ${dist}/source.tar.gz HEAD ${paths.join(' ')}`, {stdio: 'inherit'});
console.log(`source.tar.gz: ergatory-${sha} (${flavor}${paths.length ? ': ' + paths.join(', ') : ': whole repository'})`);
