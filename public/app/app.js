(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = RENDER.esc;
  const vista = $('#vista');
  const modal = $('#modal');
  let sesion = { usuario: null };

  // ---------- Utilidades ----------
  async function api(url, opciones = {}) {
    const init = { ...opciones };
    if (init.body && !(init.body instanceof FormData)) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(init.body);
    }
    const resp = await fetch(url, init);
    const r = await resp.json().catch(() => ({ ok: false, errores: ['Respuesta inválida del servidor'] }));
    if (resp.status === 401 && !url.includes('/auth/')) mostrarLogin();
    return r;
  }

  function aviso(texto, error) {
    const el = $('#aviso');
    el.textContent = texto;
    el.className = 'aviso' + (error ? ' error' : '');
    el.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => (el.hidden = true), 4000);
  }

  const alertaErrores = (lista) =>
    `<div class="alerta alerta-error"><ul>${(lista || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  const badge = (estado) => `<span class="estado estado-${estado}">${esc(CAMPOS.ESTADOS[estado] || estado)}</span>`;
  const fecha = (f) => (f ? esc(f.slice(0, 16)) : '—');
  const tamano = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB');
  const catNombre = (c) => CAMPOS.CATEGORIAS[c]?.nombre || c;

  function abrirModal(html, alEnviar) {
    modal.innerHTML = `<form method="dialog">${html}</form>`;
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

  // ---------- Sesión ----------
  function mostrarLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#l-usuario').focus();
  }

  async function iniciar() {
    const r = await api('/api/auth/me');
    sesion = r;
    if (!r.usuario) return mostrarLogin();
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#usuario-nombre').textContent = r.usuario.nombre;
    document.querySelectorAll('[data-solo-admin]').forEach((el) => (el.hidden = r.usuario.rol !== 'admin'));
    enrutar();
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/api/auth/login', { method: 'POST', body: RENDER.leer(e.target) });
    if (!r.ok) return ($('#login-error').innerHTML = alertaErrores(r.errores));
    $('#login-error').innerHTML = '';
    e.target.reset();
    iniciar();
  });
  $('#btn-salir').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); mostrarLogin(); });
  $('#btn-menu').addEventListener('click', () => $('#lateral').classList.toggle('abierto'));

  // ---------- Enrutador ----------
  const rutas = {
    inicio: vistaInicio,
    lista: vistaLista,
    tercero: vistaTercero,
    nuevo: vistaNuevo,
    editar: vistaEditar,
    usuarios: vistaUsuarios,
    cuenta: vistaCuenta,
  };

  async function enrutar() {
    if (!sesion.usuario) return;
    const partes = (location.hash.replace(/^#\/?/, '') || 'inicio').split('/');
    const fn = rutas[partes[0]] || vistaInicio;
    document.querySelectorAll('.lateral nav a[data-ruta]').forEach((a) => {
      const r = a.dataset.ruta;
      a.classList.toggle('activo', location.hash.replace(/^#\//, '') === r || (r === 'inicio' && !location.hash));
    });
    $('#lateral').classList.remove('abierto');
    vista.innerHTML = '<div class="vacio">Cargando…</div>';
    await fn(...partes.slice(1));
    actualizarContadores();
  }
  window.addEventListener('hashchange', enrutar);

  async function actualizarContadores() {
    const r = await api('/api/resumen');
    if (!r.ok) return;
    for (const [cat, v] of Object.entries(r.porCategoria)) {
      const el = document.querySelector(`[data-contador="${cat}"]`);
      if (el) el.textContent = v.total || '';
    }
    return r;
  }

  // ---------- Panel general ----------
  async function vistaInicio() {
    const r = await api('/api/resumen');
    if (!r.ok) return;
    const enlace = `${location.origin}/formulario/`;
    vista.innerHTML = `
      <div class="titulo-vista"><div><h2>Panel general</h2><div class="sub">Resumen de terceros registrados</div></div>
        <div class="botones"><a class="btn" href="#/nuevo">+ Registro manual</a></div></div>
      <div class="tarjetas">
        ${Object.entries(CAMPOS.CATEGORIAS).map(([cat, info]) => {
          const v = r.porCategoria[cat];
          return `<a class="tarjeta" href="#/lista/${cat}">
            <div class="etq">${esc(info.plural)}</div><div class="cifra">${v.total}</div>
            <div class="mini"><span>Pendientes <b>${v.pendiente + v.en_revision}</b></span><span>Validados <b>${v.validado}</b></span><span>Enviados <b>${v.enviado}</b></span></div></a>`;
        }).join('')}
      </div>
      <div class="caja"><div class="caja-titulo">Enlace del formulario para terceros</div>
        <div class="caja-cuerpo"><p class="ayuda">Comparta este enlace con clientes, proveedores y contratistas para que diligencien su registro y adjunten sus documentos.</p>
          <div class="enlace-form"><input readonly value="${esc(enlace)}" id="enlace"><button class="btn btn-sec" id="copiar">Copiar</button></div></div></div>
      ${sesion.smtp ? '' : '<div class="alerta alerta-info">El servidor de correo (SMTP) no está configurado: los correos se guardarán como archivos .eml en el servidor. Configure SMTP en el archivo .env para enviarlos.</div>'}
      <div class="caja"><div class="caja-titulo">Últimos registros</div>${tablaTerceros(r.recientes, true)}</div>`;
    $('#copiar').onclick = () => { navigator.clipboard?.writeText(enlace); $('#enlace').select(); aviso('Enlace copiado'); };
    enlazarFilas();
  }

  function tablaTerceros(lista, conCategoria) {
    if (!lista.length) return '<div class="vacio">No hay registros</div>';
    return `<div class="tabla-scroll"><table class="tabla"><thead><tr>
      <th>Consecutivo</th>${conCategoria ? '<th>Tipo</th>' : ''}<th>Nombre / Razón social</th>${conCategoria ? '' : '<th>Documento</th><th>Ciudad</th><th>Anexos</th><th>Origen</th>'}<th>Estado</th><th>Fecha</th></tr></thead><tbody>
      ${lista.map((t) => `<tr data-id="${t.id}">
        <td class="cons">${esc(t.consecutivo)}</td>
        ${conCategoria ? `<td>${esc(catNombre(t.categoria))}</td>` : ''}
        <td>${esc(t.nombre)}</td>
        ${conCategoria ? '' : `<td>${esc(t.tipo_documento || '')} ${esc(t.numero_documento || '')}</td><td>${esc(t.ciudad || '')}</td><td>${t.num_anexos}</td><td>${t.origen === 'manual' ? 'Manual' : 'Formulario'}</td>`}
        <td>${badge(t.estado)}</td><td>${fecha(t.created_at)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function enlazarFilas() {
    vista.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#/tercero/${tr.dataset.id}`)));
  }

  // ---------- Listas por categoría ----------
  async function vistaLista(categoria) {
    const info = CAMPOS.CATEGORIAS[categoria];
    if (!info) return vistaInicio();
    vista.innerHTML = `
      <div class="titulo-vista"><div><h2>${esc(info.plural)}</h2><div class="sub">Base de datos de ${esc(info.plural.toLowerCase())} · consecutivo ${info.prefijo}-00000</div></div>
        <div class="botones"><a class="btn btn-sec" id="exportar" href="#">Exportar a Excel (CSV)</a><a class="btn" href="#/nuevo/${categoria}">+ Nuevo ${esc(info.nombre.toLowerCase())}</a></div></div>
      <div class="caja">
        <div class="filtros">
          <input type="search" id="buscar" placeholder="Buscar por consecutivo, nombre, documento, correo o ciudad…">
          <select id="f-estado"><option value="">Todos los estados</option>${Object.entries(CAMPOS.ESTADOS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
        </div>
        <div id="resultado"></div>
      </div>`;
    const cargar = async () => {
      const params = new URLSearchParams({ categoria, q: $('#buscar').value.trim(), estado: $('#f-estado').value });
      $('#exportar').href = '/api/terceros/exportar.csv?' + params;
      const r = await api('/api/terceros?' + params);
      if (!r.ok) return;
      $('#resultado').innerHTML = tablaTerceros(r.terceros, false);
      enlazarFilas();
    };
    let t;
    $('#buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 250); });
    $('#f-estado').addEventListener('change', cargar);
    await cargar();
  }

  // ---------- Detalle del tercero ----------
  async function vistaTercero(id) {
    const r = await api('/api/terceros/' + encodeURIComponent(id));
    if (!r.ok) return (vista.innerHTML = alertaErrores(r.errores));
    const t = r.tercero;
    const d = t.datos;
    const esAdmin = sesion.usuario.rol === 'admin';
    const puedeEnviar = ['validado', 'enviado'].includes(t.estado);

    const secciones = CAMPOS.seccionesPara(t.categoria, d).map((s) => `
      <div class="caja"><div class="caja-titulo">${esc(s.titulo)}</div><div class="caja-cuerpo"><div class="datos">
        ${s.campos.map((c) => `<div class="dato${c.full ? ' full' : ''}"><div class="etq">${esc(c.label)}</div><div class="val">${esc(d[c.name]) || '—'}</div></div>`).join('')}
      </div></div></div>`).join('');

    const requeridos = CAMPOS.anexosPara(t.categoria, d).filter((a) => a.req && !t.anexos.some((x) => x.tipo === a.name));
    const autorizaciones = CAMPOS.AUTORIZACIONES.map((a) => `<li>${d[a.name] ? '✅' : '—'} ${esc(a.label)}</li>`).join('');

    vista.innerHTML = `
      <div class="titulo-vista">
        <div><div class="sub"><a href="#/lista/${t.categoria}">${esc(CAMPOS.CATEGORIAS[t.categoria].plural)}</a> / ${esc(t.consecutivo)}</div>
          <h2>${esc(t.nombre)}</h2>
          <div class="sub">${esc(catNombre(t.categoria))} · ${esc(t.tipo_documento || '')} ${esc(t.numero_documento || '')}${d.dv ? '-' + esc(d.dv) : ''} · ${badge(t.estado)}</div></div>
        <div class="botones">
          <button class="btn btn-sec" data-acc="editar">Editar</button>
          ${t.estado !== 'en_revision' && t.estado !== 'enviado' ? '<button class="btn btn-sec" data-acc="en_revision">Marcar en revisión</button>' : ''}
          ${t.estado !== 'validado' && t.estado !== 'enviado' ? '<button class="btn btn-ok" data-acc="validado">Validar información</button>' : ''}
          ${t.estado !== 'rechazado' && t.estado !== 'enviado' ? '<button class="btn btn-peligro" data-acc="rechazado">Rechazar</button>' : ''}
          <button class="btn btn-acento" data-acc="enviar"${puedeEnviar ? '' : ' disabled title="Primero valide la información"'}>Enviar por correo</button>
          ${esAdmin ? '<button class="btn btn-sec" data-acc="eliminar">Eliminar</button>' : ''}
        </div>
      </div>
      ${t.observaciones ? `<div class="alerta ${t.estado === 'rechazado' ? 'alerta-error' : 'alerta-info'}"><b>Observaciones:</b> ${esc(t.observaciones)}</div>` : ''}
      <div class="detalle-grid">
        <div>
          <div class="caja"><div class="caja-titulo">Registro</div><div class="caja-cuerpo"><div class="datos">
            <div class="dato"><div class="etq">Consecutivo</div><div class="val cons">${esc(t.consecutivo)}</div></div>
            <div class="dato"><div class="etq">Origen</div><div class="val">${t.origen === 'manual' ? 'Registro manual (' + esc(t.creado_por || '') + ')' : 'Formulario web'}</div></div>
            <div class="dato"><div class="etq">Fecha de registro</div><div class="val">${fecha(t.created_at)}</div></div>
            <div class="dato"><div class="etq">Validado por</div><div class="val">${t.validado_por ? esc(t.validado_por) + ' · ' + fecha(t.fecha_validacion) : '—'}</div></div>
            <div class="dato"><div class="etq">Último envío</div><div class="val">${fecha(t.fecha_envio)}</div></div>
          </div></div></div>
          ${secciones}
          ${t.origen === 'formulario' ? `<div class="caja"><div class="caja-titulo">Autorizaciones del tercero</div><div class="caja-cuerpo"><ul class="lista-autorizaciones">${autorizaciones}</ul></div></div>` : ''}
        </div>
        <div>
          <div class="caja"><div class="caja-titulo">Anexos (${t.anexos.length})<label class="btn btn-sec btn-sm" for="subir-anexo">+ Agregar</label></div>
            <div class="caja-cuerpo">
              ${requeridos.length ? `<p class="faltante">⚠ Faltan: ${requeridos.map((a) => esc(a.label)).join(', ')}</p>` : ''}
              ${t.anexos.length ? `<ul class="lista-anexos">${t.anexos.map((a) => `<li>
                <div><div class="tipo-anexo">${esc(CAMPOS.etiqueta(a.tipo))}</div><div class="nom">${esc(a.nombre_original)}</div><div class="tipo-anexo">${tamano(a.tamano)} · ${fecha(a.created_at)}</div></div>
                <div class="acc"><a class="btn btn-sec btn-sm" href="/api/anexos/${a.id}?ver=1" target="_blank" rel="noopener">Ver</a>
                <a class="btn btn-sec btn-sm" href="/api/anexos/${a.id}" title="Descargar">↓</a>
                <button class="btn btn-sec btn-sm" data-borrar-anexo="${a.id}" title="Eliminar">✕</button></div></li>`).join('')}</ul>` : '<p class="ayuda">Sin anexos.</p>'}
            </div></div>
          <div class="caja"><div class="caja-titulo">Correos enviados</div><div class="caja-cuerpo">
            ${t.correos.length ? `<ul class="linea-tiempo">${t.correos.map((c) => `<li><b>${esc(c.asunto)}</b><br>Para: ${esc(c.destinatarios)}<br>
              <span class="estado estado-${c.estado === 'error' ? 'rechazado' : 'enviado'}">${esc(c.estado)}</span> <span class="fecha">${fecha(c.created_at)} · ${esc(c.usuario || '')}</span></li>`).join('')}</ul>` : '<p class="ayuda">Aún no se ha enviado.</p>'}
          </div></div>
          <div class="caja"><div class="caja-titulo">Historial</div><div class="caja-cuerpo"><ul class="linea-tiempo">
            ${t.historial.map((h) => `<li><b>${esc(h.accion)}</b>${h.detalle ? '<br>' + esc(h.detalle) : ''}<br><span class="fecha">${fecha(h.created_at)} · ${esc(h.usuario || '')}</span></li>`).join('')}
          </ul></div></div>
        </div>
      </div>`;

    vista.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => accion(b.dataset.acc, t)));
    vista.querySelectorAll('[data-borrar-anexo]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este anexo?')) return;
      await api('/api/anexos/' + b.dataset.borrarAnexo, { method: 'DELETE' });
      aviso('Anexo eliminado');
      vistaTercero(t.id);
    }));
    agregarSelectorAnexo(t);
  }

  function agregarSelectorAnexo(t) {
    const tipos = CAMPOS.anexosPara(t.categoria, t.datos);
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'subir-anexo';
    input.hidden = true;
    input.multiple = true;
    input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
    vista.appendChild(input);
    input.addEventListener('change', () => {
      const archivos = [...input.files];
      if (!archivos.length) return;
      abrirModal(`<h3>Agregar anexos</h3>
        <p class="ayuda">${archivos.map((f) => esc(f.name)).join(', ')}</p>
        <div class="campo"><label>Tipo de documento</label><select name="tipo" required>${tipos.map((a) => `<option value="${a.name}">${esc(a.label)}</option>`).join('')}</select></div>
        <div id="m-err"></div>
        <div class="botones"><button class="btn btn-sec" value="cancelar" formnovalidate>Cancelar</button><button class="btn">Subir</button></div>`,
      async (f) => {
        const fd = new FormData();
        archivos.forEach((a) => fd.append(f.tipo.value, a));
        const r = await api(`/api/terceros/${t.id}/anexos`, { method: 'POST', body: fd });
        if (!r.ok) { $('#m-err', modal).innerHTML = alertaErrores(r.errores); return false; }
        aviso('Anexos agregados');
        vistaTercero(t.id);
      });
      input.value = '';
    });
  }

  async function accion(acc, t) {
    if (acc === 'editar') return (location.hash = `#/editar/${t.id}`);
    if (acc === 'eliminar') {
      if (!confirm(`¿Eliminar definitivamente ${t.consecutivo} – ${t.nombre} y todos sus anexos?`)) return;
      await api('/api/terceros/' + t.id, { method: 'DELETE' });
      aviso('Registro eliminado');
      return (location.hash = `#/lista/${t.categoria}`);
    }
    if (acc === 'enviar') return modalEnviar(t);

    const titulos = { validado: 'Validar información', rechazado: 'Rechazar registro', en_revision: 'Marcar en revisión' };
    const faltan = CAMPOS.anexosPara(t.categoria, t.datos).filter((a) => a.req && !t.anexos.some((x) => x.tipo === a.name));
    abrirModal(`<h3>${titulos[acc]}</h3>
      <p>${esc(t.consecutivo)} · ${esc(t.nombre)}</p>
      ${acc === 'validado' && faltan.length ? `<div class="alerta alerta-info">Atención: faltan anexos obligatorios (${faltan.map((a) => esc(a.label)).join(', ')}).</div>` : ''}
      <div class="campo"><label>Observaciones${acc === 'rechazado' ? ' <span class="req">*</span>' : ''}</label>
        <textarea name="observaciones" rows="3"${acc === 'rechazado' ? ' required' : ''} placeholder="${acc === 'validado' ? 'Ej.: RUT y cámara de comercio verificados' : 'Motivo'}"></textarea></div>
      <div id="m-err"></div>
      <div class="botones"><button class="btn btn-sec" value="cancelar" formnovalidate>Cancelar</button>
        <button class="btn ${acc === 'rechazado' ? 'btn-peligro' : acc === 'validado' ? 'btn-ok' : ''}">Confirmar</button></div>`,
    async (f) => {
      const r = await api(`/api/terceros/${t.id}/estado`, { method: 'POST', body: { estado: acc, observaciones: f.observaciones.value } });
      if (!r.ok) { $('#m-err', modal).innerHTML = alertaErrores(r.errores); return false; }
      aviso('Estado actualizado: ' + CAMPOS.ESTADOS[acc]);
      vistaTercero(t.id);
    });
  }

  function modalEnviar(t) {
    const cat = catNombre(t.categoria);
    abrirModal(`<h3>Enviar información por correo</h3>
      <p class="ayuda">Se enviará la información del ${esc(cat.toLowerCase())} ${esc(t.consecutivo)} con los anexos seleccionados.</p>
      <div class="campo"><label>Para <span class="req">*</span></label><input name="destinatarios" required placeholder="correo@empresa.com, otro@empresa.com" value="${esc(sesion.correoPorDefecto || '')}"></div>
      <div class="campo"><label>CC</label><input name="cc" placeholder="Opcional"></div>
      <div class="campo"><label>Asunto</label><input name="asunto" value="${esc(`Vinculación ${cat} ${t.consecutivo} – ${t.nombre}`)}"></div>
      <div class="campo"><label>Mensaje</label><textarea name="mensaje" rows="3">Cordial saludo,\n\nAdjunto la información y documentos del ${esc(cat.toLowerCase())} validado por el área contable.</textarea></div>
      <div class="campo"><label>Anexos a adjuntar</label>
        ${t.anexos.length ? t.anexos.map((a) => `<label class="check"><input type="checkbox" name="anexo" value="${a.id}" checked><span>${esc(CAMPOS.etiqueta(a.tipo))}: ${esc(a.nombre_original)}</span></label>`).join('') : '<p class="ayuda">Este tercero no tiene anexos.</p>'}</div>
      ${sesion.smtp ? '' : '<div class="alerta alerta-info">SMTP no configurado: el correo se generará y guardará en el servidor sin enviarse.</div>'}
      <div id="m-err"></div>
      <div class="botones"><button class="btn btn-sec" value="cancelar" formnovalidate>Cancelar</button><button class="btn btn-acento">Enviar correo</button></div>`,
    async (f) => {
      const body = {
        destinatarios: f.destinatarios.value, cc: f.cc.value, asunto: f.asunto.value, mensaje: f.mensaje.value,
        anexosIds: [...f.querySelectorAll('input[name=anexo]:checked')].map((i) => Number(i.value)),
      };
      const r = await api(`/api/terceros/${t.id}/enviar`, { method: 'POST', body });
      if (!r.ok) { $('#m-err', modal).innerHTML = alertaErrores(r.errores); return false; }
      aviso(r.estado === 'simulado' ? 'Correo generado (SMTP no configurado)' : 'Correo enviado correctamente');
      vistaTercero(t.id);
    });
  }

  // ---------- Registro manual y edición ----------
  function formularioTercero({ titulo, sub, categoria, valores, conAnexos, conSelector, alGuardar }) {
    vista.innerHTML = `
      <div class="titulo-vista"><div><h2>${esc(titulo)}</h2><div class="sub">${esc(sub)}</div></div></div>
      <form id="form-tercero" novalidate>
        ${conSelector ? `<fieldset class="seccion"><legend>Tipo de tercero</legend><div class="grid"><div class="campo">
          <label for="f_categoria">Tipo <span class="req">*</span></label><select id="f_categoria" name="categoria">
          ${Object.entries(CAMPOS.CATEGORIAS).map(([k, v]) => `<option value="${k}"${k === categoria ? ' selected' : ''}>${esc(v.nombre)}</option>`).join('')}
          </select></div></div></fieldset>` : ''}
        <div id="secciones-t"></div>
        <div id="errores-t"></div>
        <div class="botones" style="justify-content:flex-end"><a class="btn btn-sec" href="javascript:history.back()">Cancelar</a><button class="btn" id="btn-guardar">Guardar</button></div>
      </form>`;
    const form = $('#form-tercero');
    const cont = $('#secciones-t');
    const cat = () => (conSelector ? form.categoria.value : categoria);
    const pintar = (inicial) => RENDER.pintar(cont, cat(), { anexos: conAnexos, valores: inicial ? valores : undefined });
    pintar(true);
    form.addEventListener('change', (e) => {
      if (['categoria', 'tipo_persona', 'tipo_documento'].includes(e.target.name)) pintar();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.classList.add('enviado');
      const lista = CAMPOS.validar(cat(), RENDER.leer(form), [], { omitirAnexos: true, omitirAutorizaciones: true });
      if (lista.length) { $('#errores-t').innerHTML = alertaErrores(lista); return $('#errores-t').scrollIntoView({ block: 'center' }); }
      const btn = $('#btn-guardar');
      btn.disabled = true;
      const r = await alGuardar(form);
      btn.disabled = false;
      if (!r.ok) { $('#errores-t').innerHTML = alertaErrores(r.errores); return $('#errores-t').scrollIntoView({ block: 'center' }); }
      location.hash = `#/tercero/${r.tercero.id}`;
    });
  }

  function vistaNuevo(categoria) {
    formularioTercero({
      titulo: 'Registro manual de tercero',
      sub: 'Use esta opción para registrar empleados u otros terceros directamente desde el área contable.',
      categoria: CAMPOS.CATEGORIAS[categoria] ? categoria : 'empleado',
      conAnexos: true,
      conSelector: true,
      alGuardar: async (form) => {
        const r = await api('/api/terceros', { method: 'POST', body: new FormData(form) });
        if (r.ok) aviso(`Registro creado con consecutivo ${r.tercero.consecutivo}`);
        return r;
      },
    });
  }

  async function vistaEditar(id) {
    const r = await api('/api/terceros/' + encodeURIComponent(id));
    if (!r.ok) return (vista.innerHTML = alertaErrores(r.errores));
    const t = r.tercero;
    formularioTercero({
      titulo: `Editar ${t.consecutivo}`,
      sub: `${catNombre(t.categoria)} · ${t.nombre}`,
      categoria: t.categoria,
      valores: t.datos,
      alGuardar: async (form) => {
        const res = await api('/api/terceros/' + t.id, { method: 'PUT', body: RENDER.leer(form) });
        if (res.ok) aviso('Información actualizada');
        return res;
      },
    });
  }

  // ---------- Usuarios ----------
  async function vistaUsuarios() {
    if (sesion.usuario.rol !== 'admin') return vistaInicio();
    const r = await api('/api/usuarios');
    vista.innerHTML = `
      <div class="titulo-vista"><div><h2>Usuarios del aplicativo</h2><div class="sub">Personal del área contable con acceso</div></div>
        <div class="botones"><button class="btn" id="nuevo-usuario">+ Nuevo usuario</button></div></div>
      <div class="caja"><div class="tabla-scroll"><table class="tabla"><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>
      ${r.usuarios.map((u) => `<tr><td class="cons">${esc(u.usuario)}</td><td>${esc(u.nombre)}</td><td>${u.rol === 'admin' ? 'Administrador' : 'Contabilidad'}</td>
        <td>${u.activo ? badge('validado').replace(CAMPOS.ESTADOS.validado, 'Activo') : badge('rechazado').replace(CAMPOS.ESTADOS.rechazado, 'Inactivo')}</td>
        <td class="botones"><button class="btn btn-sec btn-sm" data-clave="${u.id}">Cambiar contraseña</button>
        ${u.id !== sesion.usuario.id ? `<button class="btn btn-sec btn-sm" data-activo="${u.id}" data-valor="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    $('#nuevo-usuario').onclick = () => abrirModal(`<h3>Nuevo usuario</h3>
      <div class="campo"><label>Usuario</label><input name="usuario" required></div>
      <div class="campo"><label>Nombre completo</label><input name="nombre" required></div>
      <div class="campo"><label>Contraseña (mínimo 8 caracteres)</label><input name="password" type="password" required minlength="8"></div>
      <div class="campo"><label>Rol</label><select name="rol"><option value="contabilidad">Contabilidad</option><option value="admin">Administrador</option></select></div>
      <div id="m-err"></div>
      <div class="botones"><button class="btn btn-sec" value="cancelar" formnovalidate>Cancelar</button><button class="btn">Crear</button></div>`,
    async (f) => {
      const res = await api('/api/usuarios', { method: 'POST', body: RENDER.leer(f) });
      if (!res.ok) { $('#m-err', modal).innerHTML = alertaErrores(res.errores); return false; }
      aviso('Usuario creado');
      vistaUsuarios();
    });
    vista.querySelectorAll('[data-activo]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/usuarios/${b.dataset.activo}/activo`, { method: 'POST', body: { activo: b.dataset.valor === '1' } });
      vistaUsuarios();
    }));
    vista.querySelectorAll('[data-clave]').forEach((b) => b.addEventListener('click', () => abrirModal(`<h3>Cambiar contraseña</h3>
      <div class="campo"><label>Nueva contraseña (mínimo 8 caracteres)</label><input name="password" type="password" required minlength="8"></div>
      <div id="m-err"></div>
      <div class="botones"><button class="btn btn-sec" value="cancelar" formnovalidate>Cancelar</button><button class="btn">Guardar</button></div>`,
    async (f) => {
      const res = await api(`/api/usuarios/${b.dataset.clave}/password`, { method: 'POST', body: { password: f.password.value } });
      if (!res.ok) { $('#m-err', modal).innerHTML = alertaErrores(res.errores); return false; }
      aviso('Contraseña actualizada');
    })));
  }

  function vistaCuenta() {
    vista.innerHTML = `
      <div class="titulo-vista"><div><h2>Mi cuenta</h2><div class="sub">${esc(sesion.usuario.nombre)} · ${esc(sesion.usuario.usuario)}</div></div></div>
      <div class="caja" style="max-width:480px"><div class="caja-titulo">Cambiar contraseña</div><form class="caja-cuerpo" id="form-clave">
        <div class="campo"><label>Contraseña actual</label><input type="password" name="actual" required autocomplete="current-password"></div><br>
        <div class="campo"><label>Nueva contraseña (mínimo 8 caracteres)</label><input type="password" name="nueva" required minlength="8" autocomplete="new-password"></div><br>
        <div id="c-err"></div><button class="btn">Actualizar contraseña</button></form></div>`;
    $('#form-clave').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await api('/api/auth/password', { method: 'POST', body: RENDER.leer(e.target) });
      if (!r.ok) return ($('#c-err').innerHTML = alertaErrores(r.errores));
      e.target.reset();
      $('#c-err').innerHTML = '';
      aviso('Contraseña actualizada');
    });
  }

  iniciar();
})();
