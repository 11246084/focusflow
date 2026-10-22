import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const frameworkDir = path.resolve(sourceDir, '../..');
const resultsDir = path.join(frameworkDir, 'results', 'v1-0');
const recordsDir = path.join(frameworkDir, 'records', 'v1-0');
const root = path.resolve(sourceDir, '../../../../..');
const stem = 'focusflow-research-framework-v1-0';
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(recordsDir, `${stem}.manifest.json`), 'utf8'));

for (const [relativePath, expectedHash] of Object.entries(manifest.sourceFiles)) {
  assert.equal(hash(fs.readFileSync(path.join(root, relativePath))), expectedHash, `Source drift: ${relativePath}`);
}
for (const [relativePath, expectedHash] of Object.entries(manifest.artifacts)) {
  const filePath = path.join(frameworkDir, relativePath);
  assert.equal(hash(fs.readFileSync(filePath)), expectedHash, `Artifact drift: ${relativePath}`);
}

const markdown = fs.readFileSync(path.join(recordsDir, 'README-v1-0.md'), 'utf8');
const links = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
for (const relativePath of links) assert(fs.existsSync(path.resolve(recordsDir, relativePath)), `Missing link: ${relativePath}`);

const svgPath = path.join(resultsDir, `${stem}.svg`);
const before = hash(fs.readFileSync(svgPath));
execFileSync(process.execPath, [path.join(sourceDir, 'build-research-framework-v1-0.mjs')], { stdio: 'pipe' });
assert.equal(hash(fs.readFileSync(svgPath)), before, 'SVG was not deterministic');

const png = fs.readFileSync(path.join(resultsDir, `${stem}.png`));
assert.equal(png.subarray(1, 4).toString(), 'PNG');
assert.equal(png.readUInt32BE(16), 2560);
assert.equal(png.readUInt32BE(20), 3552);
const pdf = fs.readFileSync(path.join(resultsDir, `${stem}.pdf`));
const pageObjects = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
assert.equal(pageObjects, 1, 'Expected one PDF page');

const reportPath = path.join(recordsDir, 'validation-v1-0.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
report.filesystemChecks = { sourceHashesVerified: Object.keys(manifest.sourceFiles).length, relativeLinksVerified: links.length, deterministicSvg: true, pngSizeVerified: true, pdfPageObjects: pageObjects };
const outputs = [`${stem}.svg`, `${stem}.html`, `${stem}.png`, `${stem}.pdf`];
report.outputHashes = Object.fromEntries(outputs.map(relativePath => [relativePath, hash(fs.readFileSync(path.join(resultsDir, relativePath)))]));
report.outputHashes['records/v1-0/README-v1-0.md'] = hash(fs.readFileSync(path.join(recordsDir, 'README-v1-0.md')));
report.outputHashes['source/v1-0/build-research-framework-v1-0.mjs'] = hash(fs.readFileSync(path.join(sourceDir, 'build-research-framework-v1-0.mjs')));
report.outputHashes['source/v1-0/render-research-framework-v1-0.js'] = hash(fs.readFileSync(path.join(sourceDir, 'render-research-framework-v1-0.js')));
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.filesystemChecks, null, 2));
