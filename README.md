# Lector (PWA)

Lector de libros EPUB, PDF, TXT y HTML que se instala en el iPhone y el iPad desde Safari. Sin npm ni paso de compilación.

- **Fase 1:** biblioteca, importación, lector con temas y tamaño de letra, funcionamiento sin conexión.
- **Fase 2:** PDF, recordar la página donde ibas, marcadores e índice.
- **Fase 3:** resaltados (4 colores), búsqueda, copia de seguridad (sirve también para pasar libros entre iPhone e
  iPad) y ajustes para iPad (doble página, paneles centrados, teclado, arrastrar archivos).

## Probar en la computadora

```
python -m http.server 8000
```

(ejecutar dentro de esta carpeta) y abrir http://localhost:8000. Para tener libros con los que probar,
`python tools/generar_recursos.py` crea la carpeta `muestras/` (no se sube al repositorio). El service worker pide
siempre la versión nueva cuando hay conexión, así que basta con recargar después de cambiar algo.

## Instalar en el iPhone / iPad

Safari solo instala (y deja funcionar sin conexión) páginas servidas con **HTTPS**; `http://` en la red local sirve
para ver la app pero no para instalarla. Hay que publicar esta carpeta en un hosting estático con HTTPS
(GitHub Pages, Netlify, Cloudflare Pages) y abrir esa dirección en Safari → Compartir → "Añadir a pantalla de inicio".
Los libros no se suben a ningún lado: se guardan en cada dispositivo. Para pasar libros, marcadores y resaltados de
uno a otro: botón **⋯** de la biblioteca → Copia de seguridad.

## Uso rápido

- **Pasar de página:** tocar el 30 % izquierdo/derecho de la pantalla, deslizar el dedo o usar las flechas del teclado.
  Tocar el centro muestra u oculta la barra.
- **Resaltar:** mantener el dedo sobre un texto, seleccionarlo y tocar un color. Los resaltados están en ☰ → Resaltados.
- **Buscar:** ícono de lupa (o Cmd/Ctrl+F con teclado).
- **Marcar el lugar:** ícono de marcador. Índice, marcadores y resaltados: ☰.

## Estructura

| Ruta | Para qué sirve |
|---|---|
| `index.html` | Esqueleto: biblioteca, lector, paneles, barra de colores y ventana de copia |
| `css/estilos.css` | Aspecto de toda la app |
| `js/app.js` | Arranque, botones, copia de seguridad, arrastrar y soltar |
| `js/almacen.js` | Guarda libros, progreso, marcadores y resaltados en IndexedDB |
| `js/importar.js` | Lee el archivo elegido: formato, título, autor, portada |
| `js/texto.js` | Decodifica y limpia TXT/HTML; detecta títulos en TXT; mapa de texto para buscar y resaltar |
| `js/ajustes.js` | Tema, tamaño, letra y zoom |
| `js/colores.js` | Colores de los resaltados |
| `js/biblioteca.js` | Cuadrícula de libros con barra de avance |
| `js/dom.js` | Ayudante para crear elementos de forma segura |
| `js/lector.js` | Coordina la lectura: progreso, marcadores, resaltados, búsqueda, paneles, toques |
| `js/gestos.js` | Toques, deslizamientos y teclas |
| `js/panel-indice.js` | Panel de índice, marcadores y resaltados |
| `js/panel-busqueda.js` | Panel de búsqueda |
| `js/barra-seleccion.js` | Barra de colores al seleccionar texto |
| `js/copia.js` | Crear y restaurar copias de seguridad (.zip) |
| `js/formato-epub.js` | EPUB (epub.js), por páginas; dos páginas en pantallas anchas |
| `js/formato-pdf.js` | PDF (pdf.js): lienzo + capa de marcas + capa de texto |
| `js/formato-doc.js` | TXT y HTML, en un iframe aislado con desplazamiento |
| `sw.js`, `manifest.json` | Funcionamiento sin conexión e instalación |
| `vendor/` | epub.js 0.3.93, JSZip 3.10.1 y pdf.js 3.11.174 (de cdn.jsdelivr.net/npm, versiones fijas) |
| `tools/generar_recursos.py` | Genera `icons/` y `muestras/` (solo biblioteca estándar de Python) |

## Datos de cada libro (IndexedDB, cajón `libros`)

`id, formato, titulo, autor, portada, agregado, progreso, marcadores` y, desde la fase 3, `resaltados`.
El `destino` (dónde está algo dentro del libro) depende del formato: `{ cfi }` / `{ cfiRange }` en EPUB,
`{ pagina }` / `{ pagina, rects }` en PDF, `{ fraccion }` / `{ inicio, fin }` en TXT/HTML. Los libros guardados en
fases anteriores siguen funcionando: simplemente no traen los campos nuevos.

## Limitaciones conocidas

- Cambiar varias veces el tamaño de letra en un EPUB puede correr el lugar unas líneas (cada cambio vuelve a
  anclar al inicio de la página).
- El avance de un EPUB es aproximado (capítulo actual + fracción del capítulo).
- Resaltar en TXT/HTML necesita Safari 17.2 o más nuevo (iOS/iPadOS 17.2+); en EPUB y PDF no hay esa restricción.
- En PDF no hay tipo de letra ni reajuste de texto (la hoja es fija); el tema oscuro invierte los colores,
  incluidas las imágenes. Los PDF escaneados (sin texto) se ven, pero no se pueden seleccionar ni buscar.
- Un resaltado se quita desde la lista (☰ → Resaltados), no tocándolo en la página.
- La búsqueda en PDF marca las apariciones de una sola palabra o frase continua; si el PDF corta el texto en
  trozos raros, la página se abre pero puede no marcarse el texto.
- Al restaurar una copia se suman marcadores y resaltados: si borraste uno en un dispositivo y existe en la copia,
  vuelve a aparecer.
- No probado en un iPhone ni un iPad reales.

## Pendiente

Notas en los resaltados, quitar un resaltado tocándolo, publicación con HTTPS y pulido tras probar en un dispositivo real.
