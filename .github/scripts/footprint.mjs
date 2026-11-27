import fs from 'node:fs';

const LOGIN = process.env.LOGIN || 'm4c4r0n1n';
const TOKEN = process.env.FOOTPRINT_TOKEN || process.env.GITHUB_TOKEN || '';
const OUT = process.env.OUT || 'dist';
const ALSO = [
  { name: 'SQL', color: '#e38c00' },
  { name: 'Dockerfile', color: '#384d54' },
  { name: 'Assembly', color: '#6E4C13' },
  { name: 'Binary', color: '#8b949e' },
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

async function repos(own = Boolean(process.env.FOOTPRINT_TOKEN)) {
  const token = own ? process.env.FOOTPRINT_TOKEN : process.env.GITHUB_TOKEN || process.env.FOOTPRINT_TOKEN;
  const q = own
    ? `query($c:String){viewer{login repositories(first:100,after:$c,ownerAffiliations:OWNER,isFork:false){pageInfo{hasNextPage endCursor}nodes{name isPrivate languages(first:100){edges{size node{name color}}}}}}}`
    : `query($c:String,$l:String!){user(login:$l){repositories(first:100,after:$c,ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC){pageInfo{hasNextPage endCursor}nodes{name isPrivate languages(first:100){edges{size node{name color}}}}}}}`;
  const all = [];
  let c = null;
  do {
    const d = await gql(q, own ? { c } : { c, l: LOGIN }, token);
    const page = (own ? d.viewer : d.user).repositories;
    all.push(...page.nodes);
    c = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (c);
  return { all, own };
}

function totals(list) {
  const m = new Map();
  for (const r of list) {
    for (const e of r.languages.edges) {
      if (SKIP.has(e.node.name)) continue;
      const cur = m.get(e.node.name) || { name: e.node.name, color: e.node.color || '#8b949e', size: 0 };
      cur.size += e.size;
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
  console.log(`private repos skipped, the token did not work: ${e.message.slice(0, 120)}`);
  found = await repos(false);
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
