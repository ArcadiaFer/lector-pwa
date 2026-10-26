// Lector: coordina la lectura de un libro, sea del formato que sea.
// Cada formato (formato-epub.js, formato-pdf.js, formato-doc.js) sabe dibujarse a sí mismo y devuelve un "mando":
//   paginado            true si se pasa de página (EPUB, PDF); false si se desplaza (TXT, HTML)
//   soportaResaltado    false si el formato o el navegador no pueden resaltar
//   aplicar(a)          repinta con los ajustes nuevos
//   siguiente(), anterior()
//   posicion()          dónde va el lector ahora: { destino, porcentaje, etiqueta } (el destino se puede guardar)
//   contiene(m)         ¿el marcador m está en lo que se ve ahora?
//   irA(destino)        salta a un marcador, una entrada del índice, un resaltado o un resultado de búsqueda
//   indice()            lista [{ titulo, nivel, destino }]
//   seleccion()         el texto seleccionado ahora: { destino, texto, porcentaje } o null
//   limpiarSeleccion()
//   resaltar(r), quitarResaltado(id)
//   buscar(consulta, control)   lista [{ antes, dentro, despues, lugar, destino }]
//   limpiarBusqueda()
//   cerrar()
// Este módulo se ocupa de lo común: guardar dónde vas, marcadores, resaltados, búsqueda, paneles, barras y toques.
import { obtenerLibro, obtenerArchivo, actualizarLibro, nuevoId } from './almacen.js';
import { alCambiar } from './ajustes.js';
import { conectarGestos, conectarTeclas } from './gestos.js';
import { crearPanelIndice } from './panel-indice.js';
import { crearPanelBusqueda } from './panel-busqueda.js';
import { crearBarraSeleccion } from './barra-seleccion.js';
import { abrirEpub } from './formato-epub.js';
import { abrirPdf } from './formato-pdf.js';
import { abrirDocumento } from './formato-doc.js';

const $ = id => document.getElementById(id);

const ABRIDORES = { epub: abrirEpub, pdf: abrirPdf, txt: abrirDocumento, html: abrirDocumento };
const ESPERA_GUARDADO = 800;    // ms sin moverte antes de guardar dónde vas
const ESPERA_SELECCION = 250;   // ms de selección quieta antes de mostrar la barra de colores

let abierto = null;          // el mando del libro que se está leyendo
let ficha = null;            // sus datos (título, marcadores, resaltados, progreso...)
let dejarDeEscuchar = null;  // para dejar de recibir cambios de ajustes al cerrar
let turno = 0;               // número de apertura: detecta si el usuario salió mientras el libro cargaba
let temporizador = null;     // guardado de progreso pendiente

// ===== Abrir y cerrar =====

export async function abrir(id) {
  await cerrar();
  const miTurno = ++turno;

  // Se vuelve a leer la ficha de la base de datos para tener el progreso, marcadores y resaltados más recientes.
  const [datos, buffer] = await Promise.all([obtenerLibro(id), obtenerArchivo(id)]);
  if (!datos || !buffer) throw new Error('No se encontró el archivo de este libro.');

  $('titulo-lector').textContent = datos.titulo;
  $('lector').dataset.formato = datos.formato; // el CSS oculta controles que un formato no usa (p. ej. la letra en PDF)
  $('lector').classList.remove('sin-barras');

  const libro = await ABRIDORES[datos.formato](buffer, datos, contexto);

  if (miTurno !== turno) { libro.cerrar(); return; } // mientras cargaba, el usuario ya volvió atrás
  abierto = libro;
  ficha = { ...datos, marcadores: datos.marcadores ?? [], resaltados: datos.resaltados ?? [] };
  dejarDeEscuchar = alCambiar(libro.aplicar);        // si cambian tema/tamaño/letra, se repinta
  for (const r of ficha.resaltados) libro.resaltar(r);
  alMover();
}

// Devuelve una promesa: espera a que termine de guardarse dónde ibas antes de cerrar del todo.
export async function cerrar() {
  turno++;
  const guardado = guardarProgreso(); // primero guardar, mientras el libro sigue abierto
  dejarDeEscuchar?.();
  dejarDeEscuchar = null;
  abierto?.limpiarBusqueda();
  abierto?.cerrar();
  abierto = null;
  ficha = null;
  $('visor').replaceChildren();
  mostrarPanel(null);
  panelBusqueda.reiniciar();
  ocultarBarraSeleccion();
  await guardado;
}

// Lo que cada formato necesita de este módulo.
const contexto = {
  visor: $('visor'),
  alMover: () => alMover(),
  alSeleccionar: () => alSeleccionar(),
  // `extra` permite a un formato afinar el comportamiento (el PDF ampliado desactiva el deslizamiento).
  conectarGestos: (objetivo, paginado, extra = {}) => conectarGestos(objetivo, {
    alTocar,
    siguiente: () => abierto?.siguiente(),
    anterior: () => abierto?.anterior(),
    paginado,
    atajos: ATAJOS,
    ...extra,
  }),
};

// ===== Dónde ibas =====

// Se llama cada vez que el lector se mueve (página nueva, desplazamiento...).
function alMover() {
  if (!abierto) return;
  actualizarBotonMarcador();
  clearTimeout(temporizador);
  temporizador = setTimeout(guardarProgreso, ESPERA_GUARDADO); // se espera a que pares para no guardar en cada píxel
}

async function guardarProgreso() {
  clearTimeout(temporizador);
  temporizador = null;
  const posicion = abierto?.posicion();
  if (!posicion || !ficha) return;
  ficha.progreso = { destino: posicion.destino, porcentaje: posicion.porcentaje, fecha: Date.now() };
  await actualizarLibro(ficha.id, { progreso: ficha.progreso });
}

// En el iPhone y el iPad, al cambiar de app la página puede cerrarse sin avisar: se guarda en cuanto se oculta.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') guardarProgreso();
});
window.addEventListener('pagehide', () => guardarProgreso());

// ===== Marcadores =====

function actualizarBotonMarcador() {
  if (!abierto || !ficha) return;
  const marcado = ficha.marcadores.some(m => abierto.contiene(m));
  $('btn-marcador').setAttribute('aria-pressed', marcado);
}

// El ícono de la barra: si ya hay un marcador en lo que ves, lo quita; si no, lo crea.
export async function alternarMarcador() {
  if (!abierto || !ficha) return;
  const aqui = ficha.marcadores.filter(m => abierto.contiene(m));
  if (aqui.length) {
    ficha.marcadores = ficha.marcadores.filter(m => !aqui.includes(m));
  } else {
    const posicion = abierto.posicion();
    if (!posicion) return;
    ficha.marcadores = [...ficha.marcadores, {
      id: nuevoId(),
      destino: posicion.destino,
      porcentaje: posicion.porcentaje,
      etiqueta: posicion.etiqueta,
      creado: Date.now(),
    }];
  }
  actualizarBotonMarcador();
  panelIndice.refrescar();
  await actualizarLibro(ficha.id, { marcadores: ficha.marcadores });
}

async function borrarMarcador(id) {
  ficha.marcadores = ficha.marcadores.filter(m => m.id !== id);
  actualizarBotonMarcador();
  await actualizarLibro(ficha.id, { marcadores: ficha.marcadores });
}

// ===== Resaltados =====

const barraSeleccion = crearBarraSeleccion($('barra-seleccion'), {
  alElegir: color => resaltarSeleccion(color),
  alCancelar: () => cancelarSeleccion(),
});
let seleccionPendiente = null; // lo que se resaltaría al tocar un color (una "foto" tomada al aparecer la barra)
let temporizadorSeleccion = null;

// Los formatos avisan cada vez que cambia la selección. Mientras se arrastran las asas cambia muchas veces por
// segundo, así que se espera a que se quede quieta un momento antes de mostrar la barra.
function alSeleccionar() {
  clearTimeout(temporizadorSeleccion);
  temporizadorSeleccion = setTimeout(() => {
    if (!abierto || barraSeleccion.tocada()) return; // tocar la barra puede hacer parpadear la selección
    const seleccion = abierto.soportaResaltado ? abierto.seleccion() : null;
    seleccionPendiente = seleccion;
    barraSeleccion.mostrar(Boolean(seleccion));
  }, ESPERA_SELECCION);
}

function ocultarBarraSeleccion() {
  clearTimeout(temporizadorSeleccion);
  seleccionPendiente = null;
  barraSeleccion.mostrar(false);
}

function cancelarSeleccion() {
  ocultarBarraSeleccion();
  abierto?.limpiarSeleccion();
}

async function resaltarSeleccion(color) {
  const seleccion = seleccionPendiente;
  if (!seleccion || !ficha) return;
  const resaltado = {
    id: nuevoId(),
    color,
    destino: seleccion.destino,
    texto: seleccion.texto.slice(0, 300),
    porcentaje: seleccion.porcentaje,
    creado: Date.now(),
  };
  ficha.resaltados = [...ficha.resaltados, resaltado];
  abierto.resaltar(resaltado);
  cancelarSeleccion();
  panelIndice.refrescar();
  await actualizarLibro(ficha.id, { resaltados: ficha.resaltados });
}

async function borrarResaltado(id) {
  ficha.resaltados = ficha.resaltados.filter(r => r.id !== id);
  abierto.quitarResaltado(id);
  await actualizarLibro(ficha.id, { resaltados: ficha.resaltados });
}

// ===== Paneles (ajustes, índice y búsqueda) =====

const panelIndice = crearPanelIndice($('panel-indice'), {
  cargarIndice: () => abierto.indice(),
  marcadores: () => ficha?.marcadores ?? [],
  resaltados: () => ficha?.resaltados ?? [],
  alElegir: destino => { mostrarPanel(null); abierto?.irA(destino); },
  alBorrar: (tipo, id) => (tipo === 'marcador' ? borrarMarcador(id) : borrarResaltado(id)),
});

const panelBusqueda = crearPanelBusqueda($('panel-busqueda'), {
  buscar: (consulta, control) => abierto.buscar(consulta, control),
  // Al elegir un resultado el panel se esconde (taparía el texto), pero la marca queda en la página
  // y la lista se conserva por si se quiere ir a otro resultado.
  alElegir: destino => { mostrarPanel(null); abierto?.irA(destino); },
  alLimpiar: () => abierto?.limpiarBusqueda(),
});

const PANELES = { ajustes: 'panel-ajustes', indice: 'panel-indice', busqueda: 'panel-busqueda' };

// Solo un panel a la vez: 'ajustes', 'indice', 'busqueda' o null (ninguno).
function mostrarPanel(nombre) {
  for (const [clave, id] of Object.entries(PANELES)) $(id).hidden = clave !== nombre;
}
const hayPanel = () => Object.values(PANELES).some(id => !$(id).hidden);

export function alternarAjustes() {
  mostrarPanel($('panel-ajustes').hidden ? 'ajustes' : null);
}

export function alternarIndice() {
  if ($('panel-indice').hidden) { mostrarPanel('indice'); panelIndice.abrir(); } else mostrarPanel(null);
}

// `abrirSiempre` lo usa el atajo Cmd/Ctrl+F: si ya está abierto, solo vuelve a enfocar la caja de texto.
export function alternarBusqueda(abrirSiempre = false) {
  if (!abierto) return;
  if (!$('panel-busqueda').hidden && !abrirSiempre) { mostrarPanel(null); return; }
  mostrarPanel('busqueda');
  panelBusqueda.enfocar(); // dentro del gesto del usuario, para que iOS abra el teclado
}

// ===== Toques y teclas =====

// Tocar la pantalla: el 30 % izquierdo retrocede, el 30 % derecho avanza, el centro muestra/oculta la barra.
// Si hay un panel o la barra de colores abiertos, el primer toque solo los cierra.
function alTocar(fraccion) {
  if (hayPanel()) { mostrarPanel(null); return; }
  if (!$('barra-seleccion').hidden) { cancelarSeleccion(); return; }
  if (fraccion < 0.3) abierto?.anterior();
  else if (fraccion > 0.7) abierto?.siguiente();
  else $('lector').classList.toggle('sin-barras');
}

// Cmd/Ctrl+F abre la búsqueda y Escape cierra lo que esté abierto (útil con teclado en iPad).
const ATAJOS = {
  alBuscar: () => alternarBusqueda(true),
  alEscape: () => { mostrarPanel(null); cancelarSeleccion(); },
};

// Teclas en la página principal (las de dentro de cada iframe las conecta gestos.js).
conectarTeclas(document, {
  siguiente: () => abierto?.siguiente(),
  anterior: () => abierto?.anterior(),
  activo: () => abierto?.paginado,
  alBuscar: () => { if (abierto) ATAJOS.alBuscar(); },
  alEscape: () => { if (abierto) ATAJOS.alEscape(); },
});
