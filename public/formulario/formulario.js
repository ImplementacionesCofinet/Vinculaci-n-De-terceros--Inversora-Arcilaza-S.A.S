(function () {
  const form = document.getElementById('formulario');
  const cont = document.getElementById('secciones');
  const errores = document.getElementById('errores');
  const btn = document.getElementById('btn-enviar');
  // Campos cuyo valor cambia qué secciones se muestran
  const CONDICIONANTES = ['tipo_persona', 'tipo_documento'];

  document.getElementById('autorizaciones').innerHTML = CAMPOS.AUTORIZACIONES.map((a) =>
    `<label class="check"><input type="checkbox" name="${a.name}" required> <span>${RENDER.esc(a.label)}</span></label>`).join('');

  const categoria = () => form.querySelector('input[name=categoria]:checked')?.value;

  function pintar() {
    const cat = categoria();
    if (!cat) return;
    const siguiente = RENDER.pintar(cont, cat, { anexos: true, numerar: true, inicio: 2, maxMb: 10 });
    document.getElementById('num-autorizacion').textContent = siguiente;
    document.getElementById('seccion-autorizacion').hidden = false;
    document.getElementById('acciones').hidden = false;
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'categoria' || CONDICIONANTES.includes(e.target.name)) pintar();
  });

  function mostrarErrores(lista) {
    errores.innerHTML = lista.length
      ? `<div class="alerta alerta-error"><b>Revise la siguiente información:</b><ul>${lista.map((e) => `<li>${RENDER.esc(e)}</li>`).join('')}</ul></div>`
      : '';
    if (lista.length) errores.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.classList.add('enviado');
    const cat = categoria();
    if (!cat) return mostrarErrores(['Seleccione si es cliente, proveedor o contratista']);

    const datos = RENDER.leer(form);
    const cargados = [...form.querySelectorAll('input[type=file]')].filter((i) => i.files.length).map((i) => i.name);
    const lista = CAMPOS.validar(cat, datos, cargados);
    const grandes = [...form.querySelectorAll('input[type=file]')].flatMap((i) => [...i.files]).filter((f) => f.size > 10 * 1024 * 1024);
    grandes.forEach((f) => lista.push(`El archivo ${f.name} supera 10 MB`));
    if (lista.length) return mostrarErrores(lista);
    mostrarErrores([]);

    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const resp = await fetch('/api/public/registro', { method: 'POST', body: new FormData(form) });
      const r = await resp.json().catch(() => ({ ok: false, errores: ['Respuesta inválida del servidor'] }));
      if (!r.ok) return mostrarErrores(r.errores || ['No fue posible enviar el registro']);
      form.hidden = true;
      document.getElementById('exito-consecutivo').textContent = r.consecutivo;
      document.getElementById('exito').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      mostrarErrores(['No hay conexión con el servidor. Intente nuevamente.']);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar registro';
    }
  });
})();
