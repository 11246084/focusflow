const fs = require('node:fs');
const { reciprocalRankFusion } = require('../../src/services/rankFusion.service');

function fuseQueries(queries) {
  if (!Array.isArray(queries) || queries.length > 3) throw new TypeError('Expected at most three validation queries.');
  return queries.map(({ queryId, lists }) => ({ queryId,
    equal: reciprocalRankFusion(lists),
    textWeighted: reciprocalRankFusion(lists, { weights: { text: 2, audio: 1, visual: 1 } }),
  }));
}

if (require.main === module) {
  try {
    const input = fs.readFileSync(0, 'utf8');
    if (Buffer.byteLength(input) > 256 * 1024) throw new RangeError('Validation input exceeds limit.');
    process.stdout.write(JSON.stringify(fuseQueries(JSON.parse(input))));
  } catch {
    console.error('Validation RRF failed; details redacted.');
    process.exitCode = 1;
  }
}

module.exports = { fuseQueries };
