/* Service worker – Firmas Drywall Enterprise (offline) */
const CACHE = 'firmax-v6';
// Imprescindibles: si falla alguno, la instalación falla
const CORE = [
 "./",
 "./index.html",
 "./hoja.html",
 "./documento.html",
 "./share.js",
 "./manifest.webmanifest",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/maskable-192.png",
 "./icons/maskable-512.png",
 "./icons/apple-touch-icon.png",
 "./icons/logo.png",
 "./icons/firmas-logo.png",
 "./lib/pdf-lib.min.js",
 "./lib/pdfjs/pdf.min.mjs",
 "./lib/pdfjs/pdf.worker.min.mjs"
];
// Opcionales (fuentes/wasm de pdf.js): se intentan cachear, sin bloquear
const EXTRA = [
 "./lib/pdfjs/standard_fonts/FoxitDingbats.pfb",
 "./lib/pdfjs/standard_fonts/FoxitFixed.pfb",
 "./lib/pdfjs/standard_fonts/FoxitFixedBold.pfb",
 "./lib/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
 "./lib/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
 "./lib/pdfjs/standard_fonts/FoxitSerif.pfb",
 "./lib/pdfjs/standard_fonts/FoxitSerifBold.pfb",
 "./lib/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
 "./lib/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
 "./lib/pdfjs/standard_fonts/FoxitSymbol.pfb",
 "./lib/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
 "./lib/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
 "./lib/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
 "./lib/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
 "./lib/pdfjs/wasm/jbig2.wasm",
 "./lib/pdfjs/wasm/jbig2_nowasm_fallback.js",
 "./lib/pdfjs/wasm/openjpeg.wasm",
 "./lib/pdfjs/wasm/openjpeg_nowasm_fallback.js",
 "./lib/pdfjs/wasm/qcms_bg.wasm"
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).then(() =>
    Promise.all(EXTRA.map(u => c.add(u).catch(() => null))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('firmas-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Red primero (para recibir actualizaciones); sin conexión, la copia guardada
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('./index.html'))));
    return;
  }
  // Recursos: caché primero; lo nuevo (p. ej. cmaps de pdf.js) se guarda al usarse
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(r => r || fetch(req).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return res;
  })));
});
