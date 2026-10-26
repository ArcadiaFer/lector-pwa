// Importar: toma un archivo elegido por el usuario y lo convierte en
//   meta   -> ficha del libro (título, autor, formato, portada, marcadores...)
//   buffer -> el contenido en bruto, listo para guardarse en IndexedDB
// `ePub` y `pdfjsLib` son variables globales que crean vendor/epub.min.js y vendor/pdf.min.js.
import { decodificar, datosHtml } from './texto.js';
import { nuevoId } from './almacen.js';

const FORMATOS = { epub: 'epub', pdf: 'pdf', txt: 'txt', html: 'html', htm: 'html' };
const ANCHO_PORTADA = 240;

export function formatoDe(nombre) {
  const extension = nombre.split('.').pop().toLowerCase();
  return FORMATOS[extension] ?? null;
}

export async function prepararLibro(archivo) {
  const formato = formatoDe(archivo.name);
  if (!formato) throw new Error('formato no soportado (usa EPUB, PDF, TXT o HTML)');

  const buffer = await archivo.arrayBuffer();

  // Ficha básica; el título provisional es el nombre del archivo sin extensión.
  // `progreso` (dónde ibas) se llena al leer; `marcadores` es la lista de páginas marcadas.
  const meta = {
    id: nuevoId(),
    formato,
    nombreArchivo: archivo.name,
    titulo: archivo.name.replace(/\.[^.]+$/, ''),
    autor: '',
    portada: null,
    agregado: Date.now(),
    progreso: null,
    marcadores: [],
  };

  // Cada formato puede aportar datos mejores: solo se usan los que vengan con contenido.
  let extra = {};
  if (formato === 'epub') extra = await metadatosEpub(buffer);
  if (formato === 'pdf') extra = await metadatosPdf(buffer);
  if (formato === 'html') extra = datosHtml(decodificar(buffer));
  for (const [campo, valor] of Object.entries(extra)) {
    if (valor) meta[campo] = valor;
  }
  return { meta, buffer };
}

// Un EPUB es un .zip con un archivo de metadatos; epub.js sabe leerlo.
async function metadatosEpub(buffer) {
  const libro = ePub(buffer);
  try {
    // Si el archivo no es un EPUB válido, evita quedarse esperando para siempre.
    const datos = await conLimite(libro.loaded.metadata, 10000, 'el EPUB no se pudo leer');
    let portada = null;
    try {
      portada = await reducirPortada(await libro.coverUrl());
    } catch {
      // sin portada: la biblioteca dibujará una de color
    }
    return { titulo: datos.title?.trim(), autor: datos.creator?.trim(), portada };
  } finally {
    libro.destroy();
  }
}

// Un PDF trae título y autor en su "info"; la portada es su primera página dibujada en pequeño.
async function metadatosPdf(buffer) {
  // pdf.js se queda con el buffer que se le da (se lo lleva a su hilo y deja vacío el original),
  // así que se le entrega una copia para poder guardar el original.
  const pdf = await conLimite(
    pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise,
    10000,
    'el PDF no se pudo leer',
  );
  try {
    const { info } = await pdf.getMetadata();
    let portada = null;
    try {
      const pagina = await pdf.getPage(1);
      const escala = ANCHO_PORTADA / pagina.getViewport({ scale: 1 }).width;
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(vista.width);
      lienzo.height = Math.round(vista.height);
      await pagina.render({ canvasContext: lienzo.getContext('2d'), viewport: vista }).promise;
      portada = lienzo.toDataURL('image/jpeg', 0.8);
    } catch {
      // sin portada: la biblioteca dibujará una de color
    }
    return { titulo: info?.Title?.trim(), autor: info?.Author?.trim(), portada };
  } finally {
    pdf.destroy();
  }
}

function conLimite(promesa, ms, mensaje) {
  return Promise.race([
    promesa,
    new Promise((_, fallo) => setTimeout(() => fallo(new Error(mensaje)), ms)),
  ]);
}

// Las portadas pueden pesar varios MB; se reducen a 240 px de ancho y se guardan como texto (data URL).
function reducirPortada(url) {
  return new Promise((ok, fallo) => {
    const imagen = new Image();
    imagen.onload = () => {
      const ancho = Math.min(ANCHO_PORTADA, imagen.naturalWidth);
      const alto = Math.round((imagen.naturalHeight * ancho) / imagen.naturalWidth);
      const lienzo = document.createElement('canvas');
      lienzo.width = ancho;
      lienzo.height = alto;
      lienzo.getContext('2d').drawImage(imagen, 0, 0, ancho, alto);
      ok(lienzo.toDataURL('image/jpeg', 0.8));
    };
    imagen.onerror = () => fallo(new Error('portada ilegible'));
    imagen.src = url;
  });
}
