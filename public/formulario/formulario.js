(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const { esc, kb } = UTIL;
  const form = $('#registro');

  // Estado de los documentos: { tipo: { files: File[], error: string|null } }
  let docs = {};
  let descargado = false;

  fetch('/api/public/config').then((r) => r.json()).then((c) => {
    $('#pie').textContent = `${c.empresa.nombre} · ${c.empresa.direccion} · ${c.empresa.correo} · Sistema de Gestión SAGRILAFT / SARLAFT / PTEE · FOR-DCF-001 v.01, vigente desde el 01/04/2026.`;
    if (!c.formularioDisponible) $('#descargar').insertAdjacentHTML('afterend', '<p class="ayuda">El formulario estará disponible para descarga muy pronto.</p>');
  }).catch(() => {});

  // ---------- Fila de documento ----------
  function filaDoc(def, estado, recibidos) {
    const files = estado?.files || [];
    const error = estado?.error;
    let clase = '';
    const limite = `PDF · ${def.max === 1 ? '1 archivo' : `hasta ${def.max} archivos`}`;
    let detalle = esc([def.ayuda, limite].filter(Boolean).join(' · '));
    let boton = 'Seleccionar';
    let claseBtn = 'btn-suave';
    if (error) {
      clase = 'error';
      detalle = esc(error);
      boton = 'Reemplazar';
      claseBtn = 'btn-magenta';
    } else if (files.length) {
      clase = 'listo';
      const total = files.reduce((s, f) => s + f.size, 0);
      detalle = files.length === 1
        ? `${esc(files[0].name)} · ${kb(files[0].size)} · listo`
        : `${files.map((f) => esc(f.name)).join(', ')} · ${files.length} archivos · ${kb(total)} · listo`;
      if (def.min && files.length + (recibidos?.length || 0) < def.min) detalle += ` · se esperan ${def.min}`;
      boton = 'Cambiar';
    } else if (recibidos?.length) {
      clase = 'listo';
      detalle = 'Recibido: ' + recibidos.map((r) => esc(r.nombre)).join(', ');
      boton = def.multiple ? 'Agregar' : 'Reemplazar';
    }
    return `<div class="doc ${clase}" data-tipo="${def.name}">
      <div class="doc-texto"><div class="doc-titulo"><span class="letra">${def.letra}.</span> ${esc(def.label)}${def.req ? '' : ' <span class="ayuda" style="display:inline">(opcional)</span>'}</div>
        ${detalle ? `<div class="doc-detalle">${detalle}</div>` : ''}</div>
      <button type="button" class="btn btn-chico ${claseBtn}" data-elegir="${def.name}">${boton}</button>
      <input type="file" hidden data-input="${def.name}" ${def.multiple ? 'multiple' : ''} accept=".pdf,application/pdf">
    </div>`;
  }

  /** Conecta los botones de una lista de documentos; `alCambiar` se llama tras revisar los archivos. */
  function conectarDocs(cont, alCambiar) {
    cont.querySelectorAll('[data-elegir]').forEach((b) => b.addEventListener('click', () => cont.querySelector(`[data-input="${b.dataset.elegir}"]`).click()));
    cont.querySelectorAll('[data-input]').forEach((inp) => inp.addEventListener('change', async () => {
      const files = [...inp.files];
      if (!files.length) return;
      const def = definiciones().find((d) => d.name === inp.dataset.input);
      let error = files.length > def.max ? `Puede subir máximo ${def.max} archivo${def.max === 1 ? '' : 's'} en este documento.` : null;
      for (const f of error ? [] : files) {
        const e = await UTIL.revisar(f);
        if (e) { error = `${f.name} — ${e}`; break; }
      }
      if (error && def?.ayudaError && error.includes('dañado')) error += ' ' + def.ayudaError;
      docs[inp.dataset.input] = { files: error ? [] : files, error };
      alCambiar();
    }));
    // Arrastrar y soltar sobre cada fila
    cont.querySelectorAll('.doc').forEach((fila) => {
      fila.addEventListener('dragover', (e) => { e.preventDefault(); fila.classList.add('arrastrando'); });
      fila.addEventListener('dragleave', () => fila.classList.remove('arrastrando'));
      fila.addEventListener('drop', (e) => {
        e.preventDefault();
        fila.classList.remove('arrastrando');
        const inp = fila.querySelector('[data-input]');
        const dt = new DataTransfer();
        [...e.dataTransfer.files].slice(0, 20).forEach((f) => dt.items.add(f));
        inp.files = dt.files;
        inp.dispatchEvent(new Event('change'));
      });
    });
  }

  let definiciones = () => [];

  // ---------- Registro nuevo ----------
  $('#tipos').innerHTML = CAMPOS.CATEGORIAS_PUBLICAS.map((c) =>
    `<label class="opcion"><input type="radio" name="categoria" value="${c}"><span>${esc(CAMPOS.CATEGORIAS[c].nombre)}</span></label>`).join('');

  $('#basicos').innerHTML = CAMPOS.BASICOS.map((c) => {
    const id = 'b_' + c.name;
    const control = c.type === 'select'
      ? `<select id="${id}" name="${c.name}" required><option value="">Seleccione…</option>${c.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
      : `<input id="${id}" name="${c.name}" type="${c.type || 'text'}" required value="${esc(c.value || '')}" autocomplete="${{ email: 'email', telefono: 'tel', nombre: 'organization' }[c.name] || 'off'}">`;
    return `<div class="campo${c.full ? ' ancho' : ''}"><label for="${id}">${esc(c.label)}</label>${control}${c.ayuda ? `<span class="ayuda">${esc(c.ayuda)}</span>` : ''}</div>`;
  }).join('');

  const valor = (n) => form.elements[n]?.value || '';
  const categoria = () => form.querySelector('input[name=categoria]:checked')?.value;
  const persona = () => form.querySelector('input[name=persona]:checked')?.value;

  function pintarDocs() {
    const cat = categoria();
    const per = persona();
    if (!cat || !per) {
      $('#docs').innerHTML = '';
      $('#docs-desc').textContent = 'Seleccione primero el tipo de contraparte y si es persona jurídica o natural.';
      return actualizar();
    }
    const defs = CAMPOS.anexosPara(cat, per);
    definiciones = () => defs;
    // Conserva los documentos ya elegidos que sigan aplicando
    docs = Object.fromEntries(Object.entries(docs).filter(([k]) => defs.some((d) => d.name === k)));
    $('#docs-desc').textContent = `Estos son los ${defs.length} documentos que pide el formulario para ${CAMPOS.PERSONAS[per].toLowerCase()}. Revisamos cada archivo apenas lo suba.`;
    $('#docs').innerHTML = defs.map((d) => filaDoc(d, docs[d.name])).join('');
    conectarDocs($('#docs'), pintarDocs);
    actualizar();
  }

  function estadoPasos() {
    const defs = categoria() && persona() ? definiciones() : [];
    const obligatorios = defs.filter((d) => d.req);
    const validos = obligatorios.filter((d) => docs[d.name]?.files.length && !docs[d.name].error).length;
    const hayErrores = Object.values(docs).some((d) => d.error);
    const basicos = CAMPOS.validarBasicos('proveedor', Object.fromEntries(CAMPOS.BASICOS.map((c) => [c.name, valor(c.name)]))).length === 0;
    return {
      1: descargado || Boolean(docs.formulario?.files.length),
      2: Boolean(categoria() && persona()),
      3: basicos,
      4: defs.length > 0 && validos === obligatorios.length && !hayErrores,
      5: $('#acepta').checked,
      validos, obligatorios: obligatorios.length, hayErrores,
    };
  }

  function actualizar() {
    const p = estadoPasos();
    form.querySelectorAll('.paso').forEach((s) => {
      const n = s.dataset.paso;
      s.classList.toggle('completo', Boolean(p[n]));
      s.querySelector('.paso-num').textContent = p[n] ? '✓' : n;
    });
    $('#contador').innerHTML = p.obligatorios ? `<b>${p.validos} de ${p.obligatorios}</b> obligatorios validados` : '';
    const listo = p[2] && p[3] && p[4] && p[5];
    $('#btn-enviar').disabled = !listo;
    let ayuda = '';
    if (!p[2]) ayuda = 'Indique el tipo de contraparte y de persona.';
    else if (!p[4]) ayuda = `Se habilita cuando los ${p.obligatorios} documentos obligatorios estén validados.`;
    else if (!p[3]) ayuda = 'Complete los datos básicos.';
    else if (!p[5]) ayuda = 'Falta autorizar el tratamiento de datos.';
    $('#enviar-ayuda').textContent = ayuda;
  }

  form.addEventListener('change', (e) => {
    if (['categoria', 'persona'].includes(e.target.name)) {
      // Sugiere el tipo de documento según la persona
      if (e.target.name === 'persona' && !valor('tipo_documento')) form.elements.tipo_documento.value = e.target.value === 'juridica' ? 'NIT' : 'C.C.';
      pintarDocs();
    } else actualizar();
  });
  form.addEventListener('input', actualizar);
  $('#descargar').addEventListener('click', () => { descargado = true; actualizar(); });

  function mostrarErrores(cont, lista) {
    cont.innerHTML = lista.length ? `<div class="alerta alerta-error"><b>Revise lo siguiente:</b><ul>${lista.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  }

  function datosFormulario(extra) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    for (const [tipo, d] of Object.entries(docs)) for (const f of d.files) fd.append(tipo, f, f.name);
    return fd;
  }

  async function enviar(url, fd, boton, textoBoton) {
    boton.disabled = true;
    boton.textContent = 'Enviando…';
    try {
      const resp = await fetch(url, { method: 'POST', body: fd });
      return await resp.json().catch(() => ({ ok: false, errores: ['Respuesta inválida del servidor'] }));
    } catch {
      return { ok: false, errores: ['No hay conexión con el servidor. Intente nuevamente.'] };
    } finally {
      boton.textContent = textoBoton;
    }
  }

  function aplicarErroresArchivos(r) {
    for (const [tipo, msg] of Object.entries(r.archivos || {})) docs[tipo] = { files: [], error: msg };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.classList.add('invalido');
    const extra = { categoria: categoria(), persona: persona(), acepta_tratamiento: $('#acepta').checked ? 'on' : '' };
    for (const c of CAMPOS.BASICOS) extra[c.name] = valor(c.name).trim();
    const r = await enviar('/api/public/registro', datosFormulario(extra), $('#btn-enviar'), 'Enviar registro');
    if (!r.ok) {
      aplicarErroresArchivos(r);
      pintarDocs();
      mostrarErrores($('#errores'), r.errores || ['No fue posible enviar el registro']);
      return;
    }
    form.hidden = true;
    $('.intro').hidden = true;
    $('#exito-cons').textContent = r.consecutivo;
    $('#exito-texto').textContent = `Su expediente quedó radicado. Le enviamos la confirmación a ${r.email}. Contabilidad revisará los documentos y, si falta algo, le escribirá a ese correo.`;
    $('#exito').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------- Corrección de un expediente devuelto ----------
  const token = new URLSearchParams(location.search).get('expediente');
  if (token) iniciarCorreccion(token);

  async function iniciarCorreccion(tk) {
    form.hidden = true;
    const r = await fetch('/api/public/expediente/' + encodeURIComponent(tk)).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok || r.expediente.estado !== 'devuelto') {
      $('.intro').hidden = true;
      $('#aviso-texto').textContent = r.ok
        ? `El expediente ${r.expediente.consecutivo} ya no tiene correcciones pendientes. Si necesita enviar algo más, escríbanos.`
        : 'El enlace no es válido. Verifique que lo copió completo desde el correo que le enviamos.';
      $('#aviso-enlace').hidden = false;
      return;
    }
    const x = r.expediente;
    $('#titulo').textContent = 'Corrija su registro';
    $('#introduccion').textContent = `Contabilidad revisó el expediente de ${x.nombre} y le pidió algunos ajustes. Reemplace o complete los documentos indicados y envíe las correcciones.`;
    $('#c-cons').textContent = `EXPEDIENTE ${x.consecutivo} · DEVUELTO AL TERCERO`;
    $('#c-texto').textContent = 'Observaciones de Contabilidad:';
    $('#c-obs').textContent = x.observaciones || '';
    const correccion = $('#correccion');
    correccion.hidden = false;
    const defs = CAMPOS.anexosPara(x.categoria, x.persona);
    definiciones = () => defs;

    const pintar = () => {
      $('#c-docs').innerHTML = defs.map((d) => filaDoc(d, docs[d.name], x.anexos.filter((a) => a.tipo === d.name))).join('');
      conectarDocs($('#c-docs'), pintar);
      const hayNuevos = Object.values(docs).some((d) => d.files.length);
      const hayErrores = Object.values(docs).some((d) => d.error);
      $('#c-enviar').disabled = !hayNuevos || hayErrores;
    };
    pintar();

    correccion.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await enviar('/api/public/expediente/' + encodeURIComponent(tk), datosFormulario({}), $('#c-enviar'), 'Enviar correcciones');
      if (!res.ok) {
        aplicarErroresArchivos(res);
        pintar();
        mostrarErrores($('#c-errores'), res.errores || ['No fue posible enviar las correcciones']);
        return;
      }
      correccion.hidden = true;
      $('.intro').hidden = true;
      $('#exito-titulo').textContent = 'Recibimos sus correcciones';
      $('#exito-cons').textContent = res.consecutivo;
      $('#exito-texto').textContent = 'Contabilidad revisará nuevamente su expediente. Le escribiremos si se requiere algo más.';
      $('#exito').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  actualizar();
})();
