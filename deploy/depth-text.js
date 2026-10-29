/* ==========================================================================
   DepthText — 3D 挤出文字（React Bits 组件的原生移植版）
   去掉 React，保留完整逻辑：层叠挤出、指针视差、自动环绕、悬停按压弹簧、入场生长。
   用法：createDepthText(rootEl, { text: '杨召', layers: 34, ... })
   ========================================================================== */
(function () {
  "use strict";

  var MAX_LAYERS = 64;
  var INTRO_MS = 1200;
  var PUSH_STIFFNESS = 260;
  var PUSH_DAMPING = 17;
  var PRESS_EXTRA = 0.25;
  var FLOAT_EASE = 0.7;

  var clamp = function (v, min, max) { return Math.min(Math.max(v, min), max); };

  /* 层与层之间的颜色：越靠后越接近 depthColor，并整体压暗 */
  var getLayerColor = function (faceColor, depthColor, index, total) {
    var progress = total <= 1 ? 1 : index / total;
    var eased = progress * progress;
    var faceMix = Math.round((1 - eased) * 72 + 4);
    return "color-mix(in srgb, color-mix(in srgb, " + faceColor + " " + faceMix +
      "%, " + depthColor + ") 92%, black)";
  };

  /* 实心挤出：正面 depthColor → 背面压暗，不透明，才有"一块金属"的手感 */
  var getSolidColor = function (depthColor, index, total, shade) {
    var t = total <= 1 ? 0 : (index - 1) / (total - 1);
    var back = Math.round(clamp(shade, 0, 0.95) * 100);
    return "color-mix(in srgb, " + depthColor + " " + (100 - back) + "%, black)";
  };

  var getFadeColor = function (depthColor, index, total, outline) {
    var reach = function (layer) { return Math.pow(clamp(1 - (layer - 0.5) / total, 0, 1), 1.6); };
    var here = reach(index);
    var behind = index >= total ? 0 : reach(index + 1);
    var alpha = outline ? here : behind >= 1 ? 1 : 1 - (1 - here) / (1 - behind);
    return "color-mix(in srgb, " + depthColor + " " + (clamp(alpha, 0, 1) * 100).toFixed(2) + "%, transparent)";
  };

  var getTransform = function (rotateX, rotateY, lift, roll, sink) {
    return [
      lift ? "translateY(" + lift.toFixed(2) + "px)" : "",
      roll ? "rotateZ(" + roll.toFixed(3) + "deg)" : "",
      "rotateX(" + rotateX.toFixed(3) + "deg) rotateY(" + rotateY.toFixed(3) + "deg)",
      sink ? "translateZ(" + (-sink).toFixed(2) + "px)" : ""
    ].filter(Boolean).join(" ");
  };

  function createDepthText(root, options) {
    if (!root) return null;
    var o = options || {};

    var text = o.text || root.getAttribute("data-text") || "Elevate";
    var layers = clamp(Math.round(Number(o.layers) || 34), 2, MAX_LAYERS);
    var depth = clamp(Number(o.depth) || 0, 0, 12);
    var tilt = clamp(Number(o.tilt) || 0, 0, 12);
    var smoothing = clamp(Number(o.smoothing) || 0.14, 0.02, 0.35);
    var perspective = clamp(Number(o.perspective) || 900, 300, 2000);
    var orbitSpeed = clamp(Number(o.orbitSpeed) || 0, 0, 2);
    var pushAmount = clamp(Number(o.hoverPush) || 0, 0, 1);
    var gradientDepth = !!o.gradientDepth;
    var solidDepth = !!o.solidDepth;
    var depthRatio = o.depthRatio === undefined || o.depthRatio === null ? null : Number(o.depthRatio);
    var depthShade = o.depthShade === undefined || o.depthShade === null ? 0.55 : Number(o.depthShade);
    var pointerTracking = o.pointerTracking !== false;
    var autoOrbit = o.autoOrbit !== false;
    var doFloat = !!o.float;
    var outline = !!o.outline;
    var shadow = o.shadow !== false;
    var intro = o.intro !== false;
    var fontSize = o.fontSize || "clamp(3rem, 12vw, 7rem)";
    var fontWeight = o.fontWeight || 900;
    var fontFamily = o.fontFamily || "";
    var track = o.letterSpacing || "";
    var faceColor = o.faceColor || "currentColor";
    var depthColor = o.depthColor || "#7c3aed";

    var extent = layers * depth;
    /* 静止姿态角：默认沿用原组件公式。显式传入 restX / restY 可以加大摆角，
       让 3D 挤出在静止时就露出足够的厚度（原组件限制在 ±12°，侧壁很难看见）。 */
    var restX = o.restX === undefined || o.restX === null ? -tilt * 0.32 : Number(o.restX);
    var restY = o.restY === undefined || o.restY === null ? tilt * 0.42 : Number(o.restY);
    var baseRotation = { x: restX, y: restY };

    /* ---------- 结构 ---------- */
    root.className = "depth-text" + (outline ? " depth-text--outline" : "") +
      (o.className ? " " + o.className : "");
    root.style.setProperty("--depth-text-perspective", perspective + "px");
    root.style.setProperty("--depth-text-font-size", fontSize);
    root.style.setProperty("--depth-text-font-weight", fontWeight);
    root.style.setProperty("--depth-text-face-color", faceColor);
    if (fontFamily) root.style.setProperty("--depth-text-font-family", fontFamily);
    if (track) root.style.setProperty("--depth-text-track", track);
    root.style.setProperty("--depth-text-shadow",
      shadow && !gradientDepth && !solidDepth
        ? "0 0.18em 0.32em color-mix(in srgb, " + depthColor + " 24%, rgba(0, 0, 0, 0.42))"
        : "none");
    root.style.setProperty("--depth-text-face-shadow",
      shadow ? "0 0.035em 0.07em rgba(0, 0, 0, 0.28)" : "none");

    var stage = document.createElement("span");
    stage.className = "depth-text__stage";
    stage.style.transform = getTransform(baseRotation.x, baseRotation.y);
    stage.style.setProperty("--depth-text-grow", intro ? 0 : 1);

    var frag = document.createDocumentFragment();
    var layerEls = [];
    for (var li = 0; li < layers; li++) {
      var index = layers - li;
      var layerEl = document.createElement("span");
      layerEl.className = "depth-text__layer" + (index === layers ? " depth-text__layer--back" : "");
      layerEl.setAttribute("aria-hidden", "true");
      layerEls.push(layerEl);
      layerEl.style.color = solidDepth
        ? getSolidColor(depthColor, index, layers, depthShade * ((layers - index) / layers * 0.4 + 0.6))
        : gradientDepth
          ? getFadeColor(depthColor, index, layers, outline)
          : getLayerColor(faceColor, depthColor, index, layers);
      layerEl.textContent = text;
      frag.appendChild(layerEl);
    }

    var face = document.createElement("span");
    face.className = "depth-text__face";
    face.textContent = text;
    face.setAttribute("aria-hidden", "true");
    frag.appendChild(face);

    stage.appendChild(frag);
    root.appendChild(stage);

    /* 厚度可以按字号等比缩放：小屏字号小，固定像素厚度会让侧壁比字还厚 */
    var applyDepth = function () {
      if (depthRatio !== null && isFinite(depthRatio)) {
        var fs = parseFloat(window.getComputedStyle(root).fontSize) || 100;
        depth = clamp((fs * depthRatio) / layers, 0, 12);
        extent = layers * depth;
      }
      for (var i = 0; i < layerEls.length; i++) {
        var idx = layers - i;
        layerEls[i].style.transform =
          "translateZ(calc(var(--depth-text-grow, 1) * " + (-idx * depth).toFixed(2) + "px))";
      }
    };
    applyDepth();

    /* ---------- 动效 ---------- */
    var motion = { push: 0, velocity: 0, float: 0 };
    var introProgress = intro ? 0 : 1;
    var current = { x: baseRotation.x, y: baseRotation.y };
    var target = { x: baseRotation.x, y: baseRotation.y };

    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    var canTrackPointer = pointerTracking && finePointer && !reducedMotion;
    var listensToHover = (pushAmount > 0 || doFloat) && !reducedMotion;

    var frameId = 0;
    var visible = true;
    var activePointer = false;
    var hovered = false;
    var pressed = false;
    var lastTime = 0;
    var size = root.offsetHeight || 1;
    var startTime = performance.now();

    var sinkAmount = function () { return clamp(motion.push, -0.25, 1); };

    var applyGrow = function () {
      var p = introProgress;
      var grow = p >= 1 ? 1 : 1 - Math.pow(1 - p, 3);
      var value = grow * (1 - sinkAmount());
      stage.style.setProperty("--depth-text-grow", value === 1 ? "1" : value.toFixed(4));
    };

    var applyTransform = function (now) {
      var time = ((now || performance.now()) - startTime) / 1000;
      var drift = motion.float;
      stage.style.transform = getTransform(
        current.x + (drift ? Math.cos(time * 1.19) * 2 * drift : 0),
        current.y + (drift ? Math.sin(time * 0.86 + 2.1) * 4 * drift : 0),
        drift ? Math.sin(time * 1.43) * size * 0.045 * drift : 0,
        drift ? Math.sin(time * 1.03 + 0.8) * 1.6 * drift : 0,
        sinkAmount() * extent
      );
    };

    if (reducedMotion) {
      introProgress = 1;
      applyGrow();
      applyTransform();
      return { destroy: function () {} };
    }

    var stop = function () {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    };

    var tick = function (now) {
      var delta = lastTime ? Math.min(now - lastTime, 50) : 16;
      lastTime = now;

      if (introProgress < 1) {
        introProgress = Math.min(1, introProgress + delta / INTRO_MS);
      }

      if ((!canTrackPointer || !activePointer) && autoOrbit) {
        var elapsed = (now - startTime) / 1000;
        var orbit = elapsed * orbitSpeed * Math.PI * 2;
        var fallbackAmount = canTrackPointer ? 0.18 : 0.55;
        target.x = baseRotation.x + Math.sin(orbit) * tilt * fallbackAmount;
        target.y = baseRotation.y + Math.cos(orbit * 0.85) * tilt * fallbackAmount;
      }

      current.x += (target.x - current.x) * smoothing;
      current.y += (target.y - current.y) * smoothing;

      var pushGoal = pushAmount > 0 && (hovered || pressed)
        ? Math.min(1, pushAmount + (pressed ? PRESS_EXTRA : 0))
        : 0;
      var remaining = delta / 1000;
      while (remaining > 0) {
        var s = Math.min(remaining, 1 / 120);
        motion.velocity += (PUSH_STIFFNESS * (pushGoal - motion.push) - PUSH_DAMPING * motion.velocity) * s;
        motion.push += motion.velocity * s;
        remaining -= s;
      }
      var springIdle = Math.abs(pushGoal - motion.push) < 0.0005 && Math.abs(motion.velocity) < 0.002;
      if (springIdle) {
        motion.push = pushGoal;
        motion.velocity = 0;
      }

      var floatGoal = doFloat && !hovered && !pressed ? 1 : 0;
      motion.float += (floatGoal - motion.float) * (1 - Math.exp(-delta / 1000 / FLOAT_EASE));
      if (Math.abs(floatGoal - motion.float) < 0.001) motion.float = floatGoal;

      applyGrow();
      applyTransform(now);

      var settled = Math.abs(target.x - current.x) < 0.001 && Math.abs(target.y - current.y) < 0.001;
      if (!autoOrbit && !motion.float && settled && springIdle && introProgress >= 1) {
        frameId = 0;
        return;
      }
      frameId = requestAnimationFrame(tick);
    };

    var start = function () {
      if (frameId || !visible) return;
      lastTime = 0;
      frameId = requestAnimationFrame(tick);
    };

    var handlePointerMove = function (event) {
      var rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      activePointer = true;
      var x = clamp((event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.8), -1, 1);
      var y = clamp((event.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.8), -1, 1);
      target.x = baseRotation.x - y * tilt;
      target.y = baseRotation.y + x * tilt;
      start();
    };

    var handlePointerLeave = function () {
      activePointer = false;
      target.x = baseRotation.x;
      target.y = baseRotation.y;
      start();
    };

    var handlePointerOut = function (event) {
      if (!event.relatedTarget) handlePointerLeave();
    };

    var isHoverPointer = function (event) {
      return event.pointerType === "mouse" || event.pointerType === "pen";
    };

    var handleEnter = function (event) { if (!isHoverPointer(event)) return; hovered = true; start(); };
    var handleLeave = function () { hovered = false; pressed = false; start(); };
    var handleDown = function () { pressed = true; start(); };
    var handleUp = function (event) {
      pressed = false;
      if (!isHoverPointer(event)) hovered = false;
      start();
    };

    if (canTrackPointer) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerout", handlePointerOut);
      window.addEventListener("blur", handlePointerLeave);
    }
    if (listensToHover) {
      root.addEventListener("pointerenter", handleEnter);
      root.addEventListener("pointerleave", handleLeave);
      root.addEventListener("pointerdown", handleDown);
      root.addEventListener("pointerup", handleUp);
      root.addEventListener("pointercancel", handleLeave);
    }

    var observer = typeof IntersectionObserver === "undefined" ? null
      : new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          if (visible) start(); else stop();
        });
    if (observer) observer.observe(root);

    var resizeObserver = typeof ResizeObserver === "undefined" ? null
      : new ResizeObserver(function () { size = root.offsetHeight || 1; applyDepth(); });
    if (resizeObserver) resizeObserver.observe(root);

    applyGrow();
    applyTransform();
    start();

    return {
      destroy: function () {
        if (canTrackPointer) {
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerout", handlePointerOut);
          window.removeEventListener("blur", handlePointerLeave);
        }
        if (listensToHover) {
          root.removeEventListener("pointerenter", handleEnter);
          root.removeEventListener("pointerleave", handleLeave);
          root.removeEventListener("pointerdown", handleDown);
          root.removeEventListener("pointerup", handleUp);
          root.removeEventListener("pointercancel", handleLeave);
        }
        if (observer) observer.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        stop();
      }
    };
  }

  window.createDepthText = createDepthText;
})();
