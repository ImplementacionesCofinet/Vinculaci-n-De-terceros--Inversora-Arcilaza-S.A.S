/* Utilidades de navegador compartidas por el portal y el aplicativo. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Revisa un File en el navegador (vacío, dañado o renombrado). Devuelve null o el mensaje. */
  async function revisar(file) {
    const n = Math.min(2048, file.size);
    const [ini, fin] = await Promise.all([
      file.slice(0, 16).arrayBuffer(),
      file.slice(Math.max(0, file.size - n)).arrayBuffer(),
    ]);
    return CAMPOS.revisarArchivo(file.name, file.size, new Uint8Array(ini), new Uint8Array(fin));
  }

  const kb = (b) => (b >= 1024 * 1024 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)).toLocaleString('es-CO') + ' KB');

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const partes = (f) => {
    const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    return m ? { a: +m[1], m: +m[2] - 1, d: +m[3], h: m[4], min: m[5] } : null;
  };
  const fechaCorta = (f) => { const p = partes(f); return p ? `${p.d} ${MESES[p.m]}` : '—'; };
  const fechaHora = (f) => { const p = partes(f); return p ? `${p.d} ${MESES[p.m]}${p.h ? `, ${p.h}:${p.min}` : ''}` : '—'; };
  const fechaLarga = (f) => { const p = partes(f); return p ? `${p.d} de ${MESES_LARGOS[p.m]} de ${p.a}${p.h ? `, ${p.h}:${p.min}` : ''}` : '—'; };
  const fechaNum = (f) => { const p = partes(f); return p ? `${String(p.d).padStart(2, '0')}/${String(p.m + 1).padStart(2, '0')}/${p.a}` : '—'; };

  window.UTIL = { esc, revisar, kb, fechaCorta, fechaHora, fechaLarga, fechaNum, MESES_LARGOS };
})();
