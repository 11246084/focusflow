'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** 每支 clip 用哪一組已對齊字詞（fixture 只存了兩個視窗）。 */
function wordsByClipFor(plan, windows, pick) {
  return Object.fromEntries(plan.clips.map((clip) => [clip.id, windows[pick(clip)]]));
}

const fixtures = {
  plan1: () => loadJson('plan1.json'),
  plan2: () => loadJson('plan2.json'),
  evidence1: () => loadJson('evidence1.json'),
  evidence5: () => loadJson('evidence5.json'),
  words1: () => loadJson('words1.json'),
  words5: () => loadJson('words5.json'),
};

module.exports = { fixtures, clone, wordsByClipFor };
