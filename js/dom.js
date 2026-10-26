// Ayudante para crear elementos de la página. El texto siempre se pone con textContent (nunca como HTML),
// para que un título o un marcador malicioso dentro de un archivo no pueda inyectar código.
export function crear(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto) nodo.textContent = texto;
  return nodo;
}
