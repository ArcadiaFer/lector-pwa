// Panel inferior con tres pestañas: Índice (los capítulos del libro), Marcadores (los lugares que marcaste)
// y Resaltados (los textos que subrayaste). No sabe nada de formatos: pide los datos con las funciones
// que le da lector.js y avisa cuando se elige o se borra algo.
import { crear } from './dom.js';
import { COLORES } from './colores.js';

// funciones:
//   cargarIndice()   devuelve (con promesa) [{ titulo, nivel, destino }]
//   marcadores()     devuelve la lista actual de marcadores
//   resaltados()     devuelve la lista actual de resaltados
//   alElegir(dest)   se llama al tocar una entrada
//   alBorrar(tipo, id)   se llama al tocar la × de un marcador ('marcador') o un resaltado ('resaltado')
export function crearPanelIndice(panel, { cargarIndice, marcadores, resaltados, alElegir, alBorrar }) {
  const lista = panel.querySelector('.lista');
  let pestana = 'indice';
  let turno = 0; // si el panel se repinta mientras el índice carga, solo vale la última carga

  const aviso = texto => crear('li', 'aviso', texto);

  function filaIndice(entrada) {
    const boton = crear('button', 'entrada', entrada.titulo);
    boton.type = 'button';
    boton.style.setProperty('--nivel', entrada.nivel); // el CSS usa esto para la sangría
    if (!entrada.destino) boton.disabled = true;       // entradas que no llevan a ningún sitio (enlaces web, etc.)
    boton.addEventListener('click', () => alElegir(entrada.destino));
    const fila = crear('li');
    fila.append(boton);
    return fila;
  }

  // Marcadores y resaltados tienen la misma forma de fila: texto que lleva al lugar + × para borrar.
  function filaConBorrar({ texto, color, destino, tipo, id }) {
    const ir = crear('button', 'entrada');
    ir.type = 'button';
    if (color) {
      const muestra = crear('span', 'chip');
      muestra.style.backgroundColor = COLORES[color]?.valor ?? '#ffd54a';
      ir.append(muestra);
    }
    ir.append(crear('span', 'marcador-etiqueta', texto));
    ir.addEventListener('click', () => alElegir(destino));

    const borrar = crear('button', 'borrar-marcador', '×');
    borrar.type = 'button';
    borrar.setAttribute('aria-label', tipo === 'marcador' ? 'Eliminar marcador' : 'Eliminar resaltado');
    borrar.addEventListener('click', () => { alBorrar(tipo, id); pintar(); });

    const fila = crear('li', 'fila-marcador');
    fila.append(ir, borrar);
    return fila;
  }

  async function pintar() {
    const miTurno = ++turno;
    panel.querySelectorAll('[data-pestana]').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.pestana === pestana);
    });

    if (pestana === 'indice') {
      lista.replaceChildren(aviso('Cargando índice…'));
      let entradas = [];
      try { entradas = await cargarIndice(); } catch { /* sin índice */ }
      if (miTurno !== turno) return;
      lista.replaceChildren(...(entradas.length ? entradas.map(filaIndice) : [aviso('Este libro no tiene índice.')]));
    } else if (pestana === 'marcadores') {
      // En el orden del libro, no en el orden en que se crearon.
      const todos = [...marcadores()].sort((a, b) => a.porcentaje - b.porcentaje);
      lista.replaceChildren(...(todos.length
        ? todos.map(m => filaConBorrar({ texto: m.etiqueta, destino: m.destino, tipo: 'marcador', id: m.id }))
        : [aviso('Aún no hay marcadores. Toca el ícono de marcador de la barra para guardar el lugar donde vas.')]));
    } else {
      const todos = [...resaltados()].sort((a, b) => a.porcentaje - b.porcentaje);
      lista.replaceChildren(...(todos.length
        ? todos.map(r => filaConBorrar({ texto: r.texto, color: r.color, destino: r.destino, tipo: 'resaltado', id: r.id }))
        : [aviso('Aún no hay resaltados. Selecciona un texto y elige un color.')]));
    }
  }

  panel.addEventListener('click', evento => {
    const boton = evento.target.closest('[data-pestana]');
    if (!boton) return;
    pestana = boton.dataset.pestana;
    pintar();
  });

  return {
    abrir() { pestana = 'indice'; pintar(); },
    // Para cuando cambian los marcadores o resaltados desde fuera con esa pestaña a la vista.
    refrescar() { if (!panel.hidden && pestana !== 'indice') pintar(); },
  };
}
