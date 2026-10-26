// Formato EPUB: lo dibuja epub.js, por páginas. `ePub` es la variable global de vendor/epub.min.js.
// Devuelve el "mando" que describe lector.js.
import { ajustes, TEMAS, FUENTES } from './ajustes.js';
import { COLORES, COLOR_BUSQUEDA } from './colores.js';
import { mapaDeTexto, rangoEn, encontrar } from './texto.js';

const MAXIMO_RESULTADOS = 300;

// Reglas CSS que epub.js inyecta dentro de cada capítulo. El !important es para ganarle a los estilos del
// propio libro (muchos EPUB fijan texto negro, que sería ilegible en el tema oscuro).
function reglasEpub(t) {
  return {
    'html, body': { background: `${t.fondo} !important` },
    'body': { 'line-height': '1.6 !important' },
    'body *': { color: `${t.texto} !important`, 'background-color': 'transparent !important' },
    // El tamaño y la letra se fijan en <body> (ver aplicar); estas reglas hacen que los párrafos
    // los hereden en vez de usar los del libro (p. ej. "p { font-size: 14px }").
    'p, li, blockquote, td, th, dd, dt, div, span, a, em, strong, i, b': {
      'font-size': '1em !important',
      'font-family': 'inherit !important',
    },
    'h1, h2, h3, h4, h5, h6': { 'font-family': 'inherit !important' },
  };
}

// El índice del EPUB es un árbol (capítulos con subcapítulos). Se aplana a una lista con "nivel"
// para dibujarlo con sangría.
function aplanar(entradas, nivel = 0) {
  return entradas.flatMap(e => [
    { titulo: e.label.trim(), nivel, destino: { href: e.href } },
    ...aplanar(e.subitems ?? [], nivel + 1),
  ]);
}

// ¿Dos direcciones apuntan al mismo archivo? (se ignora lo que va después de "#")
function mismoArchivo(a, b) {
  const archivo = s => s.split('#')[0];
  return archivo(a) !== '' && (archivo(a).endsWith(archivo(b)) || archivo(b).endsWith(archivo(a)));
}

// Los resaltados de epub.js son rectángulos SVG dibujados encima del texto. En fondo claro se "multiplican" con
// el texto (como un marcador de tinta); en fondo oscuro eso no se vería, así que se usan semitransparentes.
function estiloResaltado(valor, tema) {
  const oscuro = tema === 'oscuro';
  return { fill: valor, 'fill-opacity': oscuro ? '0.45' : '0.4', 'mix-blend-mode': oscuro ? 'normal' : 'multiply' };
}

export async function abrirEpub(buffer, ficha, ctx) {
  const libro = ePub(buffer);
  // `spread: 'auto'` muestra dos páginas lado a lado cuando la pantalla mide al menos 900 px de ancho
  // (iPad horizontal, o un iPad Pro grande en vertical); por debajo, una sola página (el CSS limita su ancho).
  const rend = libro.renderTo(ctx.visor, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'auto',
    minSpreadWidth: 900,
  });

  // Se registra un tema de epub.js por cada tema de la app.
  for (const [nombre, t] of Object.entries(TEMAS)) rend.themes.register(nombre, reglasEpub(t));

  // Este gancho se ejecuta cada vez que epub.js carga un capítulo nuevo en un iframe.
  rend.hooks.content.register(contenido => {
    ctx.conectarGestos(contenido.document, true);
    contenido.document.addEventListener('selectionchange', () => ctx.alSeleccionar());
  });
  rend.on('relocated', () => ctx.alMover()); // cada cambio de página avisa al lector

  let indice = [];
  libro.loaded.navigation.then(nav => { indice = aplanar(nav.toc); }).catch(() => {});
  const capituloDe = href => indice.find(e => mismoArchivo(e.destino.href, href))?.titulo;

  // epub.js da como "inicio de la página" el principio del PÁRRAFO donde empieza, aunque la página empiece a
  // mitad de él (y ese párrafo puede venir de varias páginas atrás). Para volver exactamente a la misma página
  // se calcula la dirección (cfi) del primer renglón visible: se pregunta qué letra hay junto a la esquina
  // superior izquierda de la página.
  function inicioExacto() {
    try {
      const borde = ctx.visor.getBoundingClientRect().left;
      for (const contenido of rend.getContents()) {
        const marco = contenido.document.defaultView.frameElement;
        const caja = marco.getBoundingClientRect();
        const x = borde - caja.left + 24; // la misma posición, pero medida desde el borde del iframe
        if (x < 0 || x > caja.width) continue; // este iframe es otro capítulo (precargado), no el que se ve
        const rango = contenido.document.caretRangeFromPoint(x, 30);
        if (rango) return contenido.cfiFromRange(rango);
      }
    } catch {
      // si algo falla se usa la dirección aproximada de epub.js
    }
    return null;
  }

  // ===== Resaltados =====
  const resaltados = new Map(); // id -> { cfiRange, color }
  let temaActual = ajustes().tema;
  let marcaBusqueda = null;     // cfiRange del resultado de búsqueda que está marcado

  const pintarResaltado = (id, { cfiRange, color }) =>
    rend.annotations.highlight(cfiRange, { id }, null, `resaltado-${id}`, estiloResaltado(COLORES[color]?.valor ?? '#ffd54a', temaActual));

  // Cambiar el tema cambia el estilo de los resaltados: se quitan y se vuelven a poner.
  function repintarResaltados() {
    for (const [id, r] of resaltados) {
      rend.annotations.remove(r.cfiRange, 'highlight');
      pintarResaltado(id, r);
    }
  }

  // Cambiar tamaño o letra reparte el texto en páginas distintas. Se anota dónde estabas (cfi = dirección
  // del punto de lectura dentro del libro) y se vuelve a ese punto después del cambio.
  let previo = null; // la primera vez (antes de mostrar el libro) no hay punto de lectura que conservar
  const aplicar = a => {
    const reflujo = previo && (a.tamano !== previo.tamano || a.fuente !== previo.fuente);
    const cfi = reflujo ? (inicioExacto() ?? rend.currentLocation()?.start?.cfi) : null;
    rend.themes.select(a.tema);
    rend.themes.fontSize(`${a.tamano}px`);
    rend.themes.font(FUENTES[a.fuente]);
    if (cfi) rend.display(cfi);
    if (a.tema !== temaActual) {
      temaActual = a.tema;
      repintarResaltados();
    }
    previo = a;
  };
  aplicar(ajustes());

  // Se abre en la página donde se quedó; si esa dirección ya no sirve, al principio.
  try {
    await rend.display(ficha.progreso?.destino?.cfi);
  } catch {
    await rend.display();
  }

  function quitarMarcaBusqueda() {
    if (marcaBusqueda) rend.annotations.remove(marcaBusqueda, 'highlight');
    marcaBusqueda = null;
  }

  return {
    paginado: true,
    soportaResaltado: true,
    aplicar,
    siguiente: () => rend.next(),
    anterior: () => rend.prev(),

    posicion() {
      const lugar = rend.currentLocation();
      if (!lugar?.start) return null;
      const { cfi, index, displayed, href } = lugar.start;
      // Progreso aproximado: capítulo actual + fracción de capítulo, entre el total de capítulos.
      const porcentaje = (index + (displayed.page - 1) / (displayed.total || 1)) / libro.spine.length;
      return {
        destino: { cfi: inicioExacto() ?? cfi },
        porcentaje,
        etiqueta: `${capituloDe(href) ?? `Sección ${index + 1}`} · ${Math.round(porcentaje * 100)} %`,
      };
    },

    // Un marcador está "en esta página" si su dirección cae entre el inicio y el final de lo que se ve.
    contiene(marcador) {
      const lugar = rend.currentLocation();
      if (!lugar?.start || !marcador.destino.cfi) return false;
      try {
        const cfi = new ePub.CFI();
        return cfi.compare(inicioExacto() ?? lugar.start.cfi, marcador.destino.cfi) <= 0
            && cfi.compare(marcador.destino.cfi, lugar.end.cfi) <= 0;
      } catch {
        return false;
      }
    },

    // Salta a un marcador, una entrada del índice, un resaltado o un resultado de búsqueda.
    async irA(destino) {
      quitarMarcaBusqueda();
      await rend.display(destino.cfiRange ?? destino.cfi ?? destino.href);
      if (destino.temporal && destino.cfiRange) {
        marcaBusqueda = destino.cfiRange;
        rend.annotations.highlight(marcaBusqueda, {}, null, 'busqueda', estiloResaltado(COLOR_BUSQUEDA, 'claro'));
      }
    },

    async indice() {
      await libro.loaded.navigation;
      return indice;
    },

    // ----- Selección y resaltados -----
    // epub.js identifica un texto seleccionado con un "cfiRange" (dirección de inicio y de final dentro del libro).
    seleccion() {
      for (const contenido of rend.getContents()) {
        const seleccion = contenido.window.getSelection();
        if (!seleccion || !seleccion.rangeCount || seleccion.isCollapsed) continue;
        const texto = seleccion.toString().replace(/\s+/g, ' ').trim();
        if (!texto) continue;
        return {
          destino: { cfiRange: contenido.cfiFromRange(seleccion.getRangeAt(0)) },
          texto,
          porcentaje: this.posicion()?.porcentaje ?? 0,
        };
      }
      return null;
    },
    limpiarSeleccion() {
      for (const contenido of rend.getContents()) contenido.window.getSelection().removeAllRanges();
    },

    resaltar(r) {
      const datos = { cfiRange: r.destino.cfiRange, color: r.color };
      resaltados.set(r.id, datos);
      pintarResaltado(r.id, datos);
    },
    quitarResaltado(id) {
      const r = resaltados.get(id);
      if (!r) return;
      rend.annotations.remove(r.cfiRange, 'highlight');
      resaltados.delete(id);
    },

    // ----- Búsqueda -----
    // Un EPUB son muchos capítulos (archivos) que hay que abrir de uno en uno; en un libro largo tarda unos
    // segundos, por eso se va avisando del avance y se puede cancelar (control.vigente() pasa a false).
    async buscar(consulta, control) {
      const secciones = libro.spine.spineItems;
      const salida = [];
      for (let i = 0; i < secciones.length && control.vigente() && salida.length < MAXIMO_RESULTADOS; i++) {
        const seccion = secciones[i];
        try {
          await seccion.load(libro.load.bind(libro));
          const cuerpo = seccion.document?.body;
          if (cuerpo) {
            const mapa = mapaDeTexto(cuerpo);
            for (const h of encontrar(mapa, consulta, MAXIMO_RESULTADOS - salida.length)) {
              const rango = rangoEn(mapa, h.inicio, h.fin);
              salida.push({
                antes: h.antes,
                dentro: h.dentro,
                despues: h.despues,
                lugar: capituloDe(seccion.href) ?? `Sección ${i + 1}`,
                destino: { cfiRange: seccion.cfiFromRange(rango), temporal: true },
              });
            }
          }
        } finally {
          seccion.unload(); // libera la memoria del capítulo
        }
        control.avance(i + 1, secciones.length, salida);
      }
      return salida;
    },
    limpiarBusqueda: quitarMarcaBusqueda,

    cerrar: () => { rend.destroy(); libro.destroy(); },
  };
}
