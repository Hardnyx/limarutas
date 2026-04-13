"""
build_lista_rutas_atu.py

Extrae datos de rutas desde los PDFs de la ATU y los fusiona con
lista_rutas_nuevas.csv (Wikipedia) para producir un CSV maestro completo.

Logica:
  - Wikipedia gana si tiene la ruta (mejor calidad: alias, empresa, color)
  - ATU PDFs como fallback para rutas no cubiertas por Wikipedia
  - Empresa oficial tomada del PRR (PRR_099-2025_equivalencias.pdf)

Uso:
    python3 pipeline/scripts/build_lista_rutas_atu.py

Requiere:
    pipeline/output/lista_rutas_nuevas.csv        (output de scrap_wikipedia_rutas.py)
    docs/paraderos_ATU/Actualizacion del Plan.../ (PDFs de fichas tecnicas ATU)
    docs/paraderos_ATU/PRR_099-2025_equivalencias.pdf (tabla oficial de empresas)

Produce:
    pipeline/output/lista_rutas_maestro.csv
"""

import csv
import re
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, '-m', 'pip', 'install',
                           'pdfplumber', '--break-system-packages', '-q'])
    import pdfplumber


ROOT       = Path('/workspaces/limarutas')
PDF_DIR    = ROOT / 'docs/paraderos_ATU/Actualización del Plan Regulador de Rutas'
WIKI_CSV   = ROOT / 'pipeline/output/lista_rutas_nuevas.csv'
OUT_CSV    = ROOT / 'pipeline/output/lista_rutas_maestro.csv'

PDF_PATTERN = re.compile(r'RUTA_([^_/]+)_(\d{4})(?:_VF)?\.pdf$', re.IGNORECASE)

# Tabla oficial ATU PRR: codigo_nuevo -> empresa_raw
# Fuente: docs/paraderos_ATU/PRR_099-2025_equivalencias.pdf
# Seccion 14 "Cuadro de Equivalencia de Codigo de Ruta" (465 rutas)
PRR_EMPRESAS = {
    '1003': 'TRANSPORTE DE SERVICIOS URBANOS S.A.',
    '1004': 'DOJUSA TRANSPORTES Y SERVICIOS GENERALES S.A',
    '1005': 'TRANSPORTES Y SERVICIOS SANTA CRUZ S.A.',
    '1006': 'IMPULSA PROGRESO S.A.C.',
    '1007': 'EMPRESA DE TRANSP.Y SERVIC.AMANCAES S.A.',
    '1008': 'REALIDAD EXPRESS S.A.C',
    '1009': 'E.T. COMERCIALIZADORA E IMPORTADORA S.A.',
    '1010': 'EMPRESA DE TRANSPORTES MARISCAL RAMON CASTILLA S.A.',
    '1011': 'TRANSLIMA S.A.',
    '1012': 'EMPRESA DE SERVICIOS DE TRANSPORTE UNION NACIONAL S.A.C. ESTUNSAC',
    '1013': 'TRANSLIMA S.A.',
    '1014': 'EMPRESA DE TRANSPORTES Y SERVICIOS CATORCE DE DICIEMBRE S.A.C.',
    '1015': 'EMPRESA DE TRANSPORTE MIGUEL GRAU S. A.',
    '1016': 'BUENA ESTRELLA S.A.C',
    '1017': 'NOVOBUS S.A.C',
    '1018': 'E.T. 11 DE NOVIEMBRE S.A.',
    '1019': 'EMPRESA DE TRANSPORTES PALMARI S.A.',
    '1020': 'E.T. SANTA LUZMILA S.A.',
    '1021': 'INVERSIONES Y SERVICIOS CKF S.A.C.',
    '1022': 'TRANS NORCOM CORPORATION S.A.C',
    '1023': 'EMPRESA DE TRANSPORTES Y SERVICIOS NUEVA AMERICA S.A.',
    '1024': 'EMPRESA DE TRANSPORTE NOR LIMA S.A.',
    '1025': 'E.T. UNIDOS DE PASAJEROS S.A. (ETUPSA 73)',
    '1026': 'E.T. ESPECIAL SOLIDARIDAD S.A.',
    '1027': 'COOP DE TRANSP COMITE CIEN LTDA',
    '1028': 'EMPRESA DE TRANSPORTES 30 DE AGOSTO S.A.',
    '1029': 'E.T. ALIPIO PONCE VASQUEZ S.A.',
    '1030': 'EMPRESA DE TRANSPORTES CORAZON DE JESUS DE SAN DIEGO S.A.',
    '1031': 'TRANSLIMA S.A.',
    '1032': 'EMPRESA DE TRANSPORTES SAN JUAN DE LA CRUZ S.A.C.',
    '1033': 'E.T. DE LUXE S.A.C',
    '1034': 'EMPRESA INDEPENDIENTE DE TRANSPORTES S.A.',
    '1035': 'EMPRESA DE TRANSPORTES Y SERVICIOS ESPECIALES LA BALA S.A.',
    '1036': 'EMPRESA DE TRANSPORTE EL BAJOPONTINO S.A.',
    '1037': 'EMP.DE TRANS.Y SERV.LIMA CHORRILLOS S.A.',
    '1038': 'EMPRESA DE TRANSP.Y SERV.EL PORVENIR S.A',
    '1039': 'E.T. Y SERV. 117 S.A.',
    '1040': 'TRANSPORTES SAN IGNACIO S.A.',
    '1041': 'E.T. SANTA ROSA DE JICAMARCA S.A.',
    '1042': 'E.T. LAS AGUILAS 75 S.A.',
    '1043': 'E.T. CUARENTA INTEGRADA S.A.',
    '1044': 'TRANSPORTES Y SERVICIOS 104 S.A.C.',
    '1045': 'EMPRESA DE TRANSPORTES UNIDOS SOCIEDAD ANONIMA ETUSA',
    '1046': 'TRANSPORT SABINO BANOS S.A.C.',
    '1047': 'EMPRESA DE SERVICIO DE TRANSPORTES 25 DE SETIEMBRE S.A.C.',
    '1048': 'EMPRESA DE TRANSPORTES 12 DE ENERO S.A.',
    '1049': 'E.T. CAMINOS DEL INCA S.A. ETCISA',
    '1050': 'EMPRESA DE TRANSPORTES EL LOBITO S.A.C.',
    '1051': 'EMPRESA DE TRANSPORTES UNIDOS SOCIEDAD ANONIMA ETUSA',
    '1052': 'EMPRESA DE TRANSPORTES HA DE SERVICIOS MULTIPLES DE PROPIETARIOS UNIDOS HUASCAR S.A.',
    '1053': 'E.T. Y SERVICIOS MULTIPLES SUR LIMA S.A.',
    '1054': 'EMPRESA DE TRANSPORTES URBANO LINEA 4 S.A.',
    '1055': 'TRANSPORTES LIMA URBAN COMPANY S.A.',
    '1056': 'E.T. Y SERV. ARCO IRIS S.A',
    '1057': 'E.S.T. SANTA CATALINA S.A.',
    '1058': 'TRANSPORTES HUASCAR S.A.',
    '1059': 'E.S.T. SANTA CATALINA S.A.',
    '1060': 'EMP DE TRANSP Y SERV OCHO SA',
    '1061': 'EMPRESA DE TRANSPORTES Y SERVICIOS PREFERENCIAL M 1 S.A.',
    '1062': 'E.T. LOS CUATRO SUYOS S.A.',
    '1063': 'E.T. Y SERV. MU. LOS MAGNIFICOS S.A. ETYSERMULMA S.A.',
    '1064': 'E.T. SANTA ROSA DE JICAMARCA S.A.',
    '1065': 'EMPRESA DE TRANSPORTES NUEVO HORIZONTE S.A.',
    '1066': 'EMPRESA DE TRANSPORTE Y TURISMO HUAYCAN S.A.',
    '1067': 'EMPRESA DE TRANSPORTES Y SERVICIOS PERALITOS S.A.',
    '1068': 'EMPRESA DE SERVICIOS MULTIPLES NUEVO PERU S.A.',
    '1069': 'EMPRESA DE TRANSPORTES Y SERVICIOS NUEVA ERA SENOR DE MURUHUAY S.A.',
    '1070': 'EMPRESA DE TRANSPORTE BRONCO S.A. ETBRONSA',
    '1071': 'MULTISERVICIOS E INVERSIONES VIRGEN DE COPACABANA S.A.C',
    '1072': 'E.T. UNIDOS SAN MARTIN DE PORRES S.A.',
    '1073': 'EMPRESA DE TRANSPORTES NUESTRA SENORA DEL SAGRADO CORAZON S.A.',
    '1074': 'EMPRESA DE TRANSPORTES MIRAFLORES MONTERRICO S.A.',
    '1075': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAN JUAN BAUTISTA S.A.',
    '1076': 'E.T.SERV.MULT. Y COMERCIALIZACION 14 DE MAYO S.A.C.',
    '1077': 'TRANSPORTES Y SERVICIOS MULTIPLES PERLA DE LOS ANDES S.A.C.',
    '1078': 'EMPRESA DE TRANSPORTES SESENTITRES S.A.',
    '1079': 'E.T. UNIDOS SAN MARTIN DE PORRES S.A.',
    '1080': 'EMPRESA DE TRANSPORTE Y TURISMO HUAYCAN S.A.',
    '1081': 'EMPRESA DE TRANSPORTE URBANO HUAYCAN S.A.C.',
    '1082': 'EMPRESA DE TRANSPORTE ANGAMOS S.A.',
    '1083': 'TRANSPORTES MULTISERVICIOS E INVERSIONES SIN FRONTERAS S.A.C.',
    '1084': 'EMPRESA CONSORCIO DE TRANSPORTES SANTO CRISTO S.A.',
    '1085': 'EMPRESA DE TRANSPORTES CARRETERA CENTRAL S.A.C.',
    '1086': 'E.T.MAGDALENA-SAN MIGUEL S.A.',
    '1087': 'EMPRESA DE TRANSPORTES UNIDOS SOCIEDAD ANONIMA ETUSA',
    '1088': 'SERVICIOS GENERALES Y TRANSPORTES RENACIMIENTO S.A.',
    '1089': 'AGRUP. DE TRANS. EN CAMIONETAS S.A.(A.T.C.R. S.A.)',
    '1090': 'EMPRESA DE TRANSPORTES UNIDOS CHAMA SA',
    '1091': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLES 160 S.A.C',
    '1092': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLES SAN GENARO S.A.',
    '1093': 'E.T. Y SERVICIOS MULTIPLES SUR PRIMERO DE JUNIO S.A.C.',
    '1094': 'EMPRESA DE TRANSPORTES UNIDOS DOCE DE NOVIEMBRE S.A.',
    '1095': 'EMPRESA DE TRANSPORTE SERVICIOS TURISMO E INVERSIONES NORTEAMERICA S.A.C',
    '1096': 'E.T. LUIS BANCHERO ROSSI S.A.',
    '1097': 'E.T. SANTO CRISTO DE PACHACAMILLA S.A.',
    '1098': 'EMPRESA DE TRANSPORTES URBANO LINEA 4 S.A.',
    '1099': 'E.T. LUIS BANCHERO ROSSI S.A.',
    '1100': 'EMPRESA DE TRANSPORTES URBANO LINEA 4 S.A.',
    '1107': 'EMPRESA DE TRANSPORTES MONTENEGRO S.A.C.',
    '1108': 'E.S.T. SANTA CATALINA S.A.',
    '1109': 'E.T. ESFUERZOS UNIDOS S.A.',
    '1110': 'EMPRESA DE TRANSPORTES UNIDOS CHAMA SA',
    '1111': 'E.T. UNIDOS DE PASAJEROS S.A. (ETUPSA 73)',
    '1112': 'RED LIMA MOVIL S.A.',
    '1113': 'TRANSLIMA S.A.',
    '1114': 'EMPRESA DE TRANSPORTES Y SERVICIOS LOS ANGELES DEL PERU S.A.C.',
    '1115': 'EMPRESA DE TRANSP. EXPRESS PACHACAMAC SA',
    '1116': 'E.T. EDILBERTO RAMOS S.A.C.',
    '1117': 'E.T. TABLADA 2000 S.A. (ETTADOSA)',
    '1118': 'COMUN. INTEG.TURIS. Y SERV. URANO TOURS S.A.',
    '1119': 'AGRUP. DE TRANS. EN CAMIONETAS S.A.(A.T.C.R. S.A.)',
    '1120': 'REAL STAR DEL PERU S.A.C.',
    '1121': 'CONSORCIO LINEA 3 S.A.C.',
    '1122': 'LAPSO S.A.',
    '1123': 'EMPRESA DE TRANSPORTES UNIDOS CHAMA SA',
    '1124': 'EMPRESA DE TRANSPORTES EXPRESO TABLADA Y ASOCIADOS S.A.C.',
    '1125': 'EMPRESA DE TRANSPORTES PURCA GRABIEL CORACORA S.A.',
    '1126': 'E.T.S.M. VILLA ALEJANDRO S.A.',
    '1127': 'E.T. Y SERV. MULTIPLES E. ZEVALLOS S.A.',
    '1128': 'CARROCERIAS RIVERA S.A.C.',
    '1129': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAN JUAN DE DIOS S.A.',
    '1130': 'E.T. 11 DE NOVIEMBRE S.A.',
    '1131': 'EMPRESA DE TRANSPORTES Y SERVICIOS VIRGEN DE LA PUERTA S.A.',
    '1132': 'E.T. Y SERVICIOS MULTIPLES SATELITE S.A',
    '1133': 'EMPRESA DE TRANSPORTES SENOR DEL MAR S.A.',
    '1134': 'EMPRESA DE TRANSPORTES Y SERVICIOS ESTRELLA S.A.C.',
    '1135': 'EMPRESA DE TRANSPORTES MARISCAL RAMON CASTILLA S.A.',
    '1136': 'CONSORCIO NUEVA UNION',
    '1137': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAN ANTONIO S.A.',
    '1138': 'MULTISERVICIOS E INVERSIONES CHIM PUM CALLAO S.A.',
    '1139': 'CONSORCIO GRUPO UVITA',
    '1140': 'E.T. S.G. MILAGROSO INMACULADO SENOR CAUTIVO DE AYABACA S.A.',
    '1141': 'EMPRESA DE TRANSPORTE DEL FONDO COLECTIVO DE AYUDA MUTUA S.A.',
    '1142': 'EMPRESA DE TRANSPORTE Y SERVICIOS PROYECTO SIETE S.A.',
    '1143': 'TRANSPORTES CHANQUILINO S.A.C.',
    '1144': 'CONSORCIO NG',
    '1145': 'EMPRESA DE TRANSPORTES Y SERVICIOS CALLAO S.A.',
    '1146': 'EMPRESA DE TRANSPORTES SAN BENITO DE PALERMO S.A.C.',
    '1147': 'EMPRESA DE TRANSPORTES Y SERVICIOS GENERALES COLONIAL S.A.',
    '1148': 'MULTISERVICIOS DE BUSES DE WAYLLUY S.A',
    '1149': 'MULTISERVICIOS DE BUSES DE WAYLLUY S.A',
    '1150': 'EMPRESA DE TRANSPORTES 102 S.A.',
    '1151': 'EMPRESA DE TRANSPORTES MI PERU VENTANILLA S.A.',
    '1152': 'CONSORCIO DE TRANSPORTE Y SERVICIO LIVENTUR',
    '1153': 'EMPRESA DE TRANSPORTES SAN IGNACIO DE LOYOLA S.A.',
    '1154': 'CONSORCIO BRIZA',
    '1155': 'HOLDING REAL EXPRESS',
    '1156': 'EMPRESA DE TRANSPORTES Y SERVICIOS NUEVO REYNOSO S.A.',
    '1157': 'COOP DE SERV ESP.TRANSP.SOL Y MAR LTDA',
    '1158': 'SERVICIO INTERCONECTADO DE TRANSPORTE S.A.C.',
    '1159': 'TRANSLIMA S.A.',
    '1160': 'MULTISERVICIOS E INVERSIONES CHIM PUM CALLAO S.A.',
    '1161': 'EMPRESA DE TRANSPORTES VICTOR RAUL HAYA DE LA TORRE S.A.',
    '1162': 'CONSORCIO BRIZA',
    '1163': 'CORPORACION ALELUYA S.A.C.',
    '1164': 'COOPERATIVA DE TRANSPORTES CORAZON DE JESUS LTDA.',
    '1165': 'CONSORCIO BRIZA',
    '1166': 'VIA BUS S.A.C.',
    '1167': 'CONSORCIO BRIZA',
    '1168': 'GRUPO AUTOMOTOR UNO S.A.C.',
    '1169': 'TRANSPORTES Y SERVICIOS CIELO MAR Y TIERRA S.A.',
    '1170': 'PERLA ARGENTINA S.A.',
    '1171': 'CONSORCIO SANTA BARBARA S.A.',
    '1172': 'CORPORACION ETUNIJESA S.A.C.',
    '1173': 'CONSORCIO MOVIL EXPRESS S.A.C.',
    '1174': 'CORPORACION INVERSIONES LOS ANGELES DEL PERU SA.',
    '1175': 'EMP. DE TRANSPORTES PEGASSO EXPRESS S.A.',
    '1176': 'E.T. VIRGEN DE LA PUERTA S.A.',
    '1177': 'TRANSPORTES CRUZ DEL CENTRO S.A.',
    '1178': 'EMP. DE TRANSPORTES LA ENCANTADA S.A.',
    '1179': 'EMPRESA DE TRANSPORTE TURISMO E INVERSIONES SENOR DE LA SOLEDAD S.A.C',
    '1180': 'EMPRESA DE TRANSPORTES Y SERVICIOS NUEVA AMERICA S.A.',
    '1181': 'EMPRESA DE TRANSPORTES PERU S.A.',
    '1182': 'CORDOVA & PAUCAR INVERSIONISTAS S.A.C.',
    '1183': 'COMUN. INTEG.TURIS. Y SERV. URANO TOURS S.A.',
    '1184': 'E.T. EDILBERTO RAMOS S.A.C.',
    '1185': 'EMPRESA DE TRANSPORTES URBANOS LOS CHINOS S.A.',
    '1187': 'EMPRESA DE TRANSPORTES Y SERVICIOS SENOR DE NAZARENO S.A.C.',
    '1189': 'EMPRESA DE TRANSPORTE Y SERVICIOS EL INTI S.A.',
    '1190': 'EMPRESA DE SERVICIOS Y TRANSPORTES INVERSIONES EL RAPIDO S.A',
    '1191': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLE LOS EXCELENTES UNIDOS S.A.',
    '1192': 'EMPRESA DE TRANSPORTES Y SERVICIOS EL SOL DE SANTA CLARA S.A.',
    '1193': 'E.T. VIRGEN DE LA CONCEPCION S.A. ETVIRCO',
    '1194': 'EMPRESA VIRGEN DE FATIMA S.A.',
    '1195': 'EMPRESA DE TRANSP Y SERVIC EL RAPIDO S.A',
    '1196': 'TRANSPORTES CRUZ DEL CENTRO S.A.',
    '1197': 'EMP.DE TRANSP DIECISIETE DE JUNIO S.A',
    '1199': 'E.T. 36 SAN MARTIN DE PORRES S.A.',
    '1200': 'TRANSPORTES INGARUCA S.A.C.',
    '1203': 'TRANSPORTES E INVERSIONES SAN GERMAN S.A.',
    '1204': 'E.T. Y SERV. HUANCAYO CITY S.A.',
    '1205': 'VARGASANT S.A.C.',
    '1207': 'EMP. DE TRANSP. Y SERV. LA HUAYRONA S.A.',
    '1210': 'SAN FELIPE EXPRESS S.A.',
    '1214': 'EMPRESA DE TRANSPORTES VIRGEN DE LA ASUNCION S.A.',
    '1218': 'EMPRESA DE TRANSPORTES Y SERV. LIMA CHOSICA S.A.',
    '1219': 'VARGASANT S.A.C.',
    '1220': 'EMPRESA DE TRANSPORTES Y SERVICIOS PERALITOS S.A.',
    '1221': 'EMPRESA DE TRANSPORTES Y SERVICIOS LOS EXPERTOS Y SOMOS MAS S.A',
    '1222': 'EMPRESA DE TRANSPORTE Y SERVICIOS SAN CRISTOBAL PALCAMAYO S.A.',
    '1223': 'TRANSPORTES PESQUEROS S.A.',
    '1224': 'EMPRESA DE TRANSPORTES GOCARIVE 19 S.A.',
    '1225': 'E.T.ALAMO EXPRESS S.A.',
    '1226': 'EMPRESA DE TRANSPORTES EL CARMEN DE LA PUNTA S.A.',
    '1227': 'E.T. Y SERV. ALMIRANTE MIGUEL GRAU S.A.',
    '1228': 'EMPRESA DE TRANSPORTES Y SERVICIOS SANTA ROSA DE LIMA S.A.',
    '1229': 'E.T. PROCERES S.A.',
    '1230': 'EMPRESA DE SERVICIOS MULTIPLES FENIX 2000 S.A.',
    '1231': 'EMPRESA DE TRANSPORTES MACHU PICHU S.A.',
    '1232': 'EMPRESA DE TRANSPORTES SAN JUAN DE LA CRUZ S.A.C.',
    '1233': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAN PEDRO DE PAMPLONA S.A.',
    '1234': 'EMPRESA DE TRANSPORTES LA UNIDAD DE VILLA S.A.',
    '1235': 'E. T. SALAMANCA-PARRAL S.A.',
    '1236': 'EMP.DE TRANSPORTES Y MULTISERVICIOS IMPORTADORA Y EXPORTADORA SAN FRANCISCO DE ASIS DE LOS OLIVOS SA',
    '1237': 'EMPRESA DE TRANSP Y SERVIC EL RAPIDO S.A',
    '1238': 'SAN FELIPE EXPRESS S.A.',
    '1239': 'EMPRESA DE SERV. MULTIPLES EL CONDOR S.A.',
    '1240': 'EMPRESA DE TRANSPORTES Y SERVICIOS VIRGEN DE LA PUERTA S.A.',
    '1241': 'EMPRESA DE TRANSPORTES ROLUESA S.A.C.',
    '1242': 'EMPRESA DE SERVICIOS MULTIPLES NUEVO PERU S.A.',
    '1243': 'TRANS NORCOM CORPORATION S.A.C',
    '1244': 'E.T. UNIDOS DE PASAJEROS S.A. (ETUPSA 73)',
    '1245': 'E.S.E.T. SAN JUDAS TADEO S.A.',
    '1246': 'E.T. SIMON BOLIVAR S.A.',
    '1247': 'E.T. SUR EXPRESS S.A.',
    '1248': 'REAL STAR DEL PERU S.A.C.',
    '1249': 'EMPRESA DE TRANSPORTES Y SERVICIOS SALVADOR S.A.C.',
    '1250': 'TRANSPORTES RAPIDO UNIVERSAL S.A.C',
    '1251': 'E.T. Y SERV. SAN JOSE S.A.',
    '1252': 'E.S.E.T. SAN JUDAS TADEO S.A.',
    '1253': 'EMPRESA DE TRANSPORTES Y SERVICIOS GUADULFO SILVA CARBAJAL S.A',
    '1254': 'EMPRESA DE TRANSPORTES Y SERVICIOS GUADULFO SILVA CARBAJAL S.A',
    '1255': 'EMPRESA DE TRANSPORTES CAPITALES PERUANOS S.A',
    '1256': 'EMPRESA BUSINESS CORPORATION MILENIUM S.A.C.',
    '1257': 'EMPRESA DE TRANSPORTES DE SERVICIO URBANO 26 DE MAYO S.A.',
    '1258': 'E.T. LAS FLORES S.A.',
    '1259': 'GRUPO AUTOMOTOR UNO S.A.C.',
    '1260': 'INVERSIONES Y REPRESENTACIONES POLO S.A.C.',
    '1261': 'EMPRESA DE TRANSPORTES FEDERICO VILLAREAL S.A.',
    '1262': 'EMPRESA DE TRANSPORTES 41 S.A.',
    '1263': 'E.T. LOS MILAGROS DEL SENOR DE PACHACAMILLA S.A.',
    '1264': 'EMPRESA DE TRANSPORTES MIRAFLORES MONTERRICO S.A.',
    '1265': 'TRANSPORTES HOGAR TOURS S.A.',
    '1266': 'GRUPO LIMA EXPRESS',
    '1267': 'EMPRESA DE TRANSPORTES SERVICIO Y COMERCIALIZACION EXPRESO SANTA ANITA S.A.',
    '1268': 'EMPRESA DE TRANSPORTES Y SERV. EL ALAMO DE SANTA ROSA S.A.',
    '1269': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLE LOS EXCELENTES UNIDOS S.A.',
    '1270': 'EMPRESA DE TRANSPORTES ANGAMOS S.A.',
    '1271': 'EMPRESA DE TRANSPORTES CALIFORNIA 2000 S.A.',
    '1272': 'EMPRESA DE TRANSPORTES VEINTIDOS S.R.L.',
    '1273': 'EMPRESA DE TRANSPORTES IJECORPJYL S.A.',
    '1274': 'EMPRESA DE TRANSPORTES TORO S.R.L.',
    '1275': 'EMPRESA DE TRANSPORTES Y SERV. MULT. GRUPO DIEZ S.A.C.',
    '1276': 'EMPRESA DE TRANSPORTES Y TURISMO STAR TOURS S.A.C.',
    '1277': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLES CALIFORNIA S.A.C.',
    '1278': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLES REY 505 S.A.',
    '1279': 'TRANSPORTES Y SERVICE CANADA S.A.',
    '1280': 'EMPRESA E INVERSIONES GENESIS S.A.C.',
    '1281': 'TRANSPORTES Y SERVICE CANADA S.A.',
    '1282': 'EMPRESA DE TRANSPORTES Y SERVICIOS PACIFIC INTERNATIONAL S.A.',
    '1283': 'CONSORCIO DE TRANSPORTE PROYECTO LAS FLORES',
    '1284': 'EMPRESA DE TRANSPORTES TREINTITRES S.A.',
    '1285': 'TRANSPORTES PESQUEROS S.A.',
    '1286': 'TRANSPORTES HUASCAR S.A.',
    '1287': 'TRANSPORTE GROUP TIGRILLO S.A.C.',
    '1288': 'EMPRESA DE TRANSPORTES UNIDOS VITARTE S.A.',
    '1289': 'STARLET CONSORCIO S.A.',
    '1290': 'EMPRESA DE TRANSPORTES VIRGEN DE LA ASUNCION S.A.',
    '1291': 'HOLDING REAL EXPRESS',
    '1292': 'EMPRESA DE TRANSPORTES Y TURISMO CALIFORNIA SIGLO XXI S.A.C.',
    '1293': 'HOLDING REAL EXPRESS',
    '1294': 'HOLDING REAL EXPRESS',
    '1295': 'EMPRESA DE TRANSPORTES SERVICIOS Y TURISMO EUREKS S.A.C.',
    '1296': 'HOLDING REAL EXPRESS',
    '1297': 'HOLDING REAL EXPRESS',
    '1298': 'HOLDING REAL EXPRESS',
    '1299': 'EMP.D TRNSP.,SV.Y COM.GALILEA EXPRESS SA',
    '1300': 'CONSORCIO ROMA',
    '1301': 'EMPRESA DE TRANSPORTE PUBLICO EL MIRADOR S.A.C.',
    '1302': 'TRANSPORTES HUASCAR S.A.',
    '1303': 'EXPRESO NUEVA LIMA S.A.C',
    '1304': 'C.T.I. CORPORACION SAC.',
    '1305': 'EMPRESA DE TRANSPORTES EL CARMEN DE LA PUNTA S.A.',
    '1307': 'EMPRESA DE TRANSPORTES Y TURISMO CALIFORNIA SIGLO XXI S.A.C.',
    '1309': 'HOLDING REAL EXPRESS',
    '1310': 'HOLDING REAL EXPRESS',
    '1311': 'HOLDING REAL EXPRESS',
    '1312': 'EMPRESA DE TRANSPORTES Y SERVICIOS LA MAR S.A.C.',
    '1313': 'EMPRESA DE TRANSPORTES SENOR DEL MAR S.A.',
    '1314': 'CONSORCIO DE TRANSPORTE TRANSCASTEL',
    '1315': 'HOLDING REAL EXPRESS',
    '1316': 'CONSORCIO ROMA',
    '1317': 'C.T.I. CORPORACION SAC.',
    '1318': 'CONSORCIO SALAMANCA S.A.C.',
    '1319': 'EMPRESA DE TRANSPORTES PACHACUTEC INTERNACIONAL S.A.',
    '1320': 'E.T.S. 22 DE OCTUBRE DE LADERAS DE CHILLON S.A.',
    '1321': 'E.T.SANTA ROSITA DE QUIVES S.A.',
    '1322': 'EMPRESA DE TRANSPORTE Y TURISMOS ESPECIALES MANUEL PRADO S.A.',
    '1323': 'E.T. TRANSMILENIO PUENTE PIEDRA S.A.',
    '1324': 'EMPRESA DE TRANSPORTE TODO LO PUEDO EN CRISTO S.A.C.',
    '1325': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLES LOMAS DE ZAPALLAL S.A.',
    '1326': 'RAPIDO INVERSIONES S.A.',
    '1327': 'E.T. Y SERV. EL RETABLO S.A.C.',
    '1328': 'EMPRESA DE TRANSPORTES ENSENADA CHILLON S.A. ETECHSA',
    '1329': 'EMPRESA DE TRANSPORTE 26 JILGUEROS DE LOS ANDES S.A.C.',
    '1330': 'CONSORCIO GOMEZ S.A.',
    '1335': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAN FELIPE S.A.',
    '1336': 'EMPRESA DE TRANSPORTE NOR LIMA S.A.',
    '1337': 'J.C. BUS S.A.C.',
    '1338': 'CONSORCIO VIA S.A.C.',
    '1339': 'E.T. BELAUNDE OESTE S.A.',
    '1340': 'E.T. Y SERVICIOS UNIDOS PARA TRIUNFAR S.A.',
    '1341': 'E.T. SANTA ROSA DE JICAMARCA S.A.',
    '1342': 'TRANSPORTES VARA S.A.',
    '1343': 'TRANSPORTES NEGOCIACIONES SANTA ANITA S.A.',
    '1344': 'TRANSPORTES NEGOCIACIONES SANTA ANITA S.A.',
    '1345': 'E.T. Y TURISMO CINCO ESTRELLAS S.A.',
    '1346': 'EMPRESA DE TRANSPORTE NUEVO SAN JUAN S.A',
    '1347': 'EMPRESA DE TRANSPORTES 102 S.A.',
    '1348': 'JERRBUS S.A.C.',
    '1349': 'EMPRESA BECAMI S.A.C.',
    '1350': 'COMUN. INTEG.TURIS. Y SERV. URANO TOURS S.A.',
    '1351': 'VARANT S.A.C.',
    '1352': 'E. T. T. NUEVO AMANECER S.A.C.',
    '1353': 'EMPRESA DE TRANSPORTE IMPORTACIONES Y SERVICIOS H2 S.A.C.',
    '1354': 'E.T. Y SERV. EL TRIUNFO 119 S.A.',
    '1355': 'CRUZ DE NAZARENO S.A.',
    '1356': 'TRANSPORTES PREMIER EL NAZARENO S.A.',
    '1357': 'EMP. DE TRANSP. TUR. Y SERV. CONSTRUCTORES S.A. ETRANSCO',
    '1358': 'EMPRESA DE TRANSPORTE URBANO EL MOLINERO EXPRESS S.A.',
    '1359': 'AGRUP. DE TRANS. EN CAMIONETAS S.A.(A.T.C.R. S.A.)',
    '1360': 'EMPRESA DE TRANSPORTE RAPIDO MUSA S.A',
    '1361': 'INVERSIONES EMPRESARIALES NUEVO AMANECER S.A.C.',
    '1362': 'INVERSIONES RIMARZ S.A.C.',
    '1363': 'EMPRESA DE TRANSPORTES MULTIPLES SAN PABLO S.A.C.',
    '1364': 'TRANSPORTE UNIVERSAL Y MULTIPLES INVERSIONES S.A.',
    '1365': 'EMPRESA DE TRANSPORTES NANA S.A.',
    '1366': 'SERVICIO MULTIPLES E INVERSIONES NIEVERIA S.A.C',
    '1367': 'COMUN. INTEG.TURIS. Y SERV. URANO TOURS S.A.',
    '1368': 'EMPRESA DE TRANSPORTES E INVERSIONES MULTIPLES CHACARILLA TOUR S.A.C.',
    '1369': 'EMPRESA DE TRANSPORTES TUMI S.A.',
    '1370': 'E.T. Y TURISMO SANTA ANITA S.R.L.',
    '1371': 'E.T. SERV. COMER. SOL DE AMAUTA S.A.',
    '1372': 'EMPRESA DE TRANSPORTES TUMI SIGLO XXI S.A.',
    '1373': 'ROMYJOIV S.A.',
    '1374': 'LEVARO S.A.C.',
    '1375': 'EMPRESA DE TRANSPORTES Y SERVICIOS GALINDO HNOS S.A.C.',
    '1376': 'EMPRESA DE SERVICIO DE TRANSPORTISTAS JOSE OLAYA S.A.',
    '1377': 'TRANSLIMA S.A.',
    '1378': 'E.T.TURISMO SAN JUANITO S.A',
    '1379': 'PREFERENCIAL SAN JUANITO S.A.C.',
    '1380': 'E.T. TABLADA S.A.',
    '1381': 'EMPRESA DE TRANSPORTES UNIDOS DOCE DE NOVIEMBRE S.A.',
    '1382': 'E.T.COMER.E IMPOR.MARTIR OLAYA S.A.',
    '1383': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLES SAN GENARO S.A.',
    '1384': 'EMPRESA DE TRANSPORTES LA UNIDAD DE VILLA S.A.',
    '1385': 'TRANSPORTES Y SERVICE CANADA S.A.',
    '1386': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLES SAN GENARO S.A.',
    '1387': 'E.S.T. SAN JUAN S.A.',
    '1388': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAN PEDRO DE PAMPLONA S.A.',
    '1389': 'E.S.T. SAN JUAN S.A.',
    '1390': 'EMPRESA DE TRANSPORTES VIRTUAL EXPRESS S.A.',
    '1391': 'E.T.TURISMO SAN JUANITO S.A',
    '1392': 'EMPRESA DE TRANSPORTE IMAGEN DE JESUS S.A.',
    '1393': 'LIDER PAMPLONA ALTA S.A.',
    '1394': 'EMPRESA DE TRANSPORTES Y SERVICIOS 18 DE ENERO S.A.',
    '1395': 'EMPRESA DE SERVICIOS MULTIPLES LOS LAURELES DE MANCHAY S.A.',
    '1396': 'EMPRESA DE TRANSPORTES TURISMO EL MARQUEZ S.A.',
    '1397': 'TRANSPORTES E INVERSIONES ROSHEDI S.A.C.',
    '1398': 'EMPRESA DE TRANSPORTES Y SERVICIOS VIRGENCITA DE PACHACAMAC S.A.',
    '1399': 'E.T.TURISMO SAN JUANITO S.A',
    '1400': 'PREFERENCIAL SAN JUANITO S.A.C.',
    '1401': 'EMPRESA DE TRANSPORTE UNION SAN JUANITO S.A.',
    '1405': 'EMPRESA DE TRANSPORTES JOSE GALVEZ S.A.',
    '1406': 'EMPRESA DE TRANSPORTE KID GALAHAD S.A.',
    '1407': 'INVERSIONES Y SERVICIOS NOVOA S.A.C.',
    '1408': 'E.T.Y SERV.MULTIPLES TALIA S.A.C',
    '1409': 'EMPRESA DE TRANSPORTES JOSE GALVEZ S.A.',
    '1410': 'EMPRESA DE TRANSPORTES TRABAJADORES CORAJE S.A.',
    '1413': 'EMPRESA DE TRANSPORTES CORAZON VALIENTE S.A.',
    '1414': 'TRAGEPSA S.A.',
    '1415': 'EMPRESA DE TRANSPORTES SAN PEDRO DE LURIN S.A.',
    '1416': 'E.T. Y SERV. SANTA CRUZ DE PUNTA HERMOSA S.A.',
    '1417': 'TRANSPORTE INVERSIONES MULTIPLICANDO ESPERANZAS SAC',
    '1418': 'TRANSPORTES & INVERSIONES LAS NUEVAS ESPERANZAS S.A.',
    '1419': 'E.T. TABLADA S.A.',
    '1420': 'EMPRESA DE TRANSPORTES MULTISERVICIOS OVNI S.A.',
    '1421': 'EMPRESA MODELO DE TRANSPORTES LATINOAMERICA S.A.',
    '1422': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAN ANTONIO S.A.',
    '1423': 'EMPRESA DE TRANSPORTES SAN JOSE S.A.',
    '1424': 'EMPRESA DE TRANSPORTES ROSARIO DE SANTA MARIA S.A.C.',
    '1425': 'EMPRESA DE SERVICIOS DE TRANSPORTES COMAS EXPRESS S.A.',
    '1426': 'CONSORCIO DE TRANSPORTE Y SERVICIO LIVENTUR',
    '1427': 'CONSORCIO DE TRANSPORTE Y SERVICIO LIVENTUR',
    '1428': 'EMPRESA DE TRANSPORTES RAPIDO CORRE CAMINOS S.A.',
    '1429': 'EMPRESA DE TRANSPORTES MULTISERVICIOS OVNI S.A.',
    '1430': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAN FELIPE S.A.',
    '1431': 'CONSORCIO 4S',
    '1432': 'EMPRESA DE TRANSPORTES LIDER S.R.L.',
    '1433': 'EMPRESA DE TRANSPORTES Y SERVICIOS RAPIDO MARCOS S.A.',
    '1434': 'LEVI EXPRESS DE TRANSPORTES S.A.',
    '1435': 'EMPRESA DE TRANSPORTES Y SERVICIOS NUEVA AMERICA S.A.',
    '1436': 'EMPRESA DE TRANSPORTES Y SERVICIOS SAGRADO CORAZON DE COLLIQUE S.A.C.',
    '1437': 'CONSORCIO HAYDEE ALFARO MONTUFAR S.A.C',
    '1438': 'COOP DE SERV ESP.TRANSP.SOL Y MAR LTDA',
    '1439': 'EMPRESA DE TRANSPORTES RAPIDO RAMON CASTILLA S.A.',
    '1440': 'CONSORCIO BRIZA',
    '1441': 'CONSORCIO BRIZA',
    '1442': 'CORPORACION AVAGON S.A.C.',
    '1443': 'EMPRESA DE TRANSPORTES Y SERVICIOS MULTIPLES CALIFORNIA S.A.C.',
    '1444': 'CONSORCIO GRUPO UVITA',
    '1445': 'CORPORACION AVAGON S.A.C.',
    '1446': 'EMPRESA DE TRANSPORTES CRUZ DE MOTUPE S.A.C.',
    '1447': 'EMPRESA DE TRANSPORTES SAN BENITO DE PALERMO S.A.C.',
    '1448': 'CONSORCIO DE TRANSPORTE KILMER',
    '1449': 'EMPRESA DE TRANSPORTES SERVICIO RAPIDO SANTA MARINA S.A.C.',
    '1450': 'EMPRESA DE TRANSPORTES SERVICIO RAPIDO SANTA MARINA S.A.C.',
    '1451': 'LA ESPERANZA TRANSPORTES Y SERVICIOS S.A.',
    '1452': 'LA ESPERANZA TRANSPORTES Y SERVICIOS S.A.',
    '1453': 'EMPRESA LA PERLA S.A.',
    '1454': 'EMPRESA DE TRANSPORTE RAPIDO VENTANILLA CALLAO S.A.',
    '1455': 'CONSORCIO SATELITE TRANSPORT GROUP',
    '1456': 'EMPRESA DE TRANSPORTE RAPIDO VENTANILLA CALLAO S.A.',
    '1457': 'CONSORCIO DE TRANSPORTES ARIES S.A.',
    '1458': 'EMPRESA DE TRANSPORTES ACOR S.A.C.',
    '1459': 'MULTISERVICIOS E INVERSIONES MI DIVINO SAN SALVADOR S.A.C.',
    '1460': 'MULTISERVICIOS E INVERSIONES MI DIVINO SAN SALVADOR S.A.C.',
    '1461': 'E.T. Y SERV. JUAN PABLO S.A. EMJUPASA',
    '1462': 'EMPRESA HUANDOY S.A.',
    '1463': 'E.T.S. SAN JUAN NUMERO CIENTO OCHO S.A.',
    '1464': 'RED LIMA MOVIL S.A.',
    '1465': 'EMPRESA DE TRANSPORTES Y SERVICIOS GUADULFO SILVA CARBAJAL S.A',
    '1466': 'E.S.E.T. SAN JUDAS TADEO S.A.',
    '1467': 'ROYAL EXPRESS S.A.',
    '1468': 'EMPRESA DE TRANSPORTES Y SERVICIOS VIRGEN DE LA PUERTA S.A.',
    '1469': 'EMPRESA VIRGEN DE FATIMA S.A.',
    '1470': 'EMPRESA DE TRANSPORTE Y SERVICIO MULTIPLE RUMI S.A.',
    '1471': 'LINEA PERUANA DE TRANSPORTES S.A. LIPETSA.',
    '1472': 'EMPRESA DE TRANSPORTES SOL DE ORO S.A.C.',
    '1473': 'EMPRESA DE TRANSPORTES EL CARMEN S.A.',
    '1474': 'EMPRESA DE TRANSPORTES CHABAQUITO S.A.C.',
    '1475': 'EMPRESA DE TRANSPORTES COLONIAL S.A.',
    '1476': 'EMPRESA DE TRANSPORTES SOL DE ORO S.A.C.',
    '1477': 'VISHENZO INVESTMENT COMPANY 505 S.A.C.',
    '1478': 'EXPRESSO DOCE S.A.C.',
    '1479': 'EMPRESA DE TRANSPORTES 78 S.A.',
    '1480': 'EMPRESA DE TRANSPORTES Y REPRESENTACIONES SARITA COLONIA Y VILLA SOL S.A.',
    '1481': 'EMPRESA DE TRANSPORTES PATRON SAN SEBASTIAN S.A.C.',
    '1482': 'EMPRESA DE TRANSPORTE Y SERVICIOS MULTIPLES AQUARIUS EXPRESS S.A.C.',
    '1483': 'EMPRESA DE TRANSPORTES LA UNIDAD DE VILLA S.A.',
    '1484': 'E.T. MILAGROSA VIRGEN DEL CARMEN DE LURIN S.A.',
    '1485': 'EMPRESA DE TRANSPORTES LA UNIDAD DE VILLA S.A.',
    '1486': 'EMPRESA DE TRANSPORTE URBANO MARIATEGUI S.A.',
    '1487': 'E.T. ESFUERZOS UNIDOS S.A.',
    '1488': 'TRANSPORTES INVERSIONES NUEVA GALAXIA',
    '1489': 'EMPRESA DE TRANSPORTES Y SERVICIOS LOS ALIZOS S.A.',
    '1490': 'EMPRESA DE TRANSPORTES ESPECIAL SOLIDARIDAD S.A.',
    '1491': 'CONSORCIO GRUPO SALAMANCA S.A.',
    '1492': 'EMPRESA DE TRANSPORTES Y SERVICIOS SALVADOR S.A.C.',
}


# ── Normalización de empresa (misma lógica que scrap_wikipedia_rutas.py) ──────

PREFIJOS = [
    r'Corporaci[oó]n Empresa de Transportes Urbano',
    r'Corporaci[oó]n Inversiones',
    r'Corporaci[oó]n',
    r'Cooperativa de Servicios Especiales Transportes',
    r'Cooperativa de Transportes',
    r'Cooperativa de Transporte',
    r'Comunicaci[oó]n Integral Turismo e Inversiones',
    r'Agrupaci[oó]n de Transportistas en Camionetas\s+S\.?A\.?C?\.?',
    r'Agrupaci[oó]n de Transportistas en Camionetas',
    r'Empresa de Servicios y Transportes',
    r'Empresa de Servicios de Transportes',
    r'Empresa de Servicios de Transporte',
    r'Empresa de Servicios M[uú]ltiples',
    r'Empresa de Servicio Especial de Transporte',
    r'Empresa de Transportes,?\s+Servicios,?\s+Comercializadora,.+',
    r'Empresa de Transportes,?\s+Inversiones y Servicios',
    r'Empresa de Transporte,?\s+Servicios\s+y\s+Comercializaci[oó]n',
    r'Empresa de Transporte\s+de\s+Servicio\s+de\s+Transportes',
    r'Empresa de Transporte\s+de\s+Servicio',
    r'Empresa de Transporte\s+y\s+Turismos?\s+Especiales',
    r'Empresa de Transporte\s+y\s+Turismos?',
    r'Empresa de Transportes y Servicios M[uú]ltiples',
    r'Empresa de Transportes y Servicios',
    r'Empresa de Transportes',
    r'Empresa de Transporte y Servicios',
    r'Empresa de Transporte',
    r'Empresa Business Corporation',
    r'Empresa Modelo de Transportes',
    r'Empresa',
    r'Grupo Express del Per[uú]\s+S\.?A\.?C?\.?',
    r'Grupo',
    r'Multiservicios de Buses de',
    r'Multiservicios e Inversiones',
    r'Inversiones\s+Empresariales',
    r'Inversiones y Servicios M[uú]ltiples',
    r'Inversiones y Servicios',
    r'Inversiones\s+Empresa\s+de\s+Transportes',
    r'Servicios Generales y Transportes',
    r'Servicio Interconectado de Transporte',
    r'Transportes e Inversiones',
    r'Transportes y Servicios M[uú]ltiples',
    r'Transportes y Servicios',
    r'Transportes,?\s+Inversiones y Servicios',
    r'Transportes',
    r'Trans\.',
    r'y\s+Representaciones',
    r'y\s+Multiservicios',
    r'y\s+Service\b',
    r'e\s+Inversiones\s+M[uú]ltiples',
    r'y\s+Turismos?\b',
    r'de\s+Multiservicios',
    r'de\s+Servicio\s+R[aá]pido',
    r'de\s+Servicio\s+Urbano',
    r'de\s+Servicios\s+Urbanos',
    r'de\s+Transportes?,\s+Servicios.+',
    r'de\s+Transportes?,\s+Inversiones.+',
    r'de\s+Transporte,\s+Servicios.+',
]

SUFIJOS_JURIDICOS = re.compile(
    r'\s*\b(S\.A\.C\.|S\.A\.|S\.A\b|E\.I\.R\.L\.|EIRL|Ltda\.|Ltda|S\.R\.L\.)\s*$',
    re.IGNORECASE
)

INICIO_RESIDUAL = re.compile(
    r'^(del?\s+|de\s+los\s+|de\s+las\s+|y\s+|e\s+)',
    re.IGNORECASE
)


def extraer_abrev(texto):
    m = re.search(r'\(([A-Z][A-Z0-9\s\-]{0,14})\)\s*$', texto)
    return m.group(1).strip() if m else ''


def limpiar_empresa(texto_raw):
    if not texto_raw or texto_raw.strip() in ('', 'Desconocido'):
        return 'Desconocido', ''
    texto = texto_raw.strip().split('/')[0].strip()
    texto = re.sub(r'\s*\([^)]{16,}\)', '', texto).strip()
    abrev = extraer_abrev(texto)
    texto = re.sub(r'\s*\([A-Z][A-Z0-9\s\-]{0,14}\)\s*$', '', texto).strip()
    texto = SUFIJOS_JURIDICOS.sub('', texto).strip()
    for prefijo in PREFIJOS:
        nuevo = re.sub(r'^\s*' + prefijo + r'\s*', '', texto, flags=re.IGNORECASE)
        if nuevo != texto:
            texto = nuevo.strip()
            break
    texto = SUFIJOS_JURIDICOS.sub('', texto).strip()
    texto = INICIO_RESIDUAL.sub('', texto).strip()
    texto = SUFIJOS_JURIDICOS.sub('', texto).strip()
    if not texto and abrev:
        return abrev, abrev
    return (texto if texto else 'Desconocido'), abrev


# Normalizar PRR_EMPRESAS al cargarse
PRR_EMPRESAS_NORM = {
    cod: limpiar_empresa(nombre)[0]
    for cod, nombre in PRR_EMPRESAS.items()
}


# Banco de colores placeholder para rutas sin color oficial.
# Tonos steel-blue/slate muted, L=35-52%: visibles en mapa claro y oscuro.
# Se asignan por codigo_nuevo % N para consistencia entre corridas.
COLORES_PLACEHOLDER = [
    '#3D6B7A',
    '#4A7A8A',
    '#527585',
    '#5C8FA0',
    '#4F7F90',
    '#6595A5',
    '#3A6878',
    '#608090',
    '#456878',
    '#5A8595',
]


def color_placeholder(codigo_nuevo):
    try:
        idx = int(codigo_nuevo) % len(COLORES_PLACEHOLDER)
        return COLORES_PLACEHOLDER[idx]
    except (ValueError, TypeError):
        return COLORES_PLACEHOLDER[0]




def leer_pdf(filepath):
    """Extrae cod_antiguo, cod_nuevo, origen, destino desde un PDF suelto."""
    filepath = Path(filepath)
    m = PDF_PATTERN.search(filepath.name)
    if not m:
        return None
    cod_antiguo = m.group(1)
    cod_nuevo   = m.group(2)

    try:
        texto = ''
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                texto += (page.extract_text() or '') + '\n'
    except Exception:
        return {
            'codigo_antiguo':    cod_antiguo,
            'codigo_nuevo':      cod_nuevo,
            'distrito_origen':   '',
            'distrito_destino':  '',
            'empresa_operadora': 'Desconocido',
            'empresa_abrev':     '',
            'alias':             'Desconocido',
            'color_hex':         color_placeholder(cod_nuevo),
            'fuente':            'atu_zip_error',
        }

    origen  = re.search(r'DISTRITO DE ORIGEN\s*:\s*(.+)',  texto)
    destino = re.search(r'DISTRITO DE DESTINO\s*:\s*(.+)', texto)

    return {
        'codigo_antiguo':    cod_antiguo,
        'codigo_nuevo':      cod_nuevo,
        'distrito_origen':   origen.group(1).strip().title()  if origen  else '',
        'distrito_destino':  destino.group(1).strip().title() if destino else '',
        'empresa_operadora': PRR_EMPRESAS_NORM.get(cod_nuevo, 'Desconocido'),
        'empresa_abrev':     '',
        'alias':             'Desconocido',
        'color_hex':         color_placeholder(cod_nuevo),
        'fuente':            'atu_pdf',
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    # 1. Cargar Wikipedia (fuente principal)
    wiki = {}
    with open(WIKI_CSV, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            wiki[row['codigo_nuevo']] = row

    print(f'Rutas desde Wikipedia:  {len(wiki)}')

    # 2. Leer PDFs del directorio ATU
    print(f'Leyendo PDFs desde: {PDF_DIR}')
    atu = {}
    archivos = sorted(PDF_DIR.glob('RUTA_*.pdf'))
    print(f'PDFs encontrados: {len(archivos)}')
    for filepath in archivos:
        row = leer_pdf(filepath)
        if row:
            cod = row['codigo_nuevo']
            if cod not in atu:
                atu[cod] = row
            print(f'  {cod} ({row["codigo_antiguo"]}) [{row["fuente"]}] '
                  f'| {row["distrito_origen"]} -> {row["distrito_destino"]}')

    print(f'\nRutas desde ATU zip:    {len(atu)}')

    # 3. Fusionar: Wikipedia gana, ATU zip como fallback
    maestro = {}

    # Primero todas las de ATU zip (base)
    for cod, row in atu.items():
        maestro[cod] = dict(row)

    # Luego Wikipedia sobreescribe (tiene mejor calidad)
    for cod, row in wiki.items():
        entrada = dict(row)
        entrada['fuente'] = 'wikipedia'
        maestro[cod] = entrada

    # 4. Aplicar overrides manuales conocidos
    overrides = {
        '1001': {'empresa_operadora': 'Tablada 2000', 'empresa_abrev': 'ETTADOSA',
                 'alias': 'La Tablada', 'color_hex': '#2E7D32'},  # verde bosque
        '1002': {'empresa_operadora': 'Urano Tours', 'empresa_abrev': '',
                 'alias': 'La U', 'color_hex': '#66BB6A'},  # verde claro
    }
    for cod, vals in overrides.items():
        if cod in maestro:
            maestro[cod].update(vals)

    # 5. Ordenar y escribir
    filas = sorted(maestro.values(), key=lambda r: int(r['codigo_nuevo']))

    campos = ['codigo_antiguo', 'codigo_nuevo', 'distrito_origen', 'distrito_destino',
              'empresa_operadora', 'empresa_abrev', 'alias', 'color_hex', 'fuente']

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_CSV, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=campos, extrasaction='ignore')
        w.writeheader()
        w.writerows(filas)

    # 6. Resumen
    total       = len(filas)
    de_wiki     = sum(1 for r in filas if r['fuente'] == 'wikipedia')
    de_atu      = sum(1 for r in filas if r['fuente'] == 'atu_pdf')
    con_empresa = sum(1 for r in filas if r['empresa_operadora'] not in ('Desconocido', ''))
    sin_empresa = sum(1 for r in filas if r['empresa_operadora'] == 'Desconocido')

    print(f'\n{"="*50}')
    print(f'Total rutas en maestro: {total}')
    print(f'  Desde Wikipedia:      {de_wiki}')
    print(f'  Desde ATU zip:        {de_atu}')
    print(f'  Con empresa:          {con_empresa}')
    print(f'  Sin empresa:          {sin_empresa}')
    print(f'\nArchivo: {OUT_CSV}')


if __name__ == '__main__':
    main()