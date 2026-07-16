-- Migration 008: Reestructura de estados en 4 dimensiones (instancia + momento +
-- resultado) + esperas + historial de instancias. El campo `estado` legacy NO se
-- elimina: se mantiene con doble escritura porque panel-agencia.html lo lee crudo
-- y panel-abogado.html lo escribe vía api/abogados.js?action=update-estado.
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query).

-- ---- Nuevas columnas ----
ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS instancia            TEXT DEFAULT 'evaluacion',
  ADD COLUMN IF NOT EXISTS momento              TEXT,
  ADD COLUMN IF NOT EXISTS resultado            TEXT,
  ADD COLUMN IF NOT EXISTS motivo_cierre        TEXT,
  ADD COLUMN IF NOT EXISTS motivo_cierre_detalle TEXT,
  ADD COLUMN IF NOT EXISTS acuerdo_instancia    TEXT,
  ADD COLUMN IF NOT EXISTS fecha_acuerdo        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pago_aerolinea_fecha    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comision_cobrada_fecha  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS honorarios_abogado_fecha TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS esperas              JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS instancia_historial  JSONB DEFAULT '[]';

-- ---- Migración de datos existentes ----
-- Todo lo de abajo corre una sola vez sobre los casos que aún no tienen instancia
-- seteada explícitamente por esta migración (usamos estado_historial / creado_en
-- para fechar el sembrado de instancia_historial).

-- Helper inline: fecha del estado actual dentro de estado_historial (última
-- entrada que matchea ese estado), o creado_en si no hay entrada.
-- (Se repite como subconsulta correlacionada en cada UPDATE de abajo.)

-- 1) evaluacion / en_revision -> evaluacion, sin momento
UPDATE reclamos SET
  instancia = 'evaluacion',
  momento = NULL,
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'evaluacion', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = reclamos.estado ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado IN ('pendiente', 'en_revision');

-- 2) esperando_info -> evaluacion + espera info_pasajero
UPDATE reclamos SET
  instancia = 'evaluacion',
  momento = NULL,
  esperas = COALESCE(esperas, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'id', 'mig-' || id::text || '-info',
      'tipo', 'info_pasajero',
      'detalle', NULL,
      'responsable', 'pasajero',
      'creada', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'esperando_info' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'vence', NULL, 'resuelta', NULL
    )
  ),
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'evaluacion', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'esperando_info' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'esperando_info';

-- 3) autorizacion_pendiente -> evaluacion + espera firma_documento
UPDATE reclamos SET
  instancia = 'evaluacion',
  momento = NULL,
  esperas = COALESCE(esperas, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'id', 'mig-' || id::text || '-firma',
      'tipo', 'firma_documento',
      'detalle', NULL,
      'responsable', 'pasajero',
      'creada', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'autorizacion_pendiente' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'vence', NULL, 'resuelta', NULL
    )
  ),
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'evaluacion', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'autorizacion_pendiente' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'autorizacion_pendiente';

-- 4) en_gestion (legacy) / reclamado_aerolinea -> reclamo_directo/presentado
UPDATE reclamos SET
  instancia = 'reclamo_directo',
  momento = 'presentado',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'reclamo_directo', 'momento', 'presentado',
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = reclamos.estado ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado IN ('en_gestion', 'reclamado_aerolinea');

-- 5) negociacion -> reclamo_directo/respuesta_recibida
UPDATE reclamos SET
  instancia = 'reclamo_directo',
  momento = 'respuesta_recibida',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'reclamo_directo', 'momento', 'respuesta_recibida',
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'negociacion' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'negociacion';

-- 6) rechazado_aerolinea / rechazado (legacy) -> reclamo_directo/respuesta_recibida
--    (quedan ACTIVOS para re-triage: decidir escalar a mediación o cerrar)
UPDATE reclamos SET
  instancia = 'reclamo_directo',
  momento = 'respuesta_recibida',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'reclamo_directo', 'momento', 'respuesta_recibida',
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = reclamos.estado ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado IN ('rechazado_aerolinea', 'rechazado');

-- 7) derivado_mediacion -> mediacion/preparacion
UPDATE reclamos SET
  instancia = 'mediacion',
  momento = 'preparacion',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'mediacion', 'momento', 'preparacion',
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'derivado_mediacion' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'derivado_mediacion';

-- 8) mediacion_notificada / en_mediacion -> mediacion/presentado
UPDATE reclamos SET
  instancia = 'mediacion',
  momento = 'presentado',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'mediacion', 'momento', 'presentado',
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = reclamos.estado ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado IN ('mediacion_notificada', 'en_mediacion');

-- 9) acuerdo -> cobro. acuerdo_instancia = mediacion si estado_historial contiene
--    algún estado de mediación, sino reclamo_directo.
UPDATE reclamos SET
  instancia = 'cobro',
  momento = NULL,
  acuerdo_instancia = CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(estado_historial) elem
      WHERE elem->>'estado' IN ('derivado_mediacion', 'mediacion_notificada', 'en_mediacion')
    ) THEN 'mediacion' ELSE 'reclamo_directo' END,
  fecha_acuerdo = COALESCE((
    SELECT (elem->>'fecha')::timestamptz FROM jsonb_array_elements(estado_historial) elem
    WHERE elem->>'estado' = 'acuerdo' ORDER BY elem->>'fecha' DESC LIMIT 1
  ), now()),
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'cobro', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'acuerdo' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'acuerdo';

-- 10) cobro_pasajero_pendiente -> cobro (igual que acuerdo)
UPDATE reclamos SET
  instancia = 'cobro',
  momento = NULL,
  acuerdo_instancia = CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(estado_historial) elem
      WHERE elem->>'estado' IN ('derivado_mediacion', 'mediacion_notificada', 'en_mediacion')
    ) THEN 'mediacion' ELSE 'reclamo_directo' END,
  fecha_acuerdo = COALESCE((
    SELECT (elem->>'fecha')::timestamptz FROM jsonb_array_elements(estado_historial) elem
    WHERE elem->>'estado' = 'acuerdo' ORDER BY elem->>'fecha' DESC LIMIT 1
  ), now()),
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'cobro', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'cobro_pasajero_pendiente' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'cobro_pasajero_pendiente';

-- 11) cobro_comision_pendiente -> cobro (igual + pago_aerolinea_fecha)
UPDATE reclamos SET
  instancia = 'cobro',
  momento = NULL,
  acuerdo_instancia = CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(estado_historial) elem
      WHERE elem->>'estado' IN ('derivado_mediacion', 'mediacion_notificada', 'en_mediacion')
    ) THEN 'mediacion' ELSE 'reclamo_directo' END,
  fecha_acuerdo = COALESCE((
    SELECT (elem->>'fecha')::timestamptz FROM jsonb_array_elements(estado_historial) elem
    WHERE elem->>'estado' = 'acuerdo' ORDER BY elem->>'fecha' DESC LIMIT 1
  ), now()),
  pago_aerolinea_fecha = COALESCE((
    SELECT (elem->>'fecha')::timestamptz FROM jsonb_array_elements(estado_historial) elem
    WHERE elem->>'estado' = 'cobro_comision_pendiente' ORDER BY elem->>'fecha' DESC LIMIT 1
  ), (
    SELECT (elem->>'fecha')::timestamptz FROM jsonb_array_elements(estado_historial) elem
    WHERE elem->>'estado' = 'acuerdo' ORDER BY elem->>'fecha' DESC LIMIT 1
  ), now()),
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'cobro', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'cobro_comision_pendiente' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'cobro_comision_pendiente';

-- 12) cerrado / aprobado / resuelto -> cerrado, resultado=exito
UPDATE reclamos SET
  instancia = 'cerrado',
  momento = NULL,
  resultado = 'exito',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'cerrado', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = reclamos.estado ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado IN ('cerrado', 'aprobado', 'resuelto');

-- 13) sin_exito -> cerrado, resultado=sin_exito
UPDATE reclamos SET
  instancia = 'cerrado',
  momento = NULL,
  resultado = 'sin_exito',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'cerrado', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'sin_exito' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'sin_exito';

-- 14) no_apto -> cerrado, resultado=no_apto
UPDATE reclamos SET
  instancia = 'cerrado',
  momento = NULL,
  resultado = 'no_apto',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'cerrado', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'no_apto' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'no_apto';

-- 15) cancelado -> cerrado, resultado=abandonado
UPDATE reclamos SET
  instancia = 'cerrado',
  momento = NULL,
  resultado = 'abandonado',
  instancia_historial = COALESCE(instancia_historial, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'instancia', 'cerrado', 'momento', NULL,
      'fecha', COALESCE((
        SELECT elem->>'fecha' FROM jsonb_array_elements(estado_historial) elem
        WHERE elem->>'estado' = 'cancelado' ORDER BY elem->>'fecha' DESC LIMIT 1
      ), creado_en::text, now()::text),
      'por', 'migracion'
    )
  )
WHERE estado = 'cancelado';

-- 16) Requerimientos pendientes de la aerolínea -> espera tipo requerimiento_aerolinea.
--     Las columnas requerimiento_tipo/fecha/detalle se mantienen (dejan de usarse).
UPDATE reclamos SET
  esperas = COALESCE(esperas, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'id', 'mig-' || id::text || '-req',
      'tipo', 'requerimiento_aerolinea',
      'detalle', requerimiento_detalle,
      'responsable', 'solucionair',
      'creada', COALESCE(requerimiento_fecha::text, now()::text),
      'vence', NULL, 'resuelta', NULL
    )
  )
WHERE requerimiento_tipo IS NOT NULL;

UPDATE reclamos SET
  requerimiento_tipo = NULL,
  requerimiento_fecha = NULL,
  requerimiento_detalle = NULL
WHERE requerimiento_tipo IS NOT NULL;
