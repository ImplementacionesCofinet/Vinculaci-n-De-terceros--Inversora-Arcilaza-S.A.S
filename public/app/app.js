(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const { esc, kb, fechaCorta, fechaHora, fechaLarga, fechaNum } = UTIL;
  const vista = $('#vista');
  const modal = $('#modal');
  let sesion = {};
  let resumenActual = null;

  // ---------- Utilidades ----------
  async function api(url, opciones = {}) {
    const init = { ...opciones };
    if (init.body && !(init.body instanceof FormData)) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(init.body);
    }
    try {
      const resp = await fetch(url, init);
      const r = await resp.json().catch(() => ({ ok: false, errores: ['Respuesta inválida del servidor'] }));
      if (resp.status === 401 && !url.includes('/auth/')) mostrarLogin();
      return r;
    } catch {
      return { ok: false, errores: ['No hay conexión con el servidor'] };
    }
  }

  function aviso(texto, error) {
    const el = $('#aviso');
    el.textContent = texto;
    el.className = 'aviso' + (error ? ' error' : '');
    el.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => (el.hidden = true), 5000);
  }

  const alertaErrores = (lista) => `<div class="alerta alerta-error"><ul>${(lista || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  const badge = (e) => `<span class="estado estado-${e}">${esc(CAMPOS.ESTADOS[e] || e)}</span>`;
  const cat = (c) => CAMPOS.CATEGORIAS[c] || { nombre: c, plural: c };
  const iniciales = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  function abrirModal(html, alEnviar) {
    modal.innerHTML = `<form method="dialog" novalidate>${html}</form>`;
    const f = $('form', modal);
    f.addEventListener('submit', async (e) => {
      if (e.submitter?.value === 'cancelar') return;
      e.preventDefault();
      const btn = e.submitter;
      if (btn) btn.disabled = true;
      const cerrar = await alEnviar(f);
      if (btn) btn.disabled = false;
      if (cerrar !== false) modal.close();
    });
    modal.showModal();
    return f;
  }
  const botonesModal = (texto, clase = '') =>
    `<div id="m-err"></div><div class="botones"><button class="btn btn-linea" value="cancelar" formnovalidate>Cancelar</button><button class="btn ${clase}">${esc(texto)}</button></div>`;
  const errorModal = (r) => { $('#m-err', modal).innerHTML = alertaErrores(r.errores); return false; };

  function encabezado({ titulo, sub, acciones = '', migas = '' }) {
    return `<header class="encabezado">
      ${migas}
      <div style="display:flex;align-items:center;gap:12px"><button class="btn btn-linea btn-chico menu-movil" data-menu aria-label="Menú">☰</button>
        <div><h1>${titulo}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>
      <div class="acciones">${acciones}</div></header>`;
  }

  // ---------- Sesión ----------
  function mostrarLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#l-usuario').focus();
  }

  async function iniciar() {
    sesion = await api('/api/auth/me');
    if (!sesion.usuario) return mostrarLogin();
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#usuario-nombre').textContent = sesion.usuario.nombre;
    $('#usuario-rol').textContent = sesion.usuario.rol === 'admin' ? 'Administrador' : 'Contabilidad';
    $('#avatar').textContent = iniciales(sesion.usuario.nombre);
    document.querySelectorAll('[data-solo-admin]').forEach((el) => (el.hidden = sesion.usuario.rol !== 'admin'));
    enrutar();
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api('/api/auth/login', { method: 'POST', body: { usuario: f.usuario.value, password: f.password.value } });
    if (!r.ok) return ($('#login-error').innerHTML = alertaErrores(r.errores));
    $('#login-error').innerHTML = '';
    f.reset();
    iniciar();
  });
  $('#btn-salir').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); mostrarLogin(); });
  vista.addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) $('#lateral').classList.toggle('abierto'); });

  // ---------- Enrutador ----------
  const rutas = {
    bandeja: vistaBandeja,
    categoria: vistaCategoria,
    expediente: vistaExpediente,
    registrar: vistaRegistrar,
    'por-actualizar': vistaPorActualizar,
    reportes: vistaReportes,
    usuarios: vistaUsuarios,
    cuenta: vistaCuenta,
  };
  let origenLista = { etiqueta: 'Bandeja de revisión', ruta: '#/bandeja' };

  async function enrutar() {
    if (!sesion.usuario) return;
    const partes = (location.hash.replace(/^#\/?/, '') || 'bandeja').split('/');
    const actual = partes.slice(0, 2).join('/');
    document.querySelectorAll('#nav a[data-ruta]').forEach((a) => {
      const r = a.dataset.ruta;
      a.classList.toggle('activo', r === actual || r === partes[0] || (partes[0] === 'expediente' && origenLista.ruta === '#/' + r));
    });
    $('#lateral').classList.remove('abierto');
    await actualizarResumen();
    await (rutas[partes[0]] || vistaBandeja)(...partes.slice(1));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', enrutar);

  async function actualizarResumen() {
    const r = await api('/api/resumen');
    if (!r.ok) return;
    resumenActual = r;
    document.querySelectorAll('[data-cuenta]').forEach((el) => (el.textContent = r[el.dataset.cuenta] || ''));
    $('#nav-otros').hidden = !r.por_categoria.otro;
  }

  // ---------- Tabla de terceros ----------
  function tabla(lista, { mostrarTipo = true } = {}) {
    if (!lista.length) return '<div class="vacio">No hay terceros con estos filtros.</div>';
    return `<div class="tabla-scroll"><table class="tabla"><thead><tr>
      <th>Consecutivo</th><th>Razón social</th>${mostrarTipo ? '<th>Tipo</th>' : ''}<th>Documento</th><th>Recibido</th><th>Anexos</th><th>Estado</th>
      </tr></thead><tbody>${lista.map((t) => `<tr data-id="${t.id}">
        <td class="cons">${esc(t.consecutivo)}</td>
        <td class="nom">${esc(t.nombre)}</td>
        ${mostrarTipo ? `<td class="tenue">${esc(cat(t.categoria).nombre)}</td>` : ''}
        <td class="tenue">${esc(CAMPOS.documento(t.tipo_documento, t.numero_documento))}</td>
        <td class="tenue">${fechaCorta(t.created_at)}</td>
        <td class="tenue">${t.anexos_tipos} / ${t.anexos_total}</td>
        <td>${badge(t.estado)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function enlazarFilas(etiqueta, ruta) {
    vista.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => {
      origenLista = { etiqueta, ruta };
      location.hash = `#/expediente/${tr.dataset.id}`;
    }));
  }

  function filtroSelect(id, etiqueta, opciones, valor, porDefecto) {
    return `<label class="filtro${valor !== porDefecto ? ' activo' : ''}" data-filtro="${id}"><span>${etiqueta}:</span>
      <select id="${id}">${opciones.map(([v, t]) => `<option value="${esc(v)}"${v === valor ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  }

  /** Lista con buscador y filtros. `fijo` son filtros que no se muestran (p. ej. la categoría). */
  async function listaFiltrada({ titulo, sub, fijo = {}, filtros, etiqueta, ruta, mostrarTipo }) {
    const anioActual = String(new Date().getFullYear());
    const anios = [...new Set([anioActual, ...(resumenActual?.anios || []).map(String)])];
    const estados = [['', 'todos'], ['pendientes', 'pendientes'], ...Object.entries(CAMPOS.ESTADOS).map(([k, v]) => [k, v.toLowerCase()])];
    const valores = { tipo: '', estado: filtros.estado ?? '', anio: filtros.anio ?? anioActual };
    vista.innerHTML = encabezado({
      titulo, sub,
      acciones: `<a class="btn btn-linea" href="#/registrar${fijo.categoria ? '/' + fijo.categoria : ''}">Registrar manualmente</a>
        <a class="btn" id="exportar" href="#">Exportar base</a>`,
    }) + `<div class="cuerpo">
      ${filtros.kpis ? kpis() : ''}
      <div class="filtros">
        <input type="search" id="buscar" placeholder="Buscar por razón social, NIT o consecutivo" aria-label="Buscar tercero">
        ${fijo.categoria ? '' : filtroSelect('f-tipo', 'Tipo', [['', 'todos'], ...Object.entries(CAMPOS.CATEGORIAS).map(([k, v]) => [k, v.plural.toLowerCase()])], '', '')}
        ${filtroSelect('f-estado', 'Estado', estados, valores.estado, '')}
        ${filtroSelect('f-anio', 'Año', [['', 'todos'], ...anios.map((a) => [a, a])], valores.anio, '')}
      </div>
      <div class="tabla-caja" id="resultado"><div class="vacio">Cargando…</div></div></div>`;

    const cargar = async () => {
      const params = new URLSearchParams({
        q: $('#buscar').value.trim(), categoria: fijo.categoria || $('#f-tipo')?.value || '', estado: $('#f-estado').value, anio: $('#f-anio').value,
      });
      vista.querySelectorAll('[data-filtro]').forEach((l) => l.classList.toggle('activo', Boolean(l.querySelector('select').value)));
      $('#exportar').href = '/api/terceros/exportar.csv?' + params;
      const r = await api('/api/terceros?' + params);
      if (!r.ok) return;
      $('#resultado').innerHTML = tabla(r.terceros, { mostrarTipo });
      enlazarFilas(etiqueta, ruta);
    };
    let t;
    $('#buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 250); });
    vista.querySelectorAll('.filtros select').forEach((s) => s.addEventListener('change', cargar));
    await cargar();
  }

  function kpis() {
    const r = resumenActual;
    const mes = UTIL.MESES_LARGOS[new Date().getMonth()];
    const k = (etq, n, color, filtro) => `<a class="kpi" href="#" data-kpi="${filtro}"><div class="kpi-etq">${etq}</div><div class="kpi-num" style="color:${color}">${n}</div></a>`;
    return `<div class="kpis">
      ${k('Pendientes de revisión', r.pendientes, 'var(--terracota)', 'pendientes')}
      ${k('Devueltos al tercero', r.devueltos, 'var(--magenta)', 'devuelto')}
      ${k('En Cumplimiento', r.en_cumplimiento, 'var(--azul)', 'en_cumplimiento')}
      ${k(`Aprobados en ${mes}`, r.aprobados_mes, 'var(--verde-2)', 'aprobado')}
    </div>`;
  }

  // ---------- Bandeja ----------
  async function vistaBandeja() {
    const r = resumenActual;
    await listaFiltrada({
      titulo: 'Bandeja de revisión',
      sub: `${plural(r.total, 'tercero registrado', 'terceros registrados')} · ${r.pendientes} esperando revisión`,
      filtros: { estado: 'pendientes', kpis: true },
      etiqueta: 'Bandeja de revisión', ruta: '#/bandeja', mostrarTipo: true,
    });
    vista.querySelectorAll('[data-kpi]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      $('#f-estado').value = a.dataset.kpi;
      $('#f-estado').dispatchEvent(new Event('change'));
    }));
  }

  async function vistaCategoria(c) {
    if (!CAMPOS.CATEGORIAS[c]) return vistaBandeja();
    const info = cat(c);
    const n = resumenActual.por_categoria[c] || 0;
    await listaFiltrada({
      titulo: info.plural,
      sub: `${plural(n, info.nombre.toLowerCase() + ' registrado', info.plural.toLowerCase() + ' registrados')} · archivo ${info.carpeta}${info.porAnio ? ' / año' : ''}`,
      fijo: { categoria: c }, filtros: { estado: '', anio: '' },
      etiqueta: info.plural, ruta: `#/categoria/${c}`, mostrarTipo: false,
    });
  }

  // ---------- Expediente ----------
  /** Estado de revisión de cada anexo: punto de color y texto. */
  function revisionAnexos(t) {
    return CAMPOS.anexosPara(t.categoria, t.persona).map((def) => {
      const archivos = t.anexos.filter((a) => a.tipo === def.name);
      let nivel = 'ok';
      let detalle = archivos.map((a) => `<a href="/api/anexos/${a.id}?ver=1" target="_blank" rel="noopener">${esc(a.nombre_archivo)}</a>`).join('<br>');
      let problema = null;
      if (!archivos.length) {
        nivel = def.req ? 'alerta' : 'vacio';
        detalle = def.req ? 'No aportado' : 'Opcional — no aportado';
        if (def.req) problema = `${def.label}: no se recibió`;
      } else if (def.min && archivos.length < def.min) {
        nivel = 'alerta';
        detalle = def.name === 'ref_comerciales' && archivos.length === 1 ? 'Solo se recibió una de las dos' : `Solo se recibió ${archivos.length} de ${def.min} esperados`;
        problema = `${def.label}: ${detalle.toLowerCase()}`;
      } else if (def.name === 'camara' && t.datos.fecha_camara) {
        const dias = Math.floor((new Date(t.created_at.slice(0, 10)) - new Date(t.datos.fecha_camara)) / 86400000);
        if (dias > 30) {
          nivel = 'alerta';
          detalle = `Expedido el ${fechaNum(t.datos.fecha_camara)} — supera los 30 días`;
          problema = `${def.label}: expedido el ${fechaNum(t.datos.fecha_camara)}, supera los 30 días`;
        } else detalle += ` · expedido el ${fechaNum(t.datos.fecha_camara)}`;
      }
      return { def, archivos, nivel, detalle, problema };
    });
  }

  function filaDato(etq, valor) {
    return `<div class="fila-dato"><div>${esc(etq)}</div><div${valor ? '' : ' class="por-completar"'}>${valor ? esc(valor) : 'Por completar'}</div></div>`;
  }

  async function vistaExpediente(id) {
    const r = await api('/api/terceros/' + encodeURIComponent(id));
    if (!r.ok) { vista.innerHTML = encabezado({ titulo: 'Expediente' }) + `<div class="cuerpo">${alertaErrores(r.errores)}</div>`; return; }
    const t = r.tercero;
    const d = t.datos;
    const info = cat(t.categoria);
    const juridica = t.persona === 'juridica';
    const esEmpleado = t.categoria === 'empleado';
    const revision = revisionAnexos(t);
    const abiertos = ['pendiente', 'en_revision', 'devuelto'].includes(t.estado);
    const docLabel = t.tipo_documento === 'NIT' ? 'NIT' : t.tipo_documento || 'Documento';

    let acciones = '';
    if (abiertos) {
      if (!esEmpleado) acciones += '<button class="btn btn-alerta" data-accion="devolver">Devolver al tercero</button>';
      acciones += `<button class="btn" data-accion="aprobar">${info.sagrilaft ? 'Aprobar y enviar a Cumplimiento' : 'Aprobar expediente'}</button>`;
    }
    if (['aprobado', 'en_cumplimiento', 'devuelto', 'rechazado'].includes(t.estado)) {
      acciones = '<button class="btn btn-alerta" data-accion="reversar" title="Devuelve el expediente a revisión si se aprobó, envió, devolvió o rechazó por error">Reversar tercero</button>' + acciones;
    }
    if (info.sagrilaft && ['aprobado', 'en_cumplimiento'].includes(t.estado)) {
      acciones += `<button class="btn ${t.estado === 'aprobado' ? '' : 'btn-linea'}" data-accion="reenviar">${t.estado === 'aprobado' ? 'Enviar a Cumplimiento' : 'Reenviar a Cumplimiento'}</button>`;
    }

    const basica = esEmpleado
      ? [['Nombre completo', t.nombre], ['Cédula', t.numero_documento], ['Ciudad', t.ciudad], ['Correo', t.email]]
      : [[juridica ? 'Razón social' : 'Nombre', t.nombre], [docLabel, t.numero_documento], ['País y ciudad', [t.pais, t.ciudad].filter(Boolean).join(' · ')],
        ...(juridica ? [['Representante legal', d.representante_legal]] : []), ['Persona de contacto', t.contacto], ['Teléfono', t.telefono], ['Correo', t.email]];

    const sagrilaft = CAMPOS.REVISION.sagrilaft.filter((c) => !c.persona || c.persona === t.persona).map((c) => {
      const v = d[c.name];
      const clase = !v ? '' : v === c.riesgo ? 'alerta' : 'ok';
      return `<div class="fila-sagrilaft"><span>${esc(!juridica && c.labelNatural ? c.labelNatural : c.label)}</span><span class="pastilla ${clase}">${esc(v || '—')}</span></div>`;
    }).join('');

    const recibidos = revision.filter((x) => x.archivos.length).length;
    const carpetaTexto = t.carpeta.split('/').join(' / ');

    vista.innerHTML = `<header class="encabezado" style="padding:20px 36px 22px">
        <div class="migas"><button class="btn btn-linea btn-chico menu-movil" data-menu aria-label="Menú">☰</button>
          <a href="${origenLista.ruta}">${esc(origenLista.etiqueta)}</a><span class="sep">&nbsp;/&nbsp;</span><span class="actual">${esc(t.consecutivo)}</span></div>
        <div style="display:flex;flex-direction:column;gap:9px">
          <div class="titulo-detalle"><h1>${esc(t.nombre)}</h1>${badge(t.estado)}</div>
          <div class="sub" style="font-size:14px">${esc(info.nombre)}${esEmpleado ? '' : ' · ' + esc(CAMPOS.PERSONAS[t.persona])} · ${esc(esEmpleado ? 'C.C. ' + t.numero_documento : docLabel + ' ' + t.numero_documento)} ·
            ${t.origen === 'portal' ? 'Recibido' : 'Registrado'} el ${fechaLarga(t.created_at)}${t.origen === 'manual' ? ' por ' + esc(t.creado_por) : ''}</div>
        </div>
        <div class="acciones">${acciones}</div>
      </header>
      <div class="cuerpo"><div class="detalle">
        <div class="detalle-izq">
          <div class="tarjeta"><div class="tarjeta-titulo">Información básica <button class="btn-texto" data-accion="editar">Editar</button></div>
            ${basica.map(([k, v]) => filaDato(k, v)).join('')}</div>
          <div class="tarjeta"><div class="tarjeta-titulo">Información bancaria <button class="btn-texto" data-accion="editar">Editar</button></div>
            ${filaDato('Beneficiario', d.beneficiario)}${filaDato('Banco', d.banco)}${filaDato('Tipo de cuenta', d.tipo_cuenta)}${filaDato('Número de cuenta', d.numero_cuenta)}</div>
          ${info.sagrilaft ? `<div class="tarjeta"><div class="tarjeta-titulo">Declaraciones SAGRILAFT <button class="btn-texto" data-accion="editar">Editar</button></div>${sagrilaft}
            <div class="ayuda" style="margin:0">Transcriba las respuestas de la sección correspondiente del FOR-DCF-001.</div></div>` : ''}
        </div>
        <div class="detalle-der">
          <div class="tarjeta">
            <div class="tarjeta-titulo">Anexos · ${esEmpleado ? 'empleado' : 'sección 9, ' + esc(CAMPOS.PERSONAS[t.persona].toLowerCase())} (${recibidos}/${revision.length})
              <span style="display:flex;gap:16px">${t.sharepoint_url ? `<a href="${esc(t.sharepoint_url)}" target="_blank" rel="noopener">Abrir carpeta en SharePoint</a>` : ''}
                <button class="btn-texto" data-accion="anexos">Gestionar</button></span></div>
            <div class="anexos-lista">${revision.map((x) => `<div class="anexo">
              <span class="punto ${x.nivel === 'ok' ? '' : 'p-' + x.nivel}"></span>
              <div class="anexo-texto"><div class="anexo-titulo"><span class="letra">${x.def.letra}.</span> ${esc(x.def.corto || x.def.label)}</div><div class="anexo-detalle">${x.detalle}</div></div>
              ${x.archivos.length ? `<a class="btn btn-linea" href="/api/anexos/${x.archivos[0].id}?ver=1" target="_blank" rel="noopener">Ver</a>` : '<button class="btn btn-linea" disabled>Ver</button>'}
            </div>`).join('')}</div>
            <div class="ayuda" style="margin:0" title="${esc(carpetaTexto)}">Carpeta: ${esc(carpetaTexto)}</div>
          </div>
          <div class="tarjeta"><div class="tarjeta-titulo">Observaciones de la revisión</div>
            <textarea id="observaciones" rows="4" ${abiertos ? '' : 'readonly'} placeholder="Ej.: Falta la segunda referencia comercial. El certificado de cámara supera los 30 días.">${esc(t.observaciones || '')}</textarea>
            <div class="ayuda" style="margin:0">${esEmpleado ? 'Notas internas del expediente.' : 'Si devuelve el expediente, este texto se envía al correo del tercero.'}
              ${abiertos ? ' · <button class="btn-texto" data-accion="rechazar">Rechazar expediente</button>' : ''}</div>
          </div>
          <div class="tarjeta"><div class="tarjeta-titulo">Historial</div>
            <div class="historial">${t.historial.map((h) => `<div class="cuando">${fechaHora(h.created_at)}</div><div>${esc(h.texto)}</div>`).join('')}
              ${t.correos.map((c) => `<div class="cuando">${fechaHora(c.created_at)}</div><div>Correo ${c.estado === 'error' ? 'no enviado' : c.estado === 'simulado' ? 'generado (simulado)' : 'enviado'}: “${esc(c.asunto)}” → ${esc(c.destinatarios)}${c.estado === 'error' ? ` <span style="color:var(--magenta)">(${esc(c.detalle)})</span>` : ''}</div>`).join('')}</div>
            ${sesion.usuario.rol === 'admin' ? '<div style="text-align:right"><button class="btn-texto" data-accion="eliminar" style="color:var(--magenta)">Eliminar expediente</button></div>' : ''}
          </div>
        </div>
      </div></div>`;

    // Guardado automático de observaciones
    const obs = $('#observaciones');
    let temporizador;
    const guardarObs = () => api(`/api/terceros/${t.id}/observaciones`, { method: 'PUT', body: { observaciones: obs.value } });
    obs.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(guardarObs, 700); });

    vista.querySelectorAll('[data-accion]').forEach((b) => b.addEventListener('click', () => accion(b.dataset.accion, t, revision)));
  }

  async function accion(acc, t, revision) {
    const obs = $('#observaciones')?.value.trim() || '';
    const recargar = () => vistaExpediente(t.id).then(actualizarResumen);

    if (acc === 'editar') return modalEditar(t);
    if (acc === 'reversar') {
      const avisa = t.estado === 'en_cumplimiento';
      abrirModal(`<h3>Reversar tercero</h3>
        <p>${esc(t.consecutivo)} · ${esc(t.nombre)} está <b>${esc(CAMPOS.ESTADOS[t.estado])}</b>. Al reversarlo vuelve a <b>En revisión</b>
          y se borra la aprobación${t.revisado_por ? ` registrada por ${esc(t.revisado_por)}` : ''}.</p>
        ${avisa ? `<div class="alerta alerta-info">Como ya se envió a Cumplimiento, se avisará al ${esc(sesion.oficial || 'Oficial de Cumplimiento')} que no tenga en cuenta el envío anterior.</div>` : ''}
        ${t.estado === 'devuelto' ? '<div class="alerta alerta-info">El enlace de corrección que recibió el tercero dejará de funcionar.</div>' : ''}
        <div class="campo"><label for="m-motivo">Motivo del reverso <span class="req">*</span></label>
          <textarea id="m-motivo" name="motivo" rows="3" required placeholder="Ej.: Se aprobó por error; falta verificar la referencia bancaria."></textarea></div>
        ${botonesModal('Reversar', 'btn-magenta')}`,
      async (f) => {
        const motivo = f.motivo.value.trim();
        if (!motivo) return errorModal({ errores: ['Indique el motivo del reverso'] });
        const res = await api(`/api/terceros/${t.id}/reversar`, { method: 'POST', body: { motivo } });
        if (!res.ok) return errorModal(res);
        aviso(res.correo && !res.correo.ok ? 'Reversado, pero no se pudo avisar a Cumplimiento: ' + res.correo.error : `Expediente reversado: vuelve a revisión${res.correo ? ' y se avisó a Cumplimiento' : ''}`, res.correo && !res.correo.ok);
        recargar();
      });
      return;
    }
    if (acc === 'anexos') return modalAnexos(t);
    if (acc === 'eliminar') {
      if (!confirm(`¿Eliminar definitivamente ${t.consecutivo} – ${t.nombre}, su carpeta y todos sus anexos?`)) return;
      await api('/api/terceros/' + t.id, { method: 'DELETE' });
      aviso('Expediente eliminado');
      location.hash = origenLista.ruta;
      return;
    }
    if (acc === 'devolver' || acc === 'rechazar') {
      if (!obs) { $('#observaciones').focus(); return aviso(`Escriba en "Observaciones de la revisión" ${acc === 'devolver' ? 'qué debe corregir el tercero' : 'el motivo del rechazo'}.`, true); }
      const problemas = revision.map((x) => x.problema).filter(Boolean);
      abrirModal(acc === 'devolver'
        ? `<h3>Devolver al tercero</h3><p>Se enviará a <b>${esc(t.email)}</b> un correo con sus observaciones y un enlace para reemplazar los documentos.</p>
          <div class="alerta alerta-info" style="white-space:pre-line">${esc(obs)}</div>
          ${problemas.length ? `<h4>DOCUMENTOS QUE SE INCLUIRÁN EN EL CORREO</h4><ul style="margin:0;padding-left:18px;font-size:14px">${problemas.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
          ${botonesModal('Devolver y notificar', 'btn-magenta')}`
        : `<h3>Rechazar expediente</h3><p>${esc(t.consecutivo)} · ${esc(t.nombre)} quedará como rechazado. El tercero no recibe notificación automática.</p>
          <div class="alerta alerta-info" style="white-space:pre-line">${esc(obs)}</div>${botonesModal('Rechazar', 'btn-magenta')}`,
      async () => {
        const res = await api(`/api/terceros/${t.id}/${acc}`, { method: 'POST', body: { observaciones: obs, pendientes: problemas } });
        if (!res.ok) return errorModal(res);
        aviso(acc === 'devolver' ? (res.correo?.ok ? `Expediente devuelto. Se notificó a ${t.email}.` : 'Expediente devuelto, pero el correo falló: ' + res.correo?.error) : 'Expediente rechazado', acc === 'devolver' && !res.correo?.ok);
        recargar();
      });
      return;
    }
    if (acc === 'aprobar' || acc === 'reenviar') {
      const info = cat(t.categoria);
      const problemas = revision.filter((x) => x.problema);
      const faltanDatos = info.sagrilaft && CAMPOS.REVISION.sagrilaft.some((c) => (!c.persona || c.persona === t.persona) && !t.datos[c.name]);
      abrirModal(`<h3>${acc === 'reenviar' ? 'Enviar a Cumplimiento' : info.sagrilaft ? 'Aprobar y enviar a Cumplimiento' : 'Aprobar expediente'}</h3>
        ${info.sagrilaft ? `<p>Se enviará al ${esc(sesion.oficial || 'Oficial de Cumplimiento (sin correo configurado)')} un correo con la información del tercero y los ${t.anexos.length} documentos adjuntos.</p>` : `<p>El expediente de ${esc(t.nombre)} quedará aprobado por Contabilidad.</p>`}
        ${problemas.length && acc === 'aprobar' ? `<div class="alerta alerta-error"><b>Hay documentos con observaciones:</b><ul>${problemas.map((x) => `<li>${esc(x.problema)}</li>`).join('')}</ul></div>` : ''}
        ${faltanDatos && acc === 'aprobar' ? '<div class="alerta alerta-info">Aún no ha transcrito todas las declaraciones SAGRILAFT.</div>' : ''}
        ${sesion.smtp ? '' : '<div class="alerta alerta-info">SMTP no configurado: el correo se generará y guardará en el servidor sin enviarse.</div>'}
        ${botonesModal(acc === 'reenviar' ? 'Enviar' : 'Aprobar')}`,
      async () => {
        const res = await api(`/api/terceros/${t.id}/${acc === 'aprobar' ? 'aprobar' : 'reenviar-cumplimiento'}`, { method: 'POST', body: { observaciones: $('#observaciones')?.value } });
        if (!res.ok && !res.tercero) return errorModal(res);
        if (res.correo && !res.correo.ok) aviso('Aprobado, pero no se pudo enviar a Cumplimiento: ' + res.correo.error, true);
        else aviso(res.correo ? `Enviado al Oficial de Cumplimiento${res.correo.estado === 'simulado' ? ' (simulado)' : ''}` : 'Expediente aprobado');
        recargar();
      });
    }
  }

  function campoHtml(c, valor, prefijo = 'e_') {
    const id = prefijo + c.name;
    const v = valor ?? '';
    let control;
    if (c.type === 'select') {
      control = `<select id="${id}" name="${c.name}"${c.req ? ' required' : ''}><option value="">—</option>${c.options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else control = `<input id="${id}" name="${c.name}" type="${c.type || 'text'}" value="${esc(v)}"${c.req ? ' required' : ''}>`;
    return `<div class="campo${c.full ? ' ancho' : ''}"><label for="${id}">${esc(c.label)}</label>${control}</div>`;
  }

  function modalEditar(t) {
    const juridica = t.persona === 'juridica';
    const aplica = (c) => !c.persona || c.persona === t.persona;
    const basicos = CAMPOS.basicosPara(t.categoria);
    const sagri = CAMPOS.REVISION.sagrilaft.filter(aplica).map((c) => ({ ...c, label: !juridica && c.labelNatural ? c.labelNatural : c.label, type: 'select', options: ['Sí', 'No'] }));
    abrirModal(`<h3>Editar ${esc(t.consecutivo)}</h3>
      <h4>DATOS BÁSICOS</h4><div class="rejilla">${basicos.map((c) => campoHtml(c, t[c.name])).join('')}</div>
      ${t.categoria === 'empleado' ? '' : `<h4>DEL FORMULARIO FOR-DCF-001</h4><div class="rejilla">${CAMPOS.REVISION.basica.filter(aplica).map((c) => campoHtml({ ...c, full: true }, t.datos[c.name])).join('')}</div>`}
      <h4>INFORMACIÓN BANCARIA</h4><div class="rejilla">${CAMPOS.REVISION.bancaria.map((c) => campoHtml(c, t.datos[c.name])).join('')}</div>
      ${cat(t.categoria).sagrilaft ? `<h4>DECLARACIONES SAGRILAFT</h4><div class="rejilla">${sagri.map((c) => campoHtml(c, t.datos[c.name])).join('')}</div>` : ''}
      ${botonesModal('Guardar')}`,
    async (f) => {
      const body = Object.fromEntries([...f.elements].filter((el) => el.name).map((el) => [el.name, el.value]));
      const res = await api('/api/terceros/' + t.id, { method: 'PUT', body });
      if (!res.ok) return errorModal(res);
      aviso('Información actualizada');
      vistaExpediente(t.id);
    });
  }

  function modalAnexos(t) {
    const defs = CAMPOS.anexosPara(t.categoria, t.persona);
    const f = abrirModal(`<h3>Gestionar anexos</h3>
      <div class="anexos-lista">${t.anexos.length ? t.anexos.map((a) => `<div class="anexo"><div class="anexo-texto">
        <div class="anexo-titulo">${esc(CAMPOS.etiquetaAnexo(a.tipo))}</div><div class="anexo-detalle">${esc(a.nombre_archivo)} · ${kb(a.tamano)} · ${fechaHora(a.created_at)}</div></div>
        <a class="btn btn-linea" href="/api/anexos/${a.id}">Descargar</a><button type="button" class="btn btn-alerta" data-borrar="${a.id}">Eliminar</button></div>`).join('') : '<p class="ayuda">Sin anexos.</p>'}</div>
      <h4>AGREGAR DOCUMENTO</h4>
      <div class="rejilla"><div class="campo"><label for="m-tipo">Tipo</label><select id="m-tipo">${defs.map((d) => `<option value="${d.name}">${esc(d.corto || d.label)}</option>`).join('')}</select></div>
        <div class="campo"><label for="m-archivo">Archivo</label><input type="file" id="m-archivo" multiple accept=".pdf,application/pdf"></div></div>
      <p class="ayuda">Si el tipo admite un solo archivo, el nuevo reemplaza al anterior. Se revisan igual que los del portal.</p>
      ${botonesModal('Subir')}`,
    async (form) => {
      const archivos = [...$('#m-archivo', form).files];
      if (!archivos.length) return errorModal({ errores: ['Seleccione un archivo'] });
      for (const a of archivos) { const e = await UTIL.revisar(a); if (e) return errorModal({ errores: [`${a.name}: ${e}`] }); }
      const fd = new FormData();
      archivos.forEach((a) => fd.append($('#m-tipo', form).value, a, a.name));
      const res = await api(`/api/terceros/${t.id}/anexos`, { method: 'POST', body: fd });
      if (!res.ok) return errorModal(res);
      aviso('Anexo agregado');
      vistaExpediente(t.id);
    });
    f.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este anexo del expediente?')) return;
      await api('/api/anexos/' + b.dataset.borrar, { method: 'DELETE' });
      modal.close();
      aviso('Anexo eliminado');
      vistaExpediente(t.id);
    }));
  }

  // ---------- Registro manual ----------
  async function vistaRegistrar(categoriaInicial) {
    let categoria = CAMPOS.CATEGORIAS_MANUALES.includes(categoriaInicial) ? categoriaInicial : 'empleado';
    let persona = 'natural';
    let adjuntos = []; // { file, tipo, error }
    let valores = {};

    vista.innerHTML = encabezado({
      titulo: 'Registrar tercero manualmente',
      sub: 'Para casos que no pasan por el portal público, como empleados o terceros que entregaron los documentos en físico.',
    }) + `<div class="cuerpo"><form class="manual" id="form-manual" novalidate>
        <div class="manual-izq">
          <div class="tarjeta"><div class="tarjeta-titulo">Tipo de tercero</div>
            <div class="opciones">${CAMPOS.CATEGORIAS_MANUALES.map((c) => `<label class="opcion"><input type="radio" name="categoria" value="${c}"${c === categoria ? ' checked' : ''}><span>${esc(cat(c).nombre)}</span></label>`).join('')}</div>
            <div id="persona-caja"><div class="etiqueta">¿Es persona jurídica o natural?</div><div class="opciones">
              <label class="opcion"><input type="radio" name="persona" value="juridica"><span>Persona jurídica</span></label>
              <label class="opcion"><input type="radio" name="persona" value="natural" checked><span>Persona natural</span></label></div></div>
            <div class="nota" id="nota"></div>
          </div>
          <div class="tarjeta"><div class="tarjeta-titulo">Datos</div><div class="rejilla" id="datos"></div></div>
          <div id="m-errores"></div>
          <div style="display:flex;gap:12px"><button class="btn btn-grande" id="crear" style="padding:15px 30px">Crear expediente</button><a class="btn btn-linea" href="javascript:history.back()" style="padding:15px 26px">Cancelar</a></div>
        </div>
        <div class="manual-der">
          <div class="tarjeta"><div class="tarjeta-titulo">Anexos</div>
            <div class="soltar" id="soltar" tabindex="0" role="button"><b>Arrastre los archivos aquí</b><span>Solo PDF. Se revisan igual que los del portal:<br>vacíos, dañados o renombrados se rechazan.</span></div>
            <input type="file" id="elegir" multiple hidden accept=".pdf,application/pdf">
            <div id="adjuntos" style="display:flex;flex-direction:column;gap:10px"></div>
            <div class="faltan" id="faltan"></div>
          </div>
          <div class="consecutivo-caja"><div class="etq">CONSECUTIVO ASIGNADO</div><div class="num" id="cons"></div>
            <p>Lo asigna el sistema al guardar. Nadie lo escribe a mano, así no hay dos expedientes con el mismo número.</p></div>
        </div>
      </form></div>`;
    const form = $('#form-manual');

    const defs = () => CAMPOS.anexosPara(categoria, persona);

    function pintarDatos() {
      const campos = CAMPOS.basicosPara(categoria);
      $('#datos').innerHTML = campos.map((c) => campoHtml(c, valores[c.name] ?? c.value, 'r_')).join('');
      if (categoria !== 'empleado' && !valores.tipo_documento) $('#r_tipo_documento').value = persona === 'juridica' ? 'NIT' : 'C.C.';
      const info = cat(categoria);
      $('#persona-caja').hidden = categoria === 'empleado';
      $('#nota').innerHTML = categoria === 'empleado'
        ? 'Los empleados se archivan en <b>SOPORTES CREACION TERCEROS / EMPLEADOS</b>, que no se divide por año, y no llevan el formulario SAGRILAFT.'
        : `Los ${esc(info.plural.toLowerCase())} se archivan en <b>SOPORTES CREACION TERCEROS / ${esc(info.carpeta)} / ${new Date().getFullYear()}</b> y llevan el formulario FOR-DCF-001 firmado.`;
      api('/api/consecutivo?categoria=' + categoria).then((r) => ($('#cons').textContent = r.consecutivo || ''));
    }

    function pintarAdjuntos() {
      const tipos = defs();
      adjuntos.forEach((a) => { if (!tipos.some((d) => d.name === a.tipo)) a.tipo = sugerirTipo(a); });
      $('#adjuntos').innerHTML = adjuntos.map((a, i) => `<div class="adjunto${a.error ? ' error' : ''}">
        <div class="adjunto-texto"><select data-i="${i}" aria-label="Tipo de documento">${tipos.map((d) => `<option value="${d.name}"${d.name === a.tipo ? ' selected' : ''}>${esc(d.corto || d.label)}</option>`).join('')}</select>
          <div class="adjunto-detalle">${esc(a.file.name)} · ${kb(a.file.size)} · ${a.error ? esc(a.error) : 'validado'}</div></div>
        <button type="button" class="quitar" data-quitar="${i}" aria-label="Quitar">✕</button></div>`).join('');
      const faltan = tipos.filter((d) => d.req && !adjuntos.some((a) => a.tipo === d.name && !a.error));
      $('#faltan').textContent = faltan.length ? 'Faltan: ' + faltan.map((d) => d.corto || d.label).join(', ') + '.' : 'Todos los documentos obligatorios están adjuntos.';
      $('#adjuntos').querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { adjuntos[s.dataset.i].tipo = s.value; pintarAdjuntos(); }));
      $('#adjuntos').querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => { adjuntos.splice(Number(b.dataset.quitar), 1); pintarAdjuntos(); }));
    }

    /** Primer documento esperado que aún no tiene archivo (o que admite varios). */
    function sugerirTipo(a) {
      const tipos = defs();
      const nombre = a.file.name.toLowerCase();
      const pistas = { identidad: /c[eé]dula|identidad|\bcc\b|documento/, cert_bancaria: /banc/, ref_bancaria: /banc/, rut: /rut/, camara: /c[aá]mara|existencia/,
        formulario: /formulario|for-dcf/, ref_comerciales: /comercial|referencia/, estados_financieros: /estado|financ|balance/, renta: /renta|ingresos/, accionaria: /accion/ };
      const porNombre = tipos.find((d) => pistas[d.name]?.test(nombre));
      if (porNombre) return porNombre.name;
      return (tipos.find((d) => !adjuntos.some((x) => x !== a && x.tipo === d.name)) || tipos[0]).name;
    }

    async function agregar(files) {
      for (const file of files) {
        const a = { file, tipo: null, error: await UTIL.revisar(file) };
        adjuntos.push(a);
        a.tipo = sugerirTipo(a);
      }
      pintarAdjuntos();
    }

    form.addEventListener('change', (e) => {
      if (e.target.name === 'categoria' || e.target.name === 'persona') {
        valores = Object.fromEntries([...$('#datos').querySelectorAll('[name]')].map((el) => [el.name, el.value]));
        categoria = form.querySelector('input[name=categoria]:checked').value;
        persona = categoria === 'empleado' ? 'natural' : form.querySelector('input[name=persona]:checked').value;
        if (e.target.name === 'persona') delete valores.tipo_documento;
        pintarDatos();
        pintarAdjuntos();
      }
    });
    const zona = $('#soltar');
    zona.addEventListener('click', () => $('#elegir').click());
    zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#elegir').click(); } });
    $('#elegir').addEventListener('change', (e) => { agregar([...e.target.files]); e.target.value = ''; });
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('encima'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
    zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('encima'); agregar([...e.dataTransfer.files]); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.classList.add('invalido');
      const fd = new FormData();
      fd.append('categoria', categoria);
      fd.append('persona', persona);
      const datos = {};
      $('#datos').querySelectorAll('[name]').forEach((el) => { fd.append(el.name, el.value.trim()); datos[el.name] = el.value.trim(); });
      const errores = CAMPOS.validarBasicos(categoria, datos);
      if (adjuntos.some((a) => a.error)) errores.push('Quite o reemplace los archivos con error');
      if (errores.length) { $('#m-errores').innerHTML = alertaErrores(errores); return; }
      adjuntos.forEach((a) => fd.append(a.tipo, a.file, a.file.name));
      $('#crear').disabled = true;
      const r = await api('/api/terceros', { method: 'POST', body: fd });
      $('#crear').disabled = false;
      if (!r.ok) { $('#m-errores').innerHTML = alertaErrores(r.errores); return; }
      aviso(`Expediente ${r.tercero.consecutivo} creado`);
      origenLista = { etiqueta: cat(categoria).plural, ruta: `#/categoria/${categoria}` };
      location.hash = `#/expediente/${r.tercero.id}`;
    });

    pintarDatos();
    pintarAdjuntos();
  }

  // ---------- Por actualizar ----------
  async function vistaPorActualizar() {
    const r = await api('/api/por-actualizar');
    const meses = sesion.mesesActualizacion;
    vista.innerHTML = encabezado({
      titulo: 'Por actualizar',
      sub: `Terceros aprobados hace más de ${meses} meses. SAGRILAFT exige actualizar su información y documentos periódicamente.`,
    }) + `<div class="cuerpo"><div class="tabla-caja">${r.terceros.length ? `<div class="tabla-scroll"><table class="tabla"><thead><tr>
        <th>Consecutivo</th><th>Razón social</th><th>Tipo</th><th>Documento</th><th>Aprobado</th><th>Correo</th><th>Estado</th></tr></thead><tbody>
        ${r.terceros.map((t) => `<tr data-id="${t.id}"><td class="cons">${esc(t.consecutivo)}</td><td class="nom">${esc(t.nombre)}</td><td class="tenue">${esc(cat(t.categoria).nombre)}</td>
          <td class="tenue">${esc(CAMPOS.documento(t.tipo_documento, t.numero_documento))}</td><td class="tenue">${fechaNum(t.fecha_aprobacion)}</td>
          <td class="tenue">${esc(t.email)}</td><td>${badge(t.estado)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="vacio">No hay terceros pendientes de actualización. Aquí aparecerán los aprobados hace más de ${meses} meses.</div>`}</div></div>`;
    enlazarFilas('Por actualizar', '#/por-actualizar');
  }

  // ---------- Reportes ----------
  async function vistaReportes(anio) {
    const r = await api('/api/reportes?anio=' + encodeURIComponent(anio || ''));
    const anios = [...new Set([String(new Date().getFullYear()), ...(resumenActual?.anios || []).map(String)])];
    const cats = Object.keys(CAMPOS.CATEGORIAS);
    const estados = Object.keys(CAMPOS.ESTADOS);
    const celda = (c, e) => r.matriz.find((m) => m.categoria === c && m.estado === e)?.n || 0;
    const totalCat = (c) => estados.reduce((s, e) => s + celda(c, e), 0);
    const total = cats.reduce((s, c) => s + totalCat(c), 0);
    const porOrigen = (o) => r.origen.find((x) => x.origen === o)?.n || 0;
    vista.innerHTML = encabezado({
      titulo: 'Reportes', sub: `Resumen del año ${r.anio}`,
      acciones: `<label class="filtro activo"><span>Año:</span><select id="r-anio">${anios.map((a) => `<option${a === String(r.anio) ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
        <a class="btn" href="/api/terceros/exportar.csv?anio=${r.anio}">Exportar base ${r.anio}</a>`,
    }) + `<div class="cuerpo">
      <div class="kpis">
        <div class="kpi"><div class="kpi-etq">Expedientes del año</div><div class="kpi-num" style="color:var(--verde)">${total}</div></div>
        <div class="kpi"><div class="kpi-etq">Aprobados</div><div class="kpi-num" style="color:var(--verde-2)">${r.aprobados}</div></div>
        <div class="kpi"><div class="kpi-etq">Días promedio hasta aprobar</div><div class="kpi-num" style="color:var(--azul)">${r.promedioDiasAprobacion == null ? '—' : r.promedioDiasAprobacion.toFixed(1).replace('.', ',')}</div></div>
        <div class="kpi"><div class="kpi-etq">Por portal · manuales</div><div class="kpi-num" style="color:var(--terracota)">${porOrigen('portal')} · ${porOrigen('manual')}</div></div>
      </div>
      <div class="tabla-caja"><div class="tabla-scroll"><table class="tabla"><thead><tr><th>Tipo</th>${estados.map((e) => `<th>${esc(CAMPOS.ESTADOS[e])}</th>`).join('')}<th>Total</th></tr></thead><tbody>
        ${cats.map((c) => `<tr><td class="nom">${esc(cat(c).plural)}</td>${estados.map((e) => `<td class="tenue">${celda(c, e) || '·'}</td>`).join('')}<td class="cons">${totalCat(c)}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="tabla-caja"><div class="tabla-scroll"><table class="tabla"><thead><tr><th>Mes</th><th>Expedientes recibidos</th></tr></thead><tbody>
        ${UTIL.MESES_LARGOS.map((m, i) => `<tr><td style="text-transform:capitalize">${m}</td><td class="tenue">${r.meses.find((x) => x.mes === i + 1)?.n || '·'}</td></tr>`).join('')}
      </tbody></table></div></div></div>`;
    $('#r-anio').addEventListener('change', (e) => (location.hash = '#/reportes/' + e.target.value));
  }

  // ---------- Usuarios y cuenta ----------
  async function vistaUsuarios() {
    if (sesion.usuario.rol !== 'admin') return vistaBandeja();
    const r = await api('/api/usuarios');
    vista.innerHTML = encabezado({ titulo: 'Usuarios', sub: 'Personal de Contabilidad con acceso al aplicativo', acciones: '<button class="btn" id="nuevo">Nuevo usuario</button>' }) +
      `<div class="cuerpo"><div class="tabla-caja"><div class="tabla-scroll"><table class="tabla"><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>
      ${r.usuarios.map((u) => `<tr><td class="cons">${esc(u.usuario)}</td><td class="nom">${esc(u.nombre)}</td><td class="tenue">${u.rol === 'admin' ? 'Administrador' : 'Contabilidad'}</td>
        <td><span class="pastilla ${u.activo ? 'ok' : 'alerta'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td style="text-align:right"><button class="btn btn-linea btn-chico" data-clave="${u.id}">Cambiar contraseña</button>
        ${u.id !== sesion.usuario.id ? `<button class="btn btn-linea btn-chico" data-activo="${u.id}" data-valor="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div></div>`;
    $('#nuevo').onclick = () => abrirModal(`<h3>Nuevo usuario</h3><div class="rejilla">
        <div class="campo"><label for="u1">Usuario</label><input id="u1" name="usuario" required></div>
        <div class="campo"><label for="u2">Nombre completo</label><input id="u2" name="nombre" required></div>
        <div class="campo"><label for="u3">Contraseña (mínimo 8)</label><input id="u3" name="password" type="password" required></div>
        <div class="campo"><label for="u4">Rol</label><select id="u4" name="rol"><option value="contabilidad">Contabilidad</option><option value="admin">Administrador</option></select></div>
      </div>${botonesModal('Crear')}`,
    async (f) => {
      const res = await api('/api/usuarios', { method: 'POST', body: { usuario: f.usuario.value, nombre: f.nombre.value, password: f.password.value, rol: f.rol.value } });
      if (!res.ok) return errorModal(res);
      aviso('Usuario creado');
      vistaUsuarios();
    });
    vista.querySelectorAll('[data-activo]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/usuarios/${b.dataset.activo}/activo`, { method: 'POST', body: { activo: b.dataset.valor === '1' } });
      vistaUsuarios();
    }));
    vista.querySelectorAll('[data-clave]').forEach((b) => b.addEventListener('click', () => abrirModal(`<h3>Cambiar contraseña</h3>
      <div class="campo"><label for="p1">Nueva contraseña (mínimo 8 caracteres)</label><input id="p1" name="password" type="password" required></div>${botonesModal('Guardar')}`,
    async (f) => {
      const res = await api(`/api/usuarios/${b.dataset.clave}/password`, { method: 'POST', body: { password: f.password.value } });
      if (!res.ok) return errorModal(res);
      aviso('Contraseña actualizada');
    })));
  }

  function vistaCuenta() {
    vista.innerHTML = encabezado({ titulo: 'Mi cuenta', sub: `${esc(sesion.usuario.nombre)} · ${esc(sesion.usuario.usuario)}` }) +
      `<div class="cuerpo"><form class="tarjeta" id="form-clave" style="max-width:480px"><div class="tarjeta-titulo">Cambiar contraseña</div>
        <div class="campo"><label for="c1">Contraseña actual</label><input id="c1" type="password" name="actual" required autocomplete="current-password"></div>
        <div class="campo"><label for="c2">Nueva contraseña (mínimo 8 caracteres)</label><input id="c2" type="password" name="nueva" required autocomplete="new-password"></div>
        <div id="c-err"></div><div><button class="btn">Actualizar contraseña</button></div></form></div>`;
    $('#form-clave').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await api('/api/auth/password', { method: 'POST', body: { actual: e.target.actual.value, nueva: e.target.nueva.value } });
      if (!r.ok) return ($('#c-err').innerHTML = alertaErrores(r.errores));
      e.target.reset();
      $('#c-err').innerHTML = '';
      aviso('Contraseña actualizada');
    });
  }

  iniciar();
})();
