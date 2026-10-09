import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ICONS } from '../shared/icon-library.js';

const output = resolve(process.argv[2] || 'build/icons');
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const artwork = (icon) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><title>${escape(icon.label)}</title><path d="${icon.path}"/></svg>`;
mkdirSync(output, { recursive: true });
for (const icon of ICONS) writeFileSync(join(output, `${icon.id}.svg`), artwork(icon));
writeFileSync(join(output, 'catalog.json'), JSON.stringify(ICONS, null, 2) + '\n');
writeFileSync(join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Funtube SVG collection</title><style>
  :root{font-family:Arial,sans-serif;color:#dce8fc;background:#09162e;color-scheme:dark}body{margin:32px auto;padding:0 24px;max-width:1100px}h1{font-size:26px}p{color:#a7bddc}input{font:inherit;padding:12px;background:#102446;color:#eaf2ff;border:1px solid #48658d;width:min(400px,90%);margin-bottom:24px}.collection{display:grid;grid-template-columns:repeat(auto-fill,minmax(115px,1fr));gap:12px}a{display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 8px;min-height:102px;background:linear-gradient(145deg,#294971,#0d1d39);border:1px solid #46628b;color:inherit;text-decoration:none;font-size:12px;text-align:center}a:hover{border-color:#dad8a0;color:#fff0bb}svg{width:40px;height:40px;filter:drop-shadow(1px 2px 1px #000)}small{font-size:10px;color:#a7bddc}a[hidden]{display:none}
  </style><h1>Funtube SVG collection</h1><p>${ICONS.length} original icons · 32 × 32 · click an icon to download its SVG</p><input type="search" aria-label="Search icons" placeholder="Search by name or collection"><div class="collection">${ICONS.map((icon) => `<a href="${icon.id}.svg" download data-search="${escape(`${icon.label} ${icon.id} ${icon.family}`.toLowerCase())}">${artwork(icon)}<span>${escape(icon.label)}</span><small>${escape(icon.family)}</small></a>`).join('')}</div><script>document.querySelector('input').addEventListener('input',event=>{const query=event.target.value.trim().toLowerCase();document.querySelectorAll('[data-search]').forEach(icon=>icon.hidden=!icon.dataset.search.includes(query))})</script></html>\n`);
console.log(`Exported ${ICONS.length} SVGs and a browsable gallery to ${output}`);
