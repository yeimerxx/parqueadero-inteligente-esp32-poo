(function (app) {
  const { CONFIG, Renderer, Engine } = app;
  const { state } = Engine;

  let hasInitializedFromMqtt = false;
  let lastSyncedOcupados = 0;
  let lastSyncedBarrier = "CERRADA";

  function formatDist(val) {
    return val !== null && val !== undefined && !Number.isNaN(Number(val))
      ? `${Number(val).toFixed(1)} cm`
      : "N/A";
  }

  function updateKPIs() {
    const kpiLibres = document.getElementById("kpi-libres");
    const kpiOcupados = document.getElementById("kpi-ocupados");
    const kpiEstado = document.getElementById("kpi-estado");
    const kpiBarrera = document.getElementById("kpi-barrera");
    const kpiSensorAfuera = document.getElementById("kpi-sensor-afuera");
    const kpiSensorDentro = document.getElementById("kpi-sensor-dentro");
    const fullAlert = document.getElementById("full-alert");

    kpiLibres.textContent = `${state.plazasLibres} / ${CONFIG.TOTAL_PLAZAS}`;
    kpiLibres.className = "kpi-value " + (state.plazasLibres === 0 ? "full" : "ok");
    kpiOcupados.textContent = state.ocupados;

    kpiEstado.textContent = state.estado;
    kpiEstado.className = "kpi-value " + (state.estado === "LLENO" ? "full" : "ok");

    const barreraAbierta = state.targetBarrierDeg > 45 || state.manualBarrierOpen;
    kpiBarrera.textContent = barreraAbierta ? "ABIERTA" : "CERRADA";
    kpiBarrera.className = "kpi-value " + (barreraAbierta ? "ok" : "warn");

    const outDetect = state.distanciaAfueraCm !== null && state.distanciaAfueraCm >= 1 && state.distanciaAfueraCm <= 8;
    const inDetect = state.distanciaDentroCm !== null && state.distanciaDentroCm >= 1 && state.distanciaDentroCm <= 16;

    if (kpiSensorAfuera) {
      kpiSensorAfuera.textContent = formatDist(state.distanciaAfueraCm);
      kpiSensorAfuera.className = "kpi-value " + (outDetect ? "ok" : "info");
    }
    if (kpiSensorDentro) {
      kpiSensorDentro.textContent = formatDist(state.distanciaDentroCm);
      kpiSensorDentro.className = "kpi-value " + (inDetect ? "warn" : "info");
    }

    if (Engine.setSensorLiveState) {
      Engine.setSensorLiveState(outDetect, inDetect);
    }

    fullAlert.classList.toggle("visible", state.lleno || state.plazasLibres === 0);
  }

  function mapBadgeClass(evento) {
    if (evento.includes("LLENO")) return "LLENO";
    if (evento.includes("ENTRADA")) return "ENTRADA";
    if (evento.includes("SALIDA")) return "SALIDA";
    if (evento.includes("APERTURA") || evento === "ABRIR") return "ABRIR";
    if (evento.includes("CIERRE") || evento === "CERRAR") return "CERRAR";
    return "INICIO";
  }

  function pushHistory(evento, libres) {
    const normEvt = evento.replace("_REMOTO", "").replace("_REGISTRADA", "");
    const now = new Date().toLocaleTimeString();
    state.history.unshift({
      evento: normEvt,
      badge: mapBadgeClass(normEvt),
      libres,
      time: now
    });
    if (state.history.length > 5) state.history.pop();

    const ul = document.getElementById("history-list");
    ul.innerHTML = state.history
      .map((h) => `
        <li class="history-item">
          <span class="evt-badge evt-${h.badge}">${h.evento}</span>
          <span>Libres: <strong>${h.libres}/${CONFIG.TOTAL_PLAZAS}</strong></span>
          <span class="evt-time">${h.time}</span>
        </li>
      `)
      .join("");
  }

  app.UI = { updateKPIs, pushHistory };

  function applyTelemetry(data, forceSync = false) {
    const disponibles = Number(data.disponibles ?? data.plazas_libres ?? CONFIG.TOTAL_PLAZAS);
    const ocupados = Math.max(0, Math.min(CONFIG.TOTAL_PLAZAS, Number(data.ocupados ?? (CONFIG.TOTAL_PLAZAS - disponibles))));
    const barrera = String(data.barrera || "CERRADA").toUpperCase();

    state.plazasLibres = Math.max(0, Math.min(CONFIG.TOTAL_PLAZAS, disponibles));
    state.ocupados = ocupados;
    state.lleno = typeof data.lleno === "boolean" ? data.lleno : state.plazasLibres === 0;
    state.estado = data.estado || (state.lleno ? "LLENO" : "DISPONIBLE");

    const distAfuera = data.distancia_afuera_cm !== undefined ? data.distancia_afuera_cm : data.distancia_cm;
    const distDentro = data.distancia_dentro_cm;
    state.distanciaAfueraCm = distAfuera !== null && distAfuera !== undefined ? Number(distAfuera) : null;
    state.distanciaDentroCm = distDentro !== null && distDentro !== undefined ? Number(distDentro) : null;

    state.entradas = Number(data.entradas ?? state.entradas);
    state.salidas = Number(data.salidas ?? state.salidas);

    const hudSync = document.getElementById("hud-sync");
    const espTxt = state.esp32Online === null ? "" : (state.esp32Online ? "ESP32 Online · " : "ESP32 Offline · ");
    hudSync.textContent = `${espTxt}Ext: ${formatDist(state.distanciaAfueraCm)} · Int: ${formatDist(state.distanciaDentroCm)} · E:${state.entradas} S:${state.salidas}`;

    updateKPIs();

    // Primera sincronización al cargar o al volver de Modo Manual
    if (!hasInitializedFromMqtt || forceSync) {
      hasInitializedFromMqtt = true;
      lastSyncedOcupados = ocupados;
      lastSyncedBarrier = barrera;
      state.manualBarrierOpen = barrera === "ABIERTA";
      pushHistory("INICIO", state.plazasLibres);
      state.queue.push({ evento: "INICIO", ocupados, plazas_libres: state.plazasLibres });
      if (state.manualBarrierOpen) {
        state.queue.push({ evento: "ABRIR", ocupados, plazas_libres: state.plazasLibres });
      }
      Engine.processQueue();
      return;
    }

    // Detectar cambios reales de ocupación entre publicaciones periódicas de 1s
    if (ocupados > lastSyncedOcupados) {
      const diff = ocupados - lastSyncedOcupados;
      for (let i = 0; i < diff; i++) {
        state.queue.push({ evento: "ENTRADA", ocupados, plazas_libres: state.plazasLibres });
      }
      pushHistory("ENTRADA", state.plazasLibres);
      lastSyncedOcupados = ocupados;
      Engine.processQueue();
    } else if (ocupados < lastSyncedOcupados) {
      const diff = lastSyncedOcupados - ocupados;
      for (let i = 0; i < diff; i++) {
        state.queue.push({ evento: "SALIDA", ocupados, plazas_libres: state.plazasLibres });
      }
      pushHistory("SALIDA", state.plazasLibres);
      lastSyncedOcupados = ocupados;
      Engine.processQueue();
    } else if (barrera !== lastSyncedBarrier) {
      const isManual = String(data.modo || "").toUpperCase() === "MANUAL";
      state.manualBarrierOpen = isManual && barrera === "ABIERTA";
      if (!Engine.state.busy) {
        state.queue.push({
          evento: barrera === "ABIERTA" ? "ABRIR" : "CERRAR",
          ocupados,
          plazas_libres: state.plazasLibres,
          keepManualFlag: isManual
        });
        Engine.processQueue();
      }
    }

    lastSyncedBarrier = barrera;
  }

  function init() {
    const refs = Renderer.buildStaticScene();
    Engine.setSceneRefs(refs);
    Engine.updateBaysHUD();
    Engine.renderAllCars();
    updateKPIs();

    const connPill = document.getElementById("conn-pill");
    const connText = document.getElementById("conn-text");
    const hudSync = document.getElementById("hud-sync");
    const modeBtn = document.getElementById("mode-toggle-btn");
    const modeText = document.getElementById("mode-toggle-text");

    let client = null;

    function setManualMode(enable) {
      state.manualMode = enable;
      document.body.classList.toggle("manual-mode", state.manualMode);
      modeBtn.setAttribute("aria-pressed", String(state.manualMode));
      modeText.textContent = state.manualMode ? "Modo: Manual" : "Modo: Automático (MQTT)";

      if (state.manualMode) {
        if (client && client.connected) {
          client.publish(CONFIG.TOPIC_COMANDOS, "MANUAL");
        }
        hudSync.textContent = "Modo Manual activo (control físico y virtual)";
      } else {
        if (client && client.connected) {
          client.publish(CONFIG.TOPIC_COMANDOS, "AUTO");
        }
        if (state.lastMqttData) {
          applyTelemetry(state.lastMqttData, true);
        } else {
          hudSync.textContent = "Modo Automático (esperando MQTT...)";
        }
      }
    }

    try {
      client = mqtt.connect(CONFIG.BROKER_URL, {
        clientId: "GemeloDigital-" + Math.random().toString(16).slice(2, 8),
        username: CONFIG.MQTT_USER,
        password: CONFIG.MQTT_PASS,
        reconnectPeriod: 4000,
        connectTimeout: 4000
      });

      client.on("connect", () => {
        connPill.classList.add("online");
        connText.textContent = "Conectado (WS :9001)";
        client.subscribe([
          CONFIG.TOPIC_TELEMETRIA,
          CONFIG.TOPIC_EVENTO,
          CONFIG.TOPIC_CONEXION
        ]);
      });

      client.on("close", () => {
        connPill.classList.remove("online");
        connText.textContent = "Desconectado";
      });

      client.on("error", (err) => {
        connPill.classList.remove("online");
        connText.textContent = CONFIG.IS_GITHUB_PAGES ? "Modo Web Demo" : "Error de conexión";
        console.warn("Aviso conexión MQTT:", err ? err.message : err);
      });

      client.on("message", (topic, payload) => {
        const raw = payload.toString();

        if (topic === CONFIG.TOPIC_CONEXION) {
          state.esp32Online = raw.trim().toLowerCase() === "online";
          return;
        }

        if (topic === CONFIG.TOPIC_EVENTO) {
          const evt = raw.trim().toUpperCase();
          if (!state.manualMode && evt !== "ENTRADA_REGISTRADA" && evt !== "SALIDA_REGISTRADA") {
            pushHistory(evt, state.plazasLibres);
          }
          return;
        }

        if (topic !== CONFIG.TOPIC_TELEMETRIA) return;
        try {
          const data = JSON.parse(raw);
          state.lastMqttData = data;
          if (!state.manualMode) {
            applyTelemetry(data);
          }
        } catch (err) {
          console.error("Error procesando telemetría MQTT:", err);
        }
      });
    } catch (err) {
      console.warn("No se pudo inicializar WebSocket MQTT:", err);
      connText.textContent = "Modo Web Demo";
    }

    // Si está desplegado en GitHub Pages o no hay broker activo tras 2.5s, activar modo interactivo
    if (CONFIG.AUTO_DEMO) {
      setManualMode(true);
      hudSync.textContent = "Demostración Interactiva (Haz clic en bahías o botones)";
    } else {
      setTimeout(() => {
        if (!client || !client.connected) {
          hudSync.textContent = "Esperando telemetría (o activa Modo Manual para probar)";
        }
      }, 3000);
    }

    function runManualAction(evento, bayIdx) {
      if (!state.manualMode) return;

      if (evento === "ENTRADA") {
        if (state.ocupados >= CONFIG.TOTAL_PLAZAS) return;
        state.ocupados += 1;
        if (client && client.connected) client.publish(CONFIG.TOPIC_COMANDOS, "ENTRADA_MANUAL");
      } else if (evento === "SALIDA") {
        if (state.ocupados <= 0) return;
        state.ocupados -= 1;
        if (client && client.connected) client.publish(CONFIG.TOPIC_COMANDOS, "SALIDA_MANUAL");
      } else if (evento === "INICIO") {
        state.ocupados = 0;
        state.manualBarrierOpen = false;
        if (client && client.connected) client.publish(CONFIG.TOPIC_COMANDOS, "RESET");
      } else if (evento === "ABRIR" || evento === "CERRAR") {
        if (client && client.connected) client.publish(CONFIG.TOPIC_COMANDOS, evento);
      }

      state.plazasLibres = CONFIG.TOTAL_PLAZAS - state.ocupados;
      state.lleno = state.plazasLibres === 0;
      state.estado = state.lleno ? "LLENO" : "DISPONIBLE";
      hudSync.textContent = `Manual: ${evento} · ${new Date().toLocaleTimeString()}`;
      updateKPIs();
      pushHistory(evento, state.plazasLibres);

      state.queue.push({
        evento,
        ocupados: state.ocupados,
        plazas_libres: state.plazasLibres,
        bayIdx
      });
      Engine.processQueue();
    }

    modeBtn.addEventListener("click", () => {
      setManualMode(!state.manualMode);
    });

    document.getElementById("btn-manual-entry").addEventListener("click", () => runManualAction("ENTRADA"));
    document.getElementById("btn-manual-exit").addEventListener("click", () => runManualAction("SALIDA"));
    document.getElementById("btn-manual-barrier").addEventListener("click", () => {
      const cmd = (state.targetBarrierDeg > 45 || state.manualBarrierOpen) ? "CERRAR" : "ABRIR";
      runManualAction(cmd);
    });
    document.getElementById("btn-manual-reset").addEventListener("click", () => runManualAction("INICIO"));

    document.getElementById("layer-bays").addEventListener("click", (e) => {
      if (!state.manualMode) return;
      const surface = e.target.closest(".bay-surface");
      if (!surface) return;
      const idx = Number(surface.getAttribute("data-bay-idx"));
      if (Number.isNaN(idx) || state.queue.some((q) => q.bayIdx === idx)) return;
      runManualAction(state.bays[idx] ? "SALIDA" : "ENTRADA", idx);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window.ParkingApp);
