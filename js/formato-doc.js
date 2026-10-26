// Formato TXT y HTML: se muestran en un iframe aislado con desplazamiento vertical.
// Devuelve el "mando" que describe lector.js.
import { ajustes, TEMAS, FUENTES } from './ajustes.js';
import { COLORES, COLOR_BUSQUEDA } from './colores.js';
import {
  decodificar, txtAHtml, limpiarHtml, armarDocumento,
  mapaDeTexto, rangoEn, desplazamientoDe, encontrar,
} from './texto.js';

// CSS del documento mostrado en el iframe. Se regenera con cada cambio de ajustes.
// Las reglas ::highlight(...) pintan los resaltados y el resultado de búsqueda (ver "Resaltados" más abajo).
function cssDocumento({ tema, tamano, fuente }) {
  const t = TEMAS[tema];
  const alfa = tema === 'oscuro' ? '66' : '88'; // transparencia del color: en fondo oscuro se necesita menos
  const resaltados = Object.entries(COLORES)
    .map(([nombre, c]) => `::highlight(r-${nombre}) { background-color: ${c.valor}${alfa}; }`)
    .join('\n    ');
  return `
    html { background: ${t.fondo}; }
    body { margin: 0 auto; padding: 12px 22px 48px; max-width: 40rem; color: ${t.texto};
           font: ${tamano}px/1.65 ${FUENTES[fuente]}; overflow-wrap: break-word; }
    p { margin: 0 0 1em; }
    h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 .6em; }
    img { max-width: 100%; height: auto; }
    a { color: inherit; }
    blockquote { margin: 1em 0 1em 1em; padding-left: 1em; border-left: 3px solid ${t.borde}; }
    pre { white-space: pre-wrap; }
    table { max-width: 100%; }
    ${resaltados}
    ::highlight(busqueda) { background-color: ${COLOR_BUSQUEDA}; color: #000; }`;
}

export async function abrirDocumento(buffer, ficha, ctx) {
  const texto = decodificar(buffer);
  const cuerpo = ficha.formato === 'txt' ? txtAHtml(texto) : limpiarHtml(texto);

  // sandbox="allow-same-origin" SIN allow-scripts: ningún script del libro puede ejecutarse,
  // pero esta página sí puede leer y estilar el contenido del iframe.
  const marco = document.createElement('iframe');
  marco.setAttribute('sandbox', 'allow-same-origin');
  const cargado = new Promise(ok => marco.addEventListener('load', ok, { once: true }));
  marco.srcdoc = armarDocumento(cuerpo);
  ctx.visor.replaceChildren(marco);
  await cargado;

  const doc = marco.contentDocument;
  const pantalla = doc.scrollingElement; // el elemento que se desplaza
  const mapa = mapaDeTexto(doc.body);    // todo el texto del libro, para resaltar y buscar

  // Los enlaces del libro no navegan (cargarían una web ajena dentro del lector);
  // solo se permiten los que saltan a otro punto del mismo libro (#nota).
  doc.addEventListener('click', evento => {
    const enlace = evento.target.closest('a');
    if (!enlace) return;
    evento.preventDefault();
    const destino = enlace.getAttribute('href') ?? '';
    if (destino.startsWith('#')) doc.getElementById(decodeURIComponent(destino.slice(1)))?.scrollIntoView();
  });
  ctx.conectarGestos(doc, false);
  doc.addEventListener('selectionchange', () => ctx.alSeleccionar());

  // Al cambiar el tamaño de letra el texto crece o se encoge; se conserva el punto de lectura
  // guardando en qué fracción del documento estabas y volviendo a ella.
  const aplicar = a => {
    const avance = pantalla.scrollTop / (pantalla.scrollHeight || 1);
    doc.getElementById('tema').textContent = cssDocumento(a);
    pantalla.scrollTop = avance * pantalla.scrollHeight;
  };
  aplicar(ajustes());

  // Se abre donde se quedó: la posición guardada es una fracción (0 a 1) del largo total.
  pantalla.scrollTop = (ficha.progreso?.destino?.fraccion ?? 0) * pantalla.scrollHeight;
  doc.addEventListener('scroll', () => ctx.alMover(), { passive: true });

  // ===== Resaltados =====
  // Se usa la "CSS Custom Highlight API" de Safari 17.2 o más nuevo: se le da una lista de selecciones (Range) y
  // el navegador las pinta con el color indicado en cssDocumento, SIN tocar el texto del libro. Cada resaltado se
  // guarda como dos números (dónde empieza y dónde termina en el texto completo).
  const registro = marco.contentWindow.CSS?.highlights;
  const Resaltado = marco.contentWindow.Highlight;
  const soportaResaltado = Boolean(registro && Resaltado);
  const resaltados = new Map(); // id -> { color, rango }

  function pintarResaltados() {
    if (!soportaResaltado) return;
    for (const color of Object.keys(COLORES)) {
      const rangos = [...resaltados.values()].filter(r => r.color === color).map(r => r.rango);
      if (rangos.length) registro.set(`r-${color}`, new Resaltado(...rangos));
      else registro.delete(`r-${color}`);
    }
  }

  const salto = () => marco.clientHeight * 0.9; // casi una pantalla, para no perder la línea de referencia
  return {
    paginado: false,
    soportaResaltado,
    aplicar,
    siguiente: () => marco.contentWindow.scrollBy({ top: salto(), behavior: 'smooth' }),
    anterior: () => marco.contentWindow.scrollBy({ top: -salto(), behavior: 'smooth' }),

    posicion() {
      const recorrible = pantalla.scrollHeight - pantalla.clientHeight;
      const porcentaje = recorrible > 0 ? pantalla.scrollTop / recorrible : 1;
      // Para reconocer el marcador en la lista se guarda el principio del texto que se ve en lo alto.
      const punto = doc.caretRangeFromPoint?.(marco.clientWidth / 2, 24);
      const nodo = punto?.startContainer;
      let frase = '';
      if (nodo?.nodeType === Node.TEXT_NODE) {
        const texto = nodo.textContent;
        let desde = punto.startOffset;
        // Si el punto cayó a mitad de una palabra, se avanza hasta la siguiente para no empezar cortado.
        while (desde > 0 && desde < texto.length && /\S/.test(texto[desde - 1]) && /\S/.test(texto[desde])) desde++;
        frase = texto.slice(desde, desde + 50).trim();
      }
      return {
        destino: { fraccion: pantalla.scrollTop / pantalla.scrollHeight },
        porcentaje,
        etiqueta: `${Math.round(porcentaje * 100)} %${frase ? ` · ${frase}…` : ''}`,
      };
    },

    // Un marcador está "en esta pantalla" si su fracción cae entre lo que se ve arriba y abajo.
    contiene(marcador) {
      const fraccion = marcador.destino.fraccion;
      if (fraccion === undefined) return false;
      const arriba = pantalla.scrollTop / pantalla.scrollHeight;
      const abajo = (pantalla.scrollTop + pantalla.clientHeight) / pantalla.scrollHeight;
      return fraccion >= arriba - 0.0005 && fraccion <= abajo;
    },

    // Salta a un marcador, una entrada del índice, un resaltado o un resultado de búsqueda.
    irA(destino) {
      if (destino.elemento) {
        destino.elemento.scrollIntoView();
      } else if (destino.inicio !== undefined) {
        const rango = rangoEn(mapa, destino.inicio, destino.fin);
        if (!rango) return;
        rango.startContainer.parentElement?.scrollIntoView({ block: 'center' });
        if (destino.temporal && soportaResaltado) registro.set('busqueda', new Resaltado(rango));
      } else {
        pantalla.scrollTop = destino.fraccion * pantalla.scrollHeight;
      }
    },

    // El índice se arma con los títulos (h1 a h4) que haya en el documento.
    async indice() {
      const titulos = [...doc.querySelectorAll('h1, h2, h3, h4')].filter(h => h.textContent.trim());
      if (!titulos.length) return [];
      const nivelMinimo = Math.min(...titulos.map(h => Number(h.tagName[1])));
      return titulos.map(h => ({
        titulo: h.textContent.trim().replace(/\s+/g, ' ').slice(0, 90),
        nivel: Number(h.tagName[1]) - nivelMinimo,
        destino: { elemento: h },
      }));
    },

    // ----- Selección y resaltados -----
    // El texto seleccionado ahora, ya convertido a posiciones numéricas (o null si no hay selección).
    seleccion() {
      const seleccion = doc.getSelection();
      if (!seleccion || !seleccion.rangeCount || seleccion.isCollapsed) return null;
      const rango = seleccion.getRangeAt(0);
      const inicio = desplazamientoDe(mapa, rango.startContainer, rango.startOffset, false);
      const fin = desplazamientoDe(mapa, rango.endContainer, rango.endOffset, true);
      if (inicio === null || fin === null || fin <= inicio) return null;
      const texto = mapa.texto.slice(inicio, fin).replace(/\s+/g, ' ').trim();
      if (!texto) return null;
      return { destino: { inicio, fin }, texto, porcentaje: inicio / (mapa.texto.length || 1) };
    },
    limpiarSeleccion: () => doc.getSelection().removeAllRanges(),

    resaltar(r) {
      const rango = rangoEn(mapa, r.destino.inicio, r.destino.fin);
      if (!rango) return;
      resaltados.set(r.id, { color: r.color, rango });
      pintarResaltados();
    },
    quitarResaltado(id) {
      resaltados.delete(id);
      pintarResaltados();
    },

    // ----- Búsqueda -----
    // El texto está entero en memoria, así que la búsqueda es inmediata.
    async buscar(consulta) {
      return encontrar(mapa, consulta).map(h => ({
        antes: h.antes,
        dentro: h.dentro,
        despues: h.despues,
        lugar: `${Math.round((h.inicio / (mapa.texto.length || 1)) * 100)} %`,
        destino: { inicio: h.inicio, fin: h.fin, temporal: true },
      }));
    },
    limpiarBusqueda: () => registro?.delete('busqueda'),

    cerrar: () => marco.remove(),
  };
}
