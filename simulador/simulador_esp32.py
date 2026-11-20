import json
import random
import time
import paho.mqtt.client as mqtt

MQTT_BROKER = "10.11.18.126"
MQTT_PORT = 1883
MQTT_USER = "esp32_user"
MQTT_PASS = "Esp32Mqtt2026!"

T_COMANDO = "parqueadero/comando"
T_DATOS = "parqueadero/telemetria"
T_EVENTO = "parqueadero/evento"
T_ULTIMO = "parqueadero/ultimo_evento"
T_CONEXION = "parqueadero/conexion"

CAPACIDAD_TOTAL = 5
ocupados = 0
entradas = 0
salidas = 0
barrera_abierta = False
modo_manual = False
distancia_afuera_cm = 62.5
distancia_dentro_cm = 68.0


def publicar_evento(client, mensaje):
    print(f"[SIM-PARQUEADERO] EVENTO: {mensaje}")
    client.publish(T_EVENTO, mensaje)
    client.publish(T_ULTIMO, mensaje, retain=True)


def publicar_datos(client):
    disponibles = max(0, CAPACIDAD_TOTAL - ocupados)
    lleno = ocupados >= CAPACIDAD_TOTAL
    payload = json.dumps({
        "distancia_afuera_cm": round(distancia_afuera_cm, 1) if distancia_afuera_cm is not None else None,
        "distancia_dentro_cm": round(distancia_dentro_cm, 1) if distancia_dentro_cm is not None else None,
        "barrera": "ABIERTA" if barrera_abierta else "CERRADA",
        "modo": "MANUAL" if modo_manual else "AUTO",
        "lleno": lleno,
        "ocupados": ocupados,
        "disponibles": disponibles,
        "entradas": entradas,
        "salidas": salidas,
    })
    client.publish(T_DATOS, payload, retain=True)
    print(f"[SIM-PARQUEADERO] Telemetría: {payload}")


def on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        print(f"[SIM-PARQUEADERO] Conectado a {MQTT_BROKER}:{MQTT_PORT} (rc=0)")
        client.subscribe(T_COMANDO)
        client.publish(T_CONEXION, "online", retain=True)
        publicar_datos(client)
    else:
        print(f"[SIM-PARQUEADERO] Error de conexión: rc={reason_code}")


def on_message(client, userdata, msg):
    global ocupados, entradas, salidas, barrera_abierta, modo_manual
    cmd = msg.payload.decode("utf-8", errors="replace").strip().upper()
    print(f"[SIM-PARQUEADERO] Comando recibido [{msg.topic}]: {cmd}")

    if cmd == "ABRIR":
        modo_manual = True
        barrera_abierta = True
        publicar_evento(client, "APERTURA_MANUAL")
    elif cmd == "CERRAR":
        modo_manual = True
        barrera_abierta = False
        publicar_evento(client, "CIERRE_MANUAL")
    elif cmd == "MANUAL":
        modo_manual = True
        publicar_evento(client, "MODO_MANUAL")
    elif cmd == "ENTRADA_MANUAL":
        modo_manual = True
        if ocupados < CAPACIDAD_TOTAL:
            ocupados += 1
            entradas += 1
            publicar_evento(client, "ENTRADA_MANUAL")
    elif cmd == "SALIDA_MANUAL":
        modo_manual = True
        if ocupados > 0:
            ocupados -= 1
            salidas += 1
            publicar_evento(client, "SALIDA_MANUAL")
    elif cmd == "AUTO":
        modo_manual = False
        publicar_evento(client, "MODO_AUTOMATICO")
    elif cmd == "RESET":
        entradas = 0
        salidas = 0
        ocupados = 0
        publicar_evento(client, "CONTADORES_REINICIADOS")

    publicar_datos(client)


def main():
    global ocupados, entradas, salidas, barrera_abierta, distancia_afuera_cm, distancia_dentro_cm
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="esp32-parqueadero-sim")
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.will_set(T_CONEXION, "offline", qos=1, retain=True)
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    client.loop_start()

    print("[SIM-PARQUEADERO] Simulando 2 sensores (Afuera 13/34 + Dentro 32/33) cada 5s (Ctrl+C para salir)...")
    try:
        ciclo = 0
        while True:
            time.sleep(1)
            ciclo += 1
            if ciclo % 5 == 0 and not modo_manual:
                if ocupados == 0:
                    accion = "ENTRADA"
                elif ocupados >= CAPACIDAD_TOTAL:
                    accion = random.choice(["SALIDA", "SALIDA", "INTENTO_LLENO"])
                else:
                    accion = random.choice(["ENTRADA", "SALIDA"])

                if accion == "ENTRADA" and ocupados < CAPACIDAD_TOTAL:
                    # Paso 1: sensor exterior detecta vehículo (1.0 - 8.0 cm) y abre barrera
                    distancia_afuera_cm = random.uniform(2.0, 7.5)
                    distancia_dentro_cm = random.uniform(55.0, 80.0)
                    barrera_abierta = True
                    publicar_datos(client)
                    time.sleep(0.8)

                    # Paso 2: sensor interior confirma cruce (1.0 - 16.0 cm) y registra entrada
                    distancia_afuera_cm = random.uniform(55.0, 80.0)
                    distancia_dentro_cm = random.uniform(3.0, 14.0)
                    ocupados += 1
                    entradas += 1
                    publicar_evento(client, "ENTRADA_REGISTRADA")
                    publicar_datos(client)
                    time.sleep(0.8)
                    barrera_abierta = False
                    continue

                elif accion == "INTENTO_LLENO" and ocupados >= CAPACIDAD_TOTAL:
                    distancia_afuera_cm = random.uniform(2.0, 7.5)
                    distancia_dentro_cm = random.uniform(55.0, 80.0)
                    barrera_abierta = False
                    publicar_evento(client, "PARQUEADERO_LLENO")

                elif accion == "SALIDA" and ocupados > 0:
                    # Paso 1: sensor interior detecta vehículo saliendo (1.0 - 16.0 cm) y abre barrera
                    distancia_dentro_cm = random.uniform(2.0, 14.5)
                    distancia_afuera_cm = random.uniform(55.0, 80.0)
                    barrera_abierta = True
                    publicar_datos(client)
                    time.sleep(0.8)

                    # Paso 2: sensor exterior confirma cruce (1.0 - 16.0 cm) y registra salida
                    distancia_dentro_cm = random.uniform(55.0, 80.0)
                    distancia_afuera_cm = random.uniform(3.0, 14.0)
                    ocupados -= 1
                    salidas += 1
                    publicar_evento(client, "SALIDA_REGISTRADA")
                    publicar_datos(client)
                    time.sleep(0.8)
                    barrera_abierta = False
                    continue
            else:
                distancia_afuera_cm = random.uniform(55.0, 80.0)
                distancia_dentro_cm = random.uniform(55.0, 80.0)
                if not modo_manual:
                    barrera_abierta = False

            publicar_datos(client)
    except KeyboardInterrupt:
        print("\n[SIM-PARQUEADERO] Deteniendo simulador...")
    finally:
        client.publish(T_CONEXION, "offline", retain=True)
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
