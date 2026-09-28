// Input for Playwright MCP browser_run_code_unsafe(filename=...). No preview server needed.
// Audits each figure (XML, text overflow / overlap / outside), then exports PNG (3x) and a 160 mm-wide PDF.
// Returns the audit report; copy it into records/v3-0/validation-v3-0.json.
async (page) => {
  const base = 'C:/Users/User/Documents/GitHub/focusflow/docs/00_Deliverables/Research_Framework/results/v3-0';
  const figures = [
    ['01-question-to-evidence-v3-0', 1166],
    ['02-evidence-to-answer-v3-0', 1310],
    ['03-learning-feedback-v3-0', 1172],
  ];
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 3 });
  const audit = [];
  try {
    const p = await context.newPage();
    for (const [name, height] of figures) {
      await p.goto(`file:///${base}/${name}.html`);
      await p.evaluate(() => document.fonts.ready);
      const check = await p.evaluate(() => {
        const svg = document.querySelector('svg');
        const texts = [...svg.querySelectorAll('text')];
        const boxes = texts.map((t) => ({ text: t.textContent, b: t.getBBox(), max: +t.dataset.maxWidth }));
        const v = svg.viewBox.baseVal;
        return {
          xmlValid: !new DOMParser().parseFromString(svg.outerHTML, 'image/svg+xml').querySelector('parsererror'),
          width: v.width, height: v.height, textCount: texts.length,
          rasterImages: svg.querySelectorAll('image').length,
          overflow: boxes.filter((x) => x.b.width > x.max + 1).map((x) => x.text),
          outside: boxes.filter(({ b }) => b.x < 0 || b.y < 0 || b.x + b.width > v.width || b.y + b.height > v.height).map((x) => x.text),
          collisions: boxes.flatMap((a, i) => boxes.slice(i + 1)
            .filter((c) => a.b.x < c.b.x + c.b.width - 1 && a.b.x + a.b.width > c.b.x + 1 && a.b.y < c.b.y + c.b.height - 1 && a.b.y + a.b.height > c.b.y + 1)
            .map((c) => [a.text, c.text])),
          deviceScale: devicePixelRatio,
        };
      });
      const ok = check.xmlValid && check.height === height && !check.overflow.length && !check.outside.length && !check.collisions.length;
      audit.push({ name, exported: ok, ...check });
      if (!ok) continue;
      await p.locator('svg').screenshot({ path: `${base}/${name}.png`, scale: 'device' });
      await p.pdf({ path: `${base}/${name}.pdf`, preferCSSPageSize: true, printBackground: true });
    }
    return { browser: browser.version(), date: new Date().toISOString(), audit };
  } finally {
    await context.close();
  }
}
