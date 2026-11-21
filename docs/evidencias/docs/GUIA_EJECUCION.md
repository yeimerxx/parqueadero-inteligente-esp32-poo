# Guía de Ejecución y Pruebas

`	ext
================================================================================
GUIA DE EJECUCION - PARQUEADERO INTELIGENTE ESP32 + GEMELO DIGITAL 2.5D
================================================================================

1. ESTRUCTURA DEL PROYECTO
--------------------------------------------------------------------------------
- index.html            : Interfaz web principal / Gemelo Digital (GitHub Pages).
- dashboard.html        : Copia de respaldo del Gemelo Digital 2.5D.
- README.md             : Documentación completa del proyecto con badges y arquitectura.
- BITACORA_FALLAS_Y_SOLUCIONES.md : Registro técnico de errores y soluciones.
- src/main.cpp          : Firmware ESP32 (PlatformIO / Arduino).
- platformio.ini        : Dependencias del ESP32 (PubSubClient y ESP32Servo).
- simulador_esp32.py    : Simulador en Python del ESP32 para pruebas sin placa.
- mosquitto.conf        : Plantilla de configuración del Broker Eclipse Mosquitto.
- docs/evidencias/      : Capturas fotográficas del sistema en funcionamiento.
- assets/               : Modulos CSS y JS del dashboard (config, render,
                          animacion y cliente MQTT).
- GUIA_EJECUCION.txt    : Esta guia paso a paso.


2. REQUISITOS DEL ENTORNO EN WINDOWS (BROKER MOSQUITTO)
--------------------------------------------------------------------------------
El sistema se comunica por MQTT (puerto 1883) y WebSockets (puerto 9001).

A) Verificar configuracion de Mosquitto ("C:\Program Files\mosquitto\mosquitto.conf"):
   Debe incluir al final:
     listener 1883
     protocol mqtt
     listener 9001
     protocol websockets
     allow_anonymous false
     password_file C:/Program Files/mosquitto/passwd

   Usuario configurado: esp32_user
   Clave configurada  : Esp32Mqtt2026!

B) Verificar servicio de Windows (PowerShell como Administrador):
     Get-Service mosquitto
   Debe estar en estado "Running". Si no lo esta:
     Start-Service mosquitto

C) Verificar Firewall y perfil de red:
   - Deben existir reglas de entrada TCP para los puertos 1883 y 9001.
   - La red Wi-Fi activa debe estar en perfil "Private" (no "Public").

D) Si cambias de PC o de red Wi-Fi:
   Ejecuta `ipconfig` en PowerShell para ver tu nueva IPv4 activa y actualizala en:
   - src/main.cpp          (variable MQTT_SERVER)
   - simulador_esp32.py    (variable MQTT_BROKER)
   - assets/js/config.js   (variable BROKER_URL -> ws://TU_IP:9001)


3. COMO EJECUTAR EL GEMELO DIGITAL SIN ESP32 FISICO (MODO SIMULADOR)
--------------------------------------------------------------------------------
Abre dos terminales dentro de la carpeta del proyecto:

Terminal 1 - Simulador Python (requiere paho-mqtt):
  pip install paho-mqtt
  python simulador_esp32.py

Terminal 2 - Servidor web local:
  python -m http.server 8080

Luego abre en tu navegador:
  http://localhost:8080/dashboard.html

Controles en el Dashboard:
- Modo: Automatico (MQTT): escucha en tiempo real al ESP32 o simulador_esp32.py.
- Modo: Manual: pausa la cola automatica y permite ingresar/retirar vehiculos,
  abrir/cerrar la barrera o hacer clic directamente en cualquier bahia (P1-P5).


4. COMO COMPILAR Y SUBIR AL ESP32 FISICO
--------------------------------------------------------------------------------
A) Conexiones de hardware definidas en src/main.cpp (2 sensores ultrasonicos):
   - Sensor exterior (Afuera): TRIG_AFUERA = GPIO 13, ECHO_AFUERA = GPIO 34
   - Sensor interior (Dentro): TRIG_DENTRO = GPIO 32, ECHO_DENTRO = GPIO 33
   - Servomotor barrera      : PIN_SERVO = GPIO 27
   - Rangos de deteccion:
     * Entrada (S1 Afuera -> confirma S2 Dentro): 1.0 cm a 8.0 cm en Afuera
       (confirma paso por Dentro <= 16.0 cm; se bloquea si el parqueadero esta lleno)
     * Salida  (S2 Dentro -> confirma S1 Afuera): 1.0 cm a 16.0 cm en Dentro
       (confirma paso por Afuera <= 16.0 cm)
     * Timeout de transito                      : 12 segundos
     * Cierre automatico sin deteccion          : 3 segundos

B) Credenciales Wi-Fi:
   Abre `src/main.cpp` y coloca el nombre y clave de tu red Wi-Fi 2.4 GHz en:
     const char* WIFI_SSID = "TU_WIFI";
     const char* WIFI_PASS = "TU_CLAVE";

C) Compilar y subir con PlatformIO (en terminal dentro del proyecto):
   - Compilar:
       pio run
   - Compilar y subir por USB al ESP32:
       pio run -t upload
   - Ver monitor serial (115200 baudios):
       pio device monitor -b 115200

D) Mantener el servidor web abierto para ver el dashboard en vivo:
     python -m http.server 8080
   y entrar a: http://localhost:8080/dashboard.html


5. TOPICOS MQTT UTILIZADOS
--------------------------------------------------------------------------------
- parqueadero/telemetria    (JSON cada 1s: distancia_afuera_cm, distancia_dentro_cm,
                             barrera, modo, lleno, ocupados, disponibles,
                             entradas, salidas)
- parqueadero/evento        (ENTRADA_REGISTRADA, SALIDA_REGISTRADA,
                             PARQUEADERO_LLENO, etc.)
- parqueadero/ultimo_evento (ultimo evento retenido)
- parqueadero/conexion      (online / offline via LWT)
- parqueadero/comando       (ABRIR, CERRAR, AUTO, RESET)
================================================================================

`
