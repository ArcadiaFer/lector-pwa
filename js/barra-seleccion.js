// Barra flotante que aparece al seleccionar texto: un botón por cada color de resaltado y una × para cancelar.
import { COLORES } from './colores.js';
import { crear } from './dom.js';

// alElegir(nombreDelColor) se llama al tocar un color; alCancelar() al tocar la ×.
export function crearBarraSeleccion(barra, { alElegir, alCancelar }) {
  let tocadaHasta = 0;

  for (const [nombre, { etiqueta, valor }] of Object.entries(COLORES)) {
    const boton = crear('button', 'color');
    boton.type = 'button';
    boton.style.backgroundColor = valor;
    boton.setAttribute('aria-label', `Resaltar en ${etiqueta.toLowerCase()}`);
    boton.addEventListener('click', () => alElegir(nombre));
    barra.append(boton);
  }
  const cancelar = crear('button', 'cancelar', '×');
  cancelar.type = 'button';
  cancelar.setAttribute('aria-label', 'Cancelar selección');
  cancelar.addEventListener('click', alCancelar);
  barra.append(cancelar);

  // Tocar la barra no debe quitarle la selección al texto (que es lo que se va a resaltar).
  barra.addEventListener('mousedown', evento => evento.preventDefault());
  // Y mientras se toca, el lector no debe esconder la barra aunque la selección parpadee.
  barra.addEventListener('pointerdown', () => { tocadaHasta = Date.now() + 1000; });

  return {
    mostrar(si) { barra.hidden = !si; },
    tocada: () => Date.now() < tocadaHasta,
  };
}
