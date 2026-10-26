// Formato PDF: lo dibuja pdf.js, una página a la vez.
// `pdfjsLib` es la variable global de vendor/pdf.min.js. Devuelve el "mando" que describe lector.js.
//
// El texto de un PDF está fijo en su página, así que aquí no hay tamaño ni tipo de letra: solo zoom
// (100 % = la hoja ajustada al ancho de la pantalla; en iPad horizontal, la hoja entera).
//
// Cada página se compone de tres capas apiladas:
//   1. un lienzo (canvas) con el dibujo de la página
//   2. una capa de "marcas": los rectángulos de los resaltados y de la búsqueda
//   3. una capa de texto invisible (la hace pdf.js) que permite seleccionar y copiar texto como en una web
import { ajustes } from './ajustes.js';
import { COLORES } from './colores.js';
import { crear } from './dom.js';
import { mapaDeTexto, rangoEn, plegar, encontrar } from './texto.js';

const DPR_MAXIMO = 2;              // más resolución que 2x no se nota y gasta memoria en el teléfono
const MAXIMO_RESULTADOS = 300;
const PANTALLA_GRANDE = 700;       // desde este ancho (px) y en horizontal se muestra la hoja entera

export async function abrirPdf(buffer, ficha, ctx) {
  // pdf.js se lleva este buffer a su hilo; no se necesita más (el original sigue guardado en IndexedDB).
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const total = pdf.numPages;

  // Contenedor con desplazamiento propio: si la página es más alta que la pantalla o se amplía, se desplaza dentro.
  const contenedor = document.createElement('div');
  contenedor.className = 'pdf-pagina';
  ctx.visor.replaceChildren(contenedor);

  let pagina = Math.min(total, Math.max(1, ficha.progreso?.destino?.pagina ?? 1));
  let tareaActual = null;  // dibujo en curso, para poder cancelarlo
  let tareaTexto = null;   // dibujo de la capa de texto en curso
  let turno = 0;           // numera los dibujos: si llega uno nuevo, el anterior se descarta
  let zoomDibujado = ajustes().zoom;

  let hoja = null;         // la página que se ve ahora (contiene las tres capas)
  let capaMarcas = null;
  let capaTexto = null;
  const resaltados = new Map(); // id -> { color, destino: { pagina, rects } }
  let consultaActiva = '';      // texto que se está buscando (se marca en cada página que se muestre)

  // ----- Dibujo de la página -----

  async function dibujar() {
    const miTurno = ++turno;
    tareaActual?.cancel();
    tareaTexto?.cancel();
    const hojaPdf = await pdf.getPage(pagina);
    if (miTurno !== turno) return;

    const ancho = contenedor.clientWidth;
    const alto = contenedor.clientHeight;
    if (!ancho) return; // pantalla oculta: no hay nada que dibujar todavía

    const medida = hojaPdf.getViewport({ scale: 1 });
    const ajusteAncho = ancho / medida.width;
    const ajusteAlto = alto / medida.height;
    // En una pantalla grande y apaisada (iPad) cabe la hoja entera; en el teléfono se ajusta al ancho y se desplaza.
    const hojaEntera = ancho >= PANTALLA_GRANDE && ancho > alto;
    const escala = (hojaEntera ? Math.min(ajusteAncho, ajusteAlto) : ajusteAncho) * (ajustes().zoom / 100);
    const densidad = Math.min(window.devicePixelRatio || 1, DPR_MAXIMO);
    const vistaCss = hojaPdf.getViewport({ scale: escala });             // tamaño en pantalla
    const vista = hojaPdf.getViewport({ scale: escala * densidad });     // tamaño del lienzo (más píxeles = más nítido)

    // Se dibuja en una hoja nueva y solo al terminar reemplaza a la anterior: así no hay parpadeo
    // y dos dibujos seguidos nunca comparten lienzo.
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.floor(vista.width);
    lienzo.height = Math.floor(vista.height);
    lienzo.style.width = '100%';
    lienzo.style.height = '100%';
    const nuevaHoja = crear('div', 'pdf-hoja');
    nuevaHoja.style.width = `${vistaCss.width}px`;
    nuevaHoja.style.height = `${vistaCss.height}px`;
    // La capa de texto de pdf.js da el tamaño de cada letra como "calc(var(--scale-factor) * 12px)": hay que
    // decirle cuánto está ampliada la página.
    nuevaHoja.style.setProperty('--scale-factor', vistaCss.scale);
    const nuevasMarcas = crear('div', 'pdf-marcas');
    nuevaHoja.append(lienzo, nuevasMarcas);

    tareaActual = hojaPdf.render({ canvasContext: lienzo.getContext('2d'), viewport: vista });
    try {
      await tareaActual.promise;
    } catch (error) {
      if (error?.name === 'RenderingCancelledException') return; // lo canceló un dibujo más nuevo
      throw error;
    }
    if (miTurno !== turno) return;

    contenedor.replaceChildren(nuevaHoja);
    contenedor.scrollTo(0, 0);
    hoja = nuevaHoja;
    capaMarcas = nuevasMarcas;
    capaTexto = null;
    zoomDibujado = ajustes().zoom;
    pintarResaltados();
    ctx.alMover();

    // La capa de texto se hace después, sin bloquear: la página ya se ve y se puede pasar a la siguiente.
    const capa = crear('div', 'textLayer');
    nuevaHoja.append(capa);
    tareaTexto = pdfjsLib.renderTextLayer({
      textContentSource: await hojaPdf.getTextContent(),
      container: capa,
      viewport: vistaCss,
      textDivs: [],
    });
    try {
      await tareaTexto.promise;
    } catch (error) {
      if (error?.name === 'AbortException' || error?.name === 'RenderingCancelledException') return;
      throw error;
    }
    if (miTurno !== turno) return;
    capaTexto = capa;
    pintarBusqueda();
  }

  function irAPagina(numero) {
    const destino = Math.min(total, Math.max(1, numero));
    if (destino === pagina) return;
    pagina = destino;
    return dibujar();
  }

  // Un destino del índice del PDF puede ser un nombre ("capitulo2") o ya una lista; en ambos casos
  // el primer elemento identifica la página.
  async function paginaDe(dest) {
    const lista = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!lista) return null;
    const ref = lista[0];
    return typeof ref === 'object' ? (await pdf.getPageIndex(ref)) + 1 : ref + 1;
  }

  // ----- Marcas (resaltados y búsqueda) -----
  // Los rectángulos se guardan como fracciones de la hoja (0 a 1), así valen con cualquier zoom o tamaño de pantalla.

  function rectangulo(c, clase, color) {
    const caja = crear('div', `marca ${clase}`);
    caja.style.left = `${Number(c.x) * 100}%`;
    caja.style.top = `${Number(c.y) * 100}%`;
    caja.style.width = `${Number(c.w) * 100}%`;
    caja.style.height = `${Number(c.h) * 100}%`;
    caja.style.backgroundColor = color;
    return caja;
  }

  function pintarResaltados() {
    if (!capaMarcas) return;
    capaMarcas.querySelectorAll('.marca-resaltado').forEach(n => n.remove());
    for (const r of resaltados.values()) {
      if (r.destino.pagina !== pagina) continue;
      for (const c of r.destino.rects) capaMarcas.append(rectangulo(c, 'marca-resaltado', COLORES[r.color]?.valor ?? '#ffd54a'));
    }
  }

  // Convierte un Range (texto de la capa de texto) en rectángulos relativos a la hoja.
  function rectsDe(rango) {
    const caja = hoja.getBoundingClientRect();
    if (!caja.width || !caja.height) return [];
    const rects = [...rango.getClientRects()]
      .filter(r => r.width > 1 && r.height > 1)
      .map(r => ({
        x: (r.left - caja.left) / caja.width,
        y: (r.top - caja.top) / caja.height,
        w: r.width / caja.width,
        h: r.height / caja.height,
      }));
    // Un mismo renglón puede dar dos rectángulos casi iguales (el del texto y el de su contenedor); al apilarse
    // oscurecerían el color. Se descarta el que se superpone casi por completo con otro ya aceptado.
    const unicos = [];
    for (const r of rects) {
      const repetido = unicos.some(u => {
        const ancho = Math.min(u.x + u.w, r.x + r.w) - Math.max(u.x, r.x);
        const alto = Math.min(u.y + u.h, r.y + r.h) - Math.max(u.y, r.y);
        return ancho > 0 && alto > 0 && (ancho * alto) / Math.min(u.w * u.h, r.w * r.h) > 0.7;
      });
      if (!repetido) unicos.push(r);
    }
    return unicos;
  }

  // Marca en naranja, en la página que se ve, todo lo que coincida con lo que se está buscando.
  function pintarBusqueda() {
    if (!capaMarcas) return;
    capaMarcas.querySelectorAll('.marca-busqueda').forEach(n => n.remove());
    if (!consultaActiva || !capaTexto) return;
    const mapa = mapaDeTexto(capaTexto);
    for (const h of encontrar(mapa, consultaActiva, 200)) {
      const rango = rangoEn(mapa, h.inicio, h.fin);
      if (rango) for (const c of rectsDe(rango)) capaMarcas.append(rectangulo(c, 'marca-busqueda', ''));
    }
  }

  // ----- Texto de las páginas (para buscar) -----
  const textos = new Map(); // número de página -> { texto, plegado }

  async function textoDe(numero) {
    if (!textos.has(numero)) {
      const hojaPdf = await pdf.getPage(numero);
      const contenido = await hojaPdf.getTextContent();
      const texto = contenido.items.map(i => (i.str ?? '') + (i.hasEOL ? '\n' : ' ')).join('');
      textos.set(numero, { texto, plegado: plegar(texto) });
    }
    return textos.get(numero);
  }

  // ----- Gestos y ajustes -----

  // Con el PDF ampliado, deslizar de lado debe mover la hoja, no pasar de página.
  ctx.conectarGestos(contenedor, true, { deslizarActivo: () => contenedor.scrollWidth <= contenedor.clientWidth + 1 });
  document.addEventListener('selectionchange', alCambiarSeleccion);
  function alCambiarSeleccion() {
    if (capaTexto?.contains(window.getSelection()?.anchorNode)) ctx.alSeleccionar();
  }

  // Si se gira el teléfono, el ancho cambia y hay que redibujar (con una pequeña espera para no hacerlo cien veces).
  let espera = null;
  const alRedimensionar = () => { clearTimeout(espera); espera = setTimeout(dibujar, 200); };
  window.addEventListener('resize', alRedimensionar);

  const aplicar = a => {
    contenedor.dataset.tema = a.tema; // el CSS tiñe la hoja según el tema (ver estilos.css)
    if (a.zoom !== zoomDibujado) dibujar();
  };
  aplicar(ajustes());
  await dibujar();

  return {
    paginado: true,
    soportaResaltado: true,
    aplicar,
    siguiente: () => irAPagina(pagina + 1),
    anterior: () => irAPagina(pagina - 1),

    posicion: () => ({
      destino: { pagina },
      porcentaje: pagina / total,
      etiqueta: `Página ${pagina} de ${total}`,
    }),

    contiene: marcador => marcador.destino.pagina === pagina,

    // Salta a un marcador, una entrada del índice, un resaltado o un resultado de búsqueda.
    async irA(destino) {
      if (destino.temporal) consultaActiva = destino.consulta;
      const numero = destino.pagina ?? await paginaDe(destino.dest);
      if (!numero) return;
      if (numero === pagina) pintarBusqueda(); else await irAPagina(numero);
    },

    // El índice de un PDF son sus "marcadores" internos (outline). Muchos PDF no traen ninguno.
    async indice() {
      const filas = [];
      (function recorrer(entradas, nivel) {
        for (const e of entradas ?? []) {
          filas.push({ titulo: (e.title ?? '').trim() || '(sin título)', nivel, destino: e.dest ? { dest: e.dest } : null });
          recorrer(e.items, nivel + 1);
        }
      })(await pdf.getOutline(), 0);
      return filas;
    },

    // ----- Selección y resaltados -----
    // Se guardan los rectángulos de las líneas seleccionadas (como fracción de la hoja) y el texto, para mostrarlo en la lista.
    seleccion() {
      const seleccion = window.getSelection();
      if (!hoja || !capaTexto || !seleccion?.rangeCount || seleccion.isCollapsed) return null;
      if (!capaTexto.contains(seleccion.anchorNode)) return null;
      const rects = rectsDe(seleccion.getRangeAt(0));
      const texto = seleccion.toString().replace(/\s+/g, ' ').trim();
      if (!rects.length || !texto) return null;
      return { destino: { pagina, rects }, texto, porcentaje: pagina / total };
    },
    limpiarSeleccion: () => window.getSelection().removeAllRanges(),

    resaltar(r) {
      resaltados.set(r.id, { color: r.color, destino: r.destino });
      pintarResaltados();
    },
    quitarResaltado(id) {
      resaltados.delete(id);
      pintarResaltados();
    },

    // ----- Búsqueda -----
    // Hay que sacar el texto de cada página, una por una (en un PDF largo tarda unos segundos);
    // se avisa del avance y se puede cancelar (control.vigente() pasa a false).
    async buscar(consulta, control) {
      const salida = [];
      for (let n = 1; n <= total && control.vigente() && salida.length < MAXIMO_RESULTADOS; n++) {
        const { texto, plegado } = await textoDe(n);
        for (const h of encontrar({ texto, plegado }, consulta, MAXIMO_RESULTADOS - salida.length)) {
          salida.push({
            antes: h.antes,
            dentro: h.dentro,
            despues: h.despues,
            lugar: `Pág. ${n}`,
            destino: { pagina: n, consulta, temporal: true },
          });
        }
        control.avance(n, total, salida);
      }
      return salida;
    },
    limpiarBusqueda() {
      consultaActiva = '';
      capaMarcas?.querySelectorAll('.marca-busqueda').forEach(n => n.remove());
    },

    cerrar() {
      turno++;
      clearTimeout(espera);
      window.removeEventListener('resize', alRedimensionar);
      document.removeEventListener('selectionchange', alCambiarSeleccion);
      tareaActual?.cancel();
      tareaTexto?.cancel();
      pdf.destroy();
    },
  };
}
