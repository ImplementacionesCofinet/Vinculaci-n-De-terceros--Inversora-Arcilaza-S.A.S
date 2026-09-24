/*
 * Definiciones compartidas del proceso de vinculación de terceros (FOR-DCF-001).
 * Las usan el portal público, el aplicativo contable y el servidor.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CAMPOS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // carpeta: carpeta dentro de SOPORTES CREACION TERCEROS. porAnio: se subdivide por año.
  const CATEGORIAS = {
    proveedor: { nombre: 'Proveedor', plural: 'Proveedores', prefijo: 'PRO', carpeta: 'PROVEEDORES', porAnio: true, sagrilaft: true },
    contratista: { nombre: 'Contratista', plural: 'Contratistas', prefijo: 'CON', carpeta: 'CONTRATISTAS', porAnio: true, sagrilaft: true },
    cliente: { nombre: 'Cliente', plural: 'Clientes', prefijo: 'CLI', carpeta: 'CLIENTES', porAnio: true, sagrilaft: true },
    otro: { nombre: 'Otro', plural: 'Otros', prefijo: 'OTR', carpeta: 'OTROS', porAnio: true, sagrilaft: true },
    empleado: { nombre: 'Empleado', plural: 'Empleados', prefijo: 'EMP', carpeta: 'EMPLEADOS', porAnio: false, sagrilaft: false },
  };
  const CATEGORIAS_PUBLICAS = ['proveedor', 'contratista', 'cliente', 'otro'];
  const CATEGORIAS_MANUALES = ['proveedor', 'contratista', 'cliente', 'empleado'];

  const PERSONAS = { juridica: 'Persona jurídica', natural: 'Persona natural' };

  const TIPOS_DOC = ['NIT', 'C.C.', 'C.E.', 'Pasaporte', 'PPT', 'TIN'];

  // Datos mínimos que diligencia el tercero en el portal (el resto va en el FOR-DCF-001).
  const BASICOS = [
    { name: 'nombre', label: 'Nombre o razón social', full: true, req: true },
    { name: 'tipo_documento', label: 'Tipo de documento', type: 'select', options: TIPOS_DOC, req: true },
    { name: 'numero_documento', label: 'Número', req: true },
    { name: 'pais', label: 'País', req: true, value: 'Colombia' },
    { name: 'ciudad', label: 'Ciudad', req: true },
    { name: 'contacto', label: 'Persona de contacto', req: true },
    { name: 'telefono', label: 'Teléfono', type: 'tel', req: true },
    { name: 'email', label: 'Correo electrónico', type: 'email', full: true, req: true, ayuda: 'A este correo le confirmamos el radicado.' },
  ];

  // Datos de un empleado registrado manualmente.
  const BASICOS_EMPLEADO = [
    { name: 'nombre', label: 'Nombre completo', full: true, req: true },
    { name: 'numero_documento', label: 'Cédula', req: true },
    { name: 'ciudad', label: 'Ciudad', req: true },
    { name: 'email', label: 'Correo electrónico', type: 'email', full: true, req: true },
  ];

  // Datos que Contabilidad transcribe del formulario FOR-DCF-001 durante la revisión.
  const REVISION = {
    basica: [
      { name: 'representante_legal', label: 'Representante legal', persona: 'juridica' },
      { name: 'fecha_camara', label: 'Fecha de expedición del certificado de existencia', type: 'date', persona: 'juridica' },
    ],
    bancaria: [
      { name: 'beneficiario', label: 'Beneficiario' },
      { name: 'banco', label: 'Banco' },
      { name: 'tipo_cuenta', label: 'Tipo de cuenta', type: 'select', options: ['Ahorros', 'Corriente'] },
      { name: 'numero_cuenta', label: 'Número de cuenta' },
    ],
    // riesgo: respuesta que se resalta como alerta
    sagrilaft: [
      { name: 'listas_restrictivas', label: '¿Incluido en listas restrictivas?', riesgo: 'Sí' },
      { name: 'pep', label: '¿Representante legal es PEP?', labelNatural: '¿Es Persona Expuesta Políticamente (PEP)?', riesgo: 'Sí' },
      { name: 'recursos_publicos', label: '¿Administra recursos públicos?', riesgo: 'Sí' },
      { name: 'sagrilaft_implementado', label: '¿Cuenta con SAGRILAFT implementado?', riesgo: 'No', persona: 'juridica' },
    ],
  };

  // Documentos solicitados (secciones 9 y 10 del FOR-DCF-001). Solo PDF.
  // archivo: nombre con el que se guarda ("PRO-2026-0042 - RUT.pdf").
  // max: archivos permitidos. min: archivos esperados (la revisión advierte si llegan menos).
  const doc = (name, label, archivo, extra = {}) => {
    const d = { name, label, archivo, req: true, max: 1, ...extra };
    d.multiple = d.max > 1;
    return d;
  };
  const CUENTA = 'Cuenta en la que se quiere recibir el pago de las facturas';

  const ANEXOS = {
    juridica: [
      doc('camara', 'Certificado de existencia y representación legal (no mayor a 30 días)', 'CERTIFICADO EXISTENCIA Y REP. LEGAL', { corto: 'Certificado de existencia y rep. legal' }),
      doc('ref_comerciales', 'Dos referencias comerciales', 'REFERENCIA COMERCIAL', { max: 2, min: 2 }),
      doc('ref_bancaria', 'Una referencia bancaria', 'REFERENCIA BANCARIA', { ayuda: CUENTA }),
      doc('rut', 'Copia del RUT actualizado', 'RUT', { ayudaError: 'Vuelva a descargarlo de la DIAN.' }),
      doc('formulario', 'Formulario de registro de proveedores diligenciado y firmado por el representante legal', 'FORMULARIO DE VINCULACION TERCEROS',
        { corto: 'Formulario FOR-DCF-001 firmado', max: 2 }),
      doc('estados_financieros', 'Estados financieros de los dos últimos periodos', 'ESTADOS FINANCIEROS', { corto: 'Estados financieros (2 periodos)', max: 3, min: 2 }),
      doc('certificaciones', 'Certificaciones con las que cuente (ISO, RUC, SAGRILAFT, SARLAFT, PTEE, entre otras)', 'CERTIFICACIONES',
        { corto: 'Certificaciones (ISO, SAGRILAFT…)', max: 5, req: false, ayuda: 'Solo si cuenta con alguna' }),
      doc('identidad', 'Copia del documento de identidad del representante legal', 'DOCUMENTO DE IDENTIDAD', { corto: 'Documento de identidad del rep. legal' }),
      doc('renta', 'Copia de la declaración de renta del último periodo', 'DECLARACION DE RENTA', { corto: 'Declaración de renta último periodo' }),
      doc('accionaria', 'Certificado de composición accionaria actualizado', 'COMPOSICION ACCIONARIA', { corto: 'Composición accionaria actualizada' }),
    ],
    natural: [
      doc('identidad', 'Documento de identidad', 'DOCUMENTO DE IDENTIDAD'),
      doc('ref_comerciales', 'Una referencia comercial', 'REFERENCIA COMERCIAL'),
      doc('ref_bancaria', 'Una referencia bancaria', 'REFERENCIA BANCARIA', { ayuda: CUENTA }),
      doc('formulario', 'Formulario de registro de proveedores diligenciado y firmado', 'FORMULARIO DE VINCULACION TERCEROS', { corto: 'Formulario FOR-DCF-001 firmado' }),
      doc('rut', 'Copia del RUT actualizado', 'RUT', { ayudaError: 'Vuelva a descargarlo de la DIAN.' }),
    ],
    empleado: [
      doc('identidad', 'Documento de identidad', 'DOCUMENTO DE IDENTIDAD'),
      doc('cert_bancaria', 'Certificación bancaria', 'CERTIFICACION BANCARIA'),
    ],
  };
  // Letra de cada documento como en el formulario (A, B, C…)
  for (const lista of Object.values(ANEXOS)) lista.forEach((d, i) => { d.letra = String.fromCharCode(65 + i); });

  const ESTADOS = {
    pendiente: 'Pendiente de revisión',
    en_revision: 'En revisión',
    devuelto: 'Devuelto al tercero',
    aprobado: 'Aprobado por Contabilidad',
    en_cumplimiento: 'En Cumplimiento',
    rechazado: 'Rechazado',
  };

  const EXTENSIONES = ['pdf'];
  const MAX_MB = 20;

  function anexosPara(categoria, persona) {
    if (categoria === 'empleado') return ANEXOS.empleado;
    return ANEXOS[persona] || ANEXOS.juridica;
  }

  function basicosPara(categoria) {
    return categoria === 'empleado' ? BASICOS_EMPLEADO : BASICOS;
  }

  function validarBasicos(categoria, datos) {
    const errores = [];
    for (const c of basicosPara(categoria)) {
      const v = String((datos || {})[c.name] ?? '').trim();
      if (c.req && !v) errores.push(`"${c.label}" es obligatorio`);
      else if (v && c.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errores.push(`"${c.label}" no es un correo válido`);
      else if (v && c.options && !c.options.includes(v)) errores.push(`"${c.label}" no es válido`);
    }
    return errores;
  }

  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
  function empiezaCon(bytes, firma) {
    if (bytes.length < firma.length) return false;
    return firma.every((b, i) => bytes[i] === b);
  }
  function contiene(bytes, firma) {
    outer: for (let i = bytes.length - firma.length; i >= 0; i--) {
      for (let j = 0; j < firma.length; j++) if (bytes[i + j] !== firma[j]) continue outer;
      return true;
    }
    return false;
  }

  /**
   * Revisa que un archivo no esté vacío, dañado o renombrado, a partir de sus primeros
   * y últimos bytes. Devuelve null si está bien o el mensaje de error.
   */
  function revisarArchivo(nombre, tamano, inicio, final) {
    const ext = String(nombre).split('.').pop().toLowerCase();
    if (!EXTENSIONES.includes(ext)) return 'Solo se permiten archivos PDF.';
    if (!tamano) return 'El archivo está vacío.';
    if (tamano > MAX_MB * 1024 * 1024) return `El archivo supera ${MAX_MB} MB.`;
    const zip = [0x50, 0x4b, 0x03, 0x04];
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    const firmas = {
      pdf: { ini: ascii('%PDF-'), fin: ascii('%%EOF') },
      png: { ini: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], fin: ascii('IEND') },
      jpg: { ini: [0xff, 0xd8, 0xff], fin: [0xff, 0xd9] },
      docx: { ini: zip, fin: [0x50, 0x4b, 0x05, 0x06] },
      doc: { ini: ole },
    };
    firmas.jpeg = firmas.jpg;
    firmas.xlsx = firmas.docx;
    firmas.xls = firmas.doc;
    const f = firmas[ext];
    if (!empiezaCon(inicio, f.ini)) {
      // ¿Es otro tipo conocido con la extensión cambiada?
      const real = Object.keys(firmas).find((k) => empiezaCon(inicio, firmas[k].ini));
      if (real) return `El archivo fue renombrado: su contenido no es .${ext}. Súbalo en su formato original.`;
      return 'El archivo está incompleto o dañado.';
    }
    if (f.fin && !contiene(final, f.fin)) return 'El archivo está incompleto o dañado.';
    return null;
  }

  function etiquetaAnexo(tipo) {
    for (const lista of Object.values(ANEXOS)) {
      const a = lista.find((x) => x.name === tipo);
      if (a) return a.corto || a.label;
    }
    return tipo;
  }

  /** Formato de documento para mostrar: "901.447.238-1" o "C.C. 10.244.518". */
  function documento(tipo, numero) {
    if (!numero) return '';
    return tipo && tipo !== 'NIT' ? `${tipo} ${numero}` : numero;
  }

  return {
    CATEGORIAS, CATEGORIAS_PUBLICAS, CATEGORIAS_MANUALES, PERSONAS, TIPOS_DOC, BASICOS, BASICOS_EMPLEADO,
    REVISION, ANEXOS, ESTADOS, EXTENSIONES, MAX_MB,
    anexosPara, basicosPara, validarBasicos, revisarArchivo, etiquetaAnexo, documento,
  };
});
