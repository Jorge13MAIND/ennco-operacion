"""Construye el plan de las cuatro olas de los primeros 500 correos.

Determinista: liga la lista objetivo (a quien) con la secuencia del carril
directo (que se le dice) y fija que se mide antes de pasar a la siguiente ola.
No dispara nada: el artefacto nace en RESEARCH_ONLY_HOLD.
"""
import json, hashlib

LISTA = "data/imports/research/target-list-2026-09-03/target-list-v1.json"
COPY = "data/campaigns/direct-lane-sequence-v1.json"
SALIDA = "data/campaigns/waves-2026-09-03.json"

lista = json.load(open(LISTA))
copy = json.load(open(COPY))

TOQUES = 3                      # dias 0, 3 y 7
DIAS = copy["day_offsets"][:TOQUES]

DEFINICION = {
 "1": {"nombre":"Sonda de entrega",
       "proposito":"Comprobar que Gmail entrega desde los buzones propios y que las respuestas llegan al Control Room. NO mide conversion: 10 contactos no dan senal comercial.",
       "avanza_si":["entrega >= 95%","cero quejas de spam","cero rebotes duros","al menos una respuesta sincronizada en el Control Room, aunque sea negativa"],
       "para_si":["cualquier queja de spam","rebote duro","respuestas que no aparecen en el Control Room en 30 minutos"],
       "observacion_horas":48},
 "2": {"nombre":"Prueba de variante",
       "proposito":"Medir que angulo del copy responde mejor, con varios contactos por empresa.",
       "avanza_si":["entrega >= 95%","rebote duro < 2%","tasa de respuesta medida y registrada por variante"],
       "para_si":["queja de spam","rebote duro > 2%","tasa de respuesta 0 en las cuatro variantes"],
       "observacion_horas":48},
 "3": {"nombre":"Cobertura del segmento",
       "proposito":"Confirmar que la tasa aguanta al salir de las mejores cuentas.",
       "avanza_si":["entrega >= 95%","rebote duro < 2%","tasa de respuesta dentro del 50% de la de la ola 2"],
       "para_si":["queja de spam","rebote duro > 2%","tasa de respuesta menos de la mitad que en la ola 2"],
       "observacion_horas":48},
 "4": {"nombre":"Cola larga",
       "proposito":"Agotar el presupuesto de 500 correos con el resto del segmento premium.",
       "avanza_si":["se completa el presupuesto y se produce el reporte de cierre"],
       "para_si":["queja de spam","rebote duro > 2%"],
       "observacion_horas":48},
}

olas=[]
for ola in ["1","2","3","4"]:
    contactos=[c for c in lista["seleccion_por_ola"] if c["ola"]==ola]
    empresas=sorted({c["empresa"] for c in contactos})
    d=DEFINICION[ola]
    olas.append({
      "ola":int(ola), "nombre":d["nombre"], "proposito":d["proposito"],
      "contactos":len(contactos), "empresas":len(empresas),
      "correos_estimados":len(contactos)*TOQUES,
      "toques":TOQUES, "dias_offset":DIAS,
      "variantes":{v:sum(1 for c in contactos if c["perfil"]==v)
                   for v in ["MANTENIMIENTO","DIRECCION","COMPRAS","SEGURIDAD"]},
      "observacion_horas_antes_de_la_siguiente":d["observacion_horas"],
      "avanza_si":d["avanza_si"], "para_si":d["para_si"],
      "regla_multi_contacto":"maximo 3 por empresa en todo el programa, separados 48 horas",
      "contactos_detalle":[{"apollo_person_id":c["apollo_person_id"],"empresa":c["empresa"],
                            "cargo":c["cargo"],"variante_copy":c["variante_copy"],
                            "score_v2":c["score_v2"]} for c in contactos],
    })

total_correos=sum(o["correos_estimados"] for o in olas)
art={
 "schema_version":"1.0.0",
 "titulo":"Primeras cuatro olas · presupuesto de 500 correos",
 "generado":"2026-09-03",
 "authorization_state":"RESEARCH_ONLY_HOLD",
 "external_effects_executed":False,
 "requiere_antes_de_disparar":[
   "Infraestructura del carril directo lista y verificada por Grant (runbook m41)",
   "Calentamiento de los buzones resuelto por Grant",
   "Aprobacion explicita de Jorge para el primer envio externo (clausula 07)",
   "Ids de Apollo validados contra la plataforma: el gate verifica forma, no existencia",
   "Correos revelados en la fase de verificacion, con su tope de creditos",
 ],
 "copy":{"fuente":COPY,
         "source_sha256":copy["source_sha256"],
         "markdown":"docs/external/secuencia-ennco-copy.md",
         "remitente":f'{copy["sender_name"]}, {copy["sender_title"]}',
         "variantes":[v["key"] for v in copy["variants"]],
         "toques_disponibles":len(copy["day_offsets"]),
         "toques_en_uso":TOQUES,
         "nota":"La secuencia tiene 8 toques escritos. Con presupuesto de 500 correos se usan los primeros 3 (dias 0, 3 y 7), que es donde llega la mayor parte de la respuesta. Los toques 4 al 8 quedan listos para cuando suba el volumen mensual."},
 "lista_objetivo":{"fuente":LISTA,
                   "empresas":len(lista["empresas_priorizadas"]),
                   "contactos":len(lista["seleccion_por_ola"])},
 "totales":{"contactos":sum(o["contactos"] for o in olas),
            "correos_estimados":total_correos,
            "presupuesto":500},
 "olas":olas,
}
open(SALIDA,"w").write(json.dumps(art,ensure_ascii=False,indent=2)+"\n")
print(f"escrito {SALIDA}")
for o in olas:
    print(f"  ola {o['ola']} · {o['nombre']:24s} {o['contactos']:3d} contactos · {o['empresas']:2d} empresas · {o['correos_estimados']:3d} correos")
print(f"  TOTAL: {art['totales']['correos_estimados']} correos de {art['totales']['presupuesto']}")
