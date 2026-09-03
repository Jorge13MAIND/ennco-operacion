import json, hashlib

# Contactos alcanzables medidos en Apollo el 3-sep-2026 (busqueda de personas,
# 0 creditos). Segmento premium: NAICS 322/325/326/327/331/336, 201+ empleados,
# persona ubicada en Guanajuato o Queretaro, correo VERIFICADO.
# Universo medido: mantenimiento 181 · direccion 75 · compras 53 · seguridad 34.

E = {}
def add(empresa, perfil, apollo_id, nombre, cargo, nota=None):
    E.setdefault(empresa, {"contactos": []})["contactos"].append(
        {"apollo_person_id": apollo_id, "nombre_pila": nombre, "cargo": cargo,
         "perfil": perfil, "variante_copy": perfil, **({"nota": nota} if nota else {})})

# --- Empresas con cobertura multi-perfil (las mejores) ---
add("Nexteer Automotive","MANTENIMIENTO","5d42516580f93e9502ac389a","Francisco","Maintenance Supervisor")
add("Nexteer Automotive","MANTENIMIENTO","54a48a127468693b8cdb2f4f","Zahory","Plant Manager")
add("Nexteer Automotive","MANTENIMIENTO","54abe5e4746869332d39e414","Jose","Regional Facilities Manager")
add("Nexteer Automotive","COMPRAS","57e0fc2ca6da987d60b70fa3","Mario","Indirect Purchasing Manager (MX)","indirectos: perfil exacto para poliza")
add("Nexteer Automotive","SEGURIDAD","60fb9825983d2500015975df","Juan","EHS Manager - Mexico Division")

add("Martinrea International","MANTENIMIENTO","54a44eed7468692fa2e05a3d","Marin","Maintenance Manager")
add("Martinrea International","MANTENIMIENTO","68cb1cd368ac9b000194a9a2","Edgar","Maintenance Manager")
add("Martinrea International","DIRECCION","66c663ba4c8d5600016cae31","Francisco","General Manager")

add("Shape Corp.","MANTENIMIENTO","5d65576780f93e74f0c85385","Pedro","Plant Maintenance Manager")
add("Shape Corp.","MANTENIMIENTO","54aab56f7468690377b31014","Rogelio","Plant Manager")
add("Shape Corp.","COMPRAS","640e0b1532681b0001c096b1","Luis","Procurement Director")

add("Bosal","MANTENIMIENTO","69983f6a0fe9830001cdc8f1","Valentin","Plant Manager")
add("Bosal","DIRECCION","691c597a11998000015bf94f","Luis","Director General")
add("Bosal","COMPRAS","67c7219721d4a60001ad7a02","Perla","Purchasing Manager")

add("Innophos","MANTENIMIENTO","642715f5c24ebc000182d507","David","Maintenance Manager")
add("Innophos","MANTENIMIENTO","6102e58c358ad60001250136","Alan","Plant Manager")
add("Innophos","SEGURIDAD","5da6ee6261c9f300017d0d38","Miguel","EHS Manager")

add("Johnson Matthey","MANTENIMIENTO","57dfa6c2a6da980b414b346f","Ricardo","Plant Maintenance Manager")
add("Johnson Matthey","MANTENIMIENTO","5c608355f651251bed2c8b5f","Fernando","Plant Manager")
add("Johnson Matthey","SEGURIDAD","54a50c6d7468692cf0b2b278","Hugo","Gerente de EHS")

add("The Gund Company","MANTENIMIENTO","54a584b57468692fa2fe0e9a","Victor","Maintenance Manager")
add("The Gund Company","MANTENIMIENTO","5e625a87b342a7000136497c","Carlos","Plant Manager")
add("The Gund Company","DIRECCION","54a758f374686965d9b04e2c","Rodrigo","Director of Operations")

add("Condumex","MANTENIMIENTO","601a9dc4748327000113eedd","Gustavo","Maintenance Supervisor")
add("Condumex","DIRECCION","69d767334b9f19000187e7b5","Raul","General Manager")
add("Condumex","DIRECCION","5e60e35955a319000101cb6e","Julio","General Manager")

add("Grupo DEACERO","MANTENIMIENTO","60c0b53ffc9d330001af603c","Saul","Maintenance Manager")
add("Grupo DEACERO","MANTENIMIENTO","64c7b5eda979930001782659","Refugio","Maintenance Supervisor")
add("Grupo DEACERO","DIRECCION","6816713b7a118a000153acf3","Juan","Director General")

add("Novem Group","MANTENIMIENTO","5e7fae4d4d0ff80001563573","Leonardo","Maintenance Supervisor")
add("Novem Group","MANTENIMIENTO","67602d114cef820001cc8b02","Nicolas","Maintenance Supervisor")
add("Novem Group","COMPRAS","6544a85e7819bf0001067bad","Sergio","Purchasing Manager Americas")

add("TREMEC","MANTENIMIENTO","672c8d9d7229440001ccaeaf","Ildefonso","Jefe de Mantenimiento Forjas y Tratamiento Termico")
add("TREMEC","COMPRAS","54a5995f74686938ac142f9d","Miguel","Purchasing Manager GSM")
add("TREMEC","COMPRAS","5e6da5c812b54200011743b5","Carlos","Purchasing Manager (TREMEC KUO)")

add("Hatch Stamping Company","MANTENIMIENTO","57ddd347a6da987afd942ba2","Enrique","Maintenance Manager")
add("Hatch Stamping Company","COMPRAS","66c3a6f08c4cd5000132209f","Dulce","Purchasing Supervisor")

add("Le Belier Groupe","MANTENIMIENTO","613a147b2edc6c0001ae7ab6","Omar","Maintenance Manager")
add("Le Belier Groupe","COMPRAS","67d9d69b17166a0001e10019","Liliana","Purchasing Manager")

add("Gerresheimer","MANTENIMIENTO","67066259c3fdf600015b141a","Maria","Supervisor de Mantenimiento")
add("Gerresheimer","COMPRAS","57d396a2f651252c592d67fb","Rogelio","Purchasing Manager")

add("Carcoustics","MANTENIMIENTO","5fd1a294d9b8670001dba9bc","Alejandro","Plant Manager")
add("Carcoustics","COMPRAS","57d83f8ea6da980a46bbcc33","Juan","Program Purchasing Manager","capex de programa, pertinente")

add("Lamosa Porcelanite","MANTENIMIENTO","5bc827cda3ae613052d95f0b","Ivan","Maintenance Manager")
add("Lamosa Porcelanite","MANTENIMIENTO","54a4864c7468692cf0b5404e","Ildefonso","Plant Manager")
add("Lamosa Porcelanite","MANTENIMIENTO","5570abde73696419c65d3f00","Vicente","Maintenance Supervisor")

add("Elay Group","MANTENIMIENTO","54a4559374686938ac70ad3f","Victor","Maintenance Manager")
add("Elay Group","COMPRAS","54a7aad774686968294f394a","Ion","Purchasing Manager")

add("Productos Pennsylvania","DIRECCION","6101c59f37b4330001622357","Hayde","General Manager")
add("Productos Pennsylvania","DIRECCION","679d8c9120e9a4000127dfab","Alberto","Director of Operations")
add("Productos Pennsylvania","COMPRAS","66d4a972bdd4300001b0a410","Adriana","Procurement & Sourcing Manager")

add("DEDIENNE AEROSPACE","DIRECCION","674a91378a8bc30001c1a80e","Edgar","General Manager")
add("DEDIENNE AEROSPACE","COMPRAS","5e9c5daeaa2fb2000112804d","Leticia","Purchasing Manager")

add("Guala Closures","MANTENIMIENTO","54a4edeb74686932090d6c6e","Jose","Plant Manager")
add("Guala Closures","DIRECCION","5f99ab3c1082100001fe3e0a","Hector","Director General Mexico")

add("Ulbrich Stainless Steels","MANTENIMIENTO","614ea7c47ea6fd0001f0e795","Daniel","Plant Manager")
add("Ulbrich Stainless Steels","DIRECCION","54aa9e4b7468690b75b76c0e","Cesar","General Manager")

add("IMS Gear","MANTENIMIENTO","683b9bbfcbedf20001c5e6de","Juan","Maintenance Supervisor")
add("IMS Gear","DIRECCION","54a5d6537468692fa2a3f3ac","Agustin","General Manager")

add("Symrise AG","DIRECCION","54a61c29746869344292e2c2","Juan","General Manager")
add("Symrise AG","SEGURIDAD","669febccbf157b00011e4ce5","Jose","Latam Safety Manager")

add("Volkswagen Truck and Bus Mexico","SEGURIDAD","63bdc2b1f137320001000d6b","Isabel","Coordinador de Seguridad e Higiene")
add("Volkswagen Truck and Bus Mexico","COMPRAS","65b7c2dfc8c22c0001079bab","Monserrat","Gerente de Compras")

add("Siegfried Rhein Mexico","SEGURIDAD","57dc1aaba6da98687b47b094","Marlene","Jefe de Seguridad e Higiene")
add("Siegfried Rhein Mexico","COMPRAS","63a9813cc3c804000197d0cb","Maria","Purchasing Manager")

add("FANOSA","SEGURIDAD","645b775380756c00013ccc8a","Flor","Seguridad e Higiene")
add("FANOSA","COMPRAS","67a7a083ee763c0001cd3abe","Lizbeth","Purchasing Manager")

add("Avery Dennison","SEGURIDAD","68df9f5f632b4900015a3c6c","Cesar","EHS & ELS Manager Latam")
add("Avery Dennison","COMPRAS","649d1625ceaa9b000158f6c0","Cesar","Procurement Manager Latam")

add("Hi-Lex Mexicana","MANTENIMIENTO","63dd04b3ab6084000136434d","Luis","Plant Manager")
add("Hi-Lex Mexicana","COMPRAS","57d6f510a6da986b4d8c8be6","Arnulfo","Purchasing Manager")

add("GRAMMER Americas","MANTENIMIENTO","60bf84b0b23a6f00016b7ec1","Rafael","Plant Manager")
add("GRAMMER Americas","MANTENIMIENTO","55710c357369641b6ea80100","Adrian","Gte. de Mantenimiento")

add("Topre Autoparts Mexico","MANTENIMIENTO","6357c8cb8351120001896295","Luis","Maintenance Supervisor")
add("Topre Autoparts Mexico","MANTENIMIENTO","67a9986bb4b8270001ad5d03","Jesus","Gerente de Planta")

add("Mubea","MANTENIMIENTO","54a2de8b74686930c22b5743","Oscar","Gerente de Mantenimiento de Planta")
add("Mubea","MANTENIMIENTO","54a4b31c746869344226725c","Ruben","Plant Manager")

add("RONAL Wheels","MANTENIMIENTO","5e7c0bf46187330001276153","Fernando","Plant Manager")
add("RONAL Wheels","MANTENIMIENTO","5d4cec6da3ae61415b4dde11","Roberto","Jefe de Mantenimiento Tratamiento Termico")

add("Ampacet Corporation","MANTENIMIENTO","60f70490d08c4a0001fc5d36","Sergio","Plant Manager")
add("Ampacet Corporation","MANTENIMIENTO","57e08de4a6da981c254078c8","Gustavo","Maintenance Manager")

add("Vibrantz Technologies","MANTENIMIENTO","63a992c32e55240001b505a5","Alan","Plant Manager")
add("Vibrantz Technologies","MANTENIMIENTO","64244eddf437b80001f0499f","Jaqueline","Pigments Plant Manager")

add("KI Industries","MANTENIMIENTO","5f0d293dc1c64a00010af5f8","Alex","Maintenance Supervisor")
add("KI Industries","MANTENIMIENTO","60e7f3188767bc00014d53ae","Fabiola","Gerente de Planta")

add("ARTLUX","MANTENIMIENTO","57d58149a6da98538e81b155","Jose","Maintenance Manager")
add("ARTLUX","DIRECCION","54a1bd187468695c8295670c","Luis","Director of Operations")

add("Printpack","DIRECCION","54a8ca367468693399f51006","Andre","General Manager")
add("Printpack","SEGURIDAD","63a2f4a9b1d3e70001f64448","Andres","Coordinador de Seguridad Patrimonial","patrimonial, no higiene industrial: verificar antes de usar variante seguridad")

add("DELFINGEN","MANTENIMIENTO","54a3e9977468692cf01a051d","Hugues","Celaya Plant Manager")

# --- Tier 1 con senal publica doble (PROFEPA + DENUE 251+ + corredor) ---
add("KIRCHHOFF Automotive","MANTENIMIENTO","54a3b18174686938ac216f0b","Frank","Plant Manager")
add("KIRCHHOFF Automotive","COMPRAS","67e58615824e210001bee5b9","Hector","Director of Procurement")
add("KIRCHHOFF Automotive","COMPRAS","5cdaf7dd80f93e0f1c860b88","Yadira","Procurement Supervisor")

# --- Cobertura de un solo contacto, alta calidad ---
for emp, pid, nom, cargo, perfil in [
 ("Trelleborg Group","5e720e4ba980e900011ddaf8","Erick","Gerente de Mantenimiento y Procesos","MANTENIMIENTO"),
 ("Corporacion Moctezuma","57d41c0fa6da9853a65bcc42","Jose","Supervisor de Mantenimiento","MANTENIMIENTO"),
 ("Grupo AlEn","66d92f7a8f3a90000199354c","Vicente","Jefe de Mantenimiento Mexico","MANTENIMIENTO"),
 ("Eurotranciatura Mexico","5d61d167f651257dbfc888e4","Carlos","Gerente de Mantenimiento Planta","MANTENIMIENTO"),
 ("Givaudan","5f01af5f71ff5c0001285493","Eden","Maintenance Supervisor","MANTENIMIENTO"),
 ("WIPRO LAUAK","612bacd25178700001e2584f","Omar","Maintenance Supervisor","MANTENIMIENTO"),
 ("Nolato Vermont","57e185faa6da987dd4283eda","Leonardo","Maintenance Supervisor","MANTENIMIENTO"),
 ("AAM - American Axle","6198f9baecceae0001fdc86f","Alejandro","Maintenance Supervisor","MANTENIMIENTO"),
 ("REHAU Window Solutions","642bcf758d2e520001f7735d","Alfredo","Maintenance Supervisor","MANTENIMIENTO"),
 ("Hanon Systems","5dc900c30ff0100001acd20f","Carlos","Maintenance Supervisor","MANTENIMIENTO"),
 ("Rassini","68650a9390be97000160021a","Jair","Maintenance Supervisor","MANTENIMIENTO"),
 ("Gentherm","61b44d8f2447960001605f70","Jose","Maintenance Supervisor","MANTENIMIENTO"),
 ("Winpak","5d473951a3ae61a69a41dd75","Fermin","Plant Maintenance Manager","MANTENIMIENTO"),
 ("DWK Life Sciences","54c222907468691639c5ba7c","Sergio","Plant Manager","MANTENIMIENTO"),
 ("Sensient Technologies","6817288dfca6fe00012c2c5e","Francisco","Plant Manager","MANTENIMIENTO"),
 ("ALPLA Mexico","6628c0e44e44e600067c62dc","Sergio","Plant Manager","MANTENIMIENTO"),
 ("BOS Automotive Products","5d58ad01f651257391bb346d","Rafael","Plant Manager","MANTENIMIENTO"),
 ("MAHLE","66f8231da0ad4800010a7f58","Jorge","Plant Manager","MANTENIMIENTO"),
 ("Shiloh Industries","5d6924bda3ae61cbadd05411","Carlos","Plant Manager","MANTENIMIENTO"),
 ("Grupo Industrial Saltillo","684765c714f55d00013c9739","Juan","Plant Manager","MANTENIMIENTO"),
 ("Exo-s","57dfded1a6da980ad27c4eee","Juan","Plant Manager","MANTENIMIENTO"),
 ("Afton Chemical","5e6b72d316d9d000014bf465","Jose","Plant Manager","MANTENIMIENTO"),
 ("Tachi-S Mexico","635947d5e7bb660001e74401","Daniel","Plant Manager","MANTENIMIENTO"),
 ("FANDELI","659f2abd949ae3000117759f","Eden","Plant Manager","MANTENIMIENTO"),
 ("Industrias Pegaduro","6424296c6356250001c113a3","Antonio","Plant Manager","MANTENIMIENTO"),
 ("Industrial Corona de Mexico","54a4782d7468693209bbef49","Victor","Plant Manager","MANTENIMIENTO"),
 ("Grupo Vasconia","54a4ac87746869320999eb59","Carlos","Plant Manager","MANTENIMIENTO"),
 ("INX International Ink","6426fb2c764a7f0001c5e65e","Juan","Plant Manager","MANTENIMIENTO"),
 ("Baomarc Automotive Solutions","5e8c07543b5eb10001aaf879","Edwin","Maintenance Manager","MANTENIMIENTO"),
 ("SaarGummi Group","674b80859a6cb80001eff61b","Joel","Maintenance Manager","MANTENIMIENTO"),
 ("Multimatic","67382075132e0b0001e1b51c","Gerardo","Maintenance Manager","MANTENIMIENTO"),
 ("PAC Worldwide","612a0b63f4a24d000196e616","Daniel","Maintenance Manager","MANTENIMIENTO"),
 ("Freudenberg Sealing Technologies","63eac25739989600011280dc","Luis","Maintenance Manager","MANTENIMIENTO"),
 ("CCL Secure","55706cae7369644ae70c3300","Oscar","Maintenance Manager","MANTENIMIENTO"),
 ("Auria","610ae2f4591a6c00017fe199","Wenceslao","Maintenance Manager","MANTENIMIENTO"),
 ("KARTESIS INDUSTRIES","62876bd89a7ff200013e74b4","Raymundo","Maintenance Manager","MANTENIMIENTO"),
 ("Serviacero Comercial","608a6397f4bb4e0001f084d6","Joel","COO | Director de Operaciones","DIRECCION"),
 ("BizLink Group","57d42996a6da98537ecd5590","Jorge","Director de Operaciones de Planta","DIRECCION"),
 ("Walter Pack","67b588ec92ac100001d990d7","Miguel","Country Manager","DIRECCION"),
 ("Pirelli Mexico","55ca2fbef3e5bb47cf001f70","Oscar","Country Manager","DIRECCION"),
 ("Shurtape Technologies","624e27f2cf61550001e77d4d","Alberto","Director General","DIRECCION"),
 ("Kautex Textron","54a2cce97468693825b5603e","Jerid","Director of Operations","DIRECCION"),
 ("OECHSLER","54a6152074686936768366c0","Daniel","General Manager","DIRECCION"),
 ("Metalor Technologies","65bf5b1307203e00018f2a86","Josue","General Manager","DIRECCION"),
 ("Interceramic","65c232d93a6b300001432687","Fermin","General Manager","DIRECCION"),
 ("GOTEC Group","6258dabd4d75230001779d02","Martin","General Manager","DIRECCION"),
 ("Marquardt Group","5e8145482d4b3000017110c6","Martin","General Manager","DIRECCION"),
 ("TI Automotive","54a228b87468692e71152e12","Rene","Site General Manager","DIRECCION"),
 ("COSENTINO","57e06dffa6da981c15d08038","Isabel","General Manager","DIRECCION"),
 ("Parker Lord","5e87fd13fe3d5e0001004737","Armando","General Manager","DIRECCION"),
 ("Metalsa","659484c514a58300016babe4","Yoselin","EHS Manager","SEGURIDAD"),
 ("Guardian Industries","671bcaddc4ad690001773971","Elisa","EHS Manager","SEGURIDAD"),
 ("Corbion","5d580dfea3ae61c4969cde0c","Claudia","EHS Manager","SEGURIDAD"),
 ("Mativ","5c427f9da3ae616f73fa6b45","Fabian","EHS Manager","SEGURIDAD"),
 ("ZKW","64eb70767000510001a17a28","Hector","Environmental, Health and Safety Manager","SEGURIDAD"),
 ("Scania Mexico","63232924b8ce80000179b02e","Rene","Jefe de Seguridad Operacional","SEGURIDAD"),
 ("ITP Aero","6833e37290531400014cc030","Manuel","Coordinador de Seguridad e Higiene","SEGURIDAD"),
 ("Rehrig Pacific Company","64cbc17b995600000130d6c9","Arturo","Coordinador de Seguridad e Higiene","SEGURIDAD"),
 ("US Farathane","61a23e05cbe356000187f5db","Jose","HR Manager & EHS","SEGURIDAD"),
 ("Suzuki Garphyttan","6359390ac534720001ab1258","Enrique","HR & EHS Manager","SEGURIDAD"),
 ("O-I","61690d5304eed80001f41868","Diana","Manager EHS","SEGURIDAD"),
 ("Airbus Helicopters","54a4fe967468693b8cd22174","Carlos","Purchasing Manager","COMPRAS"),
 ("Hope Global","5d4eb88c80f93e6beac7dad3","Ramon","Purchasing Manager","COMPRAS"),
 ("Omya","63abee72b12e640001aa9424","Juan","Purchasing Manager","COMPRAS"),
 ("GKN plc","54a51de27468692abf994b7e","Beatriz","Purchasing Manager","COMPRAS"),
 ("Wella Company","5ac98880a6da9840f6313942","Luis","Procurement Manager","COMPRAS"),
 ("Novelis","67a3a2e591686e0001f87ac5","Gustavo","Purchasing Manager Mexico","COMPRAS"),
 ("LINDAL Group","57d9ed2ba6da987634157af3","Saul","Group Procurement Manager","COMPRAS"),
 ("Aernnova Aerospace","5ad0ad8fa6da98847fc72659","Luis","Procurement & Business Development Manager","COMPRAS"),
]:
    add(emp, perfil, pid, nom, cargo)

TIER1_PROFEPA = {"KIRCHHOFF Automotive"}

# Excluidas a proposito, con marcador, nunca en silencio.
EXCLUIDAS = [
  {"empresa":"POSCO HOLDINGS","motivo":"EXCLUIDO_ANEXO_A_GRUPO",
   "detalle":"El Anexo A nombra a POSCO MPPC. POSCO HOLDINGS es la matriz y aparecio en la busqueda de compras. Sin aclaracion de ENNCO sobre si la exclusion alcanza al grupo, no se contacta. Misma duda abierta que POSCO MVWPC en el sourcing del 26-ago."},
]

def score(nombre, datos):
    c = datos["contactos"]; s = 0; razones = []
    s += 5; razones.append("contacto decisor con correo verificado (+5)")
    if nombre in TIER1_PROFEPA: s += 4; razones.append("PROFEPA-PNAA vigente, Tier 1 (+4)")
    s += 2; razones.append("sector intensivo en energia, NAICS 322/325/326/327/331/336 (+2)")
    s += 2; razones.append("201+ empleados (+2)")
    if len(c) >= 2: s += 1; razones.append(f"{len(c)} contactos alcanzables, permite multi-cargo (+1)")
    perfiles = {x["perfil"] for x in c}
    if len(perfiles) >= 2: s += 1; razones.append(f"{len(perfiles)} perfiles distintos (+1)")
    return s, razones

empresas = []
for nombre, datos in E.items():
    s, razones = score(nombre, datos)
    empresas.append({"empresa": nombre, "score_v2": s, "senales": razones,
                     "contactos_alcanzables": len(datos["contactos"]),
                     "perfiles": sorted({c["perfil"] for c in datos["contactos"]}),
                     "contactos": datos["contactos"]})
empresas.sort(key=lambda x: (-x["score_v2"], -x["contactos_alcanzables"], x["empresa"]))

# Olas: 175 contactos, 3 toques cada uno ~= 517 correos
OLAS = [("1", 10, "Solo el mejor score, un contacto por empresa, perfil mantenimiento. Prueba de entrega y de sincronizacion de respuestas."),
        ("2", 30, "Multi-contacto en las mejores cuentas. Mide que variante responde."),
        ("3", 60, "Cobertura amplia del segmento premium."),
        ("4", 75, "Cola larga del segmento premium.")]
seleccion=[]; usados=set()
# Ola 1: 10 empresas top, 1 contacto de mantenimiento cada una
for e in empresas:
    if len(seleccion)>=10: break
    m=[c for c in e["contactos"] if c["perfil"]=="MANTENIMIENTO"]
    if m: seleccion.append({**m[0],"empresa":e["empresa"],"score_v2":e["score_v2"],"ola":"1"}); usados.add(m[0]["apollo_person_id"])
# Olas 2-4: por score, hasta 3 contactos por empresa, separados 48h
cupos={"2":30,"3":60,"4":75}
# El tope de 3 contactos por empresa es GLOBAL, no por ola: si se cuenta por ola,
# una cuenta buena acumula uno en cada una y termina con cinco personas de la
# misma planta recibiendo correo. Lo atrapo verify:target-list.
from collections import Counter
por_empresa = Counter(s["empresa"] for s in seleccion)
for ola in ["2","3","4"]:
    for e in empresas:
        if cupos[ola]<=0: break
        for c in e["contactos"]:
            if cupos[ola]<=0 or por_empresa[e["empresa"]]>=3: break
            if c["apollo_person_id"] in usados: continue
            seleccion.append({**c,"empresa":e["empresa"],"score_v2":e["score_v2"],"ola":ola})
            usados.add(c["apollo_person_id"]); cupos[ola]-=1; por_empresa[e["empresa"]]+=1

art={
 "schema_version":"1.0.0","generated_for":"primeros 500 correos",
 "measured_at":"2026-09-03","measurement":"apollo_mixed_people_api_search, 0 creditos",
 "segmento":{"naics":["322","325","326","327","331","336"],
   "empleados":["201,500","501,1000","1001,2000","2001,5000","5001,10000","10001,20000"],
   "person_locations":["Guanajuato, Mexico","Queretaro, Mexico"],"email_status":"verified"},
 "universo_medido":{"mantenimiento":181,"direccion":75,"compras":53,"seguridad":34,"total":343},
 "score_v2":{"contacto_verificado":5,"profepa_vigente":4,"sector_intensivo":2,
   "empleados_201_mas":2,"parque_industrial":1,"multi_contacto":1,"multi_perfil":1},
 "plan_envio":{"contactos":len(seleccion),"toques_por_contacto":3,
   "dias_offset":[0,3,7],"correos_estimados":len(seleccion)*3,
   "regla_multi_contacto":"maximo 3 por empresa, separados 48 horas"},
 "authorization_state":"RESEARCH_ONLY_HOLD","external_effects_executed":False,
 "excluidas":EXCLUIDAS,
 "empresas_priorizadas":empresas,"seleccion_por_ola":seleccion}

p="data/imports/research/target-list-2026-09-03/target-list-v1.json"
open(p,"w").write(json.dumps(art,ensure_ascii=False,indent=2)+"\n")
print(f"empresas: {len(empresas)} | contactos seleccionados: {len(seleccion)} | correos estimados: {len(seleccion)*3}")
from collections import Counter
print("por ola:", dict(Counter(s['ola'] for s in seleccion)))
print("por variante:", dict(Counter(s['perfil'] for s in seleccion)))
print("top 8 por score:")
for e in empresas[:8]: print(f"  {e['score_v2']:2d}  {e['empresa']:34s} {e['contactos_alcanzables']} contactos {e['perfiles']}")
