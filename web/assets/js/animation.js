(function (app) {
  const { CONFIG, Renderer } = app;
  const {
    TOTAL_PLAZAS,
    BAYS,
    ROAD_ENTRY_V,
    ROAD_EXIT_V,
    STREET_LEFT_U,
    GATE_CENTER_U,
    GATE_V,
    REST_POS,
    PIGGY_POS
  } = CONFIG;

  const state = {
    bays: [false, false, false, false, false],
    bayCardboard: [false, false, false, false, false],
    cardboardProgress: [0, 0, 0, 0, 0],
    barrierDeg: 0,
    targetBarrierDeg: 0,
    manualBarrierOpen: false,
    manualMode: false,
    lastMqttData: null,
    plazasLibres: TOTAL_PLAZAS,
    ocupados: 0,
    estado: "DISPONIBLE",
    lleno: false,
    distanciaAfueraCm: null,
    distanciaDentroCm: null,
    entradas: 0,
    salidas: 0,
    esp32Online: null,
    coins: 0,
    flyingCoins: [],
    animatingCars: [],
    worker: {
      u: REST_POS.u,
      v: REST_POS.v,
      facing: REST_POS.facing,
      walking: false,
      walkPhase: 0,
      leanDeg: 0,
      holdingCardboard: false
    },
    busy: false,
    queue: [],
    history: []
  };

  let sceneRefs = null;
  let solarHudTimer = null;

  function setSceneRefs(refs) {
    sceneRefs = refs;
  }

  function renderAllCars() {
    const layerCars = sceneRefs.layers.cars;
    while (layerCars.firstChild) layerCars.removeChild(layerCars.firstChild);

    const drawables = [];
    state.bays.forEach((occ, idx) => {
      if (occ) {
        const b = BAYS[idx];
        drawables.push({
          kind: "car",
          depth: b.u + b.v,
          u: b.u,
          v: b.v,
          yaw: -Math.PI / 2,
          color: b.color,
          cardboardProgress: state.cardboardProgress[idx]
        });
      }
    });

    state.animatingCars.forEach((c) => {
      drawables.push({
        kind: "car",
        depth: c.u + c.v,
        u: c.u,
        v: c.v,
        yaw: c.yaw,
        color: c.color,
        cardboardProgress: c.cardboardProgress || 0
      });
    });

    drawables.push({
      kind: "worker",
      depth: state.worker.u + state.worker.v + 2
    });

    drawables.sort((a, b) => a.depth - b.depth);
    drawables.forEach((item) => {
      if (item.kind === "car") {
        Renderer.drawVehicle(layerCars, item.u, item.v, item.yaw, item.color, item.cardboardProgress);
      } else {
        Renderer.drawWorker(layerCars, state.worker);
      }
    });
  }

  function updateBaysHUD() {
    state.bays.forEach((occ, idx) => {
      const led = sceneRefs.bayLedNodes[idx];
      const hud = sceneRefs.bayHudNodes[idx];
      if (occ) {
        led.setAttribute("fill", "#ef4444");
        led.setAttribute("filter", "url(#glowRed)");
        hud.rect.setAttribute("stroke", "#ef4444");
        hud.txt.setAttribute("fill", "#fca5a5");
        hud.txt.textContent = `${hud.label} OCUP`;
      } else {
        led.setAttribute("fill", "#22c55e");
        led.setAttribute("filter", "url(#glowGreen)");
        hud.rect.setAttribute("stroke", "#22c55e");
        hud.txt.setAttribute("fill", "#86efac");
        hud.txt.textContent = `${hud.label} LIBRE`;
      }
    });

    if (sceneRefs.boothLcdText) {
      sceneRefs.boothLcdText.textContent = `ESP32 · ${state.plazasLibres}/${TOTAL_PLAZAS}`;
    }
  }

  function animateBarrierTo(deg, duration = 420) {
    state.targetBarrierDeg = deg;
    const startDeg = state.barrierDeg;
    const startTime = performance.now();

    return new Promise((resolve) => {
      function step(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        state.barrierDeg = startDeg + (deg - startDeg) * ease;
        Renderer.renderBarrierArm(sceneRefs.barrierArmGroup, state.barrierDeg);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          state.barrierDeg = deg;
          Renderer.renderBarrierArm(sceneRefs.barrierArmGroup, deg);
          if (app.UI && app.UI.updateKPIs) app.UI.updateKPIs();
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  function tweenCar(car, waypoints, totalMs) {
    const segs = [];
    let totalLen = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      const len = Math.hypot(b.u - a.u, b.v - a.v) || 1;
      segs.push({ a, b, len });
      totalLen += len;
    }

    const start = performance.now();
    return new Promise((resolve) => {
      function frame(now) {
        const p = Math.min(1, (now - start) / totalMs);
        let targetDist = p * totalLen;
        for (const seg of segs) {
          if (targetDist <= seg.len || seg === segs[segs.length - 1]) {
            const localT = Math.min(1, targetDist / seg.len);
            car.u = seg.a.u + (seg.b.u - seg.a.u) * localT;
            car.v = seg.a.v + (seg.b.v - seg.a.v) * localT;
            let diff = seg.b.yaw - seg.a.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            car.yaw = seg.a.yaw + diff * localT;
            break;
          }
          targetDist -= seg.len;
        }
        renderAllCars();
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  const sensorTimers = { out: null, in: null };

  function flashSensor(which = "out", isExit = false, ms = 1800) {
    if (!sceneRefs) return;
    const node = which === "in" ? sceneRefs.sensorInGroup : sceneRefs.sensorOutGroup;
    if (!node) return;
    node.classList.toggle("sensor-exit", isExit);
    node.classList.add("sensor-active");
    if (sensorTimers[which]) clearTimeout(sensorTimers[which]);
    sensorTimers[which] = setTimeout(() => {
      node.classList.remove("sensor-active", "sensor-exit");
      sensorTimers[which] = null;
    }, ms);
  }

  function setSensorLiveState(outActive, inActive) {
    if (!sceneRefs) return;
    if (sceneRefs.sensorOutGroup && !sensorTimers.out) {
      sceneRefs.sensorOutGroup.classList.toggle("sensor-active", Boolean(outActive));
      sceneRefs.sensorOutGroup.classList.remove("sensor-exit");
    }
    if (sceneRefs.sensorInGroup && !sensorTimers.in) {
      sceneRefs.sensorInGroup.classList.toggle("sensor-active", Boolean(inActive));
      sceneRefs.sensorInGroup.classList.toggle("sensor-exit", Boolean(inActive));
    }
  }

  function animateCoinToss(fromU, fromV, duration = 560) {
    if (!sceneRefs || !sceneRefs.flyingCoinsGroup) return Promise.resolve();
    const coin = { u: fromU, v: fromV, z: 20 };
    state.flyingCoins.push(coin);

    const start = performance.now();
    return new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - t, 2);
        coin.u = fromU + (PIGGY_POS.u - fromU) * ease;
        coin.v = fromV + (PIGGY_POS.v - fromV) * ease;
        // Parábola en altura (z) desde el techo del carro hasta la ranura de la alcancía
        const arc = 4 * t * (1 - t) * 58;
        coin.z = 20 * (1 - t) + 42 * t + arc;

        Renderer.renderFlyingCoins(sceneRefs.flyingCoinsGroup, state.flyingCoins);
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          state.flyingCoins = state.flyingCoins.filter((c) => c !== coin);
          Renderer.renderFlyingCoins(sceneRefs.flyingCoinsGroup, state.flyingCoins);
          state.coins += 1;
          Renderer.renderPiggyBank(sceneRefs.piggyGroup, state.coins);
          showSolarHud(PIGGY_POS.u, PIGGY_POS.v, `🪙 +1 Moneda (Total: ${state.coins})`, 1800);
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function showSolarHud(u, v, text = "Protección Solar (Cartón)", ms = 2800) {
    const hud = document.getElementById("solar-hud");
    const hudTxt = document.getElementById("solar-hud-text");
    const stageCard = document.querySelector(".stage-card");
    const sceneSvg = document.getElementById("scene");
    if (!hud || !stageCard || !sceneSvg) return;

    const p = Renderer.iso(u, v, 52);
    const svgRect = sceneSvg.getBoundingClientRect();
    const cardRect = stageCard.getBoundingClientRect();
    const leftPx = (svgRect.left - cardRect.left) + (p.x / 960) * svgRect.width;
    const topPx = (svgRect.top - cardRect.top) + (p.y / 560) * svgRect.height;

    hud.style.left = `${leftPx.toFixed(1)}px`;
    hud.style.top = `${topPx.toFixed(1)}px`;
    hudTxt.textContent = text;
    hud.classList.add("visible");

    if (solarHudTimer) clearTimeout(solarHudTimer);
    solarHudTimer = setTimeout(() => hud.classList.remove("visible"), ms);
  }

  function walkWorkerTo(waypoints, totalMs, interruptible = false) {
    const fullPts = [{ u: state.worker.u, v: state.worker.v }, ...waypoints];
    const segs = [];
    let totalLen = 0;
    for (let i = 0; i < fullPts.length - 1; i++) {
      const a = fullPts[i];
      const b = fullPts[i + 1];
      const len = Math.hypot(b.u - a.u, b.v - a.v);
      if (len > 0.5) {
        segs.push({ a, b, len });
        totalLen += len;
      }
    }
    if (totalLen < 1) {
      state.worker.walking = false;
      renderAllCars();
      return Promise.resolve(false);
    }

    const start = performance.now();
    state.worker.walking = true;

    return new Promise((resolve) => {
      function frame(now) {
        if (interruptible && state.queue.length > 0) {
          state.worker.walking = false;
          renderAllCars();
          resolve(true);
          return;
        }

        const p = Math.min(1, (now - start) / totalMs);
        let targetDist = p * totalLen;
        for (const seg of segs) {
          if (targetDist <= seg.len || seg === segs[segs.length - 1]) {
            const localT = Math.min(1, targetDist / seg.len);
            const nextU = seg.a.u + (seg.b.u - seg.a.u) * localT;
            const nextV = seg.a.v + (seg.b.v - seg.a.v) * localT;
            const dxIso = (nextU - state.worker.u) - (nextV - state.worker.v);
            if (Math.abs(dxIso) > 0.05) {
              state.worker.facing = dxIso >= 0 ? 1 : -1;
            }
            state.worker.u = nextU;
            state.worker.v = nextV;
            break;
          }
          targetDist -= seg.len;
        }

        state.worker.walkPhase = (now - start) * 0.018;
        renderAllCars();

        if (p < 1) requestAnimationFrame(frame);
        else {
          state.worker.walking = false;
          renderAllCars();
          resolve(false);
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function tweenWorkerAction(durationMs, onStep) {
    const start = performance.now();
    return new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - start) / durationMs);
        onStep(t);
        renderAllCars();
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function workerWaypointsToBay(bay) {
    const ptsOut = [];
    if (state.worker.u < 20) {
      ptsOut.push({ u: 12, v: 114 }, { u: 96, v: 152 });
    } else {
      ptsOut.push({ u: state.worker.u, v: 152 });
    }
    ptsOut.push({ u: bay.u + 22, v: 152 }, { u: bay.u + 22, v: bay.v - 8 });
    return ptsOut;
  }

  async function workerPlaceCardboard(bayIdx) {
    const bay = BAYS[bayIdx];
    state.worker.holdingCardboard = true;
    await walkWorkerTo(workerWaypointsToBay(bay), 450);

    state.worker.facing = -1;
    await tweenWorkerAction(280, (t) => {
      state.worker.leanDeg = 22 * Math.sin(t * Math.PI * 0.5);
      state.cardboardProgress[bayIdx] = t;
    });
    state.worker.holdingCardboard = false;
    state.bayCardboard[bayIdx] = true;
    state.cardboardProgress[bayIdx] = 1;
    showSolarHud(bay.u, bay.v, "Protección Solar (Cartón)", 2200);

    await tweenWorkerAction(140, (t) => {
      state.worker.leanDeg = 22 * (1 - t);
    });
    state.worker.leanDeg = 0;
    renderAllCars();
  }

  async function workerRemoveCardboard(bayIdx) {
    const bay = BAYS[bayIdx];
    if (!state.bayCardboard[bayIdx] && state.cardboardProgress[bayIdx] <= 0) {
      return;
    }

    await walkWorkerTo(workerWaypointsToBay(bay), 420);

    state.worker.facing = -1;
    await tweenWorkerAction(240, (t) => {
      state.worker.leanDeg = 20 * Math.sin(t * Math.PI * 0.5);
      state.cardboardProgress[bayIdx] = 1 - t;
    });
    state.bayCardboard[bayIdx] = false;
    state.cardboardProgress[bayIdx] = 0;
    state.worker.holdingCardboard = true;
    showSolarHud(bay.u, bay.v, "Cartón Retirado", 1200);

    await tweenWorkerAction(120, (t) => {
      state.worker.leanDeg = 20 * (1 - t);
    });
    state.worker.leanDeg = 0;

    await walkWorkerTo([{ u: bay.u + 26, v: 154 }], 150);
  }

  async function workerReturnToRest() {
    if (state.queue.length > 0) return;
    const interrupted = await walkWorkerTo([
      { u: state.worker.u, v: 152 },
      { u: 96, v: 152 },
      { u: 12, v: 114 },
      { u: REST_POS.u, v: REST_POS.v }
    ], 1000, true);
    if (!interrupted) {
      state.worker.facing = REST_POS.facing;
      state.worker.holdingCardboard = false;
      renderAllCars();
    }
  }

  async function animateEntry(targetBayIdx) {
    const bay = BAYS[targetBayIdx];
    const car = { u: STREET_LEFT_U, v: ROAD_ENTRY_V, yaw: 0, color: bay.color, cardboardProgress: 0 };
    state.animatingCars.push(car);
    renderAllCars();

    // El vehículo llega hasta la puerta por el carril de entrada mientras sube la barrera
    await tweenCar(car, [
      { u: STREET_LEFT_U, v: ROAD_ENTRY_V, yaw: 0 },
      { u: GATE_CENTER_U - 14, v: ROAD_ENTRY_V, yaw: 0 }
    ], 280);

    // Sensor exterior (S1 EXT) detecta llegada (1-8 cm) y abre la barrera
    flashSensor("out", false, 1200);
    await animateBarrierTo(90, 180);

    // Cruza el acceso único hacia el pasillo interno (S2 INT confirma entrada) y estaciona
    setTimeout(() => flashSensor("in", false, 1100), 160);
    await tweenCar(car, [
      { u: GATE_CENTER_U - 14, v: ROAD_ENTRY_V, yaw: 0 },
      { u: GATE_CENTER_U, v: GATE_V, yaw: -Math.PI / 2 },
      { u: GATE_CENTER_U + 14, v: 158, yaw: 0 },
      { u: bay.u - 12, v: 158, yaw: 0 },
      { u: bay.u, v: 140, yaw: -Math.PI / 2 },
      { u: bay.u, v: bay.v, yaw: -Math.PI / 2 }
    ], 680);

    state.animatingCars = state.animatingCars.filter((c) => c !== car);
    state.bays[targetBayIdx] = true;
    state.bayCardboard[targetBayIdx] = false;
    state.cardboardProgress[targetBayIdx] = 0;
    updateBaysHUD();
    renderAllCars();

    if (!state.manualBarrierOpen) {
      await animateBarrierTo(0, 180);
    }

    await workerPlaceCardboard(targetBayIdx);
    workerReturnToRest();
  }

  async function animateExit(sourceBayIdx) {
    const bay = BAYS[sourceBayIdx];
    await workerRemoveCardboard(sourceBayIdx);

    state.bays[sourceBayIdx] = false;
    state.bayCardboard[sourceBayIdx] = false;
    state.cardboardProgress[sourceBayIdx] = 0;
    updateBaysHUD();

    const car = { u: bay.u, v: bay.v, yaw: -Math.PI / 2, color: bay.color, cardboardProgress: 0 };
    state.animatingCars.push(car);
    renderAllCars();

    // Sale de la bahía hacia la misma puerta única bidireccional
    await tweenCar(car, [
      { u: bay.u, v: bay.v, yaw: Math.PI / 2 },
      { u: bay.u, v: 158, yaw: Math.PI },
      { u: GATE_CENTER_U + 16, v: 158, yaw: Math.PI }
    ], 360);

    // Sensor interior (S2 INT) detecta salida (1-16 cm) y abre la barrera
    flashSensor("in", true, 1200);
    await animateBarrierTo(90, 180);

    // Cruza la barrera abierta (S1 EXT confirma salida) y toma el carril de salida
    setTimeout(() => flashSensor("out", true, 1100), 160);
    // El vehículo lanza una moneda hacia la alcancía del señor del cartón al salir
    setTimeout(() => animateCoinToss(GATE_CENTER_U - 12, ROAD_EXIT_V - 6), 240);
    await tweenCar(car, [
      { u: GATE_CENTER_U + 16, v: 158, yaw: Math.PI },
      { u: GATE_CENTER_U, v: GATE_V, yaw: Math.PI / 2 },
      { u: GATE_CENTER_U, v: ROAD_EXIT_V, yaw: Math.PI },
      { u: STREET_LEFT_U, v: ROAD_EXIT_V, yaw: Math.PI }
    ], 580);

    state.animatingCars = state.animatingCars.filter((c) => c !== car);
    state.worker.holdingCardboard = false;
    renderAllCars();

    if (!state.manualBarrierOpen) {
      await animateBarrierTo(0, 180);
    }

    workerReturnToRest();
  }

  function reconcileBaysToCount(targetOccupied) {
    let current = state.bays.filter(Boolean).length;
    while (current < targetOccupied) {
      const freeIdx = state.bays.findIndex((v) => !v);
      if (freeIdx === -1) break;
      state.bays[freeIdx] = true;
      state.bayCardboard[freeIdx] = true;
      state.cardboardProgress[freeIdx] = 1;
      current++;
    }
    while (current > targetOccupied) {
      const occIdx = state.bays.lastIndexOf(true);
      if (occIdx === -1) break;
      state.bays[occIdx] = false;
      state.bayCardboard[occIdx] = false;
      state.cardboardProgress[occIdx] = 0;
      current--;
    }
    updateBaysHUD();
    renderAllCars();
  }

  async function processQueue() {
    if (state.busy) return;
    state.busy = true;
    while (state.queue.length > 0) {
      const item = state.queue.shift();
      const evt = (item.evento || "").toUpperCase();
      const targetOcc = Math.max(0, Math.min(TOTAL_PLAZAS, Number(item.ocupados ?? 0)));
      const currentVisualOcc = state.bays.filter(Boolean).length;

      if (evt === "ABRIR" || evt === "ABRIR_REMOTO") {
        if (item.keepManualFlag !== false) state.manualBarrierOpen = true;
        await animateBarrierTo(90, 200);
      } else if (evt === "CERRAR" || evt === "CERRAR_REMOTO") {
        state.manualBarrierOpen = false;
        await animateBarrierTo(0, 200);
      } else if (evt === "INICIO") {
        reconcileBaysToCount(targetOcc);
        if (!state.manualBarrierOpen) {
          await animateBarrierTo(0, 260);
        }
      } else if (evt === "ENTRADA" || targetOcc > currentVisualOcc) {
        const freeIdx = (item.bayIdx !== undefined && !state.bays[item.bayIdx])
          ? item.bayIdx
          : state.bays.findIndex((v) => !v);
        if (freeIdx !== -1) {
          await animateEntry(freeIdx);
        }
        reconcileBaysToCount(targetOcc);
      } else if (evt === "SALIDA" || targetOcc < currentVisualOcc) {
        const occIdx = (item.bayIdx !== undefined && state.bays[item.bayIdx])
          ? item.bayIdx
          : state.bays.findIndex((v) => v);
        if (occIdx !== -1) {
          await animateExit(occIdx);
        }
        reconcileBaysToCount(targetOcc);
      }
    }
    state.busy = false;

    // Sincronizar ángulo final de la barrera virtual con el estado físico real del ESP32
    if (!state.manualMode && state.lastMqttData && state.lastMqttData.barrera) {
      const physicalOpen = String(state.lastMqttData.barrera).toUpperCase() === "ABIERTA";
      const wantDeg = physicalOpen ? 90 : 0;
      if (Math.abs(state.targetBarrierDeg - wantDeg) > 10) {
        await animateBarrierTo(wantDeg, 180);
      }
    }
  }

  app.Engine = {
    state,
    setSceneRefs,
    renderAllCars,
    updateBaysHUD,
    setSensorLiveState,
    processQueue
  };
})(window.ParkingApp);
