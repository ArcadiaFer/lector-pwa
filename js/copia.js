// Copia de seguridad: guarda la biblioteca en un archivo .zip y la restaura desde uno.
// Sirve para respaldar, y también para pasar libros, progreso, marcadores y resaltados entre dispositivos
// (iPhone <-> iPad), ya que cada dispositivo guarda sus datos por separado.
//
// Contenido del .zip:
//   lector.json      las fichas de los libros (título, progreso, marcadores, resaltados...)
//   libros/<id>      el archivo de cada libro (solo si se pidió incluir los libros)
// `JSZip` es la variable global de vendor/jszip.min.js.
import { listarLibros, obtenerArchivo, obtenerLibro, guardarLibro, actualizarLibro } from './almacen.js';

const VERSION = 1;
const FORMATOS = ['epub', 'pdf', 'txt', 'html'];
const ID_VALIDO = /^[a-z0-9]{4,40}$/;

// ===== Crear =====

// `alAvance(texto)` informa de lo que se está haciendo. Devuelve un Blob (el archivo .zip).
export async function crearCopia({ conLibros }, alAvance = () => {}) {
  const libros = await listarLibros();
  const zip = new JSZip();
  zip.file('lector.json', JSON.stringify({ version: VERSION, creado: new Date().toISOString(), conLibros, libros }));

  if (conLibros) {
    for (const [i, libro] of libros.entries()) {
      alAvance(`Leyendo el libro ${i + 1} de ${libros.length}…`);
      const contenido = await obtenerArchivo(libro.id);
      if (contenido) zip.file(`libros/${libro.id}`, contenido);
    }
  }
  alAvance('Armando el archivo…');
  // Los EPUB y PDF ya vienen comprimidos: no se comprimen de nuevo (es mucho más rápido y pesa casi igual).
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

// ===== Restaurar =====

// Devuelve { nuevos, actualizados, omitidos }.
//   - Un libro que NO está en este dispositivo se agrega (si la copia trae su archivo).
//   - Un libro que YA está se queda como está, pero se le suman los marcadores y resaltados que le falten
//     y se toma el progreso más reciente.
export async function restaurarCopia(archivo, alAvance = () => {}) {
  let zip;
  try {
    zip = await JSZip.loadAsync(archivo);
  } catch {
    throw new Error('el archivo no es una copia de Lector');
  }
  const entrada = zip.file('lector.json');
  if (!entrada) throw new Error('el archivo no es una copia de Lector');

  let datos;
  try {
    datos = JSON.parse(await entrada.async('string'));
  } catch {
    throw new Error('la copia está dañada');
  }
  if (datos?.version !== VERSION || !Array.isArray(datos.libros)) {
    throw new Error('la copia es de una versión que esta app no entiende');
  }

  const resumen = { nuevos: 0, actualizados: 0, omitidos: 0 };
  for (const [i, bruta] of datos.libros.entries()) {
    alAvance(`Restaurando ${i + 1} de ${datos.libros.length}…`);
    const ficha = fichaSegura(bruta);
    if (!ficha) { resumen.omitidos++; continue; }

    const existente = await obtenerLibro(ficha.id);
    if (existente) {
      await actualizarLibro(ficha.id, combinar(existente, ficha));
      resumen.actualizados++;
      continue;
    }
    const contenido = zip.file(`libros/${ficha.id}`);
    if (!contenido) { resumen.omitidos++; continue; } // copia "ligera": sin el archivo no hay libro que agregar
    await guardarLibro(ficha, await contenido.async('arraybuffer'));
    resumen.nuevos++;
  }
  return resumen;
}

// Une lo guardado aquí con lo que trae la copia (sin perder nada de ninguno de los dos).
function combinar(actual, nueva) {
  const masReciente = (nueva.progreso?.fecha ?? 0) > (actual.progreso?.fecha ?? 0);
  return {
    progreso: masReciente ? nueva.progreso : actual.progreso ?? null,
    marcadores: unirPorId(actual.marcadores ?? [], nueva.marcadores),
    resaltados: unirPorId(actual.resaltados ?? [], nueva.resaltados),
  };
}

function unirPorId(a, b) {
  const ids = new Set(a.map(x => x.id));
  return [...a, ...b.filter(x => !ids.has(x.id))];
}

// ===== Validación =====
// Un archivo de copia viene de fuera: puede estar dañado o haber sido modificado a mano. Nada de lo que trae se
// usa tal cual; cada campo se revisa y se copia a un objeto nuevo, y lo que no cuadra se descarta.

const esNumero = v => typeof v === 'number' && Number.isFinite(v);
const texto = (v, maximo) => (typeof v === 'string' ? v.slice(0, maximo) : '');
const lista = (v, maximo = 5000) => (Array.isArray(v) ? v.slice(0, maximo) : []);

function destinoSeguro(d) {
  if (!d || typeof d !== 'object') return null;
  const salida = {};
  for (const clave of ['cfi', 'cfiRange']) {
    if (typeof d[clave] === 'string' && d[clave].startsWith('epubcfi(') && d[clave].length < 600) salida[clave] = d[clave];
  }
  for (const clave of ['pagina', 'inicio', 'fin', 'fraccion']) {
    if (esNumero(d[clave])) salida[clave] = d[clave];
  }
  if (Array.isArray(d.rects)) {
    salida.rects = d.rects.slice(0, 300)
      .filter(r => r && ['x', 'y', 'w', 'h'].every(k => esNumero(r[k])))
      .map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  }
  return Object.keys(salida).length ? salida : null;
}

function marcadorSeguro(m) {
  const destino = destinoSeguro(m?.destino);
  if (!destino || !ID_VALIDO.test(m.id)) return null;
  return { id: m.id, destino, porcentaje: esNumero(m.porcentaje) ? m.porcentaje : 0, etiqueta: texto(m.etiqueta, 200), creado: esNumero(m.creado) ? m.creado : 0 };
}

function resaltadoSeguro(r) {
  const destino = destinoSeguro(r?.destino);
  if (!destino || !ID_VALIDO.test(r.id)) return null;
  return {
    id: r.id,
    color: ['amarillo', 'verde', 'azul', 'rosa'].includes(r.color) ? r.color : 'amarillo',
    destino,
    texto: texto(r.texto, 300),
    porcentaje: esNumero(r.porcentaje) ? r.porcentaje : 0,
    creado: esNumero(r.creado) ? r.creado : 0,
  };
}

function progresoSeguro(p) {
  const destino = destinoSeguro(p?.destino);
  if (!destino) return null;
  return { destino, porcentaje: esNumero(p.porcentaje) ? p.porcentaje : 0, fecha: esNumero(p.fecha) ? p.fecha : 0 };
}

function fichaSegura(f) {
  if (!f || typeof f !== 'object' || !ID_VALIDO.test(f.id) || !FORMATOS.includes(f.formato)) return null;
  const portadaValida = typeof f.portada === 'string' && f.portada.length < 300000
    && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(f.portada);
  return {
    id: f.id,
    formato: f.formato,
    nombreArchivo: texto(f.nombreArchivo, 200),
    titulo: texto(f.titulo, 300) || 'Sin título',
    autor: texto(f.autor, 200),
    portada: portadaValida ? f.portada : null,
    agregado: esNumero(f.agregado) ? f.agregado : Date.now(),
    progreso: progresoSeguro(f.progreso),
    marcadores: lista(f.marcadores).map(marcadorSeguro).filter(Boolean),
    resaltados: lista(f.resaltados).map(resaltadoSeguro).filter(Boolean),
  };
}
