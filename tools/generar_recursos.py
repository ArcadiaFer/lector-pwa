"""Genera los iconos de la app (icons/) y unos libros de muestra (muestras/) para probar.

Solo usa la biblioteca estándar de Python.
Uso (desde la carpeta lector-pwa):  python tools/generar_recursos.py
"""
import struct
import zipfile
import zlib
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- PNG a mano

def escribir_png(ruta, ancho, alto, color_en):
    """Escribe un PNG RGB. `color_en(x, y)` devuelve (r, g, b) para cada píxel."""
    filas = bytearray()
    for y in range(alto):
        filas.append(0)  # cada fila empieza con su byte de filtro: 0 = sin filtro
        for x in range(ancho):
            filas += bytes(color_en(x, y))

    def trozo(tipo, datos):
        crc = zlib.crc32(tipo + datos) & 0xFFFFFFFF
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", crc)

    cabecera = struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0)  # 8 bits, color RGB
    Path(ruta).write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + trozo(b"IHDR", cabecera)
        + trozo(b"IDAT", zlib.compress(bytes(filas), 9))
        + trozo(b"IEND", b"")
    )


# ---------------------------------------------------------------- iconos

def mezclar(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def color_icono(u, v):
    """Color del icono en el punto (u, v), con u y v entre 0 y 1: un libro abierto sobre fondo azul."""
    color = mezclar((38, 70, 112), (18, 34, 62), v)  # fondo: degradado vertical
    d = abs(u - 0.5)  # distancia al lomo; las dos páginas son simétricas
    arriba = 0.30 - 0.2 * d  # borde superior de la página (se inclina hacia afuera)
    abajo = 0.76 - 0.2 * d
    if 0.012 <= d <= 0.30:
        if arriba <= v <= abajo:
            color = (250, 246, 236)  # papel
            for k in range(5):  # renglones de texto
                if 0.06 <= d <= 0.26 and abs(v - (arriba + 0.09 + 0.075 * k)) < 0.0065:
                    color = (160, 170, 190)
        elif abajo < v <= abajo + 0.035:
            color = (205, 195, 172)  # canto de las páginas
    return color


def dibujar_icono(ruta, lado):
    muestras = 3  # 3x3 puntos por píxel, para bordes suaves

    def color_en(x, y):
        suma = [0, 0, 0]
        for sy in range(muestras):
            for sx in range(muestras):
                c = color_icono((x + (sx + 0.5) / muestras) / lado, (y + (sy + 0.5) / muestras) / lado)
                for i in range(3):
                    suma[i] += c[i]
        return tuple(s // (muestras * muestras) for s in suma)

    escribir_png(ruta, lado, lado, color_en)


def crear_iconos():
    carpeta = RAIZ / "icons"
    carpeta.mkdir(exist_ok=True)
    dibujar_icono(carpeta / "icon-512.png", 512)
    dibujar_icono(carpeta / "icon-192.png", 192)
    dibujar_icono(carpeta / "apple-touch-icon.png", 180)  # el tamaño que usa iOS


# ---------------------------------------------------------------- libros de muestra

FRASES = [
    "El viento llegaba desde el mar con olor a sal y a madera mojada, y nadie en el pueblo recordaba haberlo sentido tan temprano.",
    "Marina dejó el cuaderno sobre la mesa y miró por la ventana: el faro seguía ahí, inmóvil, como si esperara algo.",
    "—No deberías subir esta noche —dijo Tomás—. La escalera está resbalosa y la lámpara ya no funciona.",
    "Ella sonrió sin responder; había aprendido que algunas advertencias se agradecen mejor con el silencio.",
    "En la repisa, entre frascos de tornillos y mapas desteñidos, había un libro sin título cuyas páginas parecían de papel de arroz.",
    "Pasó la tarde leyendo, y cuando levantó la vista, la luz del día se había vuelto de un naranja espeso, casi líquido.",
    "Cada capítulo terminaba con una pregunta, y cada pregunta abría una puerta que daba a otro pasillo de la misma casa.",
    "Afuera, las gaviotas discutían por los restos de la pesca; adentro, el reloj contaba los minutos con una paciencia antigua.",
]


def parrafo(i, n=4):
    """Un párrafo de n frases, empezando en la frase i (así los párrafos no son todos iguales)."""
    return " ".join(FRASES[(i + k) % len(FRASES)] for k in range(n))


def crear_epub(ruta):
    capitulos = [("La llegada", 12), ("El cuaderno", 12), ("La lámpara apagada", 12)]

    def xhtml(titulo, cuerpo):
        return (
            '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
            '<html xmlns="http://www.w3.org/1999/xhtml" lang="es"><head><meta charset="utf-8"/>'
            f'<title>{titulo}</title><link rel="stylesheet" href="estilo.css"/></head><body>{cuerpo}</body></html>'
        )

    # El estilo del "editor" fija texto negro a propósito: sirve para comprobar que el tema oscuro lo corrige.
    estilo = "p { color: #000; text-align: justify; font-size: 14px; } h1 { color: #000; }"
    archivos = {
        "META-INF/container.xml": (
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
            "</rootfiles></container>"
        ),
        "OEBPS/estilo.css": estilo,
    }
    items = ""
    orden = ""
    indice = ""
    for n, (titulo, cantidad) in enumerate(capitulos, start=1):
        cuerpo = f"<h1>{titulo}</h1>" + "".join(f"<p>{parrafo(n + i)}</p>" for i in range(cantidad))
        archivos[f"OEBPS/cap{n}.xhtml"] = xhtml(titulo, cuerpo)
        items += f'<item id="cap{n}" href="cap{n}.xhtml" media-type="application/xhtml+xml"/>'
        orden += f'<itemref idref="cap{n}"/>'
        indice += f'<li><a href="cap{n}.xhtml">{titulo}</a></li>'
    archivos["OEBPS/nav.xhtml"] = (
        '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es">'
        f'<head><meta charset="utf-8"/><title>Índice</title></head><body><nav epub:type="toc"><ol>{indice}</ol></nav></body></html>'
    )
    archivos["OEBPS/content.opf"] = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:identifier id="id">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>'
        "<dc:title>El faro de papel (muestra)</dc:title><dc:creator>Autora de Muestra</dc:creator>"
        '<dc:language>es</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>'
        '<meta name="cover" content="portada"/></metadata>'
        '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        '<item id="estilo" href="estilo.css" media-type="text/css"/>'
        '<item id="portada" href="portada.png" media-type="image/png" properties="cover-image"/>'
        f"{items}</manifest><spine>{orden}</spine></package>"
    )

    # Portada de 300x450: degradado verde con franjas diagonales.
    def color_portada(x, y):
        base = mezclar((24, 90, 84), (10, 40, 52), y / 450)
        return (230, 200, 120) if (x + y) % 90 < 6 else base

    ruta_portada = ruta.with_name("_portada.png")
    escribir_png(ruta_portada, 300, 450, color_portada)

    with zipfile.ZipFile(ruta, "w") as zf:
        # Regla del formato: "mimetype" va primero y SIN comprimir.
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        for nombre, contenido in archivos.items():
            zf.writestr(nombre, contenido, compress_type=zipfile.ZIP_DEFLATED)
        zf.write(ruta_portada, "OEBPS/portada.png", compress_type=zipfile.ZIP_DEFLATED)
    ruta_portada.unlink()


def crear_pdf(ruta, titulo, autor, paginas, indice):
    """Escribe un PDF sencillo a mano.

    paginas: lista de (titulo_de_capitulo o None, [renglones])
    indice:  lista de (titulo, numero_de_pagina, nivel); nivel 0 = capítulo, 1 = sección dentro del capítulo
    """
    hex_utf16 = lambda s: "<FEFF" + s.encode("utf-16-be").hex().upper() + ">"  # texto con acentos en el índice
    esc = lambda s: s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    n = len(paginas)

    # Numeración de objetos: 1 catálogo, 2 páginas, 3-4 fuentes, 5 info, luego (página, contenido) por cada página
    # y al final el índice.
    pagina_obj = lambda i: 6 + 2 * i
    contenido_obj = lambda i: 7 + 2 * i
    raiz_indice = 6 + 2 * n

    # Árbol del índice: cada capítulo con sus secciones.
    arbol = []
    for titulo_i, num, nivel in indice:
        nodo = {"titulo": titulo_i, "pagina": num, "hijos": []}
        if nivel == 0 or not arbol:
            arbol.append(nodo)
        else:
            arbol[-1]["hijos"].append(nodo)
    siguiente = [raiz_indice + 1]
    objetos = {}

    def construir(nodos, padre):
        ids = []
        for nodo in nodos:
            nodo["id"] = siguiente[0]
            siguiente[0] += 1
            ids.append(nodo["id"])
        for k, nodo in enumerate(nodos):
            hijos_ids = construir(nodo["hijos"], nodo["id"])
            partes = [f"/Title {hex_utf16(nodo['titulo'])}", f"/Parent {padre} 0 R",
                      f"/Dest [{pagina_obj(nodo['pagina'] - 1)} 0 R /Fit]"]
            if k > 0:
                partes.append(f"/Prev {ids[k - 1]} 0 R")
            if k < len(nodos) - 1:
                partes.append(f"/Next {ids[k + 1]} 0 R")
            if hijos_ids:
                partes += [f"/First {hijos_ids[0]} 0 R", f"/Last {hijos_ids[-1]} 0 R", f"/Count {len(hijos_ids)}"]
            objetos[nodo["id"]] = ("<< " + " ".join(partes) + " >>").encode("latin-1")
        return ids

    ids_raiz = construir(arbol, raiz_indice)
    objetos[raiz_indice] = (
        f"<< /Type /Outlines /First {ids_raiz[0]} 0 R /Last {ids_raiz[-1]} 0 R /Count {len(ids_raiz)} >>"
    ).encode("latin-1")

    objetos[1] = f"<< /Type /Catalog /Pages 2 0 R /Outlines {raiz_indice} 0 R >>".encode("latin-1")
    kids = " ".join(f"{pagina_obj(i)} 0 R" for i in range(n))
    objetos[2] = f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode("latin-1")
    objetos[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    objetos[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    objetos[5] = f"<< /Title {hex_utf16(titulo)} /Author {hex_utf16(autor)} >>".encode("latin-1")

    for i, (cap, renglones) in enumerate(paginas):
        texto = ["BT"]
        y = 730
        if cap:
            texto.append(f"/F2 26 Tf 1 0 0 1 60 {y} Tm ({esc(cap)}) Tj")
            y -= 46
        texto.append("/F1 12 Tf")
        for renglon in renglones:
            texto.append(f"1 0 0 1 60 {y} Tm ({esc(renglon)}) Tj")
            y -= 16
        texto.append(f"/F1 10 Tf 1 0 0 1 280 40 Tm (- {i + 1} -) Tj")
        texto.append("ET")
        flujo = "\n".join(texto).encode("cp1252")
        objetos[contenido_obj(i)] = b"<< /Length %d >>\nstream\n" % len(flujo) + flujo + b"\nendstream"
        objetos[pagina_obj(i)] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {contenido_obj(i)} 0 R "
            "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>"
        ).encode("latin-1")

    salida = bytearray(b"%PDF-1.4\n")
    posiciones = {}
    for numero in sorted(objetos):
        posiciones[numero] = len(salida)
        salida += b"%d 0 obj\n" % numero + objetos[numero] + b"\nendobj\n"
    inicio_xref = len(salida)
    total = max(objetos) + 1
    salida += b"xref\n0 %d\n0000000000 65535 f \n" % total
    for numero in range(1, total):
        salida += b"%010d 00000 n \n" % posiciones[numero]
    salida += b"trailer\n<< /Size %d /Root 1 0 R /Info 5 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (total, inicio_xref)
    Path(ruta).write_bytes(bytes(salida))


def crear_pdf_muestra(ruta):
    import textwrap

    capitulos = {1: "Capítulo 1: La llegada", 5: "Capítulo 2: El cuaderno", 9: "Capítulo 3: La lámpara apagada"}
    paginas = []
    for p in range(1, 13):
        renglones = []
        for k in range(5):
            renglones += textwrap.wrap(parrafo(p + k, 4), 88) + [""]
        paginas.append((capitulos.get(p), renglones[: 34 if p in capitulos else 38]))
    indice = [
        ("Capítulo 1: La llegada", 1, 0),
        ("El viento del mar", 3, 1),
        ("Capítulo 2: El cuaderno", 5, 0),
        ("Capítulo 3: La lámpara apagada", 9, 0),
        ("Epílogo", 12, 1),
    ]
    crear_pdf(ruta, "Mapa del faro (muestra)", "Autor de Muestra", paginas, indice)


def crear_muestras():
    carpeta = RAIZ / "muestras"
    carpeta.mkdir(exist_ok=True)
    crear_epub(carpeta / "El faro de papel.epub")
    crear_pdf_muestra(carpeta / "Mapa del faro.pdf")

    # TXT en UTF-8, estilo Gutenberg: renglones cortados a mano y línea en blanco entre párrafos.
    # Los "Capítulo N" sirven para probar el índice de los TXT.
    renglones = []
    for i in range(10):
        if i % 4 == 0:
            renglones += [f"Capítulo {i // 4 + 1}", ""]
        palabras = parrafo(i).split()
        for j in range(0, len(palabras), 11):
            renglones.append(" ".join(palabras[j:j + 11]))
        renglones.append("")
    # Se escribe en bytes: con write_text, Windows convertiría cada "\r\n" en "\r\r\n".
    texto = "Cuaderno de a bordo\r\n\r\n" + "\r\n".join(renglones)
    (carpeta / "ejemplo utf8.txt").write_bytes(texto.encode("utf-8"))

    # TXT en windows-1252 (el de Windows antiguo), un párrafo por línea: prueba acentos y la detección de codificación.
    lineas = [parrafo(i, 3) for i in range(8)]
    (carpeta / "ejemplo windows.txt").write_bytes("Año nuevo, vida nueva\r\n".encode("cp1252") + "\r\n".join(lineas).encode("cp1252"))

    # HTML "con malas intenciones": sirve para comprobar que el visor lo neutraliza.
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Página de prueba</title>
<meta name="author" content="Quien Sea">
<style>body {{ background: red; color: red; }}</style>
<script>document.title = 'HACKEADO'; window.parent.__hackeado = true;</script></head>
<body style="background:red">
<h1 onclick="window.parent.__hackeado = true">Una página HTML</h1>
<p>{parrafo(0)}</p>
<p>Ir a la <a href="#nota">nota al final</a>. Enlace externo: <a href="https://example.com/">example.com</a>.</p>
<p><img src="https://example.com/rastreador.png" alt="imagen remota (debe bloquearse)"></p>
{"".join(f"<p>{parrafo(i)}</p>" for i in range(1, 12))}
<h2 id="nota">Nota</h2><p>Llegaste a la nota.</p>
</body></html>"""
    (carpeta / "ejemplo.html").write_bytes(html.encode("utf-8"))


if __name__ == "__main__":
    crear_iconos()
    crear_muestras()
    print("Listo: icons/ y muestras/ generados en", RAIZ)
