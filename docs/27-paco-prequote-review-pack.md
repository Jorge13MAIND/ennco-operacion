# Validación técnica recibida de Paco

Solicitud enviada: 13 de agosto de 2026.

Respuesta recibida y autorizada para implementación por Jorge: 20 de agosto de 2026.

Versión resultante: `ENNCO-PREQ-2026-08-PACO-01`.

Estado del modelo: `APPROVED` para sus parámetros técnicos y referencias comerciales. La publicación pública permanece bloqueada por privacidad, infraestructura, UAT y release explícito.

## Parámetros aprobados

1. Tarifa efectiva de energía: 2.80 a 3.35 MXN/kWh.
2. Producción mensual estimada: 120 a 165 kWh/kWp/mes.
3. Potencia de módulos: 620 a 650 Wp.
4. Superficie requerida: 5.2 a 7.3 m2/kWp.
5. Inversión para proyectos menores a 30 kWp: 18,000 a 29,000 MXN/kWp.
6. Inversión para proyectos de 30 a menos de 100 kWp: 17,000 a 24,000 MXN/kWp.
7. Proyectos de 100 kWp o más: revisión técnica y comercial obligatoria, sin rango automático de inversión.

## Referencias comerciales

- Garantía de referencia: 24 meses por vicios ocultos.
- Descuento de contado: 3% a 6%.
- Precio de arranque: 11,000 MXN por módulo instalado.
- Precio contractual: requiere validación comercial y no se deriva automáticamente de MKT.
- Fecha de instalación: depende de materiales y programación de obra.

Estas referencias se muestran siempre como sujetas al contrato final. El sistema no aplica descuentos, garantías, precios contractuales ni fechas de forma automática.

## Regla de presentación

Todos los cálculos son estimaciones o rangos preliminares. Requieren recibo CFE, tarifa, condiciones del sitio, estructura, distancias, obra eléctrica y revisión técnica.

## Evidencia auditable

- Fuente congelada: `data/prequote/paco-approved-parameters-2026-08-20.json`.
- Modelo versionado: `data/prequote/model-approved-v3.json`.
- Manifest de fuentes: `data/prequote/source-manifest.json`.
- Histórico ENNCO: 20 proyectos, ninguno elegible de 100 kWp o más.
- Backtest: cuatro propuestas anónimas.

## Regla de versión

Cualquier cambio de rango, condición comercial, fórmula, fuente o vigencia produce una versión nueva. Esta aprobación no puede reutilizarse para una versión distinta.
