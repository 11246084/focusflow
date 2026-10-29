'use strict';

const pkg = require('../../package.json');
const ASSET_VERSIONS = Object.freeze({
  '@iconify-json/fluent-emoji-flat': '1.2.6',
  '@phosphor-icons/core': '2.1.1',
});
const SHORT_RENDER_VERSION = '0.2.0';
const CONTRACT_VERSION = 'sentence-v1';
const THEMES = Object.freeze({
  N2: { bg: '#151C3F', panel: '#1C1A40', end: '#28173A', card: '#293157', edge: '#7F83AD', ink: '#FFFFFF', muted: '#D3D5EB', accent: '#FFC93C', accentInk: '#171B34', light: false },
  N1: { bg: '#111C31', panel: '#152A43', end: '#1C3550', card: '#253D57', edge: '#7991AC', ink: '#FFFFFF', muted: '#D1DCE8', accent: '#FFC93C', accentInk: '#111C31', light: false },
  C: { bg: '#25101F', panel: '#2E1226', end: '#381230', card: '#4A2340', edge: '#AF7F9F', ink: '#FFFFFF', muted: '#E2C9D9', accent: '#FFC93C', accentInk: '#25101F', light: false },
  B: { bg: '#EEE9F8', panel: '#E4DCF2', end: '#F4F0FA', card: '#FFFFFF', edge: '#9381B3', ink: '#292039', muted: '#57466E', accent: '#735112', accentInk: '#FFFFFF', light: true },
  G: { bg: '#EFF1F4', panel: '#E2E6EB', end: '#F8F9FA', card: '#FFFFFF', edge: '#8995A4', ink: '#202B39', muted: '#49586B', accent: '#79510E', accentInk: '#FFFFFF', light: true },
});

function getRendererMetadata(modelId) {
  return { modelId, shortRender: SHORT_RENDER_VERSION, assets: { ...ASSET_VERSIONS } };
}

function validateVersions(versions) {
  const errors = [];
  if (pkg.version !== SHORT_RENDER_VERSION) errors.push('installed renderer package version does not match runtime');
  if (!versions || typeof versions.modelId !== 'string' || !versions.modelId.trim()) errors.push('modelId is required');
  if (versions?.shortRender !== SHORT_RENDER_VERSION) errors.push('short_render version mismatch');
  for (const [name, version] of Object.entries(ASSET_VERSIONS)) {
    if (versions?.assets?.[name] !== version || pkg.dependencies[name] !== version) errors.push(`${name} version mismatch`);
  }
  return errors;
}

function calculateFixedGain({ integratedLufs, truePeakDbtp }) {
  if (![integratedLufs, truePeakDbtp].every(Number.isFinite)) throw new Error('finite loudness measurements required');
  const gainDb = Math.round(Math.min(-16 - integratedLufs, -1.5 - truePeakDbtp) * 1e6) / 1e6;
  return { gainDb, inputIntegratedLufs: integratedLufs, inputTruePeakDbtp: truePeakDbtp, targetLufs: -16, maxTruePeakDbtp: -1.5 };
}

function validateAudio(audio) {
  if (!audio || ![audio.gainDb, audio.inputIntegratedLufs, audio.inputTruePeakDbtp].every(Number.isFinite)) return ['finite fixed gain and source measurements required'];
  const expected = calculateFixedGain({ integratedLufs: audio.inputIntegratedLufs, truePeakDbtp: audio.inputTruePeakDbtp });
  const errors = [];
  if (audio.targetLufs !== -16 || audio.maxTruePeakDbtp !== -1.5 || Math.abs(expected.gainDb - audio.gainDb) > 1e-5) errors.push('gain must be the peak-limited fixed gain for -16 LUFS / -1.5 dBTP');
  if (audio.inputIntegratedLufs + audio.gainDb < -18 - 1e-5) errors.push('RECUT_SOURCE_TOO_QUIET');
  return errors;
}

module.exports = { CONTRACT_VERSION, SHORT_RENDER_VERSION, ASSET_VERSIONS, THEMES, getRendererMetadata, validateVersions, calculateFixedGain, validateAudio };
