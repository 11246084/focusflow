import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const frameworkDir = path.resolve(sourceDir, '../..');
const resultsDir = path.join(frameworkDir, 'results', 'v2-0');
const recordsDir = path.join(frameworkDir, 'records', 'v2-0');
const v1Dir = path.join(frameworkDir, 'results', 'v1-0');
const root = path.resolve(sourceDir, '../../../../..');
const stem = 'focusflow-research-framework-v2-0';
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const readResult = relativePath => fs.readFileSync(path.join(resultsDir, relativePath));
const readRecord = relativePath => fs.readFileSync(path.join(recordsDir, relativePath));

const preservedV1 = JSON.parse(readRecord('v1-preservation.json'));
for (const [relativePath, expectedHash] of Object.entries(preservedV1)) {
  assert.equal(hash(fs.readFileSync(path.join(v1Dir, relativePath))), expectedHash, `First version changed: ${relativePath}`);
}
const manifest = JSON.parse(readRecord(`${stem}.manifest.json`));
for (const [relativePath, expectedHash] of Object.entries(manifest.sourceFiles)) {
  assert.equal(hash(fs.readFileSync(path.join(root, relativePath))), expectedHash, `Source drift: ${relativePath}`);
}
for (const [relativePath, expectedHash] of Object.entries(manifest.artifacts)) {
  const filePath = path.join(frameworkDir, relativePath);
  assert.equal(hash(fs.readFileSync(filePath)), expectedHash, `Artifact drift: ${relativePath}`);
}

const svgPath = path.join(resultsDir, `${stem}.svg`);
const before = hash(fs.readFileSync(svgPath));
execFileSync(process.execPath, [path.join(sourceDir, 'build-research-framework-v2-0.mjs')], { stdio: 'pipe' });
assert.equal(hash(fs.readFileSync(svgPath)), before, 'Nondeterministic SVG');

const markdownFiles = ['README-v2-0.md', 'chapter03-insertion-v2-0.md'];
let links = 0;
for (const fileName of markdownFiles) {
  const markdown = readRecord(fileName).toString();
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    assert(fs.existsSync(path.resolve(recordsDir, match[1])), `Broken link: ${match[1]}`);
    links += 1;
  }
}

const svg = fs.readFileSync(svgPath, 'utf8').replace(/^<\?xml[^>]+>\s*/, '').trim();
assert(readResult(`${stem}.html`).toString().includes(svg));
assert(readResult('chapter03-placement-v2-0.html').toString().includes(svg));
const png = readResult(`${stem}.png`);
assert.equal(png.readUInt32BE(16), 3300);
assert.equal(png.readUInt32BE(20), 3348);
const pdfPages = {};
for (const fileName of [`${stem}.pdf`, 'chapter03-placement-v2-0.pdf']) {
  pdfPages[fileName] = [...readResult(fileName).toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
  assert.equal(pdfPages[fileName], 1);
}
for (const directory of [sourceDir, resultsDir, recordsDir]) {
  for (const fileName of fs.readdirSync(directory).filter(name => /\.(mjs|js|md|svg|html|json)$/.test(name))) {
    const contents = fs.readFileSync(path.join(directory, fileName), 'utf8');
    assert(!contents.split(/\r?\n/).some(line => /[ \t]+$/.test(line)), `Trailing whitespace: ${fileName}`);
  }
}

const reportPath = path.join(recordsDir, 'validation-v2-0.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
report.filesystemChecks = { v1FilesUnchanged: Object.keys(preservedV1).length, sourceHashesVerified: Object.keys(manifest.sourceFiles).length, relativeLinksVerified: links, svgRebuildIdentical: true, identicalSvgInFigureAndChapter: true, pngSize: [3300, 3348], pdfPages };
const resultFiles = fs.readdirSync(resultsDir).sort();
report.outputHashes = Object.fromEntries(resultFiles.map(fileName => [fileName, hash(readResult(fileName))]));
for (const fileName of fs.readdirSync(sourceDir).sort()) report.outputHashes[`source/v2-0/${fileName}`] = hash(fs.readFileSync(path.join(sourceDir, fileName)));
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.filesystemChecks, null, 2));
