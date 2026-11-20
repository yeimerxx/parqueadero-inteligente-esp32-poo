# Guía de Configuración y Ejecución del Broker Mosquitto en Windows

El sistema de parqueadero utiliza el broker MQTT **Eclipse Mosquitto** para permitir el intercambio de datos en tiempo real entre:
1. El microcontrolador **ESP32** (o el simulador en Python) vía **TCP estándar (puerto 1883)**.
2. El **Gemelo Digital Web** vía **WebSockets (puerto 9001)**.

---

## 1. Archivo de Configuración (`mosquitto.conf`)

Copia el contenido del archivo `mosquitto.conf` que está en esta carpeta a la ruta de instalación de Mosquitto en tu equipo (típicamente `C:\Program Files\mosquitto\mosquitto.conf`).

El archivo contiene las directivas necesarias:
```conf
# Puerto MQTT TCP nativo (ESP32 y Simulador Python)
listener 1883 0.0.0.0
protocol mqtt

# Puerto WebSockets (Gemelo Digital en navegador)
listener 9001 0.0.0.0
protocol websockets

# Autenticación
allow_anonymous false
password_file C:/Program Files/mosquitto/passwd
```

---

## 2. Iniciar el Servicio en Windows

Abre una terminal de **PowerShell como Administrador** y ejecuta:

```powershell
# Verificar el estado del servicio
Get-Service mosquitto

# Iniciar el servicio si está detenido
Start-Service mosquitto
```

Si prefieres ejecutarlo manualmente en primer plano para ver los logs en vivo:
```powershell
cd "C:\Program Files\mosquitto"
.\mosquitto.exe -c "C:\Program Files\mosquitto\mosquitto.conf" -v
```

---

## 3. Verificar Reglas de Firewall

Asegúrate de que los puertos `1883` y `9001` tengan permiso en el Firewall de Windows para redes privadas:
```powershell
New-NetFirewallRule -DisplayName "Mosquitto MQTT 1883" -Direction Inbound -LocalPort 1883 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Mosquitto WebSockets 9001" -Direction Inbound -LocalPort 9001 -Protocol TCP -Action Allow
```
