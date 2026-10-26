// Convierte archivos TXT y HTML en algo que se pueda mostrar de forma segura.
// Los libros TXT se transforman a HTML sencillo para usar el mismo visor que los HTML.

// Los .txt hechos en Windows suelen venir en windows-1252, no en UTF-8.
// Si se leyeran como UTF-8 saldría "Ã±" en vez de "ñ". Primero se intenta UTF-8 estricto
// (falla si encuentra bytes inválidos) y, si falla, se usa windows-1252.
export function decodificar(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

const escapar = texto => texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Un TXT no tiene títulos, así que se adivinan: una línea corta que sea "Capítulo 3", "Parte II",
// "Chapter 5: Algo", "Prólogo"... Se exige un número después de la palabra para no confundirlo
// con una frase normal que empiece por "Parte" o "Libro".
const NUMERO = '(?:\\d+|[ivxlcdm]+|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten)';
const ES_TITULO = new RegExp(
  `^(?:(?:cap[ií]tulo|parte|libro|chapter|part|book)\\s+${NUMERO}|(?:pr[oó]logo|ep[ií]logo|introducci[oó]n|prologue|epilogue|introduction))\\s*(?:[.:\\-–—]\\s*.{0,60})?$`,
  'i',
);

// TXT -> párrafos <p> (y <h2> para los títulos detectados).
// Hay dos estilos de TXT: (a) párrafos separados por línea en blanco y renglones cortados a mano
// (libros del Proyecto Gutenberg) y (b) un párrafo por línea. Se detecta cuál es y en el caso (a)
// se unen los renglones cortados para que el texto se reajuste al ancho de la pantalla.
export function txtAHtml(texto) {
  const limpio = texto.replace(/\r\n?/g, '\n').trim();
  const hayLineasEnBlanco = /\n\s*\n/.test(limpio);
  const bloques = hayLineasEnBlanco ? limpio.split(/\n\s*\n/) : limpio.split('\n');
  return bloques
    .map(bloque => bloque.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map(bloque => {
      const etiqueta = ES_TITULO.test(bloque) ? 'h2' : 'p';
      return `<${etiqueta}>${escapar(bloque)}</${etiqueta}>`;
    })
    .join('\n');
}

// Saca título y autor de un HTML. DOMParser crea un documento "muerto":
// no ejecuta scripts ni descarga imágenes, solo permite leerlo.
export function datosHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    titulo: doc.title.trim(),
    autor: doc.querySelector('meta[name="author"]')?.content.trim() ?? '',
  };
}

// Deja solo el contenido del HTML: quita scripts, estilos del autor (para que mande nuestro tema),
// marcos incrustados y similares. Es una capa más; la protección fuerte es el iframe aislado de lector.js.
export function limpiarHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, link, iframe, object, embed, base, meta').forEach(n => n.remove());
  doc.querySelectorAll('[style]').forEach(n => n.removeAttribute('style'));
  return doc.body.innerHTML;
}

// Arma el documento completo que se mete en el iframe.
// La regla Content-Security-Policy prohíbe cargar NADA externo (imágenes remotas, fuentes, rastreadores);
// solo se permiten imágenes incrustadas (data:). <style id="tema"> lo rellena lector.js.
export function armarDocumento(cuerpo) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style id="tema"></style>
</head><body>${cuerpo}</body></html>`;
}

// ===== Posiciones y búsqueda dentro de un documento =====
// Un "mapa de texto" junta todo el texto de un documento en una sola cadena y recuerda en qué punto de ella
// empieza cada nodo de texto. Así una posición se puede guardar como un simple número ("del carácter 1200
// al 1250") y volver a convertir en una selección real del documento, sea TXT, HTML o un capítulo de EPUB.

// Para buscar sin distinguir mayúsculas ni acentos ("canción" encuentra "CANCION"). Se conserva el largo
// del texto (cada carácter se cambia por otro), porque las posiciones tienen que seguir coincidiendo.
export function plegar(texto) {
  const plegado = texto.toLowerCase().replace(/[À-ɏ]/g, c => c.normalize('NFD')[0]);
  return plegado.length === texto.length ? plegado : texto;
}

export function mapaDeTexto(raiz) {
  const nodos = [];
  const partes = [];
  let largo = 0;
  const paseo = raiz.ownerDocument.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let nodo = paseo.nextNode(); nodo; nodo = paseo.nextNode()) {
    nodos.push({ nodo, inicio: largo });
    partes.push(nodo.nodeValue);
    largo += nodo.nodeValue.length;
  }
  const texto = partes.join('');
  return { nodos, texto, plegado: plegar(texto), indice: new Map(nodos.map(n => [n.nodo, n.inicio])) };
}

// De una posición numérica al nodo de texto que la contiene (búsqueda binaria entre los nodos).
function ubicar(mapa, posicion, esFinal) {
  const p = esFinal ? posicion - 1 : posicion; // un final "exclusivo" pertenece al carácter anterior
  let bajo = 0;
  let alto = mapa.nodos.length - 1;
  while (bajo < alto) {
    const medio = (bajo + alto + 1) >> 1;
    if (mapa.nodos[medio].inicio <= p) bajo = medio; else alto = medio - 1;
  }
  const { nodo, inicio } = mapa.nodos[bajo];
  return { nodo, desplazamiento: Math.min(p - inicio + (esFinal ? 1 : 0), nodo.nodeValue.length) };
}

// De dos posiciones numéricas a un Range (una selección) del documento.
export function rangoEn(mapa, inicio, fin) {
  if (!mapa.nodos.length) return null;
  const a = ubicar(mapa, inicio, false);
  const b = ubicar(mapa, fin, true);
  const rango = mapa.nodos[0].nodo.ownerDocument.createRange();
  rango.setStart(a.nodo, a.desplazamiento);
  rango.setEnd(b.nodo, b.desplazamiento);
  return rango;
}

// Al revés: de un punto de la selección (nodo + posición dentro de él) a una posición numérica.
export function desplazamientoDe(mapa, nodo, indice, esFinal) {
  if (nodo.nodeType === Node.TEXT_NODE) {
    const base = mapa.indice.get(nodo);
    return base === undefined ? null : base + indice;
  }
  // A veces el punto cae "entre elementos" (p. ej. al seleccionar un párrafo entero): se usa el texto más cercano.
  const punto = nodo.ownerDocument.createRange();
  punto.setStart(nodo, indice);
  punto.collapse(true);
  if (esFinal) {
    for (let i = mapa.nodos.length - 1; i >= 0; i--) {
      const { nodo: n, inicio } = mapa.nodos[i];
      if (punto.comparePoint(n, n.nodeValue.length) <= 0) return inicio + n.nodeValue.length;
    }
    return 0;
  }
  for (const { nodo: n, inicio } of mapa.nodos) {
    if (punto.comparePoint(n, 0) >= 0) return inicio;
  }
  return mapa.texto.length;
}

// Un trozo de texto alrededor de [inicio, fin), partido en tres para poder poner en negrita lo encontrado.
export function extracto(texto, inicio, fin, margen = 40) {
  const limpiar = s => s.replace(/\s+/g, ' ');
  return {
    antes: (inicio > margen ? '…' : '') + limpiar(texto.slice(Math.max(0, inicio - margen), inicio)).trimStart(),
    dentro: limpiar(texto.slice(inicio, fin)),
    despues: limpiar(texto.slice(fin, fin + margen)).trimEnd() + (fin + margen < texto.length ? '…' : ''),
  };
}

// Todas las apariciones de `consulta` (hasta `maximo`) en un mapa de texto: [{ inicio, fin, antes, dentro, despues }].
export function encontrar(mapa, consulta, maximo = 300) {
  const buscada = plegar(consulta.trim());
  if (buscada.length < 2) return [];
  const salida = [];
  let desde = 0;
  while (salida.length < maximo) {
    const posicion = mapa.plegado.indexOf(buscada, desde);
    if (posicion < 0) break;
    const fin = posicion + buscada.length;
    salida.push({ inicio: posicion, fin, ...extracto(mapa.texto, posicion, fin) });
    desde = fin;
  }
  return salida;
}
