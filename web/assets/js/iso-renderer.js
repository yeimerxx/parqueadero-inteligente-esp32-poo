(function (app) {
  const {
    ISO,
    BAYS,
    GATE_PIVOT_U,
    GATE_CENTER_U,
    GATE_V,
    SENSOR_OUT_U,
    SENSOR_OUT_V,
    SENSOR_IN_U,
    SENSOR_IN_V,
    PIGGY_POS
  } = app.CONFIG;
  const SVG_NS = "http://www.w3.org/2000/svg";

  function iso(u, v, z = 0) {
    return {
      x: ISO.OX + (u - v) * ISO.COS30 * ISO.SCALE,
      y: ISO.OY + (u + v) * ISO.SIN30 * ISO.SCALE - z * ISO.SCALE
    };
  }

  function pts(points) {
    return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  function el(tag, attrs = {}, parent = null) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, v);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function drawIsoBox(parent, u0, v0, z0, du, dv, dz, colors) {
    const p000 = iso(u0, v0, z0);
    const p100 = iso(u0 + du, v0, z0);
    const p110 = iso(u0 + du, v0 + dv, z0);
    const p010 = iso(u0, v0 + dv, z0);

    const p001 = iso(u0, v0, z0 + dz);
    const p101 = iso(u0 + du, v0, z0 + dz);
    const p111 = iso(u0 + du, v0 + dv, z0 + dz);
    const p011 = iso(u0, v0 + dv, z0 + dz);

    const g = el("g", {}, parent);
    el("polygon", {
      points: pts([p010, p110, p111, p011]),
      fill: colors.front,
      stroke: colors.stroke || "none",
      "stroke-width": colors.strokeWidth || 0.6
    }, g);
    el("polygon", {
      points: pts([p100, p110, p111, p101]),
      fill: colors.right,
      stroke: colors.stroke || "none",
      "stroke-width": colors.strokeWidth || 0.6
    }, g);
    el("polygon", {
      points: pts([p001, p101, p111, p011]),
      fill: colors.top,
      stroke: colors.stroke || "none",
      "stroke-width": colors.strokeWidth || 0.6
    }, g);
    return g;
  }

  // Franjas blancas de paso en el acceso único bidireccional (eje u bajo la talanquera)
  function drawGateCrosswalkStripes(parent) {
    const v0 = GATE_V - 9;
    const v1 = GATE_V + 9;
    for (let u = GATE_CENTER_U - 34; u <= GATE_CENTER_U + 24; u += 14) {
      el("polygon", {
        points: pts([
          iso(u, v0, 0.9),
          iso(u + 8, v0, 0.9),
          iso(u + 8, v1, 0.9),
          iso(u, v1, 0.9)
        ]),
        fill: "rgba(248, 250, 252, 0.85)"
      }, parent);
    }
  }

  // Barrera vehicular única que rota 0° (horizontal sobre el acceso) -> 90° (vertical abierta)
  function renderBarrierArm(armGroup, deg) {
    while (armGroup.firstChild) armGroup.removeChild(armGroup.firstChild);
    const rad = (deg * Math.PI) / 180;
    const len = 82;
    const pivotU = GATE_PIVOT_U;
    const pivotV = GATE_V;
    const pivotZ = 21;

    const segments = 6;
    for (let i = 0; i < segments; i++) {
      const d0 = (len * i) / segments;
      const d1 = (len * (i + 1)) / segments;
      const p0 = iso(pivotU + d0 * Math.cos(rad), pivotV, pivotZ + d0 * Math.sin(rad));
      const p1 = iso(pivotU + d1 * Math.cos(rad), pivotV, pivotZ + d1 * Math.sin(rad));
      el("line", {
        x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y,
        stroke: i % 2 === 0 ? "#ef4444" : "#f8fafc",
        "stroke-width": 5.5,
        "stroke-linecap": "butt"
      }, armGroup);
    }

    const piv = iso(pivotU, pivotV, pivotZ);
    el("circle", {
      cx: piv.x, cy: piv.y, r: 4.5,
      fill: "#0f172a", stroke: "#f8fafc", "stroke-width": 1.5
    }, armGroup);
  }

  function shadeHex(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * factor)));
    const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * factor)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * factor)));
    return `rgb(${r},${g},${b})`;
  }

  function drawVehicle(parent, u, v, yawRad, color, cardboardProgress = 0) {
    const g = el("g", {}, parent);
    const c = Math.cos(yawRad);
    const s = Math.sin(yawRad);

    function localIso(lu, lv, lz) {
      return iso(u + (lu * c - lv * s), v + (lu * s + lv * c), lz);
    }

    const sh = [
      localIso(-22, -13, 1.2),
      localIso(22, -13, 1.2),
      localIso(22, 13, 1.2),
      localIso(-22, 13, 1.2)
    ];
    el("polygon", { points: pts(sh), fill: "rgba(0,0,0,0.45)" }, g);

    function drawOrientedBox(lu0, lu1, lv0, lv1, lz0, lz1, colTop, colSideA, colSideB) {
      const corners = [
        { lu: lu0, lv: lv0 }, { lu: lu1, lv: lv0 },
        { lu: lu1, lv: lv1 }, { lu: lu0, lv: lv1 }
      ];
      const bot = corners.map((k) => localIso(k.lu, k.lv, lz0));
      const top = corners.map((k) => localIso(k.lu, k.lv, lz1));

      const faces = [0, 1, 2, 3].map((i) => {
        const j = (i + 1) % 4;
        const midLu = (corners[i].lu + corners[j].lu) / 2;
        const midLv = (corners[i].lv + corners[j].lv) / 2;
        const depth = (u + midLu * c - midLv * s) + (v + midLu * s + midLv * c);
        return { i, j, depth, isLength: i % 2 === 0 };
      }).sort((a, b) => a.depth - b.depth);

      faces.slice(2).forEach((f) => {
        el("polygon", {
          points: pts([bot[f.i], bot[f.j], top[f.j], top[f.i]]),
          fill: f.isLength ? colSideA : colSideB,
          stroke: "rgba(15,23,42,0.45)",
          "stroke-width": 0.7
        }, g);
      });

      el("polygon", {
        points: pts(top),
        fill: colTop,
        stroke: "rgba(255,255,255,0.22)",
        "stroke-width": 0.7
      }, g);
    }

    drawOrientedBox(-20, 20, -11, 11, 2, 12, color, shadeHex(color, 0.72), shadeHex(color, 0.85));
    drawOrientedBox(-11, 9, -9, 9, 12, 20, shadeHex(color, 1.08), "#1e293b", "#334155");

    const ws = [
      localIso(9, -7.8, 19.6),
      localIso(15.2, -7.8, 12.6),
      localIso(15.2, 7.8, 12.6),
      localIso(9, 7.8, 19.6)
    ];
    el("polygon", {
      points: pts(ws),
      fill: "#0c4a6e",
      stroke: "#38bdf8",
      "stroke-width": 0.7
    }, g);

    if (cardboardProgress > 0.02) {
      const p = Math.min(1, cardboardProgress);
      const lift = (1 - p) * 16;
      const halfW = 9.5 * (0.35 + 0.65 * p);
      const cb = [
        localIso(5.5, -halfW, 20.6 + lift),
        localIso(16.2, -halfW, 13.4 + lift),
        localIso(16.2, halfW, 13.4 + lift),
        localIso(5.5, halfW, 20.6 + lift)
      ];
      el("polygon", {
        points: pts(cb),
        fill: "#d4a373",
        stroke: "#7f5539",
        "stroke-width": 1.1,
        opacity: (0.4 + 0.6 * p).toFixed(2)
      }, g);
      const creaseA = localIso(10.8, -halfW, 17.0 + lift);
      const creaseB = localIso(10.8, halfW, 17.0 + lift);
      el("line", {
        x1: creaseA.x, y1: creaseA.y, x2: creaseB.x, y2: creaseB.y,
        stroke: "#9c6644",
        "stroke-width": 0.9,
        opacity: (0.4 + 0.6 * p).toFixed(2)
      }, g);
    }

    const hl1 = localIso(20.5, -6, 7);
    const hl2 = localIso(20.5, 6, 7);
    el("circle", { cx: hl1.x, cy: hl1.y, r: 2.1, fill: "#fef08a" }, g);
    el("circle", { cx: hl2.x, cy: hl2.y, r: 2.1, fill: "#fef08a" }, g);

    return g;
  }

  function drawWorker(parent, w) {
    const pos = iso(w.u, w.v, 0);
    const g = el("g", {
      transform: `translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`
    }, parent);

    el("ellipse", { cx: 0, cy: 0, rx: 9.5, ry: 4.5, fill: "rgba(0,0,0,0.45)" }, g);

    const bob = w.walking ? -Math.abs(Math.sin(w.walkPhase)) * 2.2 : 0;
    const bodyWrap = el("g", {
      transform: `scale(${w.facing}, 1) translate(0, ${bob.toFixed(1)})`
    }, g);

    const stride = w.walking ? Math.sin(w.walkPhase) * 4.5 : 0;

    el("line", {
      x1: -2, y1: -14, x2: (-2.5 - stride).toFixed(1), y2: -1.5,
      stroke: "#1d4ed8", "stroke-width": 4.2, "stroke-linecap": "round"
    }, bodyWrap);
    el("ellipse", { cx: (-2.5 - stride).toFixed(1), cy: -1, rx: 3.1, ry: 1.7, fill: "#0f172a" }, bodyWrap);

    el("line", {
      x1: 2, y1: -14, x2: (2.5 + stride).toFixed(1), y2: -1.5,
      stroke: "#2563eb", "stroke-width": 4.2, "stroke-linecap": "round"
    }, bodyWrap);
    el("ellipse", { cx: (2.5 + stride).toFixed(1), cy: -1, rx: 3.1, ry: 1.7, fill: "#0f172a" }, bodyWrap);

    const upper = el("g", {
      transform: `translate(0, -14) rotate(${w.leanDeg.toFixed(1)})`
    }, bodyWrap);

    const armSwing = w.walking ? -stride * 0.75 : 0;
    const reachX = (w.holdingCardboard || w.leanDeg > 4) ? 10.5 : (3 + armSwing);
    const reachY = (w.holdingCardboard || w.leanDeg > 4) ? -6 : -3;

    el("line", {
      x1: 2, y1: -11, x2: reachX.toFixed(1), y2: (reachY - 1).toFixed(1),
      stroke: "#1e293b", "stroke-width": 3.4, "stroke-linecap": "round"
    }, upper);

    el("rect", {
      x: -5.5, y: -14, width: 11, height: 14, rx: 3,
      fill: "#1e293b", stroke: "#0f172a", "stroke-width": 0.7
    }, upper);

    el("rect", {
      x: -5.2, y: -13.5, width: 10.4, height: 12.8, rx: 2.4,
      fill: "#a3e635", stroke: "#4d7c0f", "stroke-width": 0.8
    }, upper);
    el("rect", { x: -5.1, y: -8.2, width: 10.2, height: 1.7, fill: "#f8fafc", opacity: "0.92" }, upper);
    el("rect", { x: -5.1, y: -4.6, width: 10.2, height: 1.7, fill: "#f8fafc", opacity: "0.92" }, upper);

    el("circle", { cx: 0.5, cy: -18.5, r: 4.5, fill: "#e0a97d", stroke: "#78350f", "stroke-width": 0.6 }, upper);
    el("path", {
      d: "M -4.3 -19.2 A 4.8 4.4 0 0 1 5.2 -19.2 L 7.8 -18.7 L -4.3 -18.7 Z",
      fill: "#0f172a", stroke: "#334155", "stroke-width": 0.6
    }, upper);

    el("line", {
      x1: -1, y1: -11, x2: reachX.toFixed(1), y2: reachY.toFixed(1),
      stroke: "#334155", "stroke-width": 3.5, "stroke-linecap": "round"
    }, upper);
    el("circle", { cx: reachX.toFixed(1), cy: reachY.toFixed(1), r: 1.8, fill: "#e0a97d" }, upper);

    if (w.holdingCardboard) {
      el("polygon", {
        points: `${(reachX - 2).toFixed(1)},${(reachY - 4).toFixed(1)} ${(reachX + 11).toFixed(1)},${(reachY - 7).toFixed(1)} ${(reachX + 14).toFixed(1)},${(reachY + 2).toFixed(1)} ${(reachX + 1).toFixed(1)},${(reachY + 5).toFixed(1)}`,
        fill: "#d4a373",
        stroke: "#7f5539",
        "stroke-width": 0.9
      }, upper);
    }

    return g;
  }

  function renderPiggyBank(piggyGroup, coinCount = 0) {
    if (!piggyGroup) return;
    while (piggyGroup.firstChild) piggyGroup.removeChild(piggyGroup.firstChild);

    const { u, v } = PIGGY_POS;
    // Pedestal amplio y visible junto al trabajador
    drawIsoBox(piggyGroup, u - 11, v - 11, 0, 22, 22, 7, {
      top: "#64748b", front: "#1e293b", right: "#334155",
      stroke: "rgba(250, 204, 21, 0.55)", strokeWidth: 1
    });

    // Base dorada de la alcancía
    drawIsoBox(piggyGroup, u - 9.5, v - 9.5, 7, 19, 19, 3, {
      top: "#fbbf24", front: "#b45309", right: "#d97706",
      stroke: "rgba(254,240,138,0.65)", strokeWidth: 0.9
    });

    // Relleno de monedas acumuladas dentro del frasco (crece hasta 15 niveles)
    const maxVisibleLevels = 15;
    const fillLevels = Math.min(maxVisibleLevels, coinCount);
    if (fillLevels > 0) {
      const fillH = Math.max(2.5, (fillLevels / maxVisibleLevels) * 26);
      drawIsoBox(piggyGroup, u - 7.5, v - 7.5, 10, 15, 15, fillH, {
        top: "#fde047", front: "#ca8a04", right: "#eab308",
        stroke: "rgba(254,249,195,0.85)", strokeWidth: 0.7
      });
    }

    // Cuerpo de vidrio translúcido grande
    drawIsoBox(piggyGroup, u - 9, v - 9, 10, 18, 18, 28, {
      top: "rgba(186, 230, 253, 0.28)",
      front: "rgba(56, 189, 248, 0.2)",
      right: "rgba(125, 211, 252, 0.26)",
      stroke: "rgba(224, 242, 254, 0.88)",
      strokeWidth: 1.2
    });

    // Tapa superior llamativa con ranura para monedas
    drawIsoBox(piggyGroup, u - 9.8, v - 9.8, 38, 19.6, 19.6, 4, {
      top: "#f59e0b", front: "#b45309", right: "#d97706",
      stroke: "rgba(254,240,138,0.85)", strokeWidth: 1
    });
    const slotA = iso(u - 4.2, v, 42.3);
    const slotB = iso(u + 4.2, v, 42.3);
    el("line", {
      x1: slotA.x, y1: slotA.y, x2: slotB.x, y2: slotB.y,
      stroke: "#0f172a", "stroke-width": 2.8, "stroke-linecap": "round"
    }, piggyGroup);

    // Etiqueta destacada con contador de monedas
    const lblPos = iso(u, v, 54);
    el("rect", {
      x: lblPos.x - 40, y: lblPos.y - 13,
      width: 80, height: 18, rx: 7,
      fill: "rgba(15, 23, 42, 0.94)",
      stroke: coinCount > 0 ? "#facc15" : "rgba(250, 204, 21, 0.6)",
      "stroke-width": 1.3
    }, piggyGroup);
    const lbl = el("text", {
      x: lblPos.x, y: lblPos.y - 0.5,
      fill: coinCount > 0 ? "#fde047" : "#fef08a",
      "font-size": "9.5", "font-weight": "800", "text-anchor": "middle"
    }, piggyGroup);
    lbl.textContent = `ALCANCÍA · 🪙 ${coinCount}`;
  }

  function renderFlyingCoins(coinsGroup, coins = []) {
    if (!coinsGroup) return;
    while (coinsGroup.firstChild) coinsGroup.removeChild(coinsGroup.firstChild);
    coins.forEach((c) => {
      const p = iso(c.u, c.v, c.z);
      el("circle", {
        cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 7.5,
        fill: "#facc15", stroke: "#854d0e", "stroke-width": 1.4
      }, coinsGroup);
      el("circle", {
        cx: (p.x - 1.5).toFixed(1), cy: (p.y - 1.5).toFixed(1), r: 3,
        fill: "#fef9c3"
      }, coinsGroup);
    });
  }

  function buildStaticScene() {
    const layers = {
      floor: document.getElementById("layer-floor"),
      bays: document.getElementById("layer-bays"),
      sensors: document.getElementById("layer-sensors"),
      booth: document.getElementById("layer-booth"),
      cars: document.getElementById("layer-cars"),
      barrier: document.getElementById("layer-barrier"),
      hud: document.getElementById("layer-hud")
    };

    const wallColors = {
      top: "#475569",
      front: "#1e293b",
      right: "#334155",
      stroke: "rgba(148, 163, 184, 0.32)",
      strokeWidth: 0.8
    };

    // Plataforma interior del parqueadero (cerrada al costado derecho en u=535)
    drawIsoBox(layers.floor, -110, 10, -18, 645, 180, 18, {
      top: "url(#slabTop)",
      front: "#0b1322",
      right: "#0f1a2e",
      stroke: "rgba(148,163,184,0.18)",
      strokeWidth: 1
    });

    // Calle principal ancha de doble carril (v = 190..314, con salida cerrada a la derecha)
    drawIsoBox(layers.floor, -210, 190, -18, 765, 124, 18, {
      top: "url(#roadGrad)",
      front: "#090f1d",
      right: "#0f172a",
      stroke: "rgba(148,163,184,0.22)",
      strokeWidth: 1
    });

    // Línea divisoria discontinua entre carril de entrada (v=222) y carril de salida (v=282)
    for (let u = -195; u < 530; u += 40) {
      const a = iso(u, 252, 1);
      const b = iso(u + 22, 252, 1);
      el("line", {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: "rgba(250, 204, 21, 0.65)",
        "stroke-width": 2.4
      }, layers.floor);
    }

    // Etiquetas direccionales en ambos carriles de la calle ancha
    const entTxt = iso(-135, 222, 1.5);
    const entTextEl = el("text", {
      x: entTxt.x, y: entTxt.y,
      fill: "rgba(56,189,248,0.75)",
      "font-size": "11", "font-weight": "700", "text-anchor": "middle",
      transform: `rotate(30 ${entTxt.x} ${entTxt.y})`
    }, layers.floor);
    entTextEl.textContent = "ENTRADA →";

    const salTxt = iso(-135, 282, 1.5);
    const salTextEl = el("text", {
      x: salTxt.x, y: salTxt.y,
      fill: "rgba(245,158,11,0.78)",
      "font-size": "11", "font-weight": "700", "text-anchor": "middle",
      transform: `rotate(30 ${salTxt.x} ${salTxt.y})`
    }, layers.floor);
    salTextEl.textContent = "← SALIDA";

    // Franjas blancas de paso en el acceso único bidireccional
    drawGateCrosswalkStripes(layers.floor);

    // Muros perimetrales traseros e izquierdo (detrás de bahías)
    drawIsoBox(layers.floor, -110, 10, 0, 645, 8, 16, wallColors);
    drawIsoBox(layers.floor, -110, 18, 0, 8, 172, 16, wallColors);

    // Muros perimetrales derecho (cierra el costado donde antes estaba la salida) y frontal con abertura única
    drawIsoBox(layers.booth, 527, 18, 0, 8, 170, 16, wallColors);
    drawIsoBox(layers.booth, -102, 178, 0, 114, 8, 12, wallColors);
    drawIsoBox(layers.booth, 108, 178, 0, 419, 8, 12, wallColors);

    // 5 Bahías P1..P5
    const bayLedNodes = [];
    const bayHudNodes = [];
    BAYS.forEach((bay, idx) => {
      el("polygon", {
        class: "bay-surface",
        "data-bay-idx": idx,
        points: pts([
          iso(bay.u - 32, 34, 0.8),
          iso(bay.u + 32, 34, 0.8),
          iso(bay.u + 32, 144, 0.8),
          iso(bay.u - 32, 144, 0.8)
        ]),
        fill: "rgba(30, 41, 59, 0.72)",
        stroke: "rgba(226, 232, 240, 0.35)",
        "stroke-width": 1.4
      }, layers.bays);

      const lblPos = iso(bay.u, 130, 1.2);
      const lbl = el("text", {
        x: lblPos.x, y: lblPos.y,
        fill: "rgba(226,232,240,0.45)",
        "font-size": "13", "font-weight": "800", "text-anchor": "middle"
      }, layers.bays);
      lbl.textContent = bay.label;

      drawIsoBox(layers.bays, bay.u - 4, 24, 0, 8, 8, 28, {
        top: "#475569", front: "#1e293b", right: "#334155",
        stroke: "rgba(255,255,255,0.12)"
      });
      const ledPos = iso(bay.u, 28, 32);
      bayLedNodes.push(el("circle", {
        cx: ledPos.x, cy: ledPos.y, r: 5.5,
        fill: "#22c55e", filter: "url(#glowGreen)"
      }, layers.bays));

      const hudPos = iso(bay.u, 22, 66);
      const hudG = el("g", {}, layers.hud);
      const rect = el("rect", {
        x: hudPos.x - 28, y: hudPos.y - 18,
        width: 56, height: 24, rx: 7,
        fill: "rgba(15, 23, 42, 0.88)", stroke: "#22c55e", "stroke-width": 1.3
      }, hudG);
      const txt = el("text", {
        x: hudPos.x, y: hudPos.y - 2,
        fill: "#86efac", "font-size": "9.5", "font-weight": "700", "text-anchor": "middle"
      }, hudG);
      txt.textContent = `${bay.label} LIBRE`;
      bayHudNodes.push({ rect, txt, label: bay.label });
    });

    // Zona de Descanso del Trabajador + Pila de Cartones
    el("polygon", {
      points: pts([
        iso(-92, 36, 0.8),
        iso(-20, 36, 0.8),
        iso(-20, 114, 0.8),
        iso(-92, 114, 0.8)
      ]),
      fill: "rgba(30, 41, 59, 0.8)",
      stroke: "rgba(163, 230, 53, 0.4)",
      "stroke-width": 1.2,
      "stroke-dasharray": "4 3"
    }, layers.bays);
    const restLblPos = iso(-56, 108, 1.2);
    const restLbl = el("text", {
      x: restLblPos.x, y: restLblPos.y,
      fill: "rgba(163, 230, 53, 0.65)",
      "font-size": "8.5", "font-weight": "700", "text-anchor": "middle"
    }, layers.bays);
    restLbl.textContent = "ZONA DESCANSO";

    drawIsoBox(layers.booth, -80, 44, 0, 32, 12, 8, {
      top: "#475569", front: "#1e293b", right: "#334155",
      stroke: "rgba(148,163,184,0.3)"
    });
    drawIsoBox(layers.booth, -42, 44, 0, 16, 18, 7, {
      top: "#d4a373", front: "#a98467", right: "#c89b6e",
      stroke: "#7f5539", strokeWidth: 0.9
    });

    // Alcancía del trabajador junto a la zona de descanso
    const piggyGroup = el("g", { id: "piggy-bank-group" }, layers.booth);
    renderPiggyBank(piggyGroup, 0);
    const flyingCoinsGroup = el("g", { id: "flying-coins-group" }, layers.hud);

    // Caseta de control en el acceso único
    drawIsoBox(layers.booth, -55, 128, 0, 56, 44, 46, {
      top: "#334155", front: "#1e293b", right: "#273549",
      stroke: "rgba(148,163,184,0.35)"
    });
    drawIsoBox(layers.booth, -59, 124, 46, 64, 52, 7, {
      top: "#0284c7", front: "#0369a1", right: "#0ea5e9",
      stroke: "rgba(186,230,253,0.45)"
    });
    el("polygon", {
      points: pts([
        iso(1.2, 136, 18),
        iso(1.2, 164, 18),
        iso(1.2, 164, 34),
        iso(1.2, 136, 34)
      ]),
      fill: "#064e3b", stroke: "#34d399", "stroke-width": 1
    }, layers.booth);

    const lcdHud = iso(-27, 150, 62);
    el("rect", {
      x: lcdHud.x - 36, y: lcdHud.y - 11,
      width: 72, height: 18, rx: 6,
      fill: "rgba(6, 78, 59, 0.92)", stroke: "#34d399", "stroke-width": 1
    }, layers.hud);
    const boothLcdText = el("text", {
      x: lcdHud.x, y: lcdHud.y + 1.5,
      fill: "#6ee7b7", "font-size": "9.5", "font-weight": "800", "text-anchor": "middle"
    }, layers.hud);
    boothLcdText.textContent = "ESP32 · 5/5";

    // Sensor ultrasónico 1: Exterior / Afuera (GPIO 13/34 - detecta entrada 1-8 cm y confirma salida)
    drawIsoBox(layers.sensors, SENSOR_OUT_U - 5, SENSOR_OUT_V - 5, 0, 10, 10, 20, {
      top: "#0ea5e9", front: "#0369a1", right: "#0284c7",
      stroke: "rgba(186,230,253,0.45)"
    });
    const sensorOutOrigin = iso(SENSOR_OUT_U + 4, SENSOR_OUT_V + 4, 16);
    const sensorOutGroup = el("g", {
      transform: `translate(${sensorOutOrigin.x.toFixed(1)}, ${sensorOutOrigin.y.toFixed(1)})`
    }, layers.sensors);
    el("path", { d: "M -8 6 Q 0 14 8 6", class: "wave w1" }, sensorOutGroup);
    el("path", { d: "M -13 11 Q 0 22 13 11", class: "wave w2" }, sensorOutGroup);
    el("path", { d: "M -18 16 Q 0 30 18 16", class: "wave w3" }, sensorOutGroup);

    const s1LblPos = iso(SENSOR_OUT_U, SENSOR_OUT_V, 28);
    const s1Lbl = el("text", {
      x: s1LblPos.x, y: s1LblPos.y,
      fill: "#7dd3fc", "font-size": "8.5", "font-weight": "800", "text-anchor": "middle"
    }, layers.hud);
    s1Lbl.textContent = "S1 EXT";

    // Sensor ultrasónico 2: Interior / Dentro (GPIO 32/33 - detecta salida 1-16 cm y confirma entrada)
    drawIsoBox(layers.sensors, SENSOR_IN_U - 5, SENSOR_IN_V - 5, 0, 10, 10, 20, {
      top: "#a855f7", front: "#6b21a8", right: "#7e22ce",
      stroke: "rgba(233,213,255,0.45)"
    });
    const sensorInOrigin = iso(SENSOR_IN_U - 6, SENSOR_IN_V - 2, 16);
    const sensorInGroup = el("g", {
      class: "sensor-in",
      transform: `translate(${sensorInOrigin.x.toFixed(1)}, ${sensorInOrigin.y.toFixed(1)})`
    }, layers.sensors);
    el("path", { d: "M -8 -6 Q 0 -14 8 -6", class: "wave w1" }, sensorInGroup);
    el("path", { d: "M -13 -11 Q 0 -22 13 -11", class: "wave w2" }, sensorInGroup);
    el("path", { d: "M -18 -16 Q 0 -30 18 -16", class: "wave w3" }, sensorInGroup);

    const s2LblPos = iso(SENSOR_IN_U, SENSOR_IN_V, 28);
    const s2Lbl = el("text", {
      x: s2LblPos.x, y: s2LblPos.y,
      fill: "#d8b4fe", "font-size": "8.5", "font-weight": "800", "text-anchor": "middle"
    }, layers.hud);
    s2Lbl.textContent = "S2 INT";

    // Pedestal y única barrera vehicular bidireccional
    drawIsoBox(layers.barrier, GATE_PIVOT_U - 7, GATE_V - 7, 0, 14, 14, 24, {
      top: "#facc15", front: "#ca8a04", right: "#eab308",
      stroke: "rgba(254,240,138,0.5)"
    });
    const barrierArmGroup = el("g", {}, layers.barrier);
    renderBarrierArm(barrierArmGroup, 0);

    return {
      layers,
      bayLedNodes,
      bayHudNodes,
      boothLcdText,
      sensorOutGroup,
      sensorInGroup,
      barrierArmGroup,
      piggyGroup,
      flyingCoinsGroup
    };
  }

  app.Renderer = {
    iso,
    drawVehicle,
    drawWorker,
    renderBarrierArm,
    renderPiggyBank,
    renderFlyingCoins,
    buildStaticScene
  };
})(window.ParkingApp);
