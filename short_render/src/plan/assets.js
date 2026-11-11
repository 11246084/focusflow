'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ASSET_VERSIONS } = require('./runtime');
const icons = require('@iconify-json/fluent-emoji-flat/icons.json');
const metadata = require('@iconify-json/fluent-emoji-flat/metadata.json');
const hasIcon = (name) => Object.hasOwn(icons.icons, name) || Object.hasOwn(icons.aliases || {}, name);
// Approved 2026-10-17: docs/04_Features/Short_Video/recut-asset-exclusions.md.
const EXCLUDED_FLUENT = Object.freeze([
  'bomb', 'dagger', 'crossed-swords', 'water-pistol', 'bow-and-arrow', 'military-helmet',
  'coffin', 'funeral-urn', 'skull', 'skull-and-crossbones',
  'cigarette', 'beer-mug', 'clinking-beer-mugs', 'wine-glass', 'cocktail-glass', 'tropical-drink', 'tumbler-glass', 'sake', 'bottle-with-popping-cork', 'clinking-glasses', 'slot-machine',
  'middle-finger', 'face-with-symbols-on-mouth', 'pile-of-poo', 'face-vomiting', 'eggplant', 'peach', 'kiss-mark', 'face-blowing-a-kiss', 'kissing-face', 'kissing-face-with-smiling-eyes', 'kissing-face-with-closed-eyes', 'kissing-cat', 'bikini', 'briefs', 'tongue',
  'ogre', 'goblin', 'person-zombie', 'man-zombie', 'woman-zombie', 'person-vampire', 'man-vampire', 'woman-vampire',
  'church', 'mosque', 'synagogue', 'hindu-temple', 'kaaba', 'shinto-shrine', 'prayer-beads',
]);
const SYMBOL_ALLOWLIST = Object.freeze([
  'atom-symbol', 'biohazard', 'radioactive', 'recycling-symbol', 'warning', 'prohibited', 'no-entry', 'medical-symbol', 'potable-water', 'non-potable-water',
  'male-sign', 'female-sign', 'a-button-blood-type', 'b-button-blood-type', 'ab-button-blood-type', 'o-button-blood-type',
  'red-question-mark', 'red-exclamation-mark', 'exclamation-question-mark', 'sparkle', 'infinity',
  'heavy-dollar-sign', 'currency-exchange', 'wireless', 'antenna-bars', 'copyright', 'registered', 'trade-mark',
]);
const OPEN_CATEGORIES = ['Objects', 'Travel & Places', 'Animals & Nature', 'Food & Drink', 'Activities', 'People & Body', 'Smileys & Emotion'];
const skinVariant = /-(?:light|medium-light|medium|medium-dark|dark)$/;
const excluded = new Set(EXCLUDED_FLUENT);
const FLUENT_ALLOWLIST = Object.freeze([...new Set([
  ...OPEN_CATEGORIES.flatMap((category) => metadata.categories[category]), ...SYMBOL_ALLOWLIST,
  // Iconify stores the approved default right-pointing hand as a mirrored alias,
  // absent from metadata.categories; its other skin-tone aliases stay closed.
  'backhand-index-pointing-right',
])].filter((name) => {
  // A name ending in "-light" can be a traffic light; a tone family also has -medium.
  const base = name.replace(skinVariant, '');
  const tone = base !== name && hasIcon(`${base}-medium`);
  return !tone && !excluded.has(name) && hasIcon(name);
}).sort());
// Abstract symbols are intentionally a finite list, not every UI pictogram.
const PHOSPHOR_ALLOWLIST = Object.freeze(['arrow-right', 'arrow-down', 'arrows-left-right', 'check', 'x', 'plus', 'minus', 'equals', 'warning', 'prohibit', 'link', 'brackets-curly', 'caret-right']);
const allow = new Set([...FLUENT_ALLOWLIST.map((name) => `fluent:${name}`), ...PHOSPHOR_ALLOWLIST.map((name) => `phosphor:${name}`)]);

function validateIcon(icon) { return typeof icon === 'string' && allow.has(icon); }

function getAssetCatalog() {
  return { policyVersion: '2026-10-17', versions: { ...ASSET_VERSIONS }, fluent: [...FLUENT_ALLOWLIST], phosphor: [...PHOSPHOR_ALLOWLIST] };
}

function iconSvg(icon) {
  if (!validateIcon(icon)) throw new Error(`ICON_NOT_ALLOWED: ${icon}`);
  const [family, name] = icon.split(':');
  if (family === 'fluent') {
    const alias = icons.aliases?.[name];
    const data = icons.icons[alias?.parent || name];
    const width = data.width || icons.width, height = data.height || icons.height;
    const body = alias?.hFlip ? `<g transform="translate(${width},0) scale(-1,1)">${data.body}</g>` : data.body;
    return `<svg class="asset-icon fluent" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">${body}</svg>`;
  }
  const file = require.resolve(`@phosphor-icons/core/assets/duotone/${name}-duotone.svg`);
  return fs.readFileSync(file, 'utf8').replace('<svg ', '<svg class="asset-icon phosphor" aria-hidden="true" ');
}

function validateInstalledAssets() {
  return Object.entries(ASSET_VERSIONS).flatMap(([name, version]) => {
    const root = name === '@phosphor-icons/core' ? path.resolve(path.dirname(require.resolve(name)), '..') : path.dirname(require.resolve(`${name}/package.json`));
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return installed.version === version ? [] : [`${name} installed version mismatch`];
  });
}

module.exports = { EXCLUDED_FLUENT, SYMBOL_ALLOWLIST, FLUENT_ALLOWLIST, PHOSPHOR_ALLOWLIST, validateIcon, getAssetCatalog, iconSvg, validateInstalledAssets };
