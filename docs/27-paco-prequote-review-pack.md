# Paquete de validacion tecnica para Paco

Fecha: 2026-08-13.

Version a revisar: `ENNCO-PREQ-2026-08-DRAFT-02`.

Estado actual: `DRAFT_REVIEW_REQUIRED`. No esta publicado y no puede generar precios finales.

## Mensaje listo para WhatsApp

Paco, te paso los supuestos que va a usar el precotizador inicial. No da precio final ni garantia. Solo entrega un rango preliminar y manda el caso a revision tecnica.

Necesito que me confirmes si estos rangos son correctos o me pongas el valor que debemos usar:

1. Tarifa efectiva de energia: $2.80 a $3.35 MXN por kWh.
2. Produccion mensual estimada: 115 a 160 kWh por kWp.
3. Potencia de modulo: 620 a 650 Wp.
4. Superficie requerida: 5.2 a 7.3 m2 por kWp.
5. Inversion para proyectos menores a 30 kWp: $16,000 a $29,000 MXN por kWp.
6. Inversion para proyectos de 30 a menos de 100 kWp: $16,000 a $24,000 MXN por kWp.
7. Inversion para proyectos de 100 kWp o mas: $14,000 a $27,000 MXN por kWp. Este es el punto mas importante porque no tenemos un proyecto historico entregado mayor a 100 kWp y por ahora es una extrapolacion.
8. El resultado debe mostrarse siempre como rango preliminar, sujeto a recibo, sitio, tarifa, estructura y revision tecnica.
9. Garantias, descuento, precio contractual y fecha de instalacion nunca se automatizan.

Puedes responder de una de estas dos formas:

`APROBADO ENNCO-PREQ-2026-08-DRAFT-02`

o

`CORREGIR: punto X, usar ________`

## Lo que se aprueba

La respuesta debe cubrir:

- Bandas completas, no sólo un promedio.
- Vigencia sugerida de 30 dias.
- Uso de rangos en lugar de precio final.
- Apagado del modelo si una fuente critica vence.
- Escalamiento humano de garantias, descuentos y fecha de instalacion.
- Tratamiento de proyectos de 100 kWp o mas como extrapolados hasta incorporar evidencia comparable.

## Evidencia de origen

- Historico ENNCO de 20 proyectos. Ningun proyecto elegible supera 54.825 kWp.
- Cuatro propuestas anonimizadas usadas para backtesting.
- Ficha de modulo LONGi y metodologia de tarifas CFE.
- Backtest local: cuatro de cuatro casos dentro de las bandas.

## Regla de version

Una correccion produce una version nueva. La aprobacion de esta version no se puede reutilizar si cambian bandas, fuentes, vigencia o formula.
