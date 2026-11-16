// Convierte una carpeta con una web en una app instalable (PWA).
// Uso:  node add-pwa.js "C:\ruta\mi-web" "Nombre de la app" "#1a73e8"
// Añade: manifest.webmanifest, sw.js, icon-192.png, icon-512.png y las etiquetas en index.html.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [dir, nameArg, colorArg] = process.argv.slice(2);
if (!dir) {
  console.log('Uso: node add-pwa.js "<carpeta de la web>" ["Nombre de la app"] ["#color"]');
  process.exit(1);
}
const root = path.resolve(dir);
const indexPath = path.join(root, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error(`No encuentro index.html en ${root}. Indica la carpeta que contiene directamente el index.html.`);
  process.exit(1);
}
const color = /^#[0-9a-f]{6}$/i.test(colorArg || '') ? colorArg : '#1a73e8';
let html = fs.readFileSync(indexPath, 'utf8');
const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
const appName = (nameArg || (titleMatch && titleMatch[1].trim()) || path.basename(root) || 'Mi app').slice(0, 45);
const shortName = appName.slice(0, 12);

// ---- PNG sin librerías ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function makePng(size, hex) {
  const bg = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const c = size / 2, r = size * 0.27;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const inside = (x - c) ** 2 + (y - c) ** 2 <= r * r;
      const px = row + 1 + x * 4;
      const col = inside ? [255, 255, 255] : bg;
      raw[px] = col[0]; raw[px + 1] = col[1]; raw[px + 2] = col[2]; raw[px + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = [];
const write = (file, content, keepIfExists) => {
  const p = path.join(root, file);
  if (keepIfExists && fs.existsSync(p)) { out.push(`= ${file} (ya existía, lo respeto)`); return; }
  fs.writeFileSync(p, content); out.push(`+ ${file}`);
};

write('icon-192.png', makePng(192, color), true);
write('icon-512.png', makePng(512, color), true);

write('manifest.webmanifest', JSON.stringify({
  name: appName, short_name: shortName, start_url: './', scope: './', display: 'standalone',
  background_color: '#ffffff', theme_color: color,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
}, null, 2), !nameArg && !colorArg); // si repites sin indicar nombre/color, se respeta el manifiesto actual

write('sw.js', `const CACHE = 'app-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && new URL(e.request.url).origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
`);

// ---- Etiquetas en index.html ----
if (html.includes('data-pwa="1"')) {
  out.push('= index.html (ya tenía las etiquetas)');
} else {
  const tags = [
    '<link rel="manifest" href="manifest.webmanifest" data-pwa="1">',
    `<meta name="theme-color" content="${color}">`,
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    `<meta name="apple-mobile-web-app-title" content="${shortName}">`,
    '<link rel="apple-touch-icon" href="icon-192.png">',
    ...(/<meta[^>]+name=["']viewport["']/i.test(html) ? [] : ['<meta name="viewport" content="width=device-width, initial-scale=1">']),
    "<script>if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}</script>",
  ].map(t => '  ' + t).join('\n') + '\n';
  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, tags + '</head>');
  else html = '<head>\n' + tags + '</head>\n' + html;
  fs.writeFileSync(indexPath, html);
  out.push('~ index.html (etiquetas añadidas)');
}

console.log(out.join('\n'));
console.log(`\nListo: «${appName}» ya es instalable. Vuelve a subir la carpeta a tu hosting (con HTTPS) para que surta efecto.`);
