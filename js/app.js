// Punto de entrada: conecta los botones con el resto de módulos y arranca la app.
import { prepararLibro } from './importar.js';
import { guardarLibro } from './almacen.js';
import { pintar } from './biblioteca.js';
import {
  abrir as abrirLibro,
  cerrar as cerrarLibro,
  alternarAjustes,
  alternarIndice,
  alternarBusqueda,
  alternarMarcador,
} from './lector.js';
import { iniciarAjustes } from './ajustes.js';
import { crearCopia, restaurarCopia } from './copia.js';

const $ = id => document.getElementById(id);

// pdf.js hace el trabajo pesado en un hilo aparte (worker); hay que decirle dónde está su archivo.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

// Solo una pantalla visible a la vez.
function mostrar(pantalla) {
  $('biblioteca').hidden = pantalla !== 'biblioteca';
  $('lector').hidden = pantalla !== 'lector';
}

const refrescar = () => pintar($('estante'), { abrir: abrirDesdeEstante, alBorrar: refrescar });

async function abrirDesdeEstante(libro) {
  mostrar('lector'); // primero se muestra: epub.js y pdf.js necesitan que el visor ya tenga tamaño para calcular las páginas
  try {
    await abrirLibro(libro.id);
  } catch (error) {
    await cerrarLibro();
    mostrar('biblioteca');
    alert(`No se pudo abrir el libro.\n${error.message}`);
  }
}

// Volver a la biblioteca: se cierra el libro (guardando dónde ibas) y se repinta la lista,
// que ahora muestra el avance de lectura y pone arriba el libro que acabas de leer.
// Importante: cerrarLibro() toma la posición en su primer paso, y eso tiene que ocurrir ANTES de ocultar
// el lector: con la pantalla oculta todo mide cero y la posición saldría mal. Por eso se llama primero
// (sin esperar) y recién después se cambia de pantalla.
async function volver() {
  const cerrado = cerrarLibro();
  mostrar('biblioteca');
  await cerrado;
  await refrescar();
}

// Importa uno por uno; si alguno falla, los demás siguen y al final se informa de los fallidos.
async function importar(archivos) {
  const fallos = [];
  for (const [i, archivo] of archivos.entries()) {
    $('estado').textContent = `Importando ${i + 1} de ${archivos.length}…`;
    try {
      const { meta, buffer } = await prepararLibro(archivo);
      await guardarLibro(meta, buffer);
    } catch (error) {
      const motivo = error.name === 'QuotaExceededError' ? 'no hay espacio suficiente' : error.message;
      fallos.push(`${archivo.name}: ${motivo}`);
    }
  }
  $('estado').textContent = '';
  await refrescar();
  if (fallos.length) alert(`No se pudieron importar:\n${fallos.join('\n')}`);
}

// ===== Copia de seguridad =====

let copiaLista = null; // { blob, nombre } cuando ya se armó una copia y falta entregarla

// Armar el archivo puede tardar; por eso hay DOS pasos: "Crear copia" (arma) y "Guardar o compartir"
// (entrega). Safari solo deja abrir la hoja de compartir justo después de un toque del usuario, y si se hiciera
// al terminar de armar el archivo ese permiso ya habría caducado.
async function armarCopia() {
  const estado = $('estado-copia');
  $('btn-crear-copia').disabled = true;
  $('btn-entregar-copia').hidden = true;
  copiaLista = null;
  try {
    const blob = await crearCopia({ conLibros: $('copia-con-libros').checked }, texto => { estado.textContent = texto; });
    copiaLista = { blob, nombre: `lector-copia-${new Date().toISOString().slice(0, 10)}.zip` };
    estado.textContent = `Copia lista (${(blob.size / 1048576).toFixed(1)} MB). Toca "Guardar o compartir".`;
    $('btn-entregar-copia').hidden = false;
  } catch (error) {
    estado.textContent = `No se pudo crear la copia: ${error.message}`;
  } finally {
    $('btn-crear-copia').disabled = false;
  }
}

// En iPhone/iPad se abre la hoja de compartir (guardar en Archivos, AirDrop...). En la computadora, se descarga.
async function entregarCopia() {
  if (!copiaLista) return;
  const { blob, nombre } = copiaLista;
  const archivo = new File([blob], nombre, { type: 'application/zip' });
  try {
    if (navigator.canShare?.({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: 'Copia de Lector' });
    } else {
      const url = URL.createObjectURL(blob);
      const enlace = Object.assign(document.createElement('a'), { href: url, download: nombre });
      document.body.append(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    if (error.name !== 'AbortError') $('estado-copia').textContent = `No se pudo guardar: ${error.message}`; // AbortError = el usuario canceló
  }
}

async function restaurar(archivo) {
  const estado = $('estado-copia');
  try {
    const r = await restaurarCopia(archivo, texto => { estado.textContent = texto; });
    estado.textContent = `Listo: ${r.nuevos} libro(s) nuevo(s), ${r.actualizados} actualizado(s)`
      + (r.omitidos ? `, ${r.omitidos} omitido(s) (la copia no traía su archivo).` : '.');
    await refrescar();
  } catch (error) {
    estado.textContent = `No se pudo restaurar: ${error.message}`;
  }
}

$('btn-copia').addEventListener('click', () => {
  $('estado-copia').textContent = '';
  $('btn-entregar-copia').hidden = true;
  copiaLista = null;
  $('dialogo-copia').showModal();
});
$('btn-cerrar-copia').addEventListener('click', () => $('dialogo-copia').close());
$('btn-crear-copia').addEventListener('click', armarCopia);
$('btn-entregar-copia').addEventListener('click', entregarCopia);
$('btn-restaurar-copia').addEventListener('click', () => $('entrada-copia').click());
$('entrada-copia').addEventListener('change', evento => {
  const archivo = evento.target.files[0];
  evento.target.value = '';
  if (archivo) restaurar(archivo);
});

// ===== Botones y arranque =====

$('btn-agregar').addEventListener('click', () => $('entrada-archivos').click());
$('entrada-archivos').addEventListener('change', evento => {
  const archivos = [...evento.target.files];
  evento.target.value = ''; // permite volver a elegir el mismo archivo después
  importar(archivos);
});

// Arrastrar archivos desde la app Archivos hasta la biblioteca (con dos ventanas en iPad, por ejemplo).
const biblioteca = $('biblioteca');
biblioteca.addEventListener('dragover', evento => {
  if (![...(evento.dataTransfer?.types ?? [])].includes('Files')) return;
  evento.preventDefault(); // sin esto el navegador no permite soltar aquí
  biblioteca.classList.add('arrastrando');
});
biblioteca.addEventListener('dragleave', evento => {
  if (!biblioteca.contains(evento.relatedTarget)) biblioteca.classList.remove('arrastrando');
});
biblioteca.addEventListener('drop', evento => {
  evento.preventDefault();
  biblioteca.classList.remove('arrastrando');
  const archivos = [...(evento.dataTransfer?.files ?? [])];
  if (archivos.length) importar(archivos);
});

$('btn-volver').addEventListener('click', volver);
$('btn-ajustes').addEventListener('click', alternarAjustes);
$('btn-indice').addEventListener('click', alternarIndice);
$('btn-buscar').addEventListener('click', () => alternarBusqueda());
$('btn-marcador').addEventListener('click', alternarMarcador);

iniciarAjustes($('panel-ajustes'));
refrescar().catch(error => { $('estado').textContent = `No se pudo abrir el almacenamiento: ${error.message}`; });

// Pide al navegador que no borre los libros si el dispositivo se queda corto de espacio.
Promise.resolve(navigator.storage?.persist?.()).catch(() => {});

// Registra el service worker (permite abrir la app sin conexión). Solo funciona con HTTPS o localhost.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
