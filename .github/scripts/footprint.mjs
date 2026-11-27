import fs from 'node:fs';

const LOGIN = process.env.LOGIN || 'm4c4r0n1n';
const TOKEN = process.env.FOOTPRINT_TOKEN || process.env.GITHUB_TOKEN || '';
const OUT = process.env.OUT || 'dist';
const ALSO = [
  { name: 'SQL', color: '#e38c00' },
  { name: 'Dockerfile', color: '#384d54' },
  { name: 'Assembly', color: '#6E4C13' },
  { name: 'WebAssembly', color: '#04133b' },
];
const SKIP = new Set((process.env.SKIP || '').split(',').map((s) => s.trim()).filter(Boolean));

async function gql(query, variables, token = TOKEN) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'footprint' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors || j).slice(0, 300));
  return j.data;
}

async function rest(path, token) {
  const r = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'footprint' } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function colors() {
  const map = new Map();
  for (const a of ALSO) map.set(a.name, a.color);
  try {
    const q = `query($l:String!){user(login:$l){repositories(first:100,ownerAffiliations:OWNER,privacy:PUBLIC){nodes{languages(first:100){nodes{name color}}}}}}`;
    const d = await gql(q, { l: LOGIN }, process.env.GITHUB_TOKEN || TOKEN);
    for (const r of d.user.repositories.nodes) for (const n of r.languages.nodes) if (n.color) map.set(n.name, n.color);
  } catch {}
  return map;
}

async function repos(own = Boolean(process.env.FOOTPRINT_TOKEN)) {
  const token = own ? process.env.FOOTPRINT_TOKEN : process.env.GITHUB_TOKEN || process.env.FOOTPRINT_TOKEN;
  const list = [];
  for (let page = 1; page < 20; page++) {
    const path = own ? `/user/repos?affiliation=owner&visibility=all&per_page=100&page=${page}` : `/users/${LOGIN}/repos?type=owner&per_page=100&page=${page}`;
    const batch = await rest(path, token);
    list.push(...batch);
    if (batch.length < 100) break;
  }
  const paint = await colors();
  const all = [];
  for (const r of list.filter((x) => !x.fork)) {
    const langs = await rest(`/repos/${r.full_name}/languages`, token);
    all.push({ name: r.name, isPrivate: r.private, languages: { edges: Object.entries(langs).map(([name, size]) => ({ size, node: { name, color: paint.get(name) || null } })) } });
  }
  console.log(`the token sees ${all.length} repos, ${all.filter((r) => r.isPrivate).length} of them private`);
  return { all, own };
}

function totals(list) {
  const m = new Map();
  const seen = new Set();
  for (const r of list) {
    const edges = r.languages.edges.filter((e) => !SKIP.has(e.node.name));
    const total = edges.reduce((s, e) => s + e.size, 0);
    if (!total) continue;
    for (const e of edges) {
      const key = `${e.node.name}=${e.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cur = m.get(e.node.name) || { name: e.node.name, color: e.node.color || '#8b949e', size: 0 };
      cur.size += e.size / total;
      m.set(e.node.name, cur);
    }
  }
  const langs = [...m.values()].sort((a, b) => b.size - a.size);
  const sum = langs.reduce((s, l) => s + l.size, 0) || 1;
  for (const l of langs) l.pct = (l.size / sum) * 100;
  for (const a of ALSO) if (!m.has(a.name)) langs.push({ ...a, size: 0, pct: 0 });
  return langs;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pctText = (p, size) => (!size ? 'also' : p >= 10 ? `${p.toFixed(1)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : '<0.1%');

function svg(langs, dark, note) {
  const t = dark
    ? { bg: '#0d1117', edge: '#30363d', text: '#e6edf3', dim: '#8b949e', track: '#21262d' }
    : { bg: '#ffffff', edge: '#d0d7de', text: '#1f2328', dim: '#656d76', track: '#eaeef2' };
  const W = 720, pad = 24, barY = 66, barH = 12, cols = 3, rowH = 26;
  const colW = (W - pad * 2) / cols;
  const legendY = barY + barH + 30;
  const rows = Math.ceil(langs.length / cols);
  const H = legendY + rows * rowH + 30;
  const measured = langs.filter((l) => l.size);
  let x = pad, segs = '';
  const span = W - pad * 2;
  measured.forEach((l, i) => {
    const w = i === measured.length - 1 ? pad + span - x : Math.max(1.5, (l.pct / 100) * span);
    if (w > 0) segs += `<rect x="${x.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" fill="${l.color}"><title>${esc(l.name)} ${esc(pctText(l.pct, l.size))}</title></rect>`;
    x += w;
  });
  let legend = '';
  langs.forEach((l, i) => {
    const cx = pad + (i % cols) * colW, cy = legendY + Math.floor(i / cols) * rowH;
    legend += `<g transform="translate(${cx.toFixed(1)},${cy})"><circle cx="6" cy="-4" r="5" fill="${l.color}"/><text x="18" y="0" fill="${t.text}" font-size="13" font-weight="600">${esc(l.name)}</text><text x="${(colW - 14).toFixed(1)}" y="0" fill="${t.dim}" font-size="12" text-anchor="end">${esc(pctText(l.pct, l.size))}</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Technology footprint: ${esc(langs.map((l) => l.name).join(', '))}">
<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.edge}"/>
<text x="${pad}" y="40" fill="${t.text}" font-size="18" font-weight="700">Technology Footprint</text>
<text x="${W - pad}" y="40" fill="${t.dim}" font-size="12" text-anchor="end">${esc(note)}</text>
<clipPath id="bar"><rect x="${pad}" y="${barY}" width="${span}" height="${barH}" rx="6"/></clipPath>
<rect x="${pad}" y="${barY}" width="${span}" height="${barH}" rx="6" fill="${t.track}"/>
<g clip-path="url(#bar)">${segs}</g>
${legend}
</svg>
`;
}

let found;
try { found = await repos(); } catch (e) {
  if (!process.env.FOOTPRINT_TOKEN) throw e;
  console.log(`the token did not work, so the last card stays: ${e.message.slice(0, 120)}`);
  process.exit(0);
}
const { all, own } = found;
const langs = totals(all);
const priv = all.filter((r) => r.isPrivate).length;
const note = `${langs.length} languages · ${all.length} repos${own ? ` (${priv} private)` : ''}`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/footprint-dark.svg`, svg(langs, true, note));
fs.writeFileSync(`${OUT}/footprint-light.svg`, svg(langs, false, note));
console.log(note);
console.log(langs.map((l) => `${l.name} ${pctText(l.pct, l.size)}`).join(', '));
