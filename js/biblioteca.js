// Biblioteca: dibuja la cuadrícula de libros.
// Los textos (título, autor) siempre se ponen con textContent, nunca como HTML (ver dom.js).
import { listarLibros, borrarLibro } from './almacen.js';
import { crear } from './dom.js';

const ETIQUETAS = { epub: 'EPUB', pdf: 'PDF', txt: 'TXT', html: 'HTML' };

// Color estable para las portadas sin imagen: el mismo título da siempre el mismo color.
function colorDe(texto) {
  let tono = 0;
  for (const letra of texto) tono = (tono * 31 + letra.codePointAt(0)) % 360;
  return `hsl(${tono} 38% 36%)`;
}

// Cuándo se leyó o se añadió por última vez: sirve para poner arriba lo que estás leyendo.
const ultimaVez = libro => libro.progreso?.fecha ?? libro.agregado;

export async function pintar(estante, { abrir, alBorrar }) {
  const libros = (await listarLibros()).sort((a, b) => ultimaVez(b) - ultimaVez(a));
  estante.replaceChildren(...libros.map(libro => tarjeta(libro, abrir, alBorrar)));
  document.getElementById('vacio').hidden = libros.length > 0;
}

function tarjeta(libro, abrir, alBorrar) {
  const portada = crear('button', 'portada');
  portada.type = 'button';
  portada.setAttribute('aria-label', `Abrir ${libro.titulo}`);
  if (libro.portada) {
    const imagen = new Image();
    imagen.src = libro.portada;
    imagen.alt = '';
    portada.append(imagen);
  } else {
    portada.style.background = colorDe(libro.titulo);
    portada.append(crear('span', 'sin-imagen', libro.titulo));
  }
  portada.append(crear('span', 'formato', ETIQUETAS[libro.formato]));

  // Barra delgada al pie de la portada con lo leído (solo si ya empezaste el libro).
  const leido = Math.round((libro.progreso?.porcentaje ?? 0) * 100);
  if (leido > 0) {
    const barra = crear('span', 'progreso');
    const relleno = crear('span');
    relleno.style.width = `${Math.min(100, leido)}%`;
    barra.append(relleno);
    portada.append(barra);
  }
  portada.addEventListener('click', () => abrir(libro));

  // Botón de borrar: hermano de la portada (un botón dentro de otro botón no es HTML válido).
  const borrar = crear('button', 'borrar', '×');
  borrar.type = 'button';
  borrar.setAttribute('aria-label', `Eliminar ${libro.titulo}`);
  borrar.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar "${libro.titulo}" de la biblioteca?`)) return;
    await borrarLibro(libro.id);
    alBorrar();
  });

  const tarjeta = crear('article', 'tarjeta');
  tarjeta.append(portada, borrar, crear('p', 'titulo-libro', libro.titulo));
  if (libro.autor) tarjeta.append(crear('p', 'autor-libro', libro.autor));
  return tarjeta;
}
