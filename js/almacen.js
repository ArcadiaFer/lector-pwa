// Almacén: guarda los libros en el teléfono usando IndexedDB (la base de datos del navegador).
// Hay dos "cajones" separados:
//   libros   -> datos ligeros de cada libro (título, autor, portada...). Se lee entero para pintar la biblioteca.
//   archivos -> el contenido del libro (ArrayBuffer). Solo se lee cuando abres ese libro.
// Separarlos evita cargar 50 libros enteros en memoria solo para ver la lista.

const NOMBRE_BD = 'lector';
const VERSION = 1;

let conexion = null; // la conexión se abre una sola vez y se reutiliza

function abrir() {
  if (!conexion) {
    conexion = new Promise((ok, fallo) => {
      const peticion = indexedDB.open(NOMBRE_BD, VERSION);
      // Se ejecuta solo la primera vez (o al subir VERSION): crea los cajones.
      peticion.onupgradeneeded = () => {
        const bd = peticion.result;
        bd.createObjectStore('libros', { keyPath: 'id' }); // la clave es el campo "id" del propio objeto
        bd.createObjectStore('archivos');                  // la clave se da al guardar (el id del libro)
      };
      peticion.onsuccess = () => ok(peticion.result);
      peticion.onerror = () => fallo(peticion.error);
    });
  }
  return conexion;
}

// IndexedDB usa eventos en vez de promesas; esta función lo envuelve para poder usar async/await.
// Ejecuta `operacion` dentro de una transacción y responde cuando la transacción TERMINA
// (no cuando se pide), que es cuando los datos ya están realmente guardados.
async function transaccion(cajones, modo, operacion) {
  const bd = await abrir();
  return new Promise((ok, fallo) => {
    const tx = bd.transaction(cajones, modo);
    const peticion = operacion(...cajones.map(nombre => tx.objectStore(nombre)));
    tx.oncomplete = () => ok(peticion ? peticion.result : undefined);
    tx.onerror = evento => fallo(evento.target.error);
    tx.onabort = () => fallo(tx.error); // p. ej. QuotaExceededError si el teléfono se queda sin espacio
  });
}

// Los dos cajones se escriben en UNA transacción: o se guarda todo o no se guarda nada.
export const guardarLibro = (meta, buffer) =>
  transaccion(['libros', 'archivos'], 'readwrite', (libros, archivos) => {
    libros.put(meta);
    archivos.put(buffer, meta.id);
  });

export const listarLibros = () => transaccion(['libros'], 'readonly', libros => libros.getAll());

export const obtenerLibro = id => transaccion(['libros'], 'readonly', libros => libros.get(id));

export const obtenerArchivo = id => transaccion(['archivos'], 'readonly', archivos => archivos.get(id));

// Cambia solo algunos campos de la ficha (página donde ibas, marcadores...) sin tocar el archivo pesado.
// Leer y escribir ocurren en la MISMA transacción: así dos guardados seguidos (p. ej. progreso y marcadores)
// nunca se pisan entre sí, porque cada uno parte de lo último que hay guardado.
export const actualizarLibro = (id, cambios) =>
  transaccion(['libros'], 'readwrite', libros => {
    const lectura = libros.get(id);
    lectura.onsuccess = () => {
      if (lectura.result) libros.put({ ...lectura.result, ...cambios });
    };
    return lectura;
  });

export const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const borrarLibro = id =>
  transaccion(['libros', 'archivos'], 'readwrite', (libros, archivos) => {
    libros.delete(id);
    archivos.delete(id);
  });
