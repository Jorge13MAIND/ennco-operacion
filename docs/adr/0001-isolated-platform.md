# ADR 0001: plataforma aislada

## Decisión

ENNCO tendrá repositorio, Supabase, Vercel, dominios, buzones, bots y secretos propios.

## Razón

El código actual mezcla componentes y clientes. La propiedad, seguridad, exportación y contrato requieren aislamiento.

## Consecuencias

- Mayor setup inicial.
- Menor riesgo de fuga o borrado cruzado.
- Handoff claro.
- Prohibición de usar proyectos Supabase o tokens Teckel compartidos.
