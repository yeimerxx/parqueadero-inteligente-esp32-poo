window.ParkingApp = window.ParkingApp || {};

// Detección de parámetros URL y entorno (GitHub Pages / Localhost)
const urlParams = new URLSearchParams(window.location.search);
const paramBroker = urlParams.get("broker");
const isHttps = window.location.protocol === "https:";
const isGitHubPages = window.location.hostname.includes("github.io") || (isHttps && !window.location.hostname.includes("localhost"));

window.ParkingApp.CONFIG = {
  // Broker MQTT sobre WebSockets (por defecto Mosquitto local en puerto 9001)
  BROKER_URL: paramBroker || "ws://127.0.0.1:9001",
  MQTT_USER: "esp32_user",
  MQTT_PASS: "Esp32Mqtt2026!",
  TOPIC_TELEMETRIA: "parqueadero/telemetria",
  TOPIC_COMANDOS: "parqueadero/comando",
  TOPIC_EVENTO: "parqueadero/evento",
  TOPIC_CONEXION: "parqueadero/conexion",

  IS_GITHUB_PAGES: isGitHubPages,
  AUTO_DEMO: isGitHubPages, // Si abre en GitHub Pages entra directamente en modo interactivo manual

  TOTAL_PLAZAS: 5,
  ISO: {
    OX: 430,
    OY: 72,
    SCALE: 0.74,
    COS30: 0.8660254,
    SIN30: 0.5
  },

  BAYS: [
    { id: 1, label: "P1", u: 155, v: 90, color: "#38bdf8" },
    { id: 2, label: "P2", u: 232, v: 90, color: "#a855f7" },
    { id: 3, label: "P3", u: 309, v: 90, color: "#f59e0b" },
    { id: 4, label: "P4", u: 386, v: 90, color: "#10b981" },
    { id: 5, label: "P5", u: 463, v: 90, color: "#f43f5e" }
  ],

  // Calle ancha de doble carril + acceso único bidireccional
  ROAD_ENTRY_V: 222,
  ROAD_EXIT_V: 282,
  STREET_LEFT_U: -195,
  GATE_CENTER_U: 64,
  GATE_PIVOT_U: 24,
  GATE_V: 182,
  SENSOR_OUT_U: 16,
  SENSOR_OUT_V: 196,
  SENSOR_IN_U: 106,
  SENSOR_IN_V: 164,
  REST_POS: { u: -54, v: 94, facing: 1 },
  PIGGY_POS: { u: -78, v: 96 }
};
