# Bitácora de Desafíos, Fallas y Soluciones de Ingeniería
## Proyecto: Sistema de Parqueadero Inteligente con ESP32 y Gemelo Digital 2.5D
**Institución:** Corporación Universitaria Americana  
**Facultad:** Ingeniería Mecatrónica  
**Área:** Sistemas Embebidos, Internet de las Cosas (IoT) y Gemelos Digitales  

---

### Introducción y Contexto de Desarrollo
Durante el diseño, montaje físico y desarrollo del software para el prototipo de parqueadero automatizado inteligente, el equipo de trabajo se enfrentó a diversas fallas de naturaleza electromecánica, electrónica y de redes. A continuación se desglosan en orden cronológico y técnico cada uno de los problemas identificados, su causa raíz, los procedimientos de diagnóstico aplicados y la solución de ingeniería adoptada.

---

### Registro Detallado de Incidencias

#### 1. Falla en el Mecanismo Físico de Acceso Vehicular (Palanca / Servomotor SG90)
* **Descripción del Problema:**
  Al iniciar las primeras pruebas del prototipo, la palanca (barrera elevadiza de acceso vehicular) no respondía adecuadamente ante la detección de los vehículos. Presentaba temblores erráticos (*jitter*), se quedaba a medio recorrido, vibraba intensamente sin elevarse o se trababa mecánicamente al intentar retornar a su posición de reposo.
* **Causa Raíz Identificada:**
  1. **Caída de Tensión (*Brownout* transitorio):** El servomotor SG90 demanda picos de corriente inductiva superiores a 400 mA durante el arranque del motor DC interno. Al estar alimentado directamente desde la línea regulada de 3.3V o 5V del microcontrolador sin filtrado adecuado, provocaba micro-caídas de voltaje que inestabilizaban la señal PWM del ESP32.
  2. **Descalibración Angular en PWM:** Los pulsos estándar de la librería por defecto no coincidían con la geometría física de los engranajes de nylon de la barrera, forzando al motor a llegar a su tope mecánico interno (0° a 180°), recalentando el devanado.
* **Solución de Ingeniería Aplicada:**
  - Se configuró la librería especializada `ESP32Servo` en `src/main.cpp`, acotando los anchos de pulso seguros para ángulos exactos de operación: `CERRADO = 0°` y `ABIERTO = 90°`.
  - Se desacopló la alimentación del servomotor asegurando una línea de 5V dedicada con tierra (*GND*) común entre el microcontrolador y la etapa de potencia.
  - Se programó una temporización anti-rebote no bloqueante (`TIEMPO_MIN_BARRERA = 350 ms`) y un cierre automático seguro tras 3 segundos de despeje del sensor interior, evitando sobrecargas en el mecanismo.

---

#### 2. Falla en Materiales Físicos y Daño Irreversible del Microcontrolador ESP32
* **Descripción del Problema:**
  Durante las fases de cableado en protoboard y calibración de múltiples periféricos simultáneos (sensores ultrasónicos, servo y actuadores), la primera tarjeta de desarrollo ESP32 dejó de ser detectada por la computadora mediante el puerto COM/USB, calentándose de forma excesiva en la zona del chip de comunicación serial.
* **Causa Raíz Identificada:**
  - Se produjo un retorno de corriente / sobretensión involuntario o cortocircuito entre las líneas de los sensores ultrasónicos (los cuales operan típicamente con eco a 5V) y los pines de entrada del ESP32 (tolerantes exclusivamente a 3.3V). Esto destruyó el regulador lineal AMS1117 y el puente USB-UART CP2102/CH340 de la placa original.
* **Solución de Ingeniería Aplicada:**
  - **Sustitución de Hardware:** Se reemplazó la placa dañada por una nueva placa ESP32 DevKit V1 de 30 pines completamente funcional.
  - **Rediseño del Esquema de Conexiones:** Se mapearon los pines a GPIOs seguros que no interfirieran con el proceso de arranque (*strapping pins*) ni con el canal Wi-Fi ADC2:
    - Sensor Exterior (Entrada): `TRIG = GPIO 13`, `ECHO = GPIO 34` (pin de entrada directa).
    - Sensor Interior (Salida): `TRIG = GPIO 32`, `ECHO = GPIO 33`.
    - Servomotor de Barrera: `PWM = GPIO 27`.
  - Se verificaron con multímetro todos los nodos de alimentación y se aisló el cableado para evitar falsos contactos en la maqueta.

---

#### 3. Abandono de la Pantalla Física (LCD/OLED) y Transición al Gemelo Digital Web
* **Descripción del Problema:**
  En la formulación inicial del proyecto se contemplaba instalar una pantalla física (LCD 16x2 I2C o módulo OLED 0.96") empotrada en la maqueta para informar a los conductores sobre la disponibilidad de plazas y el aforo.
* **Limitaciones y Fallas Detectadas:**
  - Espacio físico severamente limitado en la maqueta a escala.
  - Fragilidad en el bus I2C: las vibraciones del servomotor y la longitud de los cables provocaban cuelgues constantes del bus I2C (`Wire.h`), congelando la ejecución del programa.
  - Imposibilidad de representar gráficamente la ocupación individual de cada una de las 5 bahías de estacionamiento (P1, P2, P3, P4, P5), limitándose a un texto estático de "Plazas libres".
  - Nula visibilidad para el docente y los evaluadores al situarse a más de un metro de distancia del prototipo.
* **Solución de Ingeniería Aplicada:**
  - Se tomó la decisión de suprimir la pantalla física en la maqueta y migrar hacia una solución de vanguardia en la Industria 4.0: el desarrollo de un **Gemelo Digital 2.5D (Digital Twin)** en un panel web interactivo.
  - Se programó una escena isométrica vectorial SVG completa (`iso-renderer.js`, `animation.js`) con animación tridimensional simulada de vehículos entrando y saliendo, trazado de rutas hacia bahías libres, actualización dinámica de colores de los postes LED (verde = libre, rojo = ocupado), y visualización de telemetría en tiempo real (distancias en cm de los sensores, aforo, estado de barrera e historial de eventos).

---

#### 4. Aislamiento Inicial de la Página Web y Solución Integral con Servidor Mosquitto (MQTT + WebSockets)
* **Descripción del Problema:**
  Una vez diseñada la página web del Gemelo Digital (`dashboard.html`), esta funcionaba correctamente de manera visual y manual en el navegador web local, pero **no existía comunicación alguna con el sistema físico ESP32**. Los sensores reales no actualizaban el gemelo y los botones de la web no movían la barrera física.
* **Causa Raíz Identificada:**
  - Restricción de seguridad de los navegadores web: el código JavaScript que corre en un navegador opera bajo un modelo de espacio aislado (*sandbox*) y no tiene autorización ni API para abrir sockets de transporte TCP puros en el puerto 1883 (protocolo nativo que utiliza MQTT para microcontroladores).
* **Solución de Ingeniería Aplicada:**
  - **Implementación del Broker Mosquitto:** Se instaló y configuró un servidor local Eclipse Mosquitto en la máquina de control.
  - **Doble Canal de Comunicación:**
    1. Se habilitó el **puerto TCP 1883** para que el ESP32 publique telemetría y reciba comandos mediante la librería C++ `PubSubClient`.
    2. Se habilitó el **puerto WebSockets 9001** (`protocol websockets`) en `mosquitto.conf`, permitiendo que la librería cliente en JavaScript (`mqtt.min.js`) se conecte bidireccionalmente al broker directo desde el navegador.
  - **Desarrollo del Simulador en Python:** Para poder trabajar y depurar la aplicación web sin depender en todo momento de tener la maqueta conectada a la computadora, se creó `simulador_esp32.py` utilizando `paho-mqtt`. Este emula los ciclos de sensores ultrasónicos, apertura de barrera, llenado de plazas y publicación de telemetría JSON idéntica a la del hardware real.

---

#### 5. Perturbaciones Ambientales y Térmicas en Pruebas Físicas (Diseño de Protección Solar de Cartón)
* **Descripción del Problema:**
  Durante los ensayos de laboratorio bajo luz solar indirecta y lámparas fluorescentes del aula, se presentaron lecturas parásitas en los sensores ultrasónicos HC-SR04, además de dilatación térmica en el material de soporte de la barrera.
* **Solución de Ingeniería Aplicada:**
  - Se fabricó una estructura de resguardo físico en cartón ("Protección Solar") sobre el módulo de sensores y la cabina de control de la maqueta.
  - Esta mejora física fue modelada e incorporada con humor y fidelidad dentro del Gemelo Digital 2.5D, incluyendo el indicador gráfico interactivo `☀ Protección Solar (Cartón)` sobre la bahía P3 y la figura del operador de control.

---

#### 6. Detección Secuencial y Lógica Anti-Bloqueo de Vehículos
* **Descripción del Problema:**
  Si un objeto permanecía estático frente al sensor de entrada, la barrera permanecía abierta indefinidamente o el contador de plazas se incrementaba en bucle de forma infinita.
* **Solución de Ingeniería Aplicada:**
  - Se implementó una **Máquina de Estados Finitos (FSM)** en el firmware `main.cpp`:
    - `REPOSO`: Monitoreo continuo a 150 ms.
    - `ESPERANDO_CONFIRMAR_ENTRADA`: La entrada solo se valida si el vehículo activa el sensor exterior (`1.0 cm <= S1 <= 8.0 cm`) y posteriormente confirma su paso por el sensor interior (`S2 <= 16.0 cm`).
    - Si el vehículo no completa el paso antes de `TIMEOUT_TRANSITO = 12000 ms` (12 segundos), la barrera se cierra automáticamente por seguridad y se cancela la operación sin modificar el aforo.
    - Se incorporó la bandera `lleno`: si `plazas_libres == 0`, la barrera física ignora el sensor exterior y emite el evento `PARQUEADERO_LLENO`.

---

### Resumen Comparativo de Evolución del Proyecto

| Etapa | Estado Inicial (Fallas) | Estado Final Optimizado (Solución) |
|---|---|---|
| **Barrera de Acceso** | Servomotor temblaba, sin torque, se trababa. | PWM acotado (0° a 90°), alimentación estable, auto-cierre en 3s. |
| **Microcontrolador** | ESP32 dañado por retorno eléctrico. | Nueva placa ESP32 DevKit V1 con GPIOs seguros verificados. |
| **Visualización** | Pantalla LCD 16x2 limitada, cables sueltos. | Gemelo Digital 2.5D en tiempo real con SVG isométrico dinámico. |
| **Conectividad** | Web aislada sin enlace al hardware. | Broker Mosquitto dual (TCP 1883 + WebSockets 9001). |
| **Demostración y Pruebas** | Dependencia obligatoria de la maqueta física. | Simulador Python completo + Modo Demo interactivo en GitHub Pages. |

---

### Registro de Evidencias Físicas y Demostración en Video

Para constancia de la validación experimental y de laboratorio, se anexan en la carpeta `docs/evidencias/` las siguientes pruebas:

#### 1. Evidencias Fotográficas del Prototipo Real
- **`06_maqueta_fisica_vista_superior.jpg`:** Comprobación del aforo delimitado en 5 bahías (P1 a P5), la distribución del carril de entrada/salida y la caseta de protección solar de cartón sobre el circuito.
- **`07_barrera_elevada_servo_sensor.jpg`:** Detalle del actuador servomotor SG90 elevando a 90° la barrera con señalización de franjas rojas y blancas, y el transductor HC-SR04 de entrada fijado a la protoboard.
- **`08_maqueta_fisica_perspectiva_abierta.jpg`:** Vista en perspectiva del prototipo integral con el microcontrolador y el cableado de alimentación protegido.

#### 2. Evidencias en Video de Ensayos Dinámicos
- **`video_demostracion_01.mp4`:** Prueba de accionamiento angular del servomotor y respuesta del tren de pulsos PWM.
- **`video_demostracion_02.mp4`:** Validación de la secuencia lógica de detección en los sensores ultrasónicos de entrada y salida.
- **`video_demostracion_03.mp4`:** Prueba de paso vehicular con objeto de ensayo y cierre temporizado automático.
- **`video_demostracion_04.mp4`:** Prueba integral del sistema mecatrónico en tiempo real.
