// Service worker: guarda los archivos de la app en el teléfono para que abra sin internet.
// Los libros NO pasan por aquí: viven en IndexedDB (js/almacen.js).

const CACHE = 'lector-v3';

// Todo lo necesario para arrancar sin conexión. Las rutas son relativas a este archivo.
const ARCHIVOS = [
  './', 'index.html', 'manifest.json',
  'css/estilos.css',
  'js/app.js', 'js/almacen.js', 'js/importar.js', 'js/texto.js', 'js/dom.js',
  'js/ajustes.js', 'js/biblioteca.js', 'js/gestos.js', 'js/panel-indice.js',
  'js/lector.js', 'js/formato-epub.js', 'js/formato-pdf.js', 'js/formato-doc.js',
  'js/colores.js', 'js/barra-seleccion.js', 'js/panel-busqueda.js', 'js/copia.js',
  'vendor/jszip.min.js', 'vendor/epub.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

// Al instalarse: descarga y guarda todos los archivos de la lista.
self.addEventListener('install', evento => {
  evento.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ARCHIVOS)));
  self.skipWaiting(); // no esperar a que se cierren las pestañas viejas
});

// Al activarse: borra cachés de versiones anteriores y toma el control de la página.
self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(nombres.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Cada petición: primero internet (así siempre ves la versión más nueva) y, si falla
// (sin conexión), lo guardado. Cada respuesta buena se vuelve a guardar.
// `cache: 'no-cache'` obliga al navegador a preguntar al servidor si el archivo cambió (si no cambió, responde
// "304" casi sin descargar nada); sin esto podría darnos una copia vieja que él mismo considera "fresca".
self.addEventListener('fetch', evento => {
  const peticion = evento.request;
  if (peticion.method !== 'GET' || new URL(peticion.url).origin !== location.origin) return;

  evento.respondWith(
    fetch(peticion, { cache: 'no-cache' })
      .then(respuesta => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then(cache => cache.put(peticion, copia));
        }
        return respuesta;
      })
      .catch(async () => {
        const guardada = await caches.match(peticion, { ignoreSearch: true });
        if (guardada) return guardada;
        if (peticion.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      })
  );
});
