#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>
#include <Preferences.h>

// ====================================
// 1. CONFIGURACIÓN WIFI Y MQTT
// ====================================

const char* WIFI_SSID = "C.U.A";
const char* WIFI_PASS = "C951u123a";

const char* MQTT_SERVER = "10.11.18.126"; // IP de tu broker Mosquitto
const int MQTT_PORT = 1883;

const char* MQTT_USER = "esp32_user";     // Usuario Mosquitto configurado
const char* MQTT_PASS = "Esp32Mqtt2026!"; // Contraseña Mosquitto configurada

const char* MQTT_ID = "esp32-parqueadero-01";

// Tópicos MQTT
const char* T_COMANDO = "parqueadero/comando";
const char* T_DATOS = "parqueadero/telemetria";
const char* T_EVENTO = "parqueadero/evento";
const char* T_ULTIMO = "parqueadero/ultimo_evento";
const char* T_CONEXION = "parqueadero/conexion";

// ====================================
// 2. PINES Y CAPACIDAD
// ====================================

// Sensor exterior (entrada de 1 a 8 cm; también confirma salida)
const int TRIG_AFUERA = 13;
const int ECHO_AFUERA = 34;

// Sensor interior / lado derecho junto al servo (detecta salida y confirma entrada)
const int TRIG_DENTRO = 32;
const int ECHO_DENTRO = 33;

const int PIN_SERVO = 27;

const int CAPACIDAD_TOTAL = 5; // Máximo 5 plazas

// ====================================
// 3. DISTANCIAS Y TIEMPOS
// ====================================

// Entrada estrictamente entre 1.0 y 8.0 cm (> 8.0 cm NO dispara entrada)
const float ENTRADA_MIN = 1.0;
const float ENTRADA_MAX = 8.0;

// Rango del sensor interior para detectar vehículo saliendo (ajusta si necesitas)
const float SALIDA_MIN = 1.0;
const float SALIDA_MAX = 16.0;

const float DISTANCIA_MIN_VALIDA = 2.0;
const float DISTANCIA_MAX_VALIDA = 400.0;

const int CERRADO = 0;
const int ABIERTO = 90;

const unsigned long TIEMPO_CIERRE = 3000;       // 3 s sin detección para cerrar barrera
const unsigned long TIEMPO_MIN_BARRERA = 350;   // Anti-rebote rápido (350 ms)
const unsigned long TIMEOUT_TRANSITO = 12000;   // 12 s máximo para completar entrada o salida
const unsigned long COOLDOWN_LLENO = 3000;       // Evita spamear evento de lleno cada segundo
const unsigned long INTERVALO_ENVIO = 150;      // Telemetría rápida cada 150 ms por USB/MQTT

// 0 = Comunicación directa por cable USB (sin bloqueos ni duplicados Wi-Fi)
// 1 = También conectar por Wi-Fi + MQTT TCP
#define USAR_WIFI_MQTT 0

// ====================================
// 4. OBJETOS
// ====================================

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
Servo barrera;
Preferences memoria;

// ====================================
// 5. VARIABLES DE ESTADO
// ====================================

bool barreraAbierta = false;
bool modoManual = false;

float distanciaAfueras = -1;
float distanciaDentro = -1;

enum EstadoFlujo {
  REPOSO,
  ESPERANDO_CONFIRMAR_ENTRADA, // Activado por AFUERA (1 a 8 cm), espera paso por DENTRO
  ESPERANDO_CONFIRMAR_SALIDA   // Activado por DENTRO, espera paso por AFUERA
};

EstadoFlujo estadoFlujo = REPOSO;
bool pasoDetectadoEnDestino = false;
unsigned long inicioTransito = 0;
unsigned long ultimoCambioBarrera = 0;
unsigned long ultimoAvisoLleno = 0;

unsigned long ultimaDeteccion = 0;
unsigned long ultimoEnvio = 0;
unsigned long ultimoIntentoWiFi = 0;
unsigned long ultimoIntentoMQTT = 0;
unsigned long cierreManualPendienteEn = 0;

// Contadores anti-rebote para evitar disparos falsos por ruido eléctrico
uint8_t rachaEntrada = 0;
uint8_t rachaSalida = 0;
uint8_t rachaLibreDestino = 0;

// Contadores persistentes
uint32_t entradas = 0;
uint32_t salidas = 0;
uint32_t ocupados = 0;

// ====================================
// 6. FUNCIONES AUXILIARES Y MEMORIA
// ====================================

bool parqueaderoLleno() {
  return ocupados >= (uint32_t)CAPACIDAD_TOTAL;
}

void guardarContadores() {
  memoria.putUInt("entradas", entradas);
  memoria.putUInt("salidas", salidas);
  memoria.putUInt("ocupados", ocupados);
}

void publicarEvento(const char* mensaje) {
  Serial.print("EVENTO: ");
  Serial.println(mensaje);
  Serial.print("MQTT_EVENTO:");
  Serial.println(mensaje);

  if (mqtt.connected()) {
    mqtt.publish(T_EVENTO, mensaje);
    mqtt.publish(T_ULTIMO, mensaje, true);
  }
}

void reiniciarFlujo() {
  estadoFlujo = REPOSO;
  pasoDetectadoEnDestino = false;
  inicioTransito = 0;
  rachaEntrada = 0;
  rachaSalida = 0;
  rachaLibreDestino = 0;
}

void abrirBarreraAuto(unsigned long ahora, const char* motivo) {
  if (modoManual) return;
  if (!barreraAbierta && (ahora - ultimoCambioBarrera >= TIEMPO_MIN_BARRERA)) {
    Serial.println(motivo);
    barrera.write(ABIERTO);
    barreraAbierta = true;
    ultimoCambioBarrera = ahora;
    publicarDatos();
  }
}

void cerrarBarreraAuto(unsigned long ahora) {
  if (modoManual) return;
  if (barreraAbierta && (ahora - ultimoCambioBarrera >= TIEMPO_MIN_BARRERA)) {
    Serial.println("Cerrando barrera automáticamente");
    barrera.write(CERRADO);
    barreraAbierta = false;
    ultimoCambioBarrera = ahora;
    publicarDatos();
  }
}

// ====================================
// 7. MEDICIÓN DE DISTANCIA
// ====================================

float medirDistanciaSensor(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long tiempo = pulseIn(echoPin, HIGH, 18000);

  if (tiempo == 0) {
    return -1;
  }

  return tiempo * 0.0343 / 2.0;
}

bool distanciaValida(float d) {
  return (d >= DISTANCIA_MIN_VALIDA && d <= DISTANCIA_MAX_VALIDA);
}

bool esEntradaAfuera(float d) {
  return distanciaValida(d) && (d >= ENTRADA_MIN && d <= ENTRADA_MAX);
}

bool esSalidaDentro(float d) {
  return distanciaValida(d) && (d >= SALIDA_MIN && d <= SALIDA_MAX);
}

// ====================================
// 8. REGISTRAR ENTRADA / SALIDA
// ====================================

void confirmarEntrada() {
  if (parqueaderoLleno()) {
    Serial.println(">>> ENTRADA BLOQUEADA: Parqueadero lleno");
    return;
  }

  entradas++;
  ocupados++;
  guardarContadores();
  publicarEvento("ENTRADA_REGISTRADA");
  publicarDatos();

  int disponibles = CAPACIDAD_TOTAL - (int)ocupados;
  Serial.println(">>> ENTRADA CONFIRMADA (Afuera 1-8 cm -> Adentro)");
  Serial.print("Ocupados: "); Serial.println(ocupados);
  Serial.print("Disponibles: "); Serial.println(disponibles);
}

void confirmarSalida() {
  salidas++;
  if (ocupados > 0) {
    ocupados--;
  }
  guardarContadores();
  publicarEvento("SALIDA_REGISTRADA");
  publicarDatos();

  int disponibles = CAPACIDAD_TOTAL - (int)ocupados;
  Serial.println(">>> SALIDA CONFIRMADA (Adentro -> Afuera)");
  Serial.print("Ocupados: "); Serial.println(ocupados);
  Serial.print("Disponibles: "); Serial.println(disponibles);
}

// ====================================
// 9. LÓGICA DE DOS SENSORES
// ====================================

void procesarSensores(unsigned long ahora) {
  if (modoManual) {
    return;
  }

  bool detectaEntrada = esEntradaAfuera(distanciaAfueras);
  bool detectaSalida  = esSalidaDentro(distanciaDentro);

  rachaEntrada = detectaEntrada ? (rachaEntrada + 1) : 0;
  rachaSalida  = detectaSalida  ? (rachaSalida + 1)  : 0;
  bool entradaEstable = (rachaEntrada >= 2);
  bool salidaEstable  = (rachaSalida >= 2);

  // Para confirmar salida al cruzar afuera, aceptamos cualquier lectura válida cercana (2 a 16 cm)
  bool confirmaSalidaAfuera = distanciaValida(distanciaAfueras) && (distanciaAfueras <= SALIDA_MAX);
  // Para confirmar entrada al cruzar adentro, aceptamos cualquier lectura válida cercana (2 a 16 cm)
  bool confirmaEntradaDentro = distanciaValida(distanciaDentro) && (distanciaDentro <= SALIDA_MAX);

  if (detectaEntrada || detectaSalida || confirmaSalidaAfuera || confirmaEntradaDentro) {
    ultimaDeteccion = ahora;
  }

  // Caducidad si el movimiento no completó el cruce hacia el otro sensor
  if (estadoFlujo != REPOSO && (ahora - inicioTransito >= TIMEOUT_TRANSITO)) {
    Serial.println("Tiempo de tránsito agotado -> Reiniciando estado de flujo");
    reiniciarFlujo();
  }

  switch (estadoFlujo) {
    case REPOSO:
      if (entradaEstable) {
        if (parqueaderoLleno()) {
          cerrarBarreraAuto(ahora);
          if (ahora - ultimoAvisoLleno >= COOLDOWN_LLENO) {
            ultimoAvisoLleno = ahora;
            publicarEvento("PARQUEADERO_LLENO");
            Serial.println("Vehículo en rango de entrada (1-8 cm) pero parqueadero LLENO -> No se abre");
          }
        } else {
          estadoFlujo = ESPERANDO_CONFIRMAR_ENTRADA;
          pasoDetectadoEnDestino = false;
          rachaLibreDestino = 0;
          inicioTransito = ahora;
          abrirBarreraAuto(ahora, "Vehículo detectado AFUERA (1-8 cm) -> Abriendo barrera para ingresar");
        }
      }
      else if (salidaEstable) {
        estadoFlujo = ESPERANDO_CONFIRMAR_SALIDA;
        pasoDetectadoEnDestino = false;
        rachaLibreDestino = 0;
        inicioTransito = ahora;
        abrirBarreraAuto(ahora, "Vehículo detectado DENTRO -> Abriendo barrera para salir");
      }
      break;

    case ESPERANDO_CONFIRMAR_ENTRADA:
      if (parqueaderoLleno()) {
        reiniciarFlujo();
        break;
      }
      if (!barreraAbierta) {
        abrirBarreraAuto(ahora, "Reintentando abrir barrera para entrada");
      }

      if (confirmaEntradaDentro) {
        pasoDetectadoEnDestino = true;
        rachaLibreDestino = 0;
        inicioTransito = ahora;
      }
      else if (pasoDetectadoEnDestino) {
        rachaLibreDestino++;
        if (rachaLibreDestino >= 2) {
          confirmarEntrada();
          reiniciarFlujo();
        }
      }
      break;

    case ESPERANDO_CONFIRMAR_SALIDA:
      if (!barreraAbierta) {
        abrirBarreraAuto(ahora, "Reintentando abrir barrera para salida");
      }
      if (confirmaSalidaAfuera) {
        pasoDetectadoEnDestino = true;
        rachaLibreDestino = 0;
        inicioTransito = ahora;
      }
      else if (pasoDetectadoEnDestino) {
        rachaLibreDestino++;
        if (rachaLibreDestino >= 2) {
          confirmarSalida();
          reiniciarFlujo();
        }
      }
      break;
  }

  // Si está lleno y la barrera quedó abierta en auto, la cierra
  if (parqueaderoLleno() && estadoFlujo == REPOSO && !detectaSalida) {
    cerrarBarreraAuto(ahora);
  }

  // Cierre automático cuando no hay detección activa en ninguno de los dos sensores
  if (!detectaEntrada && !detectaSalida && !confirmaSalidaAfuera && !confirmaEntradaDentro && barreraAbierta) {
    if (ahora - ultimaDeteccion >= TIEMPO_CIERRE) {
      cerrarBarreraAuto(ahora);
    }
  }
}

// ====================================
// 10. PUBLICAR DATOS MQTT (TELEMETRÍA)
// ====================================

void publicarDatos() {
  char distAfueraTxt[16];
  char distDentroTxt[16];

  if (distanciaValida(distanciaAfueras)) {
    snprintf(distAfueraTxt, sizeof(distAfueraTxt), "%.1f", distanciaAfueras);
  } else {
    strcpy(distAfueraTxt, "null");
  }

  if (distanciaValida(distanciaDentro)) {
    snprintf(distDentroTxt, sizeof(distDentroTxt), "%.1f", distanciaDentro);
  } else {
    strcpy(distDentroTxt, "null");
  }

  int disponibles = CAPACIDAD_TOTAL - (int)ocupados;
  if (disponibles < 0) disponibles = 0;

  char json[420];
  snprintf(
    json, sizeof(json),
    "{"
    "\"distancia_afuera_cm\":%s,"
    "\"distancia_dentro_cm\":%s,"
    "\"barrera\":\"%s\","
    "\"modo\":\"%s\","
    "\"lleno\":%s,"
    "\"ocupados\":%lu,"
    "\"disponibles\":%d,"
    "\"entradas\":%lu,"
    "\"salidas\":%lu"
    "}",
    distAfueraTxt,
    distDentroTxt,
    barreraAbierta ? "ABIERTA" : "CERRADA",
    modoManual ? "MANUAL" : "AUTO",
    parqueaderoLleno() ? "true" : "false",
    (unsigned long)ocupados,
    disponibles,
    (unsigned long)entradas,
    (unsigned long)salidas
  );

  Serial.print("MQTT_TELEMETRIA:");
  Serial.println(json);

  if (mqtt.connected()) {
    mqtt.publish(T_DATOS, json, true);
  }
}

// ====================================
// 11. RECIBIR COMANDOS DESDE LA WEB (MQTT / SERIAL)
// ====================================

void procesarComando(String comando) {
  comando.trim();
  comando.toUpperCase();
  if (comando.length() == 0) return;

  Serial.print("Comando recibido: ");
  Serial.println(comando);

  if (comando == "ABRIR") {
    modoManual = true;
    cierreManualPendienteEn = 0;
    barrera.write(ABIERTO);
    barreraAbierta = true;
    ultimoCambioBarrera = millis();
    publicarEvento("APERTURA_MANUAL");
  }
  else if (comando == "CERRAR") {
    modoManual = true;
    cierreManualPendienteEn = 0;
    barrera.write(CERRADO);
    barreraAbierta = false;
    ultimoCambioBarrera = millis();
    publicarEvento("CIERRE_MANUAL");
  }
  else if (comando == "MANUAL") {
    modoManual = true;
    cierreManualPendienteEn = 0;
    reiniciarFlujo();
    publicarEvento("MODO_MANUAL");
  }
  else if (comando == "ENTRADA_MANUAL") {
    modoManual = true;
    if (!parqueaderoLleno()) {
      entradas++;
      ocupados++;
      guardarContadores();
      barrera.write(ABIERTO);
      barreraAbierta = true;
      ultimoCambioBarrera = millis();
      cierreManualPendienteEn = millis() + 1800;
      publicarEvento("ENTRADA_MANUAL");
      Serial.println(">>> ENTRADA MANUAL (Servo abierto 1.8s)");
    } else {
      publicarEvento("PARQUEADERO_LLENO");
    }
  }
  else if (comando == "SALIDA_MANUAL") {
    modoManual = true;
    if (ocupados > 0) {
      salidas++;
      ocupados--;
      guardarContadores();
      barrera.write(ABIERTO);
      barreraAbierta = true;
      ultimoCambioBarrera = millis();
      cierreManualPendienteEn = millis() + 1800;
      publicarEvento("SALIDA_MANUAL");
      Serial.println(">>> SALIDA MANUAL (Servo abierto 1.8s)");
    }
  }
  else if (comando == "AUTO") {
    modoManual = false;
    cierreManualPendienteEn = 0;
    reiniciarFlujo();
    publicarEvento("MODO_AUTOMATICO");
  }
  else if (comando == "RESET") {
    entradas = 0;
    salidas = 0;
    ocupados = 0;
    cierreManualPendienteEn = 0;
    barrera.write(CERRADO);
    barreraAbierta = false;
    reiniciarFlujo();
    guardarContadores();
    publicarEvento("CONTADORES_REINICIADOS");
  }

  publicarDatos();
}

void leerComandosSerial() {
  while (Serial.available() > 0) {
    String linea = Serial.readStringUntil('\n');
    linea.trim();
    if (linea.startsWith("CMD:")) {
      procesarComando(linea.substring(4));
    }
  }
}

void recibirMQTT(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, T_COMANDO) != 0) {
    return;
  }

  String comando = "";
  for (unsigned int i = 0; i < length && i < 32; i++) {
    comando += (char)payload[i];
  }

  procesarComando(comando);
}

// ====================================
// 12. GESTIÓN DE CONEXIÓN WIFI Y MQTT
// ====================================

void mantenerConexion() {
#if !USAR_WIFI_MQTT
  return;
#else
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - ultimoIntentoWiFi >= 10000) {
      ultimoIntentoWiFi = millis();
      Serial.println("Reconectando WiFi...");
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
    return;
  }

  if (mqtt.connected()) {
    return;
  }

  if (millis() - ultimoIntentoMQTT < 5000) {
    return;
  }

  ultimoIntentoMQTT = millis();
  bool conectado;

  if (strlen(MQTT_USER) > 0) {
    conectado = mqtt.connect(MQTT_ID, MQTT_USER, MQTT_PASS, T_CONEXION, 1, true, "offline");
  } else {
    conectado = mqtt.connect(MQTT_ID, T_CONEXION, 1, true, "offline");
  }

  if (conectado) {
    Serial.println("MQTT Conectado exitosamente");
    mqtt.subscribe(T_COMANDO);
    mqtt.publish(T_CONEXION, "online", true);
    publicarDatos();
  } else {
    Serial.print("Error MQTT: ");
    Serial.println(mqtt.state());
  }
#endif
}

// ====================================
// 13. SETUP
// ====================================

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_AFUERA, OUTPUT);
  pinMode(ECHO_AFUERA, INPUT);

  pinMode(TRIG_DENTRO, OUTPUT);
  pinMode(ECHO_DENTRO, INPUT);

  barrera.setPeriodHertz(50);
  barrera.attach(PIN_SERVO, 500, 2400);
  barrera.write(CERRADO);

  memoria.begin("parking", false);
  entradas = memoria.getUInt("entradas", 0);
  salidas = memoria.getUInt("salidas", 0);
  ocupados = memoria.getUInt("ocupados", 0);

#if USAR_WIFI_MQTT
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(recibirMQTT);
  mqtt.setBufferSize(512);
#endif

  Serial.println("==========================================");
  Serial.println("PARQUEADERO INTELIGENTE (2 SENSORES) - MQTT");
  Serial.println("==========================================");
}

// ====================================
// 14. LOOP PRINCIPAL
// ====================================

void loop() {
  unsigned long ahora = millis();

  mantenerConexion();
  if (mqtt.connected()) {
    mqtt.loop();
  }
  leerComandosSerial();

  distanciaAfueras = medirDistanciaSensor(TRIG_AFUERA, ECHO_AFUERA);
  delay(30);
  distanciaDentro = medirDistanciaSensor(TRIG_DENTRO, ECHO_DENTRO);

  Serial.print("Afuera: ");
  if (distanciaValida(distanciaAfueras)) {
    Serial.print(distanciaAfueras);
    Serial.print(" cm");
  } else {
    Serial.print("N/A");
  }

  Serial.print(" | Dentro: ");
  if (distanciaValida(distanciaDentro)) {
    Serial.print(distanciaDentro);
    Serial.println(" cm");
  } else {
    Serial.println("N/A");
  }

  procesarSensores(ahora);

  if (modoManual && cierreManualPendienteEn > 0 && ahora >= cierreManualPendienteEn) {
    cierreManualPendienteEn = 0;
    barrera.write(CERRADO);
    barreraAbierta = false;
    ultimoCambioBarrera = ahora;
    publicarDatos();
  }

  if (ahora - ultimoEnvio >= INTERVALO_ENVIO) {
    ultimoEnvio = ahora;
    publicarDatos();
  }

  delay(25);
}
