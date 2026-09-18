/* ==========================================================================
   U.INCCA · Visor de unidad/semana — lee el contenido (unidad, recursos)
   desde window.name como JSON. Sin datos hardcodeados: cada campo que no
   llegue se completa, campo a campo, con un placeholder genérico — nunca
   con contenido inventado que pueda confundirse con datos reales.

   MAZO HORIZONTAL: el hero y cada recurso son una DIAPOSITIVA del ancho
   del viewport dentro de ".unit-main", que es una pista que se traslada
   en X con transform (no con scroll — ver initDeck()). El <body> no
   scrollea nunca. Se pasa de una diapositiva a otra con las flechas
   (#deckPrev/#deckNext), el teclado (←/→, AvPág/RePág, Inicio/Fin), el
   riel o —en táctil— arrastrando de lado. Si el contenido de una
   diapositiva no cabe en el alto del viewport (= alto del iframe),
   scrollea DENTRO de ella (.unit-scroll) — política de desbordamiento
   acotada, nada queda recortado. Cada recurso tiene un tema propio según
   su tipo (claro/oscuro/papel/cálido/acento).

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

  // Tipo de cada actividad (color + ícono + etiqueta de la tarjeta). Es
  // OPCIONAL en el JSON ("items[].tipo"): si no llega o no es uno de estos,
  // se infiere del módulo de Moodle en el link (mod/quiz, mod/forum,
  // mod/workshop, mod/assign…) y, si tampoco, cae en "tarea". El color en
  // sí vive en el CSS (.unit-activity[data-type="…"]).
  const ACT_TYPES = ["quiz", "tarea", "foro", "taller", "entrega", "examen"];
  const ACT_TYPE_META = {
    quiz:    { label: "Quiz",    icon: "fa-circle-question" },
    tarea:   { label: "Tarea",   icon: "fa-file-pen" },
    foro:    { label: "Foro",    icon: "fa-comments" },
    taller:  { label: "Taller",  icon: "fa-screwdriver-wrench" },
    entrega: { label: "Entrega", icon: "fa-cloud-arrow-up" },
    examen:  { label: "Examen",  icon: "fa-file-circle-check" }
  };
  function inferActType(tipo, link) {
    if (ACT_TYPES.includes(tipo)) return tipo;
    const l = String(link || "").toLowerCase();
    if (l.indexOf("mod/quiz/") !== -1) return "quiz";
    if (l.indexOf("mod/forum/") !== -1) return "foro";
    if (l.indexOf("mod/workshop/") !== -1) return "taller";
    if (l.indexOf("mod/assign/") !== -1) return "tarea";
    return "tarea";
  }

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
          descripcionHtml: !!(it && it.descripcion_html),
          tipoActividad: inferActType(it && it.tipo, it && it.link)
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
    renderHeroCta(datos.recursos);

    $("#heroScrollTip").hidden = !hayRecursos;
  }

  /**
   * CTA directo a "Actividades" flotando en el hero — solo si la unidad
   * trae al menos un recurso "actividades". Salta a la PRIMERA diapositiva
   * de actividades (el click lo engancha initDeck()). El número del badge
   * es el total de actividades de TODA la unidad — mismo criterio que la
   * franja de estadísticas.
   */
  function renderHeroCta(resources) {
    const previo = $("#heroCta");
    if (previo) previo.remove();

    const actos = (resources || []).filter((r) => r.tipo === "actividades");
    if (!actos.length) return;

    const total = actos.reduce((n, r) => n + (r.items ? r.items.length : 0), 0);
    const primera = actos[0];
    const badge = total > 9 ? "9+" : String(total);

    $("#hero").insertAdjacentHTML("beforeend", `
      <button class="hero-cta-act" id="heroCta" type="button" data-target="${primera.id}" aria-label="Ir a las actividades de la unidad">
        <span class="hero-cta-shimmer" aria-hidden="true"></span>
        <span class="hero-cta-head">
          <span class="hero-cta-icon-wrap" aria-hidden="true">
            <i class="fa-solid fa-list-check"></i>
            ${total ? `<span class="hero-cta-badge">${badge}</span>` : ""}
          </span>
          <span class="hero-cta-text">
            <span class="hero-cta-label">${primera.titulo}</span>
            <span class="hero-cta-sub">Pon en práctica lo aprendido</span>
          </span>
        </span>
        <span class="hero-cta-pill">
          <span>Ir a actividades</span>
          <span class="hero-cta-pill-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>
        </span>
      </button>`);
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

  // Una fila por actividad, con COLOR/ÍCONO/ETIQUETA según su "tipo"
  // (quiz/tarea/foro/taller/entrega/examen — ver ACT_TYPE_META e
  // inferActType). Pensada para escalar a MUCHAS actividades sin volverse
  // una pared de tarjetas idénticas: la fila es angosta (índice + ícono de
  // tipo + nombre + botón "ir"), y la descripción (si hay) se expande solo
  // si el usuario la pide, igual que el acordeón de lecciones de "texto".
  // El botón "ir a la actividad" SIEMPRE está a la vista.
  //   - sin descripción → nombre no es interactivo, no hay nada que abrir
  //   - descripcionHtml=false (default) → al expandir, texto plano en
  //     párrafos (separados por línea en blanco)
  //   - descripcionHtml=true → al expandir aparece un botón que lo abre en
  //     el popup/modal (el HTML no se muestra inline para no arriesgar el
  //     layout)
  // "single": con una sola actividad no hay nada que escanear, así que
  // arranca ya abierta — ver cuerpoActividades() y ".unit-activities--single".
  function actividadCard(r, it, i, single) {
    const tieneDescripcion = !!it.descripcion;
    const esHtml = tieneDescripcion && it.descripcionHtml;
    const num = String(i + 1).padStart(2, "0");
    const meta = ACT_TYPE_META[it.tipoActividad] || ACT_TYPE_META.tarea;

    const panelInner = esHtml
      ? `<div class="unit-activity-preview-wrap"><button class="unit-btn-outline unit-activity-preview" type="button" data-resource="${r.id}" data-item="${i}"><i class="fa-solid fa-file-lines" aria-hidden="true"></i> Ver actividad completa</button></div>`
      : `<div class="unit-activity-desc">${escapeHtml(it.descripcion).split(/\n{2,}/).map((p) => `<p>${p}</p>`).join("")}</div>`;

    const abierta = single && tieneDescripcion;
    const nombreBtn = `<button class="unit-activity-toggle" type="button" aria-expanded="${abierta ? "true" : "false"}"${tieneDescripcion ? "" : " disabled"}>
      <span class="unit-activity-type-icon" aria-hidden="true"><i class="fa-solid ${meta.icon}"></i></span>
      <span class="unit-activity-nombre">${it.nombre}</span>
      ${tieneDescripcion ? `<i class="fa-solid fa-chevron-down unit-activity-caret" aria-hidden="true"></i>` : ""}
    </button>`;

    const goBtn = it.link
      ? `<a class="unit-activity-go" href="${it.link}" target="_blank" rel="noopener" title="Ir a la actividad" aria-label="Ir a la actividad: ${it.nombre}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`
      : "";

    return `
      <div class="unit-activity${abierta ? " is-open" : ""}" data-type="${it.tipoActividad}">
        <span class="unit-activity-index" aria-hidden="true">${num}</span>
        <div class="unit-activity-card">
          <div class="unit-activity-row">
            <span class="unit-activity-type">${meta.label}</span>
            ${nombreBtn}${goBtn}
          </div>
          ${tieneDescripcion ? `<div class="unit-activity-panel"><div class="unit-activity-panel-inner">${panelInner}</div></div>` : ""}
        </div>
      </div>`;
  }

  // DOS diseños, según cuántas actividades haya:
  //   - varias  → filas compactas conectadas por una línea de tiempo
  //     (".unit-activities"), cada una plegable
  //   - una sola → ".unit-activities--single" agranda índice, ícono,
  //     nombre y espaciado, y la única tarjeta arranca abierta
  // La línea conectora se renderiza siempre (con una sola actividad queda
  // detrás del índice, prácticamente invisible) — paridad 1:1 con el
  // prototipo visor_no_scroll.
  function cuerpoActividades(r) {
    if (!r.items.length) return `<p class="unit-empty-inline">Todavía no hay actividades para este recurso.</p>`;
    const single = r.items.length === 1;
    return `<div class="unit-activities${single ? " unit-activities--single" : ""}">
      <div class="unit-activities-line" aria-hidden="true"></div>
      ${r.items.map((it, i) => actividadCard(r, it, i, single)).join("")}
    </div>`;
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

    // El hero (y, sin recursos, el estado vacío) ya viven dentro de
    // #unitMain en el HTML. Acá solo se AGREGAN las diapositivas de
    // recurso — nunca se borra el hero con innerHTML.
    if (!resources.length) {
      empty.hidden = false;
      rail.hidden = true;
      initDeck([]);
      return;
    }
    empty.hidden = true;
    rail.hidden = false;

    const total = resources.length;

    main.insertAdjacentHTML("beforeend", resources.map((r, i) => {
      recursosPorId[r.id] = r;
      const stepNum = String(i + 1).padStart(2, "0");
      const stepLabel = `${stepNum} de ${String(total).padStart(2, "0")}`;
      const cuerpo = CUERPOS[r.tipo](r);
      return `
      <section class="unit-section unit-slide" id="${r.id}" data-tema="${r.tema}" data-icon="fa-solid ${r.icon}" aria-roledescription="diapositiva" aria-label="${r.titulo}" tabindex="-1">
        <span class="unit-watermark" aria-hidden="true">${stepNum}</span>
        <div class="unit-scroll">
          <div class="unit-inner">
            <div class="unit-eyebrow-row">
              <span class="unit-badge unit-badge--${r.tipo}" aria-hidden="true"><i class="fa-solid ${r.icon}"></i></span>
              <span class="unit-eyebrow-text">${r.eyebrow} · ${stepLabel}</span>
            </div>
            <h2 class="unit-title">${r.titulo}</h2>
            <div class="unit-body">${cuerpo}</div>
          </div>
        </div>
      </section>`;
    }).join(""));

    renderNav(resources);
    initLessonToggles(main);
    initVideoCards(main);
    initDocFullscreen(main);
    initReadingOpens(main);
    initActivityToggles(main);
    initActivityPopups(main);
    initDeck(resources);
  }

  function renderNav(resources) {
    const railTrack = $("#unitRailTrack");
    // Primer punto: el hero ("Inicio"). Luego, uno por recurso — mismo
    // orden final del mazo. La etiqueta aparece al pasar el cursor / en el
    // punto activo (CSS); initDeck() centra el activo en la pista.
    const heroItem = `
      <a href="#heroSlide" class="unit-rail-item" data-target="heroSlide" title="Inicio de la unidad">
        <span class="unit-rail-dot"><i class="fa-solid fa-house"></i></span>
        <span class="unit-rail-label">Inicio</span>
      </a>`;
    railTrack.innerHTML = heroItem + resources.map((r) => `
      <a href="#${r.id}" class="unit-rail-item" data-target="${r.id}" title="${r.titulo}">
        <span class="unit-rail-dot"><i class="fa-solid ${r.icon}"></i></span>
        <span class="unit-rail-label">${r.titulo}</span>
      </a>`).join("");
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
   * 7. Mazo horizontal — el hero y cada recurso son una DIAPOSITIVA del
   *    ancho del viewport dentro de #unitMain. La pista se traslada en X
   *    con transform + transición CSS (no con scroll): un transform no lo
   *    "cancela" un cambio de estilo, cosa que sí le pasa al scroll con
   *    scroll-snap: mandatory (re-engancha al origen si algo toca el
   *    layout mientras anima). Se pasa con las flechas, el teclado (←/→,
   *    AvPág/RePág, Inicio/Fin), el riel o —en táctil— arrastrando de
   *    lado; un arrastre dominante en vertical lo scrollea .unit-scroll.
   *    "current" solo lo mueve irA(): al cambiar se repinta todo (pista,
   *    riel, barra de progreso, foco, "inert") y se revela la diapositiva.
   * ------------------------------------------------------------------- */
  function initDeck(resources) {
    const track = $("#unitMain");
    const slides = Array.from(track.children).filter((el) => !el.hidden);
    if (!slides.length) return;

    const bar = $("#scrollProgress");
    const prevBtn = $("#deckPrev");
    const nextBtn = $("#deckNext");
    const railTrack = $("#unitRailTrack");
    const railItems = $$(".unit-rail-item");
    const railIcon = $("#unitRailCurrentIcon");
    const railTitle = $("#unitRailCurrentTitle");
    const railCount = $("#unitRailCurrentCount");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = slides.length;
    let current = 0;

    const revelar = (slide) => slide.classList.add("is-visible");
    if (reduceMotion) slides.forEach(revelar);

    // Nombre + ícono de una diapositiva vecina, para la etiqueta de la
    // flecha contextual: el hero es "Inicio"; un recurso usa su título e
    // ícono; si no se lo encuentra en "resources" (no debería), cae al
    // <h2>/data-icon del propio <section>.
    function infoDe(slide) {
      if (!slide) return null;
      if (slide.id === "heroSlide") return { nombre: "Inicio", icono: "fa-solid fa-house" };
      const r = resources.find((x) => x.id === slide.id);
      if (r) return { nombre: r.titulo, icono: `fa-solid ${r.icon}` };
      const t = slide.querySelector(".unit-title");
      return { nombre: t ? t.textContent.trim() : "Sección", icono: slide.dataset.icon || "fa-solid fa-shapes" };
    }
    function pintarFlecha(btn, slide) {
      const info = infoDe(slide);
      if (!info) return;
      const label = btn.querySelector(".deck-arrow-label");
      const icon = btn.querySelector(":scope > i");
      if (label) label.textContent = info.nombre;
      if (icon) icon.className = info.icono;
      btn.setAttribute("aria-label", `Ir a ${info.nombre}`);
    }

    function pintar() {
      const slide = slides[current];
      const id = slide.id;
      const resIdx = resources.findIndex((r) => r.id === id);

      track.style.transform = `translateX(-${current * 100}%)`;

      railItems.forEach((a) => {
        const activo = a.dataset.target === id;
        a.classList.toggle("is-active", activo);
        if (activo) a.setAttribute("aria-current", "step");
        else a.removeAttribute("aria-current");
      });
      // Traer el punto activo al centro de la pista del riel (con muchos
      // recursos la pista scrollea sola).
      const activoEl = railItems.find((a) => a.dataset.target === id);
      if (activoEl && railTrack) {
        const destino = activoEl.offsetLeft - railTrack.clientWidth / 2 + activoEl.offsetWidth / 2;
        railTrack.scrollTo({ left: Math.max(0, destino), behavior: reduceMotion ? "auto" : "smooth" });
      }

      if (bar) bar.style.transform = `scaleX(${total > 1 ? current / (total - 1) : 1})`;

      prevBtn.hidden = current === 0;
      nextBtn.hidden = current === total - 1;
      if (!prevBtn.hidden) pintarFlecha(prevBtn, slides[current - 1]);
      if (!nextBtn.hidden) pintarFlecha(nextBtn, slides[current + 1]);

      // La diapositiva que no se ve queda fuera del orden de tabulación y
      // del alcance de lectores de pantalla.
      slides.forEach((s, i) => { s.inert = i !== current; });

      // Etiqueta del dock: nombre completo del recurso activo (una vez).
      if (resIdx !== -1) {
        const r = resources[resIdx];
        railIcon.innerHTML = `<i class="fa-solid ${r.icon}"></i>`;
        railTitle.textContent = r.titulo;
        railCount.textContent = `${resIdx + 1}/${resources.length}`;
      } else {
        railIcon.innerHTML = `<i class="fa-solid fa-house"></i>`;
        railTitle.textContent = "Inicio";
        railCount.textContent = "";
      }

      if (history.replaceState) {
        history.replaceState(null, "", resIdx !== -1 ? `#${id}` : location.pathname + location.search);
      }

      revelar(slide);
    }

    function irA(i, opts) {
      opts = opts || {};
      const destino = Math.max(0, Math.min(total - 1, i));
      if (destino !== current) { current = destino; pintar(); }
      if (opts.foco) slides[current].focus({ preventScroll: true });
    }

    // Al hacer clic, la burbuja "explota" (.is-popping) y recién después
    // navega — salvo con reduced-motion, donde salta de una.
    function activarFlecha(btn, delta) {
      if (btn.classList.contains("is-popping")) return;
      if (reduceMotion) { irA(current + delta, { foco: true }); return; }
      btn.classList.remove("is-popping");
      void btn.offsetWidth; // reinicia la animación aunque se dispare seguido
      btn.classList.add("is-popping");
      window.setTimeout(() => {
        btn.classList.remove("is-popping");
        irA(current + delta, { foco: true });
      }, 340);
    }
    prevBtn.addEventListener("click", () => activarFlecha(prevBtn, -1));
    nextBtn.addEventListener("click", () => activarFlecha(nextBtn, 1));

    // CTA del hero (si lo creó renderHeroCta): salta a su recurso destino.
    const heroCta = $("#heroCta");
    if (heroCta) {
      heroCta.addEventListener("click", () => {
        const i = slides.findIndex((s) => s.id === heroCta.dataset.target);
        if (i !== -1) irA(i, { foco: true });
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      // Con un modal abierto, las flechas son del modal, no del mazo.
      if ($(".media-modal-overlay.is-open") || $(".reading-modal-overlay.is-open")) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (e.key) {
        case "ArrowRight": case "PageDown": e.preventDefault(); irA(current + 1, { foco: true }); break;
        case "ArrowLeft": case "PageUp": e.preventDefault(); irA(current - 1, { foco: true }); break;
        case "Home": e.preventDefault(); irA(0, { foco: true }); break;
        case "End": e.preventDefault(); irA(total - 1, { foco: true }); break;
      }
    });

    railItems.forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const i = slides.findIndex((s) => s.id === a.dataset.target);
        if (i !== -1) irA(i, { foco: true });
      });
    });

    // Gesto táctil: se sigue el dedo en horizontal y al soltar se salta
    // ±1 según la distancia. Un arrastre dominante en vertical se ignora
    // (lo scrollea .unit-scroll — ver "touch-action: pan-y" en el CSS).
    let x0 = 0, y0 = 0, dx = 0, sigo = false, resuelto = false;
    track.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
      dx = 0; sigo = true; resuelto = false;
    }, { passive: true });
    track.addEventListener("touchmove", (e) => {
      if (!sigo) return;
      dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (!resuelto) {
        resuelto = true;
        if (Math.abs(dy) > Math.abs(dx)) { sigo = false; return; } // es scroll vertical
      }
      let off = dx;
      if ((current === 0 && dx > 0) || (current === total - 1 && dx < 0)) off = dx * 0.3; // freno elástico
      track.style.transition = "none";
      track.style.transform = `translateX(calc(-${current * 100}% + ${off}px))`;
    }, { passive: true });
    track.addEventListener("touchend", () => {
      if (!sigo) { track.style.transition = ""; return; }
      sigo = false;
      track.style.transition = "";
      const ancho = track.clientWidth || 1;
      if (dx <= -ancho * 0.2) irA(current + 1);
      else if (dx >= ancho * 0.2) irA(current - 1);
      else pintar(); // no llegó al umbral: vuelve a encuadrar la actual
    }, { passive: true });

    // Deep-link inicial: #id de un recurso abre esa diapositiva, sin que
    // "vuele" desde el hero al cargar.
    const hashId = decodeURIComponent(location.hash.slice(1));
    const hashIdx = hashId ? slides.findIndex((s) => s.id === hashId) : -1;
    current = hashIdx > 0 ? hashIdx : 0;
    track.style.transition = "none";
    pintar();
    track.getBoundingClientRect(); // fuerza reflow para fijar el estado sin animación
    track.style.transition = "";
  }

  /* ---------------------------------------------------------------------
   * 8. Modal de pantalla completa — un embed (video/documento) o, para
   *     una actividad con descripción HTML, ese HTML directamente (es el
   *     único lugar donde se puede mostrar sin romper el layout del
   *     recurso que lo contiene).
   * ------------------------------------------------------------------- */
  function mostrarModal(titulo, bodyHtml, link) {
    $("#mediaModalTitle").textContent = titulo || "";
    $("#mediaModalBody").innerHTML = bodyHtml;
    vigilarEmbeds($("#mediaModalBody"));
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
   * 8b. Modal de lectura — propio (no el genérico de arriba): panel
   *      "tapa de libro" a la izquierda + documento real embebido a la
   *      derecha. Solo lo abren los ítems "embebido":true de "lecturas".
   * ------------------------------------------------------------------- */
  function openReadingModal(titulo, embedUrl, audioUrl) {
    $("#readingModalTitle").textContent = titulo || "";
    $("#readingModalFrame").innerHTML = embedUrl
      ? `<iframe src="${embedUrl}" title="${titulo || ""}" allow="autoplay; fullscreen" allowfullscreen></iframe>`
      : `<div class="unit-doc-frame-empty"><i class="fa-solid fa-file-circle-question" aria-hidden="true"></i><span>Este documento todavía no está disponible.</span></div>`;
    vigilarEmbeds($("#readingModalFrame"));
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
   * 8c. Aviso de bloqueador de anuncios — los embeds (YouTube, Drive,
   *      Vimeo…) vienen de dominios que muchos bloqueadores cortan, y el
   *      resultado es un recuadro vacío sin explicación. Este visor es un
   *      iframe cross-origin y el embed es otro adentro: no hay forma de
   *      mirar dentro de él para saber si cargó, así que se comprueba
   *      desde afuera, con dos señales:
   *        1. Sondeo de red: un fetch "no-cors" al origen del embed. Si un
   *           bloqueador corta la petición, rechaza enseguida con
   *           TypeError; si el origen responde pasa (la respuesta opaca
   *           no se lee, basta con que llegue). Se prefiere al "load" del
   *           iframe porque ese se dispara también con la página de error.
   *        2. Marco colapsado: uBlock/AdBlock esconden con display:none
   *           el iframe que bloquean.
   *      Es una heurística (no existe una API para saber si hay un
   *      bloqueador), por eso el aviso siempre deja una salida: "Abrir en
   *      pestaña nueva" y "Ocultar aviso". Un timeout NO cuenta como
   *      bloqueo — internet lento no es lo mismo que un bloqueador.
   * ------------------------------------------------------------------- */
  const sondeos = new Map(); // origen del embed -> Promise<boolean> (true = bloqueado)

  function sondearOrigen(url) {
    let origen;
    try { origen = new URL(url, location.href).origin; } catch (e) { return Promise.resolve(false); }
    if (!/^https?:/.test(origen) || origen === location.origin) return Promise.resolve(false);
    if (!sondeos.has(origen)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      sondeos.set(origen, fetch(url, { mode: "no-cors", credentials: "omit", signal: ctrl.signal })
        .then(() => false, (e) => e.name !== "AbortError" && navigator.onLine !== false)
        .finally(() => { clearTimeout(timer); ctrl.abort(); })); // abort: no bajar el cuerpo
    }
    return sondeos.get(origen);
  }

  let vigilancias = 0;

  function vigilarEmbed(iframe) {
    const src = iframe.getAttribute("src");
    if (!src || iframe.dataset.vigilado) return;
    // Cada vigilancia lleva su turno: al reintentar, los timers y listeners
    // de la anterior (con su "bloqueado" viejo) quedan inertes.
    const turno = (iframe.dataset.vigilado = String(++vigilancias));
    let bloqueado = false;
    const revisar = () => {
      if (!iframe.isConnected || iframe.dataset.vigilado !== turno || iframe.dataset.avisoOculto) return;
      if (bloqueado || getComputedStyle(iframe).display === "none") mostrarAvisoBloqueo(iframe);
    };
    sondearOrigen(src).then((b) => { bloqueado = b; revisar(); });
    iframe.addEventListener("load", revisar, { once: true });
    setTimeout(revisar, 3000); // los filtros cosméticos entran un poco después del "load"
  }

  function vigilarEmbeds(scope) {
    $$("iframe", scope).forEach(vigilarEmbed);
  }

  function mostrarAvisoBloqueo(iframe) {
    const host = iframe.parentElement;
    if (!host || host.querySelector(".embed-blocked")) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const src = iframe.getAttribute("src");
    let dominio = "";
    try { dominio = new URL(src, location.href).hostname; } catch (e) { /* sin dominio que mostrar */ }

    const aviso = document.createElement("div");
    aviso.className = "embed-blocked";
    aviso.setAttribute("role", "alert");
    aviso.innerHTML = `
      <span class="embed-blocked-icon" aria-hidden="true"><i class="fa-solid fa-shield-halved"></i></span>
      <h4 class="embed-blocked-title">Desactiva el bloqueador de anuncios para ver este contenido</h4>
      <p class="embed-blocked-text">Un bloqueador de anuncios está impidiendo que cargue el contenido de <strong class="embed-blocked-domain"></strong>.
        Desactívalo para este sitio, recarga la página y vuelve a entrar.</p>
      <div class="embed-blocked-actions">
        <button class="unit-btn-solid embed-blocked-retry" type="button"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Ya lo desactivé, reintentar</button>
        <a class="unit-btn-outline embed-blocked-open" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Abrir en pestaña nueva</a>
      </div>
      <button class="embed-blocked-hide" type="button">Ocultar aviso</button>`;
    $(".embed-blocked-domain", aviso).textContent = dominio || "este sitio";
    $(".embed-blocked-open", aviso).href = src;
    $(".embed-blocked-retry", aviso).addEventListener("click", () => {
      aviso.remove();
      sondeos.clear();
      delete iframe.dataset.vigilado;
      iframe.src = src; // vuelve a navegar el marco
      vigilarEmbed(iframe);
    });
    $(".embed-blocked-hide", aviso).addEventListener("click", () => {
      iframe.dataset.avisoOculto = "1"; // falso positivo: que no vuelva
      aviso.remove();
    });
    host.appendChild(aviso);
  }

  /* ---------------------------------------------------------------------
   * 8d. Aviso general de bloqueador de anuncios — complementa a 8c. Aquella
   *      solo salta cuando UN embed concreto falla de un modo observable
   *      desde afuera; pero un bloqueador puede romper el contenido POR
   *      DENTRO del embed (peticiones del propio visor de Drive, p. ej.), y
   *      eso, al ser cross-origin, es invisible. Por eso, además, se
   *      detecta la presencia de un bloqueador en sí, con las dos pruebas
   *      clásicas, y se avisa una vez por sesión con un cartel discreto que
   *      no tapa nada:
   *        1. Señuelo cosmético: un <div> con clases típicas de anuncio; si
   *           el bloqueador lo esconde (offsetHeight 0 / display:none), hay
   *           bloqueador.
   *        2. Señuelo de red: un fetch "no-cors" a un script de anuncios
   *           que las listas bloquean de plano.
   *      El señuelo de red NO puede ser adsbygoogle.js, gpt.js ni ad_status.js
   *      (los clásicos): uBlock Origin los "neutraliza" respondiendo un
   *      sustituto inofensivo en vez de bloquearlos, así que el fetch pasa
   *      igual (verificado con uBO Lite). conversion.js de googleadservices sí
   *      lo bloquea. Sigue siendo una heurística: un bloqueador que no
   *      toque ninguno de los dos señuelos pasa sin ser detectado.
   * ------------------------------------------------------------------- */
  const CLAVE_AVISO_CERRADO = "incca-visor-aviso-adblock-cerrado";
  const URL_SENUELO_RED = "https://www.googleadservices.com/pagead/conversion.js";

  function senuelosDeBloqueador() {
    const senuelo = document.createElement("div");
    senuelo.className = "adsbox ad-banner ad-placement pub_300x250 textAd banner_ad";
    senuelo.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:10px;height:10px";
    senuelo.innerHTML = "&nbsp;";
    document.body.appendChild(senuelo);
    const cosmetico = new Promise((res) => setTimeout(() => {
      const cs = getComputedStyle(senuelo);
      res(!senuelo.isConnected || senuelo.offsetHeight === 0 || cs.display === "none" || cs.visibility === "hidden");
      senuelo.remove();
    }, 200));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const red = fetch(URL_SENUELO_RED, { mode: "no-cors", credentials: "omit", referrerPolicy: "no-referrer", signal: ctrl.signal })
      .then(() => false, (e) => e.name !== "AbortError" && navigator.onLine !== false)
      .finally(() => { clearTimeout(timer); ctrl.abort(); });

    return Promise.all([cosmetico, red]).then(([a, b]) => a || b);
  }

  function avisoAdblockCerrado() {
    try { return sessionStorage.getItem(CLAVE_AVISO_CERRADO) === "1"; } catch (e) { return false; }
  }

  function mostrarAvisoAdblock() {
    if ($(".adblock-banner")) return;
    const aviso = document.createElement("div");
    aviso.className = "adblock-banner";
    aviso.setAttribute("role", "status");
    aviso.innerHTML = `
      <i class="fa-solid fa-shield-halved adblock-banner-icon" aria-hidden="true"></i>
      <p><strong>Detectamos un bloqueador de anuncios.</strong> Si algún video o documento no carga, desactívalo para este sitio y recarga la página.</p>
      <button class="adblock-banner-close" type="button" aria-label="Cerrar aviso"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
    $(".adblock-banner-close", aviso).addEventListener("click", () => {
      aviso.remove();
      try { sessionStorage.setItem(CLAVE_AVISO_CERRADO, "1"); } catch (e) { /* sin storage: reaparece al recargar */ }
    });
    document.body.appendChild(aviso);
  }

  function initAvisoAdblock() {
    if (avisoAdblockCerrado()) return;
    senuelosDeBloqueador().then((hay) => { if (hay) mostrarAvisoAdblock(); });
  }

  /* ---------------------------------------------------------------------
   * Arranque
   * ------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    const datos = obtenerDatos();
    renderHero(datos, datos.recursos.length > 0);
    renderContenido(datos);
    vigilarEmbeds(document);
    initAvisoAdblock();
    initMediaModal();
    initReadingModal();
  });
})();
