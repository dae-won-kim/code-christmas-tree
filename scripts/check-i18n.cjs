/**
 * 화면 문구 키 점검 — web/js/i18n.js의 ko · en 사전이 같은 키를 갖고 있는지,
 * index.html(data-i18n*)과 JS(t('키'))에서 쓰는 키가 두 사전에 모두 있는지 확인한다.
 *   npm run check:i18n      (빠진 키가 있으면 종료 코드 1)
 * 키가 en에 없으면 영어 화면에 한국어가 그대로 나오므로, 문구를 고친 뒤 꼭 돌릴 것.
 */
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(repo, f), 'utf8');

const src = read('web/js/i18n.js');
const block = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const keysOf = txt => new Set([...txt.matchAll(/(?:^\s*|,\s*)'([\w.]+)':/gm)].map(m => m[1]));
const ko = keysOf(block('const ko = {', 'const en = {'));
const en = keysOf(block('const en = {', 'const DICT'));

const used = new Set();
for (const m of read('web/index.html').matchAll(/data-i18n(?:-ph|-aria|-title)?="([\w.]+)"/g)) used.add(m[1]);
const jsFiles = dir => fs.readdirSync(path.join(repo, dir), { withFileTypes: true })
  .flatMap(d => d.isDirectory() ? jsFiles(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);
for (const f of jsFiles('web/js')) {
  if (f.endsWith('i18n.js')) continue;
  const js = read(f);
  for (const m of js.matchAll(/\bt_?\(\s*'([\w.]+)'/g)) used.add(m[1]);                      // t('키')
  for (const m of js.matchAll(/'(\w+\.\w+)'\s*:\s*'(\w+\.\w+)'/g)) { used.add(m[1]); used.add(m[2]); }   // 조건 ? '키' : '키'
  for (const m of js.matchAll(/(?:resize|upload|save): '([\w.]+)'/g)) used.add(m[1]);      // 사진 단계 이름
}
// 템플릿 문자열로 만드는 키 (`pattern.${i}` 등)
for (let i = 0; i < 8; i++) used.add(`pattern.${i}`);
for (const k of 'ball bulb star sock bell candy bow flake'.split(' ')) used.add(`decor.${k}`);
for (const k of 'red gold blue green pink white'.split(' ')) used.add(`color.${k}`);
['lines.santa', 'lines.deer', 'meta.description'].forEach(k => used.add(k));

const diff = (a, b) => [...a].filter(x => !b.has(x)).sort();
const problems = {
  'ko에만 있음': diff(ko, en),
  'en에만 있음': diff(en, ko),
  '쓰는데 ko에 없음': diff(used, ko),
  '쓰는데 en에 없음': diff(used, en)
};
const unused = diff(new Set([...ko, ...en]), used);
console.log(`ko ${ko.size}개 · en ${en.size}개 · 사용 ${used.size}개`);
let bad = 0;
for (const [label, list] of Object.entries(problems)) if (list.length) { bad++; console.log(`FAIL ${label}: ${list.join(', ')}`); }
if (unused.length) console.log(`참고 — 사전에만 있고 안 쓰는 키: ${unused.join(', ')}`);
console.log(bad ? '❌ 빠진 키가 있어요' : '✅ 키가 모두 맞아요');
process.exit(bad ? 1 : 0);
