// Toques, deslizamientos y teclas. Sirven igual para el documento de un iframe (EPUB, TXT, HTML)
// que para un elemento de la página principal (PDF).

// acciones:
//   alTocar(fraccion)     recibe en qué punto de la pantalla se tocó (0 = borde izquierdo, 1 = derecho)
//   siguiente, anterior   pasar de página
//   paginado              solo si es true se activan los deslizamientos y las teclas de pasar página
//   deslizarActivo()      (opcional) devuelve false cuando no conviene que un deslizamiento pase página
//   atajos                (opcional) { alBuscar, alEscape }: Cmd/Ctrl+F y Escape
export function conectarGestos(objetivo, { alTocar, siguiente, anterior, paginado, deslizarActivo = () => true, atajos = {} }) {
  // Si el objetivo es el documento de un iframe, hay que sumar la posición del iframe
  // para saber dónde se tocó en la pantalla (en EPUB el iframe se desplaza hacia la izquierda al pasar página).
  const marco = objetivo.defaultView?.frameElement ?? null;
  const ventana = objetivo.defaultView ?? objetivo.ownerDocument.defaultView;
  const haySeleccion = () => {
    const seleccion = ventana.getSelection();
    return !!seleccion && !seleccion.isCollapsed;
  };

  objetivo.addEventListener('click', evento => {
    if (evento.target.closest('a, button')) return; // enlaces y botones hacen lo suyo
    const izquierda = marco ? marco.getBoundingClientRect().left : 0;
    alTocar((izquierda + evento.clientX) / window.innerWidth);
  });

  // Las teclas de un iframe no llegan a la página principal, así que se conectan aparte.
  // (Para la página principal las conecta lector.js; hacerlo aquí también las duplicaría.)
  if (marco) conectarTeclas(objetivo, { siguiente, anterior, activo: () => paginado, ...atajos });

  if (!paginado) return;

  // Deslizar el dedo a los lados avanza o retrocede página.
  let inicio = null;
  objetivo.addEventListener('touchstart', evento => {
    const toque = evento.changedTouches[0];
    inicio = { x: toque.clientX, y: toque.clientY };
  }, { passive: true });
  objetivo.addEventListener('touchend', evento => {
    if (!inicio) return;
    const toque = evento.changedTouches[0];
    const dx = toque.clientX - inicio.x;
    const dy = toque.clientY - inicio.y;
    inicio = null;
    // Si hay texto seleccionado, arrastrar es mover las asas de la selección, no pasar de página.
    if (!deslizarActivo() || haySeleccion()) return;
    // Cuenta como deslizamiento si es largo y más horizontal que vertical.
    if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy)) {
      if (dx < 0) siguiente(); else anterior();
    }
  }, { passive: true });
}

// Flechas, RePág/AvPág y barra espaciadora (útil con teclado en iPad o en la computadora),
// además de Cmd/Ctrl+F (buscar) y Escape. `activo()` dice si en este momento hay que pasar página con las teclas.
export function conectarTeclas(objetivo, { siguiente, anterior, activo, alBuscar, alEscape }) {
  objetivo.addEventListener('keydown', evento => {
    if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === 'f' && alBuscar) {
      evento.preventDefault();
      alBuscar();
      return;
    }
    if (evento.key === 'Escape' && alEscape) {
      alEscape();
      return;
    }
    if (!activo()) return;
    if (['ArrowRight', 'PageDown', ' '].includes(evento.key)) { evento.preventDefault(); siguiente(); }
    else if (['ArrowLeft', 'PageUp'].includes(evento.key)) { evento.preventDefault(); anterior(); }
  });
}
