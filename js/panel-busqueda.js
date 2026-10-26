// Panel de búsqueda: una caja de texto y la lista de resultados. Cada resultado muestra un trozo de texto con lo
// encontrado en negrita y su lugar (capítulo, página o porcentaje). No sabe nada de formatos: pide la búsqueda
// con la función que le da lector.js.
import { crear } from './dom.js';

const REPINTADO_MS = 400; // mientras se busca, la lista parcial se actualiza como mucho cada tanto

// funciones:
//   buscar(consulta, control)   devuelve (con promesa) la lista de resultados; `control` trae
//                               vigente() -> false si se lanzó otra búsqueda, y avance(hechas, total, parciales)
//   alElegir(destino)           se llama al tocar un resultado
//   alLimpiar()                 se llama al empezar una búsqueda nueva (para quitar la marca de la anterior)
export function crearPanelBusqueda(panel, { buscar, alElegir, alLimpiar }) {
  const formulario = panel.querySelector('form');
  const campo = panel.querySelector('input');
  const estado = panel.querySelector('.estado-busqueda');
  const lista = panel.querySelector('.lista');
  let turno = 0; // numera las búsquedas: si empieza otra, la anterior deja de pintar

  function fila(resultado, alElegirEsta) {
    const boton = crear('button', 'resultado');
    boton.type = 'button';
    boton.append(
      crear('span', 'extracto', resultado.antes),
      crear('mark', '', resultado.dentro),
      crear('span', 'extracto', resultado.despues),
      crear('small', 'lugar', resultado.lugar),
    );
    boton.addEventListener('click', alElegirEsta);
    const item = crear('li');
    item.append(boton);
    return item;
  }

  function pintar(resultados) {
    lista.replaceChildren(...resultados.map(r => fila(r, () => alElegir(r.destino))));
  }

  formulario.addEventListener('submit', async evento => {
    evento.preventDefault();
    const consulta = campo.value.trim();
    const miTurno = ++turno;
    alLimpiar();
    lista.replaceChildren();
    if (consulta.length < 2) {
      estado.textContent = 'Escribe al menos 2 letras.';
      return;
    }
    campo.blur(); // cierra el teclado para ver los resultados
    estado.textContent = 'Buscando…';

    let ultimoPintado = 0;
    const control = {
      vigente: () => miTurno === turno,
      avance(hechas, total, parciales) {
        if (miTurno !== turno) return;
        estado.textContent = `Buscando… ${hechas} de ${total}`;
        if (Date.now() - ultimoPintado > REPINTADO_MS) {
          ultimoPintado = Date.now();
          pintar(parciales);
        }
      },
    };

    let resultados;
    try {
      resultados = await buscar(consulta, control);
    } catch (error) {
      if (miTurno === turno) estado.textContent = `No se pudo buscar: ${error.message}`;
      return;
    }
    if (miTurno !== turno) return;
    pintar(resultados);
    estado.textContent = resultados.length
      ? `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}${resultados.length >= 300 ? ' (se muestran los primeros)' : ''}`
      : 'Sin resultados.';
  });

  return {
    enfocar() { campo.focus(); campo.select(); },
    // Al cambiar de libro se vacía todo.
    reiniciar() {
      turno++;
      campo.value = '';
      estado.textContent = '';
      lista.replaceChildren();
    },
  };
}
