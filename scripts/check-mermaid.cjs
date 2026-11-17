/**
 * 문서의 ```mermaid 블록을 실제 Mermaid로 렌더링해 오류가 없는지 확인하고, 그림을 PNG로 저장
 *   npm run check:mermaid      → test-results/mermaid/*.png
 * (Mermaid는 CDN에서 불러옴 · Playwright Chromium 필요: npx playwright install chromium)
 */
const path = require('path');
const fs = require('fs');
const repo = path.resolve(__dirname, '..');
const out = path.join(repo, 'test-results', 'mermaid');
const { chromium } = require('@playwright/test');

const files = ['README.md', 'docs/ARCHITECTURE.md', 'docs/DATABASE.md'];
const blocks = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(repo, f), 'utf8');
  const re = /```mermaid\n([\s\S]*?)```/g;
  let m, i = 0;
  while ((m = re.exec(text))) blocks.push({ file: f, idx: ++i, code: m[1] });
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent('<html><body style="background:#fff"><div id="o"></div></body></html>');
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js' });
  await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false }));
  let bad = 0;
  for (const b of blocks) {
    const r = await page.evaluate(async code => {
      try {
        const { svg } = await window.mermaid.render('g' + Math.random().toString(36).slice(2), code);
        document.getElementById('o').innerHTML = svg;
        return { ok: true };
      } catch (e) { return { ok: false, err: String(e.message || e).slice(0, 400) }; }
    }, b.code);
    const name = `${b.file.replace(/[\/.]/g, '_')}-${b.idx}`;
    if (r.ok) {
      await page.locator('#o svg').screenshot({ path: path.join(out, name + '.png') });
      console.log('OK  ', name);
    } else { bad++; console.log('FAIL', name, '\n     ', r.err); }
  }
  await browser.close();
  console.log(`${blocks.length - bad}/${blocks.length} rendered`);
  process.exit(bad ? 1 : 0);
})();
