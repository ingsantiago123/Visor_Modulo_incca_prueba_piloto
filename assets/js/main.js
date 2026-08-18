/* ==========================================================================
   U.INCCA · Visor de unidad/semana — lee el contenido (unidad, recursos)
   desde window.name como JSON. Sin datos hardcodeados: cada campo que no
   llegue se completa, campo a campo, con un placeholder genérico — nunca
   con contenido inventado que pueda confundirse con datos reales.

   Cada recurso se renderiza como una sección a pantalla completa con un
   tema propio según su tipo (claro/oscuro/papel/cálido/acento), navegada
   por un riel flotante: vertical a la izquierda en escritorio (>=980px),
   y el mismo componente reorientado a un dock horizontal fijo abajo en
   pantallas angostas — no desaparece, se adapta (ver el CSS de
   ".unit-rail" en styles.css para el cambio de layout).

   MOSTRAR/OCULTAR/REORDENAR (misma lógica que "secciones" en visor
   final, aplicada acá directo sobre cada ítem de "recursos" ya que aquí
   no hay diapositivas fijas — todo el mazo es dinámico): cada recurso
   acepta "visible" (opcional, default true — false lo excluye del todo:
   ni se renderiza, ni cuenta en las estadísticas, ni aparece en el riel)
   y "orden" (opcional, número — default: su posición en el array
   "recursos"). El watermark, la numeración "X de Y" y el riel de
   navegación se recalculan siempre a partir de ese orden final, nunca
   del orden crudo del JSON — ver obtenerDatos().

   DIAPOSITIVAS/SECCIONES CUSTOM DESDE HTML (misma lógica que
   "diapositivas_extra" en visor final): un recurso con "tipo":
   "personalizado" inyecta HTML o un iframe de confianza como una sección
   más del mazo, con su propio "titulo"/"visible"/"orden" — participa del
   mismo tema/watermark/riel que cualquier otro tipo. Si llegan los dos,
   "iframe" gana sobre "html" (mismo contrato que el visor principal).
   ========================================================================== */
(function () {
  "use strict";

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  /* ---------------------------------------------------------------------
   * 1. Placeholders — igual filosofía que "visor final": genéricos y
   *    obviamente de relleno, para que sea evidente qué llegó real y qué
   *    todavía no.
   * ------------------------------------------------------------------- */
  const SIN_DATOS = {
    unidad: "Nombre de la unidad",
    titulo: "",
    descripcion: "Aquí aparecerá la descripción de esta unidad.",
    duracion_estimada: "",
    volver_url: "",
    recursos: []
  };

  const TIPOS_VALIDOS = ["texto", "video-grid", "video", "documento", "enlaces", "lecturas", "actividades", "personalizado"];

  const DEFAULTS_POR_TIPO = {
    texto: { titulo: "Recurso de lectura", parrafos: [], items: [] },
    "video-grid": { titulo: "Videos", items: [] },
    video: { titulo: "Video", url: "" },
    documento: { titulo: "Documento", documento_titulo: "", iframe_url: "", enlace_url: "", adjunto: null },
    enlaces: { titulo: "Enlaces complementarios", items: [] },
    // "lecturas" es DISTINTO de "texto": no es contenido escrito adentro
    // del visor, es una LISTA de documentos externos (típicamente PDFs en
    // Google Drive) con su propio audiolibro opcional — ver mergeRecurso()
    // para el detalle de "variante" (apoyo/complementarias) y "embebido".
    lecturas: { titulo: "Lecturas", descripcion: "", variante: "apoyo", items: [] },
    actividades: { titulo: "Actividades", items: [] },
    personalizado: { titulo: "Recurso personalizado", iframe: "", html: "" }
  };

  // Ícono por tipo "original" (antes de normalizar "video" -> "video-grid").
  const META_ICON = {
    texto: "fa-book-open", "video-grid": "fa-clapperboard", video: "fa-circle-play",
    documento: "fa-file-lines", enlaces: "fa-link", lecturas: "fa-book-open-reader",
    actividades: "fa-list-check", personalizado: "fa-puzzle-piece"
  };

  // Cada tipo de recurso "normalizado" vive en un tema visual propio —
  // no es una tarjeta genérica, es un capítulo con su propia identidad.
  // "lecturas" es la excepción: su tema/eyebrow dependen de "variante"
  // (apoyo/complementarias), no son fijos por tipo — se resuelven aparte,
  // más abajo en mergeRecurso(); estas entradas son solo el respaldo.
  const GROUP_BY_TYPE = { texto: "light", "video-grid": "dark", documento: "paper", enlaces: "warm", lecturas: "paper", actividades: "accent", personalizado: "light" };
  const EYEBROW_BY_TYPE = { texto: "LECTURA", "video-grid": "MULTIMEDIA", documento: "DOCUMENTO", enlaces: "REFERENCIAS", lecturas: "LECTURAS", actividades: "ACTIVIDADES", personalizado: "PERSONALIZADO" };

  const VIDEO_TINTS = [
    "linear-gradient(135deg, #65CBE3, #2B8BFA)",
    "linear-gradient(135deg, #2B8BFA, #0B349D)",
    "linear-gradient(150deg, #0B349D, #040C38)",
    "linear-gradient(120deg, #65CBE3, #0B349D)"
  ];

  // "contarItems" decide QUÉ se cuenta para cada tipo — no todos los
  // tipos significan lo mismo por recurso:
  //   - texto/documento: cada RECURSO ya es "una lectura"/"un documento"
  //     (sus "items" internos, si hay, son subsecciones de esa MISMA
  //     lectura — no lecturas separadas), así que se cuentan recursos.
  //   - video-grid/enlaces/actividades: cada recurso es un CONTENEDOR de
  //     varios ítems reales (videos/enlaces/actividades) — contar el
  //     recurso como "1" sería mentir sobre cuánto contenido hay
  //     realmente (p.ej. un solo recurso "actividades" con 14 ítems
  //     debe decir "14 Actividades", no "1 Actividad"), así que se
  //     suman los "items" de todos los recursos de ese tipo.
  const STAT_GROUPS = [
    { tipo: "texto", icon: "fa-book-open", label: "Lectura", plural: "Lecturas", contarItems: false },
    { tipo: "video-grid", icon: "fa-clapperboard", label: "Video", plural: "Videos", contarItems: true },
    { tipo: "documento", icon: "fa-file-lines", label: "Documento", plural: "Documentos", contarItems: false },
    { tipo: "enlaces", icon: "fa-link", label: "Enlace", plural: "Enlaces", contarItems: true },
    { tipo: "actividades", icon: "fa-list-check", label: "Actividad", plural: "Actividades", contarItems: true }
  ];

  /* ---------------------------------------------------------------------
   * 2. Lectura de datos desde window.name (JSON) — con try/catch de rescate
   * ------------------------------------------------------------------- */
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

  // Usado SOLO para la descripción de una actividad cuando el propio JSON
  // dice explícitamente que es texto plano (descripcion_html: false/ausente)
  // — así ese texto nunca se interpreta como marcado, aunque contenga
  // caracteres "<"/">" por accidente. El resto del visor no escapa nada
  // (mismo modelo de confianza que el resto del contenido autorizado).
  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Cada recurso se completa campo a campo contra el default de SU tipo.
  // "video" se normaliza a la misma forma que "video-grid" (un solo ítem,
  // marcado como "destacado") para compartir plantilla — tipoOriginal se
  // conserva solo para el ícono de navegación.
  function mergeRecurso(raw, idx) {
    const r = (raw && typeof raw === "object") ? raw : {};
    let tipo = TIPOS_VALIDOS.includes(r.tipo) ? r.tipo : null;
    if (!tipo) return null; // recurso sin "tipo" reconocido: se omite, no rompe el layout

    const def = DEFAULTS_POR_TIPO[tipo];
    const id = (r.id && String(r.id)) || `recurso-${idx + 1}`;
    const titulo = r.titulo || def.titulo;
    const tipoOriginal = r.tipo || tipo;
    // Mismo contrato que "secciones"/"diapositivas_extra" en visor final:
    // "visible" default true, "orden" default a la posición original en
    // el array — así el JSON puede ocultar/reordenar sin tocar el resto.
    const visible = r.visible !== false;
    const orden = Number.isFinite(r.orden) ? r.orden : idx;

    let cuerpo = {};
    if (tipo === "texto") {
      cuerpo = {
        parrafos: Array.isArray(r.parrafos) ? r.parrafos.filter(Boolean) : def.parrafos,
        items: Array.isArray(r.items) ? r.items.map((it) => ({
          titulo: (it && it.titulo) || "",
          descripcion: (it && it.descripcion) || ""
        })) : def.items
      };
    } else if (tipo === "video-grid") {
      cuerpo = {
        isFeatured: false,
        items: Array.isArray(r.items) ? r.items.map((it) => ({
          titulo: (it && it.titulo) || "",
          url: (it && it.url) || "",
          portada: (it && it.portada) || ""
        })) : def.items
      };
    } else if (tipo === "video") {
      cuerpo = { isFeatured: true, items: [{ titulo, url: r.url || def.url, portada: r.portada || "" }] };
      tipo = "video-grid";
    } else if (tipo === "documento") {
      cuerpo = {
        documento_titulo: r.documento_titulo || def.documento_titulo,
        iframe_url: r.iframe_url || def.iframe_url,
        enlace_url: r.enlace_url || def.enlace_url,
        adjunto: (r.adjunto && typeof r.adjunto === "object" && r.adjunto.url)
          ? { titulo: r.adjunto.titulo || "Adjunto", url: r.adjunto.url, icono: r.adjunto.icono || "fa-paperclip" }
          : def.adjunto
      };
    } else if (tipo === "enlaces") {
      cuerpo = {
        items: Array.isArray(r.items) ? r.items.map((it) => ({
          titulo: (it && it.titulo) || "",
          url: (it && it.url) || "#",
          fuente: (it && it.fuente) || ""
        })) : def.items
      };
    } else if (tipo === "lecturas") {
      // "variante" es del RECURSO completo (todas sus lecturas comparten
      // el mismo tratamiento visual — dos diseños distintos, no una mezcla
      // por ítem): "apoyo" (claro, con espacio para audiolibro) o
      // "complementarias" (oscuro/dorado, solo título+link, sin audio).
      // Cada ítem controla su PROPIO comportamiento de apertura:
      // "embebido":true lo abre en el modal de pantalla completa del
      // propio visor (como el botón "Pantalla completa" de "documento");
      // sin eso, es un link normal a pestaña nueva. "audio_url" es
      // independiente y opcional en cualquiera de los dos casos — si un
      // ítem puntual no trae audiolibro, simplemente no muestra el ícono.
      cuerpo = {
        variante: r.variante === "complementarias" ? "complementarias" : "apoyo",
        descripcion: r.descripcion || def.descripcion,
        items: Array.isArray(r.items) ? r.items.map((it) => ({
          titulo: (it && it.titulo) || "",
          url: (it && it.url) || "#",
          embebido: !!(it && it.embebido),
          audio_url: (it && it.audio_url) || "",
          fuente: (it && it.fuente) || ""
        })) : def.items
      };
    } else if (tipo === "actividades") {
      // Cada actividad trae, como mucho, 3 datos: nombre, link y una
      // descripción — que puede ser texto plano o HTML. Cuál de los dos
      // es, NO se adivina (no se "huele" el string buscando etiquetas):
      // lo decide explícitamente "descripcion_html" en cada ítem, para
      // que quien arma el JSON tenga control total. Sin ese flag, se
      // asume texto plano siempre (el caso más seguro por defecto).
      cuerpo = {
        items: Array.isArray(r.items) ? r.items.map((it) => ({
          nombre: (it && it.nombre) || "",
          link: (it && it.link) || "",
          descripcion: (it && it.descripcion) || "",
          descripcionHtml: !!(it && it.descripcion_html)
        })) : def.items
      };
    } else if (tipo === "personalizado") {
      // Mismo contrato que "diapositivas_extra" del visor principal: si
      // llegan los dos, "iframe" gana sobre "html"; el iframe se usa tal
      // cual (se espera una url ya lista para incrustar, no un link para
      // compartir), y el HTML es contenido de confianza (mismo criterio
      // que el resto del visor), inyectado directo — no va a un popup.
      cuerpo = { iframe: r.iframe || def.iframe, html: r.html || def.html };
    }

    // "lecturas" es la única excepción a "tema/eyebrow fijos por tipo": acá
    // dependen de "variante", calculada arriba en el bloque de cuerpo.
    const esComplementaria = tipo === "lecturas" && cuerpo.variante === "complementarias";
    const tema = tipo === "lecturas"
      ? (esComplementaria ? "warm" : "paper")
      : (GROUP_BY_TYPE[tipo] || "light");
    const eyebrow = tipo === "lecturas"
      ? (esComplementaria ? "LECTURAS COMPLEMENTARIAS" : "LECTURAS DE APOYO")
      : (EYEBROW_BY_TYPE[tipo] || "RECURSO");

    return Object.assign({
      id, tipo, tipoOriginal, titulo, visible, orden,
      icon: META_ICON[tipoOriginal] || META_ICON[tipo],
      tema, eyebrow
    }, cuerpo);
  }

  function obtenerDatos() {
    const recibidos = leerDatosDesdeWindowName() || {};
    return {
      unidad: recibidos.unidad || SIN_DATOS.unidad,
      titulo: recibidos.titulo || SIN_DATOS.titulo,
      descripcion: recibidos.descripcion || SIN_DATOS.descripcion,
      duracion_estimada: recibidos.duracion_estimada || SIN_DATOS.duracion_estimada,
      volver_url: recibidos.volver_url || SIN_DATOS.volver_url,
      recursos: (Array.isArray(recibidos.recursos) ? recibidos.recursos : SIN_DATOS.recursos)
        .map(mergeRecurso)
        .filter(Boolean)
        .filter((r) => r.visible)
        .sort((a, b) => a.orden - b.orden)
    };
  }

  /* ---------------------------------------------------------------------
   * 3. Render — hero (título palabra por palabra, con retardo creciente)
   * ------------------------------------------------------------------- */
  function renderHero(datos, hayRecursos) {
    $("#heroUnidad").innerHTML = datos.unidad.split(" ").map((w, i) =>
      `<span class="hero-title-word" style="animation-delay:${i * 90}ms">${w}</span>`
    ).join(" ");

    const sub = $("#heroTitulo");
    sub.hidden = !datos.titulo;
    sub.textContent = datos.titulo;

    $("#heroDescripcion").textContent = datos.descripcion;

    initHeroBack(datos);

    $("#heroScrollTip").hidden = !hayRecursos;
  }

  /**
   * Botón "Volver a las unidades": si este visor está embebido dentro de un
   * iframe (típicamente Moodle, con el mosaico ya abierto), le avisa al
   * padre por postMessage para que cierre ese mosaico y vuelva a la vista
   * principal, en vez de navegar a una URL nueva o abrir pestaña — así no
   * se pierde el contexto visual. Si el padre no contesta en 400ms (visor
   * abierto suelto sin Moodle, o Moodle no tiene el listener activo) cae al
   * comportamiento normal: navega al href como siempre. Nunca se queda un
   * botón que no hace nada.
   */
  function initHeroBack(datos) {
    const back = $("#heroBack");
    back.hidden = !datos.volver_url;
    if (!datos.volver_url) return;
    back.href = datos.volver_url;

    const estaEmbebido = window.parent && window.parent !== window;
    if (!estaEmbebido) return;

    back.addEventListener("click", function (event) {
      event.preventDefault();

      let resuelto = false;
      const onMensaje = function (ev) {
        const data = ev.data;
        if (!data || data.source !== "visorincca" || data.type !== "unidades-cerrado") return;
        resuelto = true;
        window.removeEventListener("message", onMensaje);
      };
      window.addEventListener("message", onMensaje);

      window.parent.postMessage({ source: "visorincca", type: "volver-unidades" }, "*");

      setTimeout(function () {
        if (!resuelto) {
          window.removeEventListener("message", onMensaje);
          window.location.href = datos.volver_url;
        }
      }, 400);
    });
  }

  /* ---------------------------------------------------------------------
   * 4. Render — franja de estadísticas
   * ------------------------------------------------------------------- */
  function renderStats(datos, resources) {
    const wrap = $("#unitStatsWrap");
    const stats = [];
    if (datos.duracion_estimada) stats.push({ icon: "fa-clock", isDuration: true, text: datos.duracion_estimada });
    STAT_GROUPS.forEach((g) => {
      const deEsteTipo = resources.filter((r) => r.tipo === g.tipo);
      const count = g.contarItems
        ? deEsteTipo.reduce((suma, r) => suma + (r.items ? r.items.length : 0), 0)
        : deEsteTipo.length;
      if (count > 0) stats.push({ icon: g.icon, isDuration: false, count, text: count === 1 ? g.label : g.plural });
    });
    if (!stats.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $("#unitStats").innerHTML = stats.map((s) => {
      const texto = s.isDuration
        ? `<span class="unit-stat-text"><span class="unit-stat-eyebrow">Duración</span><span class="unit-stat-value">${s.text}</span></span>`
        : `<span class="unit-stat-text"><span class="unit-stat-count">${s.count}</span><span class="unit-stat-label">${s.text}</span></span>`;
      return `<div class="unit-stat"><span class="unit-stat-icon" aria-hidden="true"><i class="fa-solid ${s.icon}"></i></span>${texto}</div>`;
    }).join("");
  }

  /* ---------------------------------------------------------------------
   * 5. Render — cuerpo por tipo de recurso
   * ------------------------------------------------------------------- */
  function cuerpoTexto(r) {
    const parrafos = r.parrafos.map((p) => `<p>${p}</p>`).join("");
    const lessons = r.items.length ? `<div class="unit-lessons">
      <div class="unit-lessons-line" aria-hidden="true"></div>
      ${r.items.map((it, i) => `
      <div class="unit-lesson" data-lesson>
        <span class="unit-lesson-num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
        <div class="unit-lesson-card">
          <button class="unit-lesson-toggle" type="button" aria-expanded="false">
            <span class="label">${it.titulo}</span>
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
          </button>
          <div class="unit-lesson-panel"><div class="unit-lesson-panel-inner"><p>${it.descripcion}</p></div></div>
        </div>
      </div>`).join("")}
    </div>` : "";
    return parrafos + lessons;
  }

  function cuerpoVideoGrid(r) {
    if (!r.items.length) return `<p class="unit-empty-inline">Todavía no hay videos para este recurso.</p>`;
    const single = r.items.length === 1;
    const cols = single ? "minmax(0,1fr)" : "repeat(auto-fill, minmax(240px,1fr))";
    const maxW = single ? (r.isFeatured ? "640px" : "460px") : "none";
    return `<div class="unit-videogrid" style="grid-template-columns:${cols}; max-width:${maxW}">${r.items.map((it, i) => {
      const bg = it.portada ? `url('${it.portada}')` : VIDEO_TINTS[i % VIDEO_TINTS.length];
      return `
      <button class="unit-video" type="button" data-resource="${r.id}" data-item="${i}" aria-label="Reproducir: ${it.titulo}">
        ${r.isFeatured ? `<span class="unit-video-badge">VIDEO DESTACADO</span>` : ""}
        <span class="unit-video-thumb" style="background-image:${bg}">
          <span class="unit-video-play" aria-hidden="true"><i class="fa-solid fa-play"></i></span>
        </span>
        <span class="unit-video-caption">${it.titulo}</span>
      </button>`;
    }).join("")}</div>`;
  }

  function cuerpoDocumento(r) {
    const titulo = r.documento_titulo
      ? `<h3 class="unit-doc-title"><a href="${r.enlace_url || r.iframe_url}" target="_blank" rel="noopener">${r.documento_titulo}</a></h3>`
      : "";
    const frame = r.iframe_url
      ? `<iframe src="${toEmbedUrl(r.iframe_url)}" loading="lazy" title="${r.titulo}" allow="autoplay"></iframe>`
      : `<div class="unit-doc-frame-empty"><i class="fa-solid fa-file-circle-question" aria-hidden="true"></i><span>Este documento todavía no está disponible.</span></div>`;
    const acciones = [];
    if (r.iframe_url) acciones.push(`<button class="unit-btn-solid doc-fullscreen" type="button" data-resource="${r.id}"><i class="fa-solid fa-expand" aria-hidden="true"></i> Pantalla completa</button>`);
    if (r.enlace_url) acciones.push(`<a class="unit-btn-outline" href="${r.enlace_url}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Abrir en pestaña nueva</a>`);
    if (r.adjunto) acciones.push(`<a class="unit-btn-flat" href="${r.adjunto.url}" target="_blank" rel="noopener"><i class="fa-solid ${r.adjunto.icono}" aria-hidden="true"></i> ${r.adjunto.titulo}</a>`);
    return `${titulo}<div class="unit-doc-stack"><div class="unit-doc-frame">${frame}</div></div><div class="unit-doc-actions">${acciones.join("")}</div>`;
  }

  function cuerpoEnlaces(r) {
    if (!r.items.length) return `<p class="unit-empty-inline">Todavía no hay enlaces para este recurso.</p>`;
    return `<ul class="unit-links">${r.items.map((it, i) => `
      <li class="unit-link-item">
        <a href="${it.url}" target="_blank" rel="noopener">
          <span class="unit-link-index" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
          <span class="unit-link-text">
            <span class="unit-link-title">${it.titulo}</span>
            ${it.fuente ? `<span class="unit-link-source">${it.fuente}</span>` : ""}
          </span>
          <span class="unit-link-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>
        </a>
      </li>`).join("")}</ul>`;
  }

  // Cada lectura es una fila: ícono + título (link) + audiolibro opcional.
  // "embebido" decide qué ES el título: un <a> normal a pestaña nueva, o
  // un <button> que abre el documento en el modal de pantalla completa
  // del propio visor (mismo modal que usa "documento" — ver
  // initReadingOpens()). El ícono de flecha del título cambia entre los
  // dos casos (expandir vs. salir) para que se note ANTES de tocarlo qué
  // va a pasar. El audiolibro, si llega, es SIEMPRE un link normal —
  // nunca se embebe.
  // "apoyo" es una GRILLA de tarjetas (protagonismo para el audiolibro,
  // pensado para pocos ítems bien destacados); "complementarias" es una
  // lista compacta de filas (pensado para escalar a muchas referencias
  // sin ocupar tanto espacio vertical) — mismo dato, dos plantillas.
  // La "tapa" es a propósito un librito de verdad, no una insignia chica:
  // dos hojas sueltas y rotadas detrás simulan una pila de papel, y la
  // tapa de encima gira sobre su lomo (rotateY, con perspective en el
  // contenedor) al pasar el mouse — el mismo gesto físico de abrir un
  // libro — revelando una hoja con líneas de texto simuladas debajo. Sin
  // esto la tarjeta era "un cuadrado con texto" y no se entendía de un
  // vistazo que representa una LECTURA.
  function lecturaCardHtml(r, it, i) {
    const flechaIcon = it.embebido ? "fa-expand" : "fa-arrow-up-right-from-square";
    const cuerpoAbrir = `
      <span class="unit-reading-card-cover-wrap" aria-hidden="true">
        <span class="unit-reading-card-stack unit-reading-card-stack--1"></span>
        <span class="unit-reading-card-stack unit-reading-card-stack--2"></span>
        <span class="unit-reading-card-page">
          <span class="unit-reading-card-page-line" style="width:70%"></span>
          <span class="unit-reading-card-page-line" style="width:88%"></span>
          <span class="unit-reading-card-page-line" style="width:55%"></span>
        </span>
        <span class="unit-reading-card-cover">
          <span class="unit-reading-card-pdf-badge">PDF</span>
          <i class="fa-solid fa-book-open-reader"></i>
        </span>
      </span>
      <span class="unit-reading-card-title">${it.titulo}</span>
      ${it.fuente ? `<span class="unit-reading-card-source">${it.fuente}</span>` : ""}
      <span class="unit-reading-card-cta">Ver documento <i class="fa-solid ${flechaIcon}" aria-hidden="true"></i></span>`;
    const abrir = it.embebido
      ? `<button class="unit-reading-card-open" type="button" data-resource="${r.id}" data-item="${i}">${cuerpoAbrir}</button>`
      : `<a class="unit-reading-card-open" href="${it.url}" target="_blank" rel="noopener">${cuerpoAbrir}</a>`;
    const audio = it.audio_url
      ? `<a class="unit-reading-card-audio" href="${it.audio_url}" target="_blank" rel="noopener"><i class="fa-solid fa-headphones" aria-hidden="true"></i> Escuchar audiolibro</a>`
      : "";
    return `<div class="unit-reading-card">${abrir}${audio}</div>`;
  }

  function lecturaRowHtml(r, it, i) {
    const flechaIcon = it.embebido ? "fa-expand" : "fa-arrow-up-right-from-square";
    const tituloHtml = `
      <span class="unit-reading-text">
        <span class="unit-reading-title">${it.titulo}</span>
        ${it.fuente ? `<span class="unit-reading-source">${it.fuente}</span>` : ""}
      </span>
      <i class="unit-reading-arrow fa-solid ${flechaIcon}" aria-hidden="true"></i>`;
    const abrir = it.embebido
      ? `<button class="unit-reading-open" type="button" data-resource="${r.id}" data-item="${i}">${tituloHtml}</button>`
      : `<a class="unit-reading-open" href="${it.url}" target="_blank" rel="noopener">${tituloHtml}</a>`;
    const audio = it.audio_url
      ? `<a class="unit-reading-audio" href="${it.audio_url}" target="_blank" rel="noopener" title="Escuchar audiolibro" aria-label="Escuchar audiolibro: ${it.titulo}"><i class="fa-solid fa-headphones" aria-hidden="true"></i></a>`
      : "";
    return `
      <li class="unit-reading-item">
        <span class="unit-reading-icon" aria-hidden="true"><i class="fa-solid fa-book-open-reader"></i></span>
        ${abrir}
        ${audio}
      </li>`;
  }

  function cuerpoLecturas(r) {
    const intro = r.descripcion ? `<p>${r.descripcion}</p>` : "";
    if (!r.items.length) return `${intro}<p class="unit-empty-inline">Todavía no hay lecturas para este recurso.</p>`;
    if (r.variante === "complementarias") {
      return `${intro}<ul class="unit-readings">${r.items.map((it, i) => lecturaRowHtml(r, it, i)).join("")}</ul>`;
    }
    return `${intro}<div class="unit-readings-grid">${r.items.map((it, i) => lecturaCardHtml(r, it, i)).join("")}</div>`;
  }

  // Una fila numerada por actividad — pensado para escalar a MUCHAS
  // actividades sin volverse una pared de tarjetas idénticas: por
  // defecto la fila es angosta (número + nombre + botón "ir"), y la
  // descripción (si hay) se expande solo si el usuario la pide, igual
  // que el acordeón de lecciones de "texto". El botón "ir a la
  // actividad" SIEMPRE está a la vista, sin depender de abrir nada.
  //   - sin descripción → nombre no es interactivo, no hay nada que abrir
  //   - descripcionHtml=false (default) → al expandir, texto plano en
  //     párrafos (separados por línea en blanco) — "diseño perfecto"
  //     para ese caso
  //   - descripcionHtml=true → el HTML no se muestra inline (no se puede
  //     mostrar "tal cual" sin arriesgar el layout): al expandir aparece
  //     un botón que lo abre en el popup/modal
  // "single": con una sola actividad no hay nada que escanear, así que
  // arranca ya abierta y no lleva el número de fondo del acordeón.
  function actividadCard(r, it, i, single) {
    const tieneDescripcion = !!it.descripcion;
    const esHtml = tieneDescripcion && it.descripcionHtml;
    const num = String(i + 1).padStart(2, "0");

    const panelInner = esHtml
      ? `<div class="unit-activity-preview-wrap"><button class="unit-btn-outline unit-activity-preview" type="button" data-resource="${r.id}" data-item="${i}"><i class="fa-solid fa-file-lines" aria-hidden="true"></i> Ver actividad completa</button></div>`
      : `<div class="unit-activity-desc">${escapeHtml(it.descripcion).split(/\n{2,}/).map((p) => `<p>${p}</p>`).join("")}</div>`;

    const abierta = single && tieneDescripcion;
    const nombreBtn = `<button class="unit-activity-toggle" type="button" aria-expanded="${abierta ? "true" : "false"}"${tieneDescripcion ? "" : " disabled"}>
      <span class="unit-activity-nombre">${it.nombre}</span>
      ${tieneDescripcion ? `<i class="fa-solid fa-chevron-down unit-activity-caret" aria-hidden="true"></i>` : ""}
    </button>`;

    const goBtn = it.link
      ? `<a class="unit-activity-go" href="${it.link}" target="_blank" rel="noopener" title="Ir a la actividad" aria-label="Ir a la actividad: ${it.nombre}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`
      : "";

    return `
      <div class="unit-activity${abierta ? " is-open" : ""}">
        <span class="unit-activity-index" aria-hidden="true">${num}</span>
        <div class="unit-activity-card">
          <div class="unit-activity-row">${nombreBtn}${goBtn}</div>
          ${tieneDescripcion ? `<div class="unit-activity-panel"><div class="unit-activity-panel-inner">${panelInner}</div></div>` : ""}
        </div>
      </div>`;
  }

  // Con una sola actividad, la fila se agranda, arranca abierta y no
  // lleva la línea conectora (no hay "secuencia" que mostrar con un solo
  // ítem); con varias, son filas compactas conectadas por una línea,
  // igual que la línea de tiempo de lecciones — ver
  // ".unit-activities--single" en el CSS, que es lo único que cambia.
  function cuerpoActividades(r) {
    if (!r.items.length) return `<p class="unit-empty-inline">Todavía no hay actividades para este recurso.</p>`;
    const single = r.items.length === 1;
    const linea = single ? "" : `<div class="unit-activities-line" aria-hidden="true"></div>`;
    return `<div class="unit-activities${single ? " unit-activities--single" : ""}">${linea}${r.items.map((it, i) => actividadCard(r, it, i, single)).join("")}</div>`;
  }

  // Mismo modelo de confianza que "diapositivas_extra" del visor
  // principal: el HTML se inyecta tal cual, directo en la sección (no en
  // un popup, a diferencia de la descripción HTML de "actividades") — es
  // contenido de autoría del plugin/Moodle, pensado para SER la sección.
  function cuerpoPersonalizado(r) {
    if (r.iframe) {
      return `<div class="unit-doc-stack"><div class="unit-doc-frame"><iframe src="${r.iframe}" loading="lazy" title="${r.titulo}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div></div>`;
    }
    if (r.html) return `<div class="unit-custom-html">${r.html}</div>`;
    return `<p class="unit-empty-inline">Este recurso todavía no tiene contenido.</p>`;
  }

  const CUERPOS = {
    texto: cuerpoTexto,
    "video-grid": cuerpoVideoGrid,
    documento: cuerpoDocumento,
    enlaces: cuerpoEnlaces,
    lecturas: cuerpoLecturas,
    actividades: cuerpoActividades,
    personalizado: cuerpoPersonalizado
  };

  /* ---------------------------------------------------------------------
   * 6. Render — secciones + navegación (riel, responsive)
   * ------------------------------------------------------------------- */
  let recursosPorId = {};

  function renderContenido(datos) {
    const main = $("#unitMain");
    const empty = $("#unitEmpty");
    const rail = $("#unitRail");
    const resources = datos.recursos;
    recursosPorId = {};

    renderStats(datos, resources);

    if (!resources.length) {
      main.hidden = true;
      rail.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    main.hidden = false;
    rail.hidden = false;

    const total = resources.length;

    main.innerHTML = resources.map((r, i) => {
      recursosPorId[r.id] = r;
      const stepNum = String(i + 1).padStart(2, "0");
      const stepLabel = `${stepNum} de ${String(total).padStart(2, "0")}`;
      const cuerpo = CUERPOS[r.tipo](r);
      return `
      <section class="unit-section" id="${r.id}" data-tema="${r.tema}">
        <span class="unit-watermark" aria-hidden="true">${stepNum}</span>
        <div class="unit-inner">
          <div class="unit-eyebrow-row">
            <span class="unit-badge unit-badge--${r.tipo}" aria-hidden="true"><i class="fa-solid ${r.icon}"></i></span>
            <span class="unit-eyebrow-text">${r.eyebrow} · ${stepLabel}</span>
          </div>
          <h2 class="unit-title">${r.titulo}</h2>
          <div class="unit-body">${cuerpo}</div>
        </div>
      </section>`;
    }).join("");

    renderNav(resources);
    initLessonToggles(main);
    initVideoCards(main);
    initDocFullscreen(main);
    initReadingOpens(main);
    initActivityToggles(main);
    initActivityPopups(main);
    initRail();
    initSectionsObservers(resources);
  }

  function renderNav(resources) {
    const railTrack = $("#unitRailTrack");
    railTrack.innerHTML = `
      <div class="unit-rail-line" aria-hidden="true"></div>
      <div class="unit-rail-fill" id="unitRailFill" aria-hidden="true"></div>
      ${resources.map((r) => `
      <a href="#${r.id}" class="unit-rail-item" data-target="${r.id}" title="${r.titulo}">
        <span class="unit-rail-dot"><i class="fa-solid ${r.icon}"></i></span>
        <span class="unit-rail-label"><span>${r.titulo}</span></span>
      </a>`).join("")}`;
  }

  function initLessonToggles(scope) {
    $$(".unit-lesson", scope).forEach((li) => {
      const toggle = $(".unit-lesson-toggle", li);
      toggle.addEventListener("click", () => {
        const abierto = li.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(abierto));
      });
    });
  }

  function initActivityToggles(scope) {
    $$(".unit-activity", scope).forEach((el) => {
      const toggle = $(".unit-activity-toggle", el);
      if (!toggle || toggle.disabled) return; // sin descripción: no hay nada que abrir
      toggle.addEventListener("click", () => {
        const abierto = el.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(abierto));
      });
    });
  }

  function initVideoCards(scope) {
    $$(".unit-video", scope).forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = recursosPorId[btn.dataset.resource];
        const item = r && r.items[Number(btn.dataset.item)];
        if (!item || !item.url) return;
        openMediaModal(item.titulo || r.titulo, toEmbedUrl(item.url));
      });
    });
  }

  function initDocFullscreen(scope) {
    $$(".doc-fullscreen", scope).forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = recursosPorId[btn.dataset.resource];
        if (!r || !r.iframe_url) return;
        openMediaModal(r.documento_titulo || r.titulo, toEmbedUrl(r.iframe_url));
      });
    });
  }

  // Solo los ítems "embebido":true son <button data-resource>; los <a>
  // normales no llevan ese atributo, así que este selector los ignora solo.
  function initReadingOpens(scope) {
    $$(".unit-reading-open[data-resource], .unit-reading-card-open[data-resource]", scope).forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = recursosPorId[btn.dataset.resource];
        const item = r && r.items[Number(btn.dataset.item)];
        if (!item) return;
        openReadingModal(item.titulo || r.titulo, toEmbedUrl(item.url), item.audio_url);
      });
    });
  }

  function initActivityPopups(scope) {
    $$(".unit-activity-preview", scope).forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = recursosPorId[btn.dataset.resource];
        const item = r && r.items[Number(btn.dataset.item)];
        if (!item || !item.descripcion) return;
        openHtmlModal(item.nombre || r.titulo, item.descripcion, item.link);
      });
    });
  }

  /* ---------------------------------------------------------------------
   * 7. Riel — expandir etiquetas al pasar el mouse (desktop); en el modo
   *    dock (<980px, ver CSS) las etiquetas ya son visibles siempre, así
   *    que el hover ahí simplemente no tiene efecto visual.
   * ------------------------------------------------------------------- */
  function initRail() {
    const rail = $("#unitRail");
    rail.addEventListener("mouseenter", () => rail.classList.add("is-hover"));
    rail.addEventListener("mouseleave", () => rail.classList.remove("is-hover"));
    $$(".unit-rail-item", rail).forEach((a) => a.addEventListener("click", onNavClick));
  }

  function onNavClick(e) {
    e.preventDefault();
    const target = document.getElementById(e.currentTarget.dataset.target);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------------------------------------------------------------------
   * 8. Observadores de sección: revelado permanente al entrar en vista +
   *    sección "activa" (resalta el ítem correspondiente del riel y
   *    actualiza su línea de progreso)
   * ------------------------------------------------------------------- */
  function initSectionsObservers(resources) {
    const secciones = $$(".unit-section");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = resources.length;
    const railItems = $$(".unit-rail-item");
    const railFill = $("#unitRailFill");

    function marcarActivo(id) {
      const idx = resources.findIndex((r) => r.id === id);
      if (idx === -1) return;
      railItems.forEach((a) => a.classList.toggle("is-active", a.dataset.target === id));
      if (railFill) railFill.style.height = (total > 1 ? (idx / (total - 1)) * 100 : 100) + "%";
      // Solo se ve en el dock móvil (icono-solamente ahí): el nombre
      // completo del recurso activo, una sola vez, no repetido por punto.
      const r = resources[idx];
      $("#unitRailCurrentIcon").innerHTML = `<i class="fa-solid ${r.icon}"></i>`;
      $("#unitRailCurrentTitle").textContent = r.titulo;
      $("#unitRailCurrentCount").textContent = `${idx + 1}/${total}`;
    }

    if (reduceMotion) {
      secciones.forEach((sec) => sec.classList.add("is-visible"));
    } else if ("IntersectionObserver" in window) {
      const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
      secciones.forEach((sec) => revealObserver.observe(sec));
    } else {
      secciones.forEach((sec) => sec.classList.add("is-visible"));
    }

    if (resources[0]) marcarActivo(resources[0].id);
    if (!("IntersectionObserver" in window)) return;
    const activeObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) marcarActivo(entry.target.id);
      });
    }, { rootMargin: "-35% 0px -55% 0px", threshold: 0 });
    secciones.forEach((sec) => activeObserver.observe(sec));
  }

  /* ---------------------------------------------------------------------
   * 9. Barra de progreso de lectura (fija arriba de todo)
   * ------------------------------------------------------------------- */
  function initScrollProgress() {
    const bar = $("#scrollProgress");
    let ticking = false;
    function actualizar() {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const frac = max > 0 ? Math.min(1, doc.scrollTop / max) : 0;
      if (bar) bar.style.transform = `scaleX(${frac})`;
      ticking = false;
    }
    window.addEventListener("scroll", () => {
      if (!ticking) { requestAnimationFrame(actualizar); ticking = true; }
    }, { passive: true });
    actualizar();
  }

  /* ---------------------------------------------------------------------
   * 10. Parallax sutil de los blobs del hero según scroll de la página
   * ------------------------------------------------------------------- */
  function initHeroParallax() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const blobs = $$(".hero-blob");
    if (!blobs.length) return;
    let ticking = false;
    function actualizar() {
      const y = Math.min(window.scrollY, 600);
      blobs.forEach((b, i) => {
        const factor = i === 0 ? 0.2 : i === 1 ? -0.14 : 0.28;
        // "translate" (no "transform"): los blobs ya animan "transform"
        // vía @keyframes (incca-float) y una animación CSS siempre gana
        // sobre un "transform" puesto inline — "translate" compone con
        // "transform" sin pisarlo.
        b.style.translate = `0 ${(y * factor).toFixed(1)}px`;
      });
      ticking = false;
    }
    window.addEventListener("scroll", () => {
      if (!ticking) { requestAnimationFrame(actualizar); ticking = true; }
    }, { passive: true });
  }

  /* ---------------------------------------------------------------------
   * 11. Modal de pantalla completa — un embed (video/documento) o, para
   *     una actividad con descripción HTML, ese HTML directamente (es el
   *     único lugar donde se puede mostrar sin romper el layout del
   *     recurso que lo contiene).
   * ------------------------------------------------------------------- */
  function mostrarModal(titulo, bodyHtml, link) {
    $("#mediaModalTitle").textContent = titulo || "";
    $("#mediaModalBody").innerHTML = bodyHtml;
    // Botón "ir a la actividad" flotando DENTRO del modal (además del que
    // ya está afuera, en la fila): así no hay que cerrar el popup para
    // ir a hacer la actividad — sería un paso de más.
    const goBtn = $("#mediaModalGo");
    goBtn.hidden = !link;
    if (link) goBtn.href = link;
    $("#mediaModalOverlay").classList.add("is-open");
  }

  function openMediaModal(titulo, embedUrl) {
    if (!embedUrl) return;
    mostrarModal(titulo, `<iframe src="${embedUrl}" title="${titulo || ""}" allow="autoplay; fullscreen" allowfullscreen></iframe>`);
  }

  function openHtmlModal(titulo, html, link) {
    if (!html) return;
    mostrarModal(titulo, `<div class="modal-html-content">${html}</div>`, link);
  }

  function closeMediaModal() {
    $("#mediaModalOverlay").classList.remove("is-open");
    $("#mediaModalBody").innerHTML = "";
  }

  function initMediaModal() {
    $("#mediaModalClose").addEventListener("click", closeMediaModal);
    $("#mediaModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "mediaModalOverlay") closeMediaModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#mediaModalOverlay").classList.contains("is-open")) closeMediaModal();
    });
  }

  /* ---------------------------------------------------------------------
   * 11b. Modal de lectura — propio (no el genérico de arriba): panel
   *      "tapa de libro" a la izquierda + documento real embebido a la
   *      derecha. Solo lo abren los ítems "embebido":true de "lecturas".
   * ------------------------------------------------------------------- */
  function openReadingModal(titulo, embedUrl, audioUrl) {
    $("#readingModalTitle").textContent = titulo || "";
    $("#readingModalFrame").innerHTML = embedUrl
      ? `<iframe src="${embedUrl}" title="${titulo || ""}" allow="autoplay; fullscreen" allowfullscreen></iframe>`
      : `<div class="unit-doc-frame-empty"><i class="fa-solid fa-file-circle-question" aria-hidden="true"></i><span>Este documento todavía no está disponible.</span></div>`;
    const audioBtn = $("#readingModalAudio");
    audioBtn.hidden = !audioUrl;
    if (audioUrl) audioBtn.href = audioUrl;
    $("#readingModalOverlay").classList.add("is-open");
  }

  function closeReadingModal() {
    $("#readingModalOverlay").classList.remove("is-open");
    $("#readingModalFrame").innerHTML = "";
  }

  function initReadingModal() {
    $("#readingModalClose").addEventListener("click", closeReadingModal);
    $("#readingModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "readingModalOverlay") closeReadingModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#readingModalOverlay").classList.contains("is-open")) closeReadingModal();
    });
  }

  /* ---------------------------------------------------------------------
   * 12. Arranque
   * ------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    const datos = obtenerDatos();
    renderHero(datos, datos.recursos.length > 0);
    renderContenido(datos);
    initMediaModal();
    initReadingModal();
    initScrollProgress();
    initHeroParallax();
  });
})();
