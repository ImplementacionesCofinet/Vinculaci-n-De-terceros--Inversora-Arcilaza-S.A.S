/*
 * Definición única de los campos del registro de terceros.
 * La usan el formulario público, el aplicativo contable (detalle y registro manual)
 * y el servidor (validación de campos obligatorios).
 *
 * Cada campo admite:
 *   cats:  categorías en las que aparece (por defecto todas las de la sección)
 *   when:  { campo: valor } condición sobre otro campo para mostrarlo
 *   req:   obligatorio
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CAMPOS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CATEGORIAS = {
    cliente: { nombre: 'Cliente', plural: 'Clientes', carpeta: 'clientes', prefijo: 'CLI' },
    proveedor: { nombre: 'Proveedor', plural: 'Proveedores', carpeta: 'proveedores', prefijo: 'PRO' },
    contratista: { nombre: 'Contratista', plural: 'Contratistas', carpeta: 'contratistas', prefijo: 'CON' },
    empleado: { nombre: 'Empleado', plural: 'Empleados', carpeta: 'empleados', prefijo: 'EMP' },
  };

  // Categorías que puede elegir un externo en el formulario público.
  // Los empleados solo los registra el área contable desde el aplicativo.
  const CATEGORIAS_PUBLICAS = ['cliente', 'proveedor', 'contratista'];

  const EXTERNOS = ['cliente', 'proveedor', 'contratista'];
  const JURIDICA = { tipo_persona: 'Jurídica' };

  const TIPOS_DOC = ['NIT', 'Cédula de ciudadanía', 'Cédula de extranjería', 'Pasaporte', 'PPT', 'Tarjeta de identidad'];
  const SI_NO = ['Sí', 'No'];

  const SECCIONES = [
    {
      id: 'general',
      titulo: 'Información general',
      campos: [
        { name: 'tipo_persona', label: 'Tipo de persona', type: 'select', options: ['Natural', 'Jurídica'], req: true },
        { name: 'tipo_documento', label: 'Tipo de documento', type: 'select', options: TIPOS_DOC, req: true },
        { name: 'numero_documento', label: 'Número de documento / NIT', type: 'text', req: true, pattern: '[0-9A-Za-z\\-\\.]{3,20}' },
        { name: 'dv', label: 'Dígito de verificación', type: 'text', maxlength: 1, when: { tipo_documento: 'NIT' } },
        { name: 'nombre', label: 'Nombre completo / Razón social', type: 'text', req: true, full: true },
        { name: 'nombre_comercial', label: 'Nombre comercial', type: 'text', cats: EXTERNOS, when: JURIDICA },
        { name: 'fecha_constitucion', label: 'Fecha de constitución', type: 'date', cats: EXTERNOS, when: JURIDICA },
        { name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', when: { tipo_persona: 'Natural' } },
      ],
    },
    {
      id: 'ubicacion',
      titulo: 'Ubicación y contacto',
      campos: [
        { name: 'direccion', label: 'Dirección', type: 'text', req: true, full: true },
        { name: 'pais', label: 'País', type: 'text', req: true, value: 'Colombia' },
        { name: 'departamento', label: 'Departamento', type: 'text', req: true },
        { name: 'ciudad', label: 'Ciudad / Municipio', type: 'text', req: true },
        { name: 'telefono', label: 'Teléfono fijo', type: 'tel' },
        { name: 'celular', label: 'Celular', type: 'tel', req: true },
        { name: 'email', label: 'Correo electrónico', type: 'email', req: true },
        { name: 'email_facturacion', label: 'Correo para facturación electrónica', type: 'email', cats: EXTERNOS },
        { name: 'sitio_web', label: 'Sitio web', type: 'text', cats: EXTERNOS },
      ],
    },
    {
      id: 'representante',
      titulo: 'Representante legal',
      cats: EXTERNOS,
      when: JURIDICA,
      campos: [
        { name: 'rep_nombre', label: 'Nombre del representante legal', type: 'text', req: true, full: true },
        { name: 'rep_tipo_documento', label: 'Tipo de documento', type: 'select', options: TIPOS_DOC, req: true },
        { name: 'rep_numero_documento', label: 'Número de documento', type: 'text', req: true },
        { name: 'rep_email', label: 'Correo electrónico', type: 'email' },
        { name: 'rep_telefono', label: 'Teléfono', type: 'tel' },
      ],
    },
    {
      id: 'tributaria',
      titulo: 'Información tributaria',
      cats: EXTERNOS,
      campos: [
        { name: 'actividad_economica', label: 'Actividad económica', type: 'text', req: true, full: true },
        { name: 'codigo_ciiu', label: 'Código CIIU', type: 'text', req: true, maxlength: 4 },
        { name: 'regimen', label: 'Responsabilidad de IVA', type: 'select', options: ['Responsable de IVA', 'No responsable de IVA', 'Régimen simple de tributación'], req: true },
        { name: 'gran_contribuyente', label: '¿Es gran contribuyente?', type: 'select', options: SI_NO, req: true },
        { name: 'autorretenedor', label: '¿Es autorretenedor?', type: 'select', options: SI_NO, req: true },
        { name: 'responsable_ica', label: '¿Responsable de ICA?', type: 'select', options: SI_NO },
        { name: 'factura_electronica', label: '¿Emite factura electrónica?', type: 'select', options: SI_NO, cats: ['proveedor', 'contratista'] },
      ],
    },
    {
      id: 'contacto',
      titulo: 'Persona de contacto',
      cats: EXTERNOS,
      campos: [
        { name: 'contacto_nombre', label: 'Nombre', type: 'text', req: true },
        { name: 'contacto_cargo', label: 'Cargo', type: 'text' },
        { name: 'contacto_email', label: 'Correo electrónico', type: 'email', req: true },
        { name: 'contacto_telefono', label: 'Teléfono', type: 'tel', req: true },
      ],
    },
    {
      id: 'comercial',
      titulo: 'Información comercial',
      cats: EXTERNOS,
      campos: [
        { name: 'bienes_servicios', label: 'Bienes o servicios que ofrece', type: 'textarea', req: true, full: true, cats: ['proveedor'] },
        { name: 'especialidad', label: 'Especialidad / tipo de obra o servicio', type: 'textarea', req: true, full: true, cats: ['contratista'] },
        { name: 'objeto_contrato', label: 'Objeto del contrato (si aplica)', type: 'textarea', full: true, cats: ['contratista'] },
        { name: 'productos_interes', label: 'Productos o servicios de interés', type: 'textarea', full: true, cats: ['cliente'] },
        { name: 'cupo_solicitado', label: 'Cupo de crédito solicitado (COP)', type: 'number', cats: ['cliente'] },
        { name: 'plazo_pago', label: 'Plazo de pago (días)', type: 'select', options: ['Contado', '15', '30', '45', '60', '90'] },
        { name: 'ref1_empresa', label: 'Referencia comercial 1 – Empresa', type: 'text' },
        { name: 'ref1_telefono', label: 'Referencia comercial 1 – Teléfono', type: 'tel' },
        { name: 'ref2_empresa', label: 'Referencia comercial 2 – Empresa', type: 'text' },
        { name: 'ref2_telefono', label: 'Referencia comercial 2 – Teléfono', type: 'tel' },
      ],
    },
    {
      id: 'empleado',
      titulo: 'Información laboral',
      cats: ['empleado'],
      campos: [
        { name: 'cargo', label: 'Cargo', type: 'text', req: true },
        { name: 'area', label: 'Área / Dependencia', type: 'text', req: true },
        { name: 'fecha_ingreso', label: 'Fecha de ingreso', type: 'date', req: true },
        { name: 'tipo_contrato', label: 'Tipo de contrato', type: 'select', options: ['Término indefinido', 'Término fijo', 'Obra o labor', 'Aprendizaje', 'Prestación de servicios'], req: true },
        { name: 'salario', label: 'Salario básico (COP)', type: 'number', req: true },
        { name: 'eps', label: 'EPS', type: 'text', req: true },
        { name: 'afp', label: 'Fondo de pensiones', type: 'text', req: true },
        { name: 'cesantias', label: 'Fondo de cesantías', type: 'text' },
        { name: 'arl', label: 'ARL', type: 'text' },
        { name: 'caja_compensacion', label: 'Caja de compensación', type: 'text' },
      ],
    },
    {
      id: 'bancaria',
      titulo: 'Información bancaria',
      cats: ['proveedor', 'contratista', 'empleado'],
      campos: [
        { name: 'banco', label: 'Banco', type: 'text', req: true },
        { name: 'tipo_cuenta', label: 'Tipo de cuenta', type: 'select', options: ['Ahorros', 'Corriente'], req: true },
        { name: 'numero_cuenta', label: 'Número de cuenta', type: 'text', req: true },
        { name: 'titular_cuenta', label: 'Titular de la cuenta', type: 'text', req: true },
      ],
    },
    {
      id: 'sarlaft',
      titulo: 'Declaración de origen de fondos (SARLAFT)',
      cats: EXTERNOS,
      campos: [
        { name: 'pep', label: '¿Es o ha sido Persona Expuesta Políticamente (PEP)?', type: 'select', options: SI_NO, req: true },
        { name: 'origen_fondos', label: 'Declaro que mis recursos provienen de', type: 'textarea', req: true, full: true },
      ],
    },
  ];

  // Anexos. `multiple` permite varios archivos para el mismo tipo.
  const ANEXOS = [
    { name: 'rut', label: 'RUT actualizado', cats: EXTERNOS, req: true },
    { name: 'camara_comercio', label: 'Certificado de Cámara de Comercio (no mayor a 30 días)', cats: EXTERNOS, when: JURIDICA, req: true },
    { name: 'documento_identidad', label: 'Documento de identidad (del tercero o representante legal)', req: true },
    { name: 'certificacion_bancaria', label: 'Certificación bancaria', cats: ['proveedor', 'contratista', 'empleado'], req: true },
    { name: 'estados_financieros', label: 'Estados financieros del último año', cats: ['cliente', 'proveedor'] },
    { name: 'seguridad_social', label: 'Planilla de seguridad social', cats: ['contratista'] },
    { name: 'polizas', label: 'Pólizas', cats: ['contratista'] },
    { name: 'hoja_vida', label: 'Hoja de vida', cats: ['empleado'] },
    { name: 'contrato', label: 'Contrato firmado', cats: ['empleado'] },
    { name: 'otros', label: 'Otros documentos', multiple: true },
  ];

  const AUTORIZACIONES = [
    {
      name: 'acepta_tratamiento',
      label: 'Autorizo a INVERSORA ARCILAZA S.A.S. el tratamiento de mis datos personales conforme a la Ley 1581 de 2012 y su política de tratamiento de datos.',
    },
    {
      name: 'acepta_veracidad',
      label: 'Declaro que la información suministrada es veraz y verificable, y me comprometo a actualizarla cuando cambie.',
    },
  ];

  const ESTADOS = {
    pendiente: 'Pendiente de validación',
    en_revision: 'En revisión',
    validado: 'Validado',
    rechazado: 'Rechazado',
    enviado: 'Enviado por correo',
  };

  function aplica(item, categoria, datos) {
    if (item.cats && !item.cats.includes(categoria)) return false;
    if (item.when) {
      for (const k of Object.keys(item.when)) {
        if ((datos || {})[k] !== item.when[k]) return false;
      }
    }
    return true;
  }

  /** Secciones y campos visibles para una categoría y unos datos dados. */
  function seccionesPara(categoria, datos) {
    return SECCIONES.filter((s) => aplica(s, categoria, datos))
      .map((s) => ({ ...s, campos: s.campos.filter((c) => aplica(c, categoria, datos)) }))
      .filter((s) => s.campos.length);
  }

  function anexosPara(categoria, datos) {
    return ANEXOS.filter((a) => aplica(a, categoria, datos));
  }

  /** Devuelve la lista de errores de validación (vacía si todo está bien). */
  function validar(categoria, datos, anexosCargados, opciones) {
    const opts = opciones || {};
    const errores = [];
    if (!CATEGORIAS[categoria]) return ['Tipo de tercero no válido'];
    for (const s of seccionesPara(categoria, datos)) {
      for (const c of s.campos) {
        const v = (datos[c.name] ?? '').toString().trim();
        if (c.req && !v) errores.push(`${s.titulo}: "${c.label}" es obligatorio`);
        if (v && c.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errores.push(`"${c.label}" no es un correo válido`);
        if (v && c.options && !c.options.includes(v)) errores.push(`"${c.label}" tiene un valor no permitido`);
      }
    }
    if (!opts.omitirAnexos) {
      for (const a of anexosPara(categoria, datos)) {
        if (a.req && !(anexosCargados || []).includes(a.name)) errores.push(`Anexo obligatorio: ${a.label}`);
      }
    }
    if (!opts.omitirAutorizaciones) {
      for (const a of AUTORIZACIONES) {
        if (!datos[a.name]) errores.push('Debe aceptar las autorizaciones y declaraciones');
      }
    }
    return [...new Set(errores)];
  }

  function etiqueta(nombreCampo) {
    for (const s of SECCIONES) for (const c of s.campos) if (c.name === nombreCampo) return c.label;
    const a = ANEXOS.find((x) => x.name === nombreCampo);
    return a ? a.label : nombreCampo;
  }

  return {
    CATEGORIAS, CATEGORIAS_PUBLICAS, SECCIONES, ANEXOS, AUTORIZACIONES, ESTADOS,
    seccionesPara, anexosPara, validar, etiqueta,
  };
});
