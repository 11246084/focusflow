'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { createRecutCodeCardHandler } = require('./recutCodeCard.service');
const { fail } = require('./recutRuntime.service');
const { numericTokens } = require('./recutCardsValidation.service');

function createRecutCodeRuntime({ decide, run, ffmpeg, resolveSourcePath, resolveSource, createWorkspace, removeWorkspace, readFile } = {}) {
  const missing = Object.entries({ decide, run, ffmpeg, resolveSourcePath, resolveSource, createWorkspace, removeWorkspace, readFile }).filter(([, v]) => !v).map(([k]) => `codeCards.${k}`);
  const images = new WeakMap();
  const capture = async ({ source, scene }) => {
    if (missing.length) throw fail('程式碼畫面轉接尚未設定。', 'RECUT_CODE_NOT_CONFIGURED');
    const first = source.sentences.findIndex((s) => s.id === scene.from), last = source.sentences.findIndex((s) => s.id === scene.to);
    if (first < 0 || last < first) throw fail('程式碼畫面範圍無效。', 'RECUT_SOURCE_INVALID');
    const start = source.sentences[first].startSec, end = source.sentences[last].endSec;
    const seconds = [...new Set([start, (start + end) / 2, Math.max(start, end - 0.05)].map((n) => Math.round(n * 1000) / 1000))];
    const directory = await createWorkspace();
    try {
      const file = await resolveSource(await resolveSourcePath(source.videoId)), frames = [], parts = [];
      for (const [index, second] of seconds.entries()) {
        const output = path.join(directory, `frame-${index}.png`);
        await run(ffmpeg, ['-nostdin', '-v', 'error', '-ss', String(second), '-protocol_whitelist', 'file,pipe', '-i', file,
          '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-an', '-y', output], { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 });
        const bytes = await readFile(output);
        if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 2 * 1024 * 1024) throw fail('程式碼畫面大小無效。', 'RECUT_CODE_CAPTURE_FAILED');
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        frames.push({ id: `frame-${index}`, sourceSec: second, sha256, mimeType: 'image/png', byteLength: bytes.length });
        parts.push({ mimeType: 'image/png', data: bytes.toString('base64') });
      }
      const nearby = source.sentences.slice(Math.max(0, first - 1), last + 2).map((s) => s.text).join('\n');
      const variables = [...new Set([...nearby.matchAll(/(?:變數|variable)\s*([A-Za-z_$][\w$]*)/giu)].map((m) => m[1]))];
      const intentional = /(?:故意|刻意)[^。！？\n]{0,12}(?:錯|error)|錯誤示範|不要修正|(?:會|可能|就)[^。！？\n]{0,8}(?:出錯|錯誤)|這(?:一)?行[^。！？\n]{0,8}(?:會|可能|就)[^。！？\n]{0,8}(?:出錯|錯誤)/iu.test(nearby);
      const intentionalErrorLines = [...new Set([...nearby.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*行[^。！？\n]{0,12}(?:故意|刻意|示範)[^。！？\n]{0,8}(?:錯|error)/giu)]
        .map((m) => Number(numericTokens(m[1])[0])).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12))];
      // Even a known line number does not prove OCR preserved a deliberately
      // malformed token. Without independently verified raw lines, use text.
      const evidence = { frames, variables, intentionalErrorLines, intentionalErrorUnresolved: intentional };
      images.set(evidence, parts); return evidence;
    } catch { throw fail('無法取得程式碼畫面。', 'RECUT_CODE_CAPTURE_FAILED'); }
    finally { await removeWorkspace(directory); }
  };
  const vision = (request) => {
    const parts = images.get(request.input.evidence);
    if (!parts?.length) throw fail('程式碼辨識缺少畫面。', 'RECUT_CODE_CAPTURE_FAILED');
    return decide({ ...request, images: parts });
  };
  return { missing, handler: missing.length ? null : createRecutCodeCardHandler({ capture, extract: vision, review: vision }) };
}

// Keep RC5's general catalog and unreviewed cards unchanged. A separate guarded
// code request contains only language; OCR supplies all lines and provenance.
function withRecutCodeRequests(renderer) {
  return { ...renderer,
    getComponentCatalog(options) {
      const catalog = renderer.getComponentCatalog(options);
      if (!options?.aiOnly || catalog.some((v) => v.name === 'code')) return catalog;
      const entry = renderer.getComponentCatalog({ aiOnly: false }).find((v) => v.name === 'code');
      if (!entry) return catalog;
      return [...catalog, { ...entry, aiEnabled: true, review: 'rc6-capture-required', paramsSchema: { type: 'OBJECT', properties: { language: { type: 'STRING', enum: ['javascript', 'python', 'cpp', 'c', 'csharp', 'java', 'text'] } }, required: ['language'] },
        example: '{"language":"python"}', doNotUse: '只請求來源畫面抄錄；不得提供 lines 或原創程式碼。' }];
    },
    getCardsResponseSchema() {
      const schema = structuredClone(renderer.getCardsResponseSchema()), scene = schema.properties.scenes.items;
      if (!scene.properties.component.enum.includes('code')) scene.properties.component.enum.push('code');
      scene.properties.params.properties.language = { type: 'STRING', enum: ['javascript', 'python', 'cpp', 'c', 'csharp', 'java', 'text'] };
      return schema;
    },
  };
}
module.exports = { createRecutCodeRuntime, withRecutCodeRequests };
