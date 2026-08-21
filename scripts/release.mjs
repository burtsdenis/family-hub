#!/usr/bin/env node
/*
  Cut a release: one tag, pushed.

  Development here is reactive and ships daily, so the release ritual has
  to cost seconds or it will not happen. It costs one command because the
  version is derived from the tag rather than written into a file — master
  is protected (pull requests only), and a version bump living in the
  manifest would mean a pull request and a CI wait every single day.

    npm run release            # what would happen, and nothing else
    npm run release -- patch   # fixes only
    npm run release -- minor   # anything new
    npm run release -- major   # an upgrade that needs hands

  Pushing the tag starts release.yml, which publishes the multi-arch image
  to GHCR and moves `latest` — that is what self-hosters install, so this
  is the moment the outside world sees the work.

  It also writes the release page, because that page is the release as far
  as anyone reading the repository is concerned — the README's badge points
  at it. By default GitHub composes the notes from the merged pull
  requests, which is the right floor for a daily release nobody is going
  to write an essay about. When a release does deserve the essay:

    npm run release -- minor --title "v1.1.0 — the board you arrange" \
                             --notes notes.md
*/
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const die = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const BUMPS = ['patch', 'minor', 'major'];
const argv = process.argv.slice(2);
const bump = argv.find((a) => !a.startsWith('-'));
if (bump && !BUMPS.includes(bump)) die(`Unknown bump "${bump}" — expected ${BUMPS.join(', ')}`);

const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const notesFile = flag('notes');
const title = flag('title');
if (notesFile && !existsSync(notesFile)) die(`No such notes file: ${notesFile}`);

// Refuse to tag anything but a clean, current master: a tag is public and
// immovable in practice, and half the point is that it names a known state.
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'master') die('Releases are cut from master');
if (git('status', '--porcelain')) die('Working tree is not clean');
git('fetch', '--quiet', '--tags', 'origin');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/master')) {
  die('master and origin/master differ — pull or push first');
}

const last = git('describe', '--tags', '--abbrev=0');
const [major, minor, patch] = last.replace(/^v/, '').split('.').map(Number);
if ([major, minor, patch].some(Number.isNaN)) die(`Cannot read a version out of "${last}"`);

const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
};

const log = git('log', `${last}..HEAD`, '--oneline', '--no-merges');
const commits = log ? log.split('\n') : [];
if (commits.length === 0) die(`Nothing new since ${last}`);

console.log(`\n${commits.length} commits since ${last}:\n`);
for (const line of commits) console.log(`  ${line}`);

if (!bump) {
  console.log('\nNothing tagged. Pick a bump:');
  for (const kind of BUMPS) console.log(`  npm run release -- ${kind}\t→ v${next[kind]}`);
  console.log();
  process.exit(0);
}

const tag = `v${next[bump]}`;
git('tag', '-a', tag, '-m', `Release ${tag}`);
// Pushed with git rather than left to `gh release create`: a tag pushed
// this way reliably starts release.yml, and the image matters more than
// the page if only one of the two survives a bad day.
git('push', 'origin', tag);
console.log(`\n✓ ${tag} pushed — release.yml is building the image.`);

const notes = notesFile ? ['--notes-file', notesFile] : ['--generate-notes'];
try {
  execFileSync('gh', ['release', 'create', tag, '--title', title ?? tag, ...notes], {
    stdio: 'inherit',
  });
  console.log(`✓ release page written`);
} catch {
  // The tag is already public; say plainly what is left rather than
  // pretending the release failed.
  console.error(`\n✗ Could not write the release page. The tag is pushed; finish with:`);
  console.error(`  gh release create ${tag} --title "${title ?? tag}" ${notes.join(' ')}\n`);
  process.exit(1);
}

console.log(`  https://github.com/burtsdenis/family-hub/releases/tag/${tag}\n`);
