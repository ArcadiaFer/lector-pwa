// Ajustes de lectura: tema, tamaño y tipo de letra.
// Guarda las preferencias en el teléfono (localStorage) y avisa a quien quiera enterarse cuando cambian.

export const TEMAS = {
  claro:  { fondo: '#ffffff', texto: '#1c1c1e', tenue: '#6b6b70', barra: '#f6f6f7', borde: '#dcdce0' },
  sepia:  { fondo: '#f4ecd8', texto: '#4f3b2a', tenue: '#8a7560', barra: '#ebe1c8', borde: '#d8cbab' },
  oscuro: { fondo: '#121212', texto: '#d4d4d4', tenue: '#8b8b8b', barra: '#1c1c1e', borde: '#333336' },
};

// Solo fuentes del sistema: no hay que descargar nada y funcionan sin conexión.
export const FUENTES = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '-apple-system, "Helvetica Neue", Arial, sans-serif',
};

const TAMANO_MIN = 12;
const TAMANO_MAX = 36; // en iPad se agradece poder leer más grande
const ZOOM_MIN = 50;   // el zoom (en %) solo lo usan los PDF; el tamaño de letra, los demás formatos
const ZOOM_MAX = 300;
const CLAVE = 'lector.ajustes';

const PREDETERMINADOS = {
  tema: matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro', // sigue al sistema la primera vez
  tamano: 18,
  fuente: 'serif',
  zoom: 100, // 100 % = el PDF ajustado al ancho de la pantalla
};

// Lo guardado puede estar viejo o dañado; se revisa cada campo y se usa el valor por defecto si no sirve.
function normalizar(a) {
  return {
    tema: Object.hasOwn(TEMAS, a.tema) ? a.tema : PREDETERMINADOS.tema,
    fuente: Object.hasOwn(FUENTES, a.fuente) ? a.fuente : PREDETERMINADOS.fuente,
    tamano: Math.min(TAMANO_MAX, Math.max(TAMANO_MIN, Math.round(Number(a.tamano)) || PREDETERMINADOS.tamano)),
    zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(Number(a.zoom)) || PREDETERMINADOS.zoom)),
  };
}

function leer() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE)) ?? {};
  } catch {
    return {}; // localStorage puede no estar disponible (modo privado, etc.)
  }
}

let actuales = normalizar(leer());
const oyentes = new Set();

export const ajustes = () => ({ ...actuales });

// Quien quiera enterarse de los cambios se apunta aquí; devuelve una función para darse de baja.
export function alCambiar(funcion) {
  oyentes.add(funcion);
  return () => oyentes.delete(funcion);
}

export function cambiar(parcial) {
  actuales = normalizar({ ...actuales, ...parcial });
  try {
    localStorage.setItem(CLAVE, JSON.stringify(actuales));
  } catch {
    // si no se puede guardar, los ajustes siguen funcionando durante esta sesión
  }
  pintarPagina();
  oyentes.forEach(funcion => funcion({ ...actuales }));
}

// Pasa los colores del tema a variables CSS para que toda la app (barras, biblioteca, panel) los use.
function pintarPagina() {
  const t = TEMAS[actuales.tema];
  const estilo = document.documentElement.style;
  for (const [nombre, valor] of Object.entries(t)) estilo.setProperty(`--${nombre}`, valor);
  // Colorea la barra del navegador en Safari (en la app instalada puede no notarse)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.fondo);
}

// Conecta los botones del panel "Aa" con los ajustes.
export function iniciarAjustes(panel) {
  // Cada botón de tema se pinta con los colores de su propio tema, como vista previa.
  panel.querySelectorAll('[data-tema]').forEach(boton => {
    const t = TEMAS[boton.dataset.tema];
    boton.style.background = t.fondo;
    boton.style.color = t.texto;
  });

  // Un solo oyente para todo el panel (delegación de eventos): se mira qué botón se tocó.
  panel.addEventListener('click', evento => {
    const boton = evento.target.closest('button');
    if (!boton) return;
    if (boton.dataset.tam) cambiar({ tamano: actuales.tamano + Number(boton.dataset.tam) });
    if (boton.dataset.zoom) cambiar({ zoom: actuales.zoom + Number(boton.dataset.zoom) });
    if (boton.dataset.tema) cambiar({ tema: boton.dataset.tema });
    if (boton.dataset.fuente) cambiar({ fuente: boton.dataset.fuente });
  });

  // Marca como "activo" el botón que corresponde al ajuste actual.
  const marcar = a => {
    panel.querySelectorAll('[data-tema]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tema === a.tema));
    panel.querySelectorAll('[data-fuente]').forEach(b => b.setAttribute('aria-pressed', b.dataset.fuente === a.fuente));
    panel.querySelector('#valor-tamano').textContent = a.tamano;
    panel.querySelector('#valor-zoom').textContent = `${a.zoom} %`;
  };
  alCambiar(marcar);
  marcar(actuales);
  pintarPagina();
}
