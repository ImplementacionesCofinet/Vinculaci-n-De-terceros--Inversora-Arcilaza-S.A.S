/* Construye los campos del formulario a partir de CAMPOS. Lo usan el formulario público y el aplicativo. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function campoHtml(c, valor) {
    const id = 'f_' + c.name;
    const req = c.req ? ' required' : '';
    const v = valor ?? c.value ?? '';
    const attrs = `id="${id}" name="${c.name}"${req}${c.maxlength ? ` maxlength="${c.maxlength}"` : ''}${c.pattern ? ` pattern="${c.pattern}"` : ''}`;
    let input;
    if (c.type === 'select') {
      input = `<select ${attrs}><option value="">Seleccione…</option>${c.options
        .map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (c.type === 'textarea') {
      input = `<textarea ${attrs} rows="3">${esc(v)}</textarea>`;
    } else {
      input = `<input type="${c.type}" ${attrs} value="${esc(v)}"${c.type === 'number' ? ' min="0" step="any"' : ''}>`;
    }
    return `<div class="campo${c.full ? ' full' : ''}"><label for="${id}">${esc(c.label)}${c.req ? ' <span class="req">*</span>' : ''}</label>${input}</div>`;
  }

  function anexoHtml(a) {
    const id = 'a_' + a.name;
    return `<div class="anexo" data-anexo="${a.name}">
      <div class="anexo-info"><span class="anexo-nombre">${esc(a.label)}${a.req ? ' <span class="req">*</span>' : ''}</span>
      <span class="anexo-archivo" data-archivo-de="${a.name}">Ningún archivo seleccionado</span></div>
      <label class="btn btn-sec btn-sm" for="${id}">Seleccionar${a.multiple ? ' archivos' : ' archivo'}</label>
      <input type="file" id="${id}" name="${a.name}" hidden${a.multiple ? ' multiple' : ''}${a.req ? ' data-req="1"' : ''}
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx">
    </div>`;
  }

  /** Lee los valores actuales de un formulario como objeto plano. */
  function leer(form) {
    const d = {};
    for (const el of form.elements) {
      if (!el.name || el.type === 'file') continue;
      d[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return d;
  }

  /**
   * Pinta las secciones de la categoría en `cont`, conservando lo digitado.
   * opciones: { anexos: bool, numerar: bool, valores: {} }
   */
  function pintar(cont, categoria, opciones) {
    const opts = opciones || {};
    const form = cont.closest('form');
    const valores = { ...(opts.valores || {}), ...(cont.dataset.pintado ? leer(form) : {}) };
    const archivos = {};
    cont.querySelectorAll('input[type=file]').forEach((i) => { if (i.files.length) archivos[i.name] = i; });

    let n = opts.inicio || 1;
    let html = '';
    for (const s of CAMPOS.seccionesPara(categoria, valores)) {
      html += `<fieldset class="seccion"><legend>${opts.numerar ? `<span class="num">${n++}</span>` : ''}${esc(s.titulo)}</legend>
        <div class="grid">${s.campos.map((c) => campoHtml(c, valores[c.name])).join('')}</div></fieldset>`;
    }
    if (opts.anexos) {
      const anexos = CAMPOS.anexosPara(categoria, valores);
      html += `<fieldset class="seccion"><legend>${opts.numerar ? `<span class="num">${n++}</span>` : ''}Documentos anexos</legend>
        <p class="ayuda">Formatos permitidos: PDF, JPG, PNG, Word o Excel.${opts.maxMb ? ` Máximo ${opts.maxMb} MB por archivo.` : ''}</p>
        <div class="anexos">${anexos.map(anexoHtml).join('')}</div></fieldset>`;
    }
    cont.innerHTML = html;
    cont.dataset.pintado = '1';

    // Conserva archivos ya elegidos cuando se vuelve a pintar (p. ej. al cambiar tipo de persona)
    for (const [nombre, inputViejo] of Object.entries(archivos)) {
      const nuevo = cont.querySelector(`input[type=file][name="${nombre}"]`);
      if (nuevo) { nuevo.replaceWith(inputViejo); mostrarArchivos(inputViejo); }
    }
    cont.querySelectorAll('input[type=file]').forEach((i) => i.addEventListener('change', () => mostrarArchivos(i)));
    return n;
  }

  function mostrarArchivos(input) {
    const span = input.closest('.anexo')?.querySelector('.anexo-archivo');
    if (!span) return;
    const nombres = [...input.files].map((f) => f.name);
    span.textContent = nombres.length ? nombres.join(', ') : 'Ningún archivo seleccionado';
    input.closest('.anexo').classList.toggle('cargado', nombres.length > 0);
  }

  window.RENDER = { pintar, leer, esc };
})();
