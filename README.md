# Visor de unidad/semana — U.INCCA

Visor estático (HTML + CSS + JS, sin build, sin frameworks, sin
dependencias salvo Font Awesome vía CDN) que muestra los **recursos
internos de una unidad/semana** de un curso: lecturas, videos, documentos
embebidos, enlaces complementarios, actividades y hasta bloques de HTML
libre. Pensado para incrustarse como `<iframe>` en Moodle, con la misma
arquitectura de datos que el visor de curso principal ("visor final") —
JSON por `window.name`, cero contenido hardcodeado, misma paleta
institucional.

Este visor **no** reemplaza a Moodle: solo presenta, con un diseño
propio, el mismo tipo de contenido que hoy se pega como HTML dentro de
una semana de Moodle (bloques tipo tabla con imagen + texto, grillas de
video, documentos embebidos, listas de enlaces, actividades con foros o
talleres).

## Índice

- [Principio de diseño: cero datos hardcodeados](#principio-de-diseño-cero-datos-hardcodeados)
- [Cómo probarlo en tu máquina](#cómo-probarlo-en-tu-máquina)
- [Cómo llegan los datos: `window.name`, a fondo](#cómo-llegan-los-datos-windowname-a-fondo)
- [Esquema del JSON](#esquema-del-json)
  - [Los 7 tipos de recurso, de un vistazo](#los-7-tipos-de-recurso-de-un-vistazo)
- [Enlaces embebidos automáticamente: `toEmbedUrl()`](#enlaces-embebidos-automáticamente-toembedurl)
- [Estados vacíos y tolerancia a datos parciales](#estados-vacíos-y-tolerancia-a-datos-parciales)
- [Franja de estadísticas: siempre calculada, nunca hardcodeada](#franja-de-estadísticas-siempre-calculada-nunca-hardcodeada)
- [Interfaz](#interfaz)
- [Estructura del proyecto](#estructura-del-proyecto)

---

## Principio de diseño: cero datos hardcodeados

Ningún texto, enlace ni recurso vive en el código. Todo llega desde
afuera como JSON. El único campo con contenido garantizado es `unidad`
(el nombre de la semana/unidad); si falta, se muestra un placeholder
genérico ("Nombre de la unidad") en vez de romper la página. Cada campo
se completa de forma **independiente** — datos parciales siempre se ven
bien, nunca a medias ni rotos.

---

## Cómo probarlo en tu máquina

No hace falta Moodle para ver el visor andando con datos reales:

1. Abrí la carpeta raíz del repo (un nivel arriba de esta) con tu
   editor y arrancá un servidor local — por ejemplo, la extensión
   **Live Server** de VS Code (clic derecho sobre
   `prueba-visor-unidad.html` → "Open with Live Server").
2. `prueba-visor-unidad.html` es un HTML mínimo, un nivel arriba de esta
   carpeta, con un solo `<iframe src="http://127.0.0.1:5500/visor unidad/index.html">`
   que le pasa datos de ejemplo reales de una unidad completa (los 7
   tipos de recurso, con links de verdad) a través de su atributo
   `name` — exactamente como lo haría Moodle (ver la sección de abajo
   para el porqué de `window.name`).
3. Para probar tu propio JSON: abrí `prueba-visor-unidad.html`, editá el
   objeto dentro del atributo `name='...'` del `<iframe>`. Ojo con el
   escapado: ese archivo usa comillas simples para envolver el
   atributo, y las comillas dobles PROPIAS del JSON van escapadas como
   `&quot;` adentro (el mismo resultado que produce
   `htmlspecialchars(json_encode($datos), ENT_QUOTES)` en PHP — ver la
   forma recomendada de fijar `window.name`, más abajo). Guardá y Live
   Server recarga solo.
4. Si abrís `index.html` de este visor DIRECTO, sin pasar por
   `prueba-visor-unidad.html` (o sea, sin que nada haya fijado
   `window.name`), no vas a ver contenido real — vas a caer en los
   placeholders genéricos (`SIN_DATOS`). Eso es lo esperado: sirve para
   confirmar que el estado "sin datos" se ve bien, no para ver una
   unidad real.

---

## Cómo llegan los datos: `window.name`, a fondo

### Por qué `window.name` y no la URL ni `postMessage`

- **No la URL** (`?datos=...`): un curso real con varios recursos,
  párrafos largos y HTML pegado de Moodle fácilmente supera los ~2000
  caracteres que los navegadores/servidores toleran de forma confiable
  en una URL (error `414 URI Too Long`). `window.name` no tiene ese
  límite práctico (los navegadores permiten varios megabytes).
- **No `postMessage`**: exigiría que el visor ya esté cargado y haya
  avisado "estoy listo" antes de que el padre le mande los datos (un
  protocolo de sincronización extra, con condiciones de carrera si el
  mensaje llega antes de que el visor esté escuchando). `window.name` ya
  está disponible **desde el primer instante** en que el script del
  visor corre — no hay que esperar ni coordinar nada.
- **Por qué funciona pese a ser cross-origin**: `window.name` es una de
  las pocas propiedades que persiste en una ventana/frame **a través de
  navegaciones**, incluso entre orígenes distintos, y el navegador la
  deja disponible de fábrica al propio documento cargado en ese frame
  (no es el padre leyendo el `name` del hijo — eso sí estaría bloqueado
  por same-origin policy — es el **propio visor**, ya cargado en su
  frame, leyendo el `name` de **su propia ventana**, algo que siempre
  puede hacer). Por eso Moodle (un origen) puede "pasarle" datos a este
  visor (otro origen, en GitHub Pages) sin que ninguno de los dos
  necesite configurar CORS.

### Las dos formas de fijar `window.name` (elegir UNA)

**1. HTML estático (recomendada — la que usa Moodle vía PHP)**

El atributo HTML `name` de un `<iframe>` se convierte automáticamente en
el `window.name` del documento que cargue adentro, sin JavaScript de por
medio. Debe fijarse en la MISMA etiqueta que `src`:

```php
<iframe id="incca-visor-unidad" title="Visor de unidad — U.INCCA"
  style="width:100%; height:100vh; border:0;"
  src="https://<tu-usuario>.github.io/<tu-repo>/"
  name='<?php echo htmlspecialchars(json_encode($datosDeLaUnidad), ENT_QUOTES); ?>'>
</iframe>
```

- `json_encode($datosDeLaUnidad)` produce el JSON.
- `htmlspecialchars(..., ENT_QUOTES)` escapa comillas simples/dobles,
  `<`, `>` y `&` para que el JSON quepa **dentro del valor de un
  atributo HTML** sin romper el parseo del propio `<iframe>` — esto es
  escapado de **atributo HTML**, no de JSON; el JSON en sí queda intacto
  una vez el navegador decodifica el atributo. `window.name` recibe el
  string YA decodificado, listo para `JSON.parse()`.

**2. Desde JavaScript (si el padre arma/mueve el iframe dinámicamente)**

Hay que fijar `iframe.contentWindow.name` (el `name` de la ventana
anidada) — **nunca** `iframe.name` (que solo refleja el atributo HTML
del tag, no el `window.name` real del documento adentro) — y hacerlo
**antes** de fijar/cambiar `iframe.src`, porque `window.name` se resetea
en algunas condiciones de navegación si se fija después:

```js
const iframe = document.getElementById("incca-visor-unidad");
iframe.contentWindow.name = JSON.stringify(datosDeLaUnidad);
iframe.src = "https://<tu-usuario>.github.io/<tu-repo>/";
```

### Cómo lo lee el visor (`main.js`)

```js
function leerDatosDesdeWindowName() {
  try {
    if (!window.name) return null;
    const recibidos = JSON.parse(window.name);
    if (!recibidos || typeof recibidos !== "object") return null;
    return recibidos;
  } catch (e) {
    return null;
  }
}
```

- Si `window.name` está vacío (el visor se abrió suelto, sin iframe, o
  el padre no lo fijó) → `null`.
- Si el JSON viene corrupto/mal formado (typo al armar el string a
  mano, corte a mitad de una entrega grande, etc.) → el `catch` atrapa
  el error de `JSON.parse` y también devuelve `null`. **Nunca** una
  página en blanco ni un error visible al usuario final.
- En ambos casos, `obtenerDatos()` toma ese `null` y lo trata como `{}`
  — de ahí en más, el resto del pipeline de "completar campo a campo
  contra el placeholder" (ver abajo) hace el resto: la página siempre
  se ve bien, con placeholders genéricos donde falte algo.

### Ciclo de vida completo, paso a paso

1. Moodle (o quien sea el padre) arma el JSON con los datos reales de
   esa semana/unidad.
2. Lo imprime en el atributo `name` del `<iframe>` (forma 1) o lo fija
   en `contentWindow.name` antes de navegar (forma 2).
3. El navegador carga `index.html` de este visor dentro de ese frame.
4. En `DOMContentLoaded`, `main.js` llama `obtenerDatos()`, que a su vez
   llama `leerDatosDesdeWindowName()` y hace `JSON.parse(window.name)`.
5. Cada campo del objeto resultante se completa, **campo por campo**,
   contra los valores por defecto (ver la referencia completa más
   abajo) — nunca se descarta el objeto entero por un solo campo malo.
6. Se renderiza el hero, la franja de estadísticas (recalculada, nunca
   hardcodeada) y cada recurso, ya filtrado por `visible` y ordenado por
   `orden`.

---

## Esquema del JSON

```jsonc
{
  "unidad": "Semana 1",
  "titulo": "Arquitectura del artículo científico",
  "descripcion": "Breve resumen de la unidad.",
  "duracion_estimada": "2 horas",
  "volver_url": "",
  "recursos": [ /* ver "Referencia completa de campos" abajo */ ]
}
```

### Referencia completa de campos — objeto raíz

| Campo | Tipo | Si falta o es inválido | Dónde se usa |
|---|---|---|---|
| `unidad` | string | `"Nombre de la unidad"` | Título gigante del hero (`#heroUnidad`), palabra por palabra con animación escalonada. También el `<title>` de la pestaña no cambia (queda fijo en el HTML). |
| `titulo` | string | `""` → el subtítulo del hero queda oculto (`hidden`), no se muestra un placeholder ahí | Subtítulo del hero (`#heroTitulo`), justo debajo de `unidad`. |
| `descripcion` | string | `"Aquí aparecerá la descripción de esta unidad."` | Párrafo del hero (`#heroDescripcion`). |
| `duracion_estimada` | string | `""` → esa píldora simplemente no aparece en la franja de estadísticas (no se cuenta como stat "en cero") | Primera píldora de `#unitStats`, con ícono de reloj. |
| `volver_url` | string (URL) | `""` → el botón "Volver a las unidades" del hero queda oculto | `href` del botón `#heroBack`. Ver "Puente con Moodle" justo abajo — el clic no siempre navega ahí directo. |
| `recursos` | array de objetos | `[]` → estado vacío ilustrado (`#unitEmpty`: "Esta unidad todavía no tiene recursos."), riel de navegación oculto | Cada elemento se procesa con `mergeRecurso()` — ver abajo. |

Cualquier clave que no esté en esta lista se ignora silenciosamente (no
rompe nada, simplemente no se usa).

### Puente con Moodle: el botón "Volver a las unidades" (opcional, vía `volver_url`)

Este visor no vive en su propia pestaña: Moodle lo incrusta dentro de un
panel/mosaico ya abierto (formato de curso "Mosaicos" +
`local_visorincca`). Si el clic en "Volver a las unidades" simplemente
navegara a `volver_url`, el mosaico quedaría abierto de fondo y el
usuario perdería el contexto visual. Por eso `initHeroBack()` intenta
primero avisarle al padre por `postMessage` para que sea **Moodle**
quien cierre el mosaico con su propia animación nativa — sin recargar ni
abrir pestaña — y solo navega a `volver_url` como **fallback**:

1. Si el visor NO está embebido (`window.parent === window` — se abrió
   suelto, p. ej. en pruebas), el botón es un link normal: navega a
   `volver_url` sin más.
2. Si SÍ está embebido, el clic no navega de una: manda
   `{ source: "visorincca", type: "volver-unidades" }` a
   `window.parent` por `postMessage` con target-origin `"*"` (comodín —
   cada instalación de Moodle vive en un dominio distinto, así que el
   visor no puede ni debe fijar uno solo; el mensaje no lleva datos
   sensibles, y la validación de qué acepta la hace Moodle del lado de
   adentro, no este visor).
3. Si el padre confirma a tiempo con
   `{ source: "visorincca", type: "unidades-cerrado" }` (dentro de
   400 ms), ahí termina — Moodle ya se encargó de cerrar el mosaico.
4. Si no confirma a tiempo (Moodle no tiene el listener activo, o el
   padre no es Moodle) → cae al comportamiento normal: navega a
   `volver_url`. Nunca se queda un botón que no hace nada.

Mismo espíritu que el puente `sectionid` del visor de curso principal:
best-effort con fallback garantizado, sin que este visor necesite saber
en qué dominio ni bajo qué plugin está corriendo Moodle.

### Reglas comunes a TODOS los recursos de `recursos[]`

Antes de mirar los campos propios de cada `tipo`, estos aplican siempre:

| Campo | Tipo | Si falta | Notas |
|---|---|---|---|
| `tipo` | string | — | **Obligatorio en la práctica**: si no es exactamente uno de `texto`, `video-grid`, `video`, `documento`, `enlaces`, `lecturas`, `actividades`, `personalizado`, el recurso entero se descarta en silencio (no rompe el resto de la página, pero tampoco aparece). |
| `id` | string | `"recurso-N"` (N = posición 1-based del recurso dentro del array `recursos` tal como llegó, **antes** de aplicar `visible`/`orden`) | Se usa como `id` del `<section>` HTML (para anclas `#id` y el riel de navegación) y como llave del mapa interno `recursosPorId` (clicks en video/documento/actividad). Si vas a enlazar a un recurso desde afuera, poné un `id` explícito y estable — no dependas del autogenerado, que cambia si reordenás el array. |
| `titulo` | string | Un default específico por tipo (ver tabla de cada tipo abajo) | Título grande (`<h2>`) de la sección, y texto del riel/tooltip de navegación. |
| `visible` | boolean | `true` | En `false`, el recurso se excluye **por completo**: no se renderiza su `<section>`, no cuenta en la franja de estadísticas, no aparece en el riel de navegación, y no ocupa un número de watermark. Es exactamente como si no estuviera en el array — la diferencia es que queda documentado/reversible en el JSON en vez de borrado. |
| `orden` | number | La posición 0-based original del recurso en el array `recursos` (el mismo índice que alimenta el `id` autogenerado) | Determina el orden final de renderizado — **no** el orden en que aparece escrito en el array. Con `orden` explícito podés reordenar sin reescribir el array entero, o intercalar un recurso `personalizado` entre dos recursos "normales". Si dos recursos empatan en `orden`, se desempata por su posición original en el array (orden estable). El **watermark** (número gigante de fondo), el `"X de Y"` del eyebrow y la posición en el riel siempre reflejan este orden FINAL — nunca el orden crudo en que están escritos en el JSON. |

### Los 7 tipos de recurso, de un vistazo

| `tipo` | Para qué sirve | Campo(s) que lo definen |
|---|---|---|
| `texto` | Introducción/lectura escrita, con "lecciones" plegables opcionales | `parrafos`, `items[].descripcion` |
| `video-grid` | Varios videos en grilla | `items[].url` |
| `video` | Un solo video destacado (misma plantilla que `video-grid`, un ítem) | `url` |
| `documento` | Un documento embebido (PDF/Drive) con acciones (pantalla completa, abrir, adjunto) | `iframe_url` |
| `enlaces` | Lista de referencias externas genéricas, para leer (no se embeben) | `items[].url` |
| `lecturas` | Lecturas específicamente — documento + audiolibro opcional, dos plantillas visuales (`apoyo`/`complementarias`) | `variante`, `items[].audio_url`, `items[].embebido` |
| `actividades` | Actividades con nombre + link + tipo + descripción plegable (texto o HTML); diseño de lista o ampliado según haya varias o una sola | `items[].tipo`, `items[].descripcion`, `items[].descripcion_html` |
| `personalizado` | HTML o iframe de confianza, para lo que no encaje en los otros 6 | `html` / `iframe` |

Detalle completo de cada uno, con su JSON de ejemplo, abajo.

### `texto` — lectura/introducción con línea de tiempo de lecciones

```jsonc
{
  "tipo": "texto",
  "titulo": "Arquitectura del artículo científico",   // default: "Recurso de lectura"
  "parrafos": ["Primer párrafo...", "Segundo párrafo..."],
  "items": [
    { "titulo": "LECCIÓN 1 · La estructura IMRaD", "descripcion": "Un mapa para el investigador." }
  ]
}
```

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `parrafos` | array de strings | `[]` | Cada string se envuelve en un `<p>`. Los valores "falsy" (`""`, `null`) se descartan automáticamente — no generan párrafos vacíos. |
| `items` | array de `{ titulo, descripcion }` | `[]` | Se renderiza como un acordeón con línea de tiempo (una "lección" por ítem, numerada). `titulo`/`descripcion` de cada ítem: `""` si faltan (no rompe el acordeón, solo se ve un ítem con texto vacío). |

### `video-grid` — grilla de tarjetas de video

```jsonc
{
  "tipo": "video-grid",
  "titulo": "Microcápsulas de aprendizaje",   // default: "Videos"
  "items": [
    { "titulo": "Lección 1", "url": "https://drive.google.com/file/d/XXX/view", "portada": "" }
  ]
}
```

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `items` | array de `{ titulo, url, portada }` | `[]` | Con 0 ítems, la sección muestra "Todavía no hay videos para este recurso." en vez de una grilla vacía. Con 1 solo ítem, la grilla usa una sola columna angosta en vez de estirarse a lo ancho. |
| `items[].url` | string (YouTube/Vimeo/Drive) | `""` | Pasa por `toEmbedUrl()` (ver más abajo) al hacer clic — podés pegar el link normal "para compartir", no hace falta convertirlo a mano. |
| `items[].portada` | string (URL de imagen) | `""` → la miniatura usa un degradado institucional en vez de imagen (rota el ciclo de 4 degradados según la posición del ítem) | Imagen de fondo de la miniatura, antes de reproducir. |

### `video` — un solo video embebido, tratamiento "destacado"

```jsonc
{
  "tipo": "video",
  "titulo": "Presentación de la semana",   // default: "Video"
  "url": "https://youtu.be/XXXXXXXXXXX",
  "portada": ""
}
```

Internamente se normaliza a la MISMA plantilla que `video-grid`
(un único ítem, con la cinta "VIDEO DESTACADO" encima) — comparte
`items[].url`/`items[].portada` del tipo anterior, pero acá van sueltos
en el recurso (`url`, `portada`), no dentro de un array `items`.

### `documento` — documento embebido (PDF/Drive) con acciones

```jsonc
{
  "tipo": "documento",
  "titulo": "Lecturas de apoyo",   // default: "Documento"
  "documento_titulo": "Arquitectura del artículo científico",
  "iframe_url": "https://drive.google.com/file/d/XXX/preview",
  "enlace_url": "https://drive.google.com/file/d/XXX/view",
  "adjunto": { "titulo": "Versión en audio", "url": "https://...", "icono": "fa-headphones" }
}
```

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `documento_titulo` | string | `""` → no se muestra el enlace-título arriba del documento | Título enlazado (a `enlace_url` si existe, si no a `iframe_url`) encima del marco del documento. |
| `iframe_url` | string (URL embebible) | `""` → el marco muestra "Este documento todavía no está disponible." | Pasa por `toEmbedUrl()`. Alimenta también el botón "Pantalla completa" (abre el mismo embed en el modal). |
| `enlace_url` | string (URL) | `""` → no aparece el botón "Abrir en pestaña nueva" | Botón secundario, `target="_blank"`. |
| `adjunto` | objeto `{ titulo, url, icono }` o ausente | `null` → no aparece el botón de adjunto | Solo se activa si `adjunto.url` existe. `titulo` default `"Adjunto"`, `icono` default `"fa-paperclip"` (cualquier clase de Font Awesome sólido, sin el prefijo `fa-solid`). |

### `enlaces` — lista de referencias externas

```jsonc
{
  "tipo": "enlaces",
  "titulo": "Lecturas complementarias",   // default: "Enlaces complementarios"
  "items": [
    { "titulo": "Título de la referencia", "url": "https://doi.org/...", "fuente": "DOI" }
  ]
}
```

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `items` | array de `{ titulo, url, fuente }` | `[]` | Con 0 ítems: "Todavía no hay enlaces para este recurso." |
| `items[].url` | string | `"#"` | Se abre tal cual, `target="_blank"` — **no** pasa por `toEmbedUrl()` (son enlaces para leer, no para embeber). |
| `items[].fuente` | string | `""` → no se muestra la etiqueta de fuente | Badge pequeño bajo el título (p. ej. "DOI", "SciELO"). |

### `lecturas` — lista de lecturas (documento + audiolibro opcional)

Distinto de `enlaces`: **esto es específicamente para lecturas** — documentos
(típicamente PDFs en Google Drive) que además pueden tener una versión en
audio ("audiolibro", normalmente un `.wav`). Dos variantes visuales por
recurso (todos sus ítems comparten una — no se mezclan dentro del mismo
recurso):

```jsonc
{
  "tipo": "lecturas",
  "titulo": "Lecturas de apoyo",       // default: "Lecturas"
  "descripcion": "Documentos para profundizar en el tema de la unidad. Cada lectura está disponible en texto y como audiolibro.",  // opcional
  "variante": "apoyo",                 // "apoyo" (default) | "complementarias"
  "items": [
    {
      "titulo": "Introducción conceptual",
      "url": "https://drive.google.com/file/d/XXX/view",
      "embebido": true,                // true: se abre en el modal de lectura del propio visor. false/ausente: pestaña nueva
      "audio_url": "https://drive.google.com/file/d/YYY/view",  // opcional — omitirlo no muestra el ícono de audio en ESE ítem
      "fuente": "DOI"                  // opcional — igual que en "enlaces"
    }
  ]
}
```

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `descripcion` | string | `""` → sin subtítulo | Párrafo corto arriba de la lista/grilla, mismo estilo que cualquier `<p>` de la sección. |
| `variante` | `"apoyo"` \| `"complementarias"` | `"apoyo"` | Cambia la PLANTILLA completa, no solo el color: `"apoyo"` es una grilla de tarjetas con portada tipo libro (ver abajo); `"complementarias"` es una lista compacta de filas (pensada para escalar a muchas referencias). También cambia el tema visual (claro vs. oscuro/dorado) y el eyebrow ("LECTURAS DE APOYO" / "LECTURAS COMPLEMENTARIAS"). Es del **recurso completo**, no por ítem — no se mezclan las dos plantillas dentro del mismo recurso. |
| `items` | array | `[]` | Con 0 ítems: "Todavía no hay lecturas para este recurso." |
| `items[].url` | string | `"#"` | El documento en sí (típicamente Drive). |
| `items[].embebido` | booleano | `false` | `true` → el título se vuelve un botón que abre el documento (pasa por `toEmbedUrl()`) en el **modal de lectura** (propio de este tipo, no el modal genérico de video/documento/actividades — ver más abajo). `false` → link normal a pestaña nueva. El ícono de flecha junto al título cambia solo (expandir vs. salir) para que se note antes de tocarlo. |
| `items[].audio_url` | string | `""` → sin ícono de audio en ese ítem | Siempre un link normal a pestaña nueva (nunca se embebe, aunque `embebido` sea `true` para el documento). Pensado para el `.wav`/audiolibro de esa misma lectura. |
| `items[].fuente` | string | `""` → sin etiqueta | Igual que en `enlaces` — badge pequeño bajo el título. |

**Tarjeta de la variante "apoyo"**: la portada no es un ícono chico en
una esquina, es un librito de verdad — dos hojas rotadas detrás simulan
una pila de papel, y la tapa (degradé institucional + insignia "PDF")
gira sobre su lomo al pasar el mouse por la tarjeta, revelando una hoja
con líneas de texto simuladas debajo — el mismo gesto físico de abrir
un libro. Las tarjetas entran en cascada (una cada ~80ms) cuando la
sección se vuelve visible.

**Modal de lectura**: los ítems `embebido:true` NO usan el modal
genérico de video/documento/actividades — abren uno propio
(`#readingModalOverlay` en `index.html` / `openReadingModal()` en
`main.js`), de una sola columna: una barra angosta arriba (ícono +
título + botón de audiolibro si el ítem lo trae + cerrar) y el
documento ocupando prácticamente todo el modal. A propósito NO tiene el
panel "tapa de libro" grande de las tarjetas — ahí es decorativo y
suma; acá competiría por espacio con la lectura en sí.

### `actividades` — una o varias actividades: nombre + link + descripción

```jsonc
{
  "tipo": "actividades",
  "titulo": "Actividades de la semana",   // default: "Actividades"
  "items": [
    {
      "nombre": "Foro: comparte tu idea de investigación",
      "tipo": "foro",                       // opcional — color/ícono/etiqueta
      "link": "https://moodle.../mod/forum/view.php?id=501",
      "descripcion": "Texto plano.\n\nSegundo párrafo, separado por línea en blanco.",
      "descripcion_html": false
    },
    {
      "nombre": "Taller: de la idea al problema",
      "tipo": "taller",
      "link": "https://moodle.../mod/assign/view.php?id=502",
      "descripcion": "<p>HTML con <strong>formato</strong>, tablas, imágenes, lo que sea.</p>",
      "descripcion_html": true
    }
  ]
}
```

**Dos diseños, elegidos automáticamente por la cantidad de ítems:**

- **Varias actividades** → lista de filas compactas plegables, conectadas
  por una línea de tiempo (como el acordeón de lecciones de `texto`).
- **Una sola actividad** → `unit-activities--single`: índice, ícono,
  nombre y espaciado ampliados, y la única tarjeta arranca abierta (no
  tiene sentido pedir un clic extra para ver el único contenido).

Cada actividad además lleva **color, ícono y una etiqueta de tipo**
(`Quiz`, `Tarea`, `Foro`, `Taller`, `Entrega`, `Examen`) — en la barra
superior de la tarjeta, el índice y el botón "ir".

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `items` | array de `{ nombre, tipo, link, descripcion, descripcion_html }` | `[]` | Con 0 ítems: "Todavía no hay actividades para este recurso." Con exactamente 1 ítem se usa el diseño ampliado `--single` y arranca abierta. Con 2+, filas compactas conectadas por una línea de tiempo. |
| `items[].nombre` | string | `""` | Encabezado de la fila. Es interactivo (acordeón) SOLO si `descripcion` no está vacía. |
| `items[].tipo` | string | Se **infiere del `link`** (`mod/quiz` → `quiz`, `mod/forum` → `foro`, `mod/workshop` → `taller`, `mod/assign` → `tarea`) y, si no matchea nada, `tarea` | Uno de `quiz`, `tarea`, `foro`, `taller`, `entrega`, `examen`. Define el color, el ícono y la etiqueta de la tarjeta — nada más (no cambia el comportamiento). Un valor no reconocido cae en `tarea`. |
| `items[].link` | string (URL) | `""` → no aparece el botón "ir a la actividad" | Botón redondo con flecha, **siempre visible** a un costado de la fila (no depende de expandir nada), más un segundo botón flotante idéntico DENTRO del popup si `descripcion_html: true` (para no tener que cerrar el popup y volver a la fila para ir a hacer la actividad). |
| `items[].descripcion` | string (texto plano o HTML) | `""` → el nombre no es interactivo, no hay flecha de acordeón | Qué es (texto o HTML) lo decide **exclusivamente** `descripcion_html` — el visor nunca intenta adivinarlo mirando el contenido del string, porque eso es frágil (un texto plano que por accidente contenga `<` rompería la detección). |
| `items[].descripcion_html` | boolean | `false` (texto plano — el caso más seguro) | `false`/ausente → al expandir la fila, el texto se muestra **inline**, escapado (`escapeHtml()`) y partido en párrafos por línea en blanco (`\n\n`) — así que aunque el texto contenga `<`/`>` por accidente, nunca se interpreta como etiquetas. `true` → el HTML **no** se muestra inline (arriesgaría el layout de toda la sección con estilos/tablas ajenos) — en su lugar, al expandir aparece un botón "Ver actividad completa" que abre ese HTML tal cual, con tipografía propia y scroll, dentro del modal de pantalla completa. |

### `personalizado` — sección custom: HTML o iframe de confianza

```jsonc
{
  "tipo": "personalizado",
  "titulo": "Bloque libre",   // default: "Recurso personalizado"
  "iframe": "https://...",
  "html": "<div>...</div>"
}
```

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `iframe` | string (URL ya lista para embeber) | `""` | Si llega, gana sobre `html`. Se usa **tal cual**, sin pasar por `toEmbedUrl()` — a diferencia de `url`/`iframe_url` en otros tipos, acá se espera directamente un link de embed (no uno "para compartir"). |
| `html` | string (HTML/CSS de confianza) | `""` | Se inyecta **directo dentro de la sección**, en el flujo normal de la página — a diferencia de la `descripcion` HTML de `actividades` (que va a un popup), este HTML **sí** se muestra inline: está pensado para SER la sección completa, no un fragmento dentro de otra plantilla. Es el mismo modelo de confianza que el resto del visor (contenido que arma el propio plugin/administrador de Moodle, no input de un usuario final). |

Sin `iframe` ni `html`, se muestra "Este recurso todavía no tiene
contenido." en vez de una sección en blanco.

**Para qué sirve**: agregar una sección nueva sin tocar el HTML/JS del
visor — participa del mismo tema visual, ícono, watermark, riel de
navegación y sistema de `visible`/`orden` que cualquier otro tipo. Es la
puerta de escape para cualquier contenido que no encaje en los otros 6
tipos (mensajes especiales, contenido pegado directo de Moodle sin
querer reestructurarlo campo a campo, embeds de terceros, etc.).

---

## Enlaces embebidos automáticamente: `toEmbedUrl()`

```js
function toEmbedUrl(url) {
  if (!url) return "";
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const drive = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  return url;
}
```

Convierte automáticamente enlaces normales ("para compartir") de
YouTube (`youtu.be/…`, `youtube.com/watch?v=…`, `youtube.com/embed/…`),
Vimeo (`vimeo.com/…`) y Google Drive (`drive.google.com/file/d/…/view`)
a su URL de embed real (`youtube.com/embed/…`, `player.vimeo.com/…`,
`/preview`). Si la URL no matchea ninguno de los tres patrones, se
devuelve **tal cual** (útil para iframes ya embebibles de otros
orígenes). Se usa en `items[].url` de `video-grid`/`video` y en
`iframe_url` de `documento` — **no** en `enlaces` (esos son para leer,
no para embeber) ni en `personalizado.iframe` (ver arriba, ahí se usa
tal cual a propósito).

## Estados vacíos y tolerancia a datos parciales

- `recursos: []` (o ausente, o no es un array) → estado vacío ilustrado
  (`#unitEmpty`), riel de navegación oculto, franja de estadísticas
  oculta.
- Un `tipo` no reconocido → ese recurso se omite en silencio, el resto
  de la página sigue funcionando normal (ni un hueco ni un error).
- Un recurso sin `items`/`url`/`iframe_url` (según su tipo) → su
  sección se renderiza igual, con un mensaje corto de "todavía no
  disponible" en el lugar del contenido, nunca una sección rota o vacía
  sin explicación.
- JSON corrupto en `window.name` → toda la unidad cae a los
  placeholders genéricos de la tabla del objeto raíz (equivalente a
  `recursos: []`).

## Franja de estadísticas: siempre calculada, nunca hardcodeada

`renderStats()` recorre los `recursos` YA filtrados por `visible` y
ordenados por `orden`, y arma una píldora por tipo presente — **contando
lo que realmente hay**, no la cantidad de recursos:

- `texto`/`documento`: se cuenta el **recurso** (cada uno ya es "una
  lectura"/"un documento", aunque tenga varias `items` internas — esas
  son subsecciones de la MISMA lectura, no lecturas separadas).
- `video-grid`/`enlaces`/`actividades`: se suman las `items` de TODOS
  los recursos de ese tipo (cada recurso es un contenedor de varios
  ítems reales — un solo recurso `actividades` con 14 ítems dice
  "14 Actividades", no "1 Actividad").

Si un tipo no tiene ningún recurso visible, su píldora simplemente no
aparece (no se muestra "0 Videos").

`lecturas` es la excepción: no suma su propia píldora. Si tuviera la
misma etiqueta "Lectura(s)" que ya usa `texto`, un curso que use ambos
tipos a la vez vería dos píldoras "Lecturas" distintas — confuso y
redundante. Sus lecturas SÍ se cuentan igual dentro de su propia
sección (el número de ítems determina el layout), solo no suman a la
franja de estadísticas del hero.

---

## Interfaz

El visor es un **mazo de diapositivas horizontal**: el `<body>` no
scrollea nunca. El hero y cada recurso son una diapositiva del ancho del
viewport dentro de `.unit-main`, una pista que se traslada en X con
`transform` (no con scroll — un transform no lo "cancela" un cambio de
layout, cosa que sí le pasa al scroll con `scroll-snap`). Si el contenido
de una diapositiva no cabe en el alto, scrollea **dentro** de ella.

- **Hero** (el único elemento que NO se puede ocultar/reordenar desde el
  JSON — siempre existe, siempre primero): degradado institucional,
  título palabra por palabra con entrada escalonada, textura de puntos y
  blobs animados. Si la unidad trae al menos un recurso `actividades`,
  aparece además un **CTA "Ir a actividades"** flotante que salta directo
  a esa diapositiva (con el total de actividades como badge).
- **Franja de estadísticas** flotando sobre el borde inferior del hero.
- **Cada recurso es un capítulo a pantalla completa** con tema propio
  (claro/oscuro/papel/cálido/acento según su tipo), número de paso como
  marca de agua gigante de fondo (sincronizada con el orden final, ver
  arriba), y una plantilla visual exclusiva por tipo.
- **Navegación** — se pasa de una diapositiva a otra con:
  - **Riel inferior** (dock flotante en escritorio, barra fija arriba en
    móvil): un punto por recurso más un punto "Inicio" para el hero;
    ícono siempre visible, etiqueta al pasar el cursor / en el activo. El
    punto activo se centra solo en la pista. A la izquierda, un panel con
    el nombre del recurso actual y su posición (X/Y).
  - **Flechas contextuales** en los bordes: cada una muestra el nombre y
    el ícono del recurso vecino (no un genérico "‹/›"), y al hacer clic
    "explotan" como burbuja antes de pasar. Se ocultan en el primer/último
    recurso.
  - **Teclado** (←/→, AvPág/RePág, Inicio/Fin), **swipe** en táctil, y el
    deep-link `#id-del-recurso` para abrir directo una diapositiva.
  - **Barra de progreso** arriba de todo, se llena según el índice de la
    diapositiva activa.
- **Modal de pantalla completa**, compartido por video, documento y las
  descripciones HTML de `actividades` (fondo con blur, animación de
  entrada, cierra con Escape/clic afuera, destruye el contenido al
  cerrar para detener la reproducción). Los ítems `embebido:true` de
  `lecturas` NO usan este: tienen su propio **modal de lectura**, de una
  sola columna, pensado para maximizar el espacio de lectura (ver la
  sección `lecturas` más arriba).
- Todo respeta `prefers-reduced-motion` (sin animación de burbuja, sin
  scroll suave del riel, revelado inmediato).
- 100% responsive, sin dependencias de build — funciona directo en
  GitHub Pages.

## Estructura del proyecto

```
index.html               — markup, un único <script> y <link> propios
assets/
  css/styles.css          — tokens institucionales + todo el visual
  js/main.js               — lectura de datos + render, sin dependencias
README.md                 — este archivo
```

No hay build ni `node_modules`: se sirve tal cual, como archivos
estáticos (GitHub Pages, cualquier servidor web, o directo desde disco
para pruebas rápidas).
