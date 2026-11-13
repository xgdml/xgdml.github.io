/* ==========================================================================
   FolderFloat — 原生移植版（React Bits ⇄ 无构建环境）
   保留：3D 翻盖、药丸逐条升起、matter-js 零重力漂浮 / 碰撞 / 拖拽抛出、
        点选回调、reduced-motion 降级。
   用法：
     window.createFolderFloat(document.getElementById("folder"), {
       items: [{ label: "AI · 生成实验", value: "ai" }, ...],
       label: "四个抽屉", sublabel: "04 个分类",
       onSelect: function (value, index) { ... },
       onOpenChange: function (open) { ... }
     });
   ========================================================================== */
(function () {
  "use strict";

  var PAD = 28;
  var CHAR = 6.8;
  var GAP = 12;
  var ROW = 52;
  var DRAG_MIN = 4;
  var ZONE_PAD = 8;

  var clamp = function (v, min, max) { return Math.min(Math.max(v, min), max); };

  /* 稳定的伪随机：同一颗药丸每次位置一致，不会每次刷新都乱跳 */
  var jitter = function (i) {
    var x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    return x - Math.floor(x);
  };

  /* 按宽度把药丸排成若干行，返回每颗相对容器中心的坐标（y 向上为负） */
  var layout = function (list, spread, lift, tilt, sizes) {
    var rows = [];
    var row = [];
    var width = 0;

    list.forEach(function (item, i) {
      var pw = (sizes[i] && sizes[i].w) || (PAD + item.label.length * CHAR);
      if (row.length && width + GAP + pw > spread * 2) {
        rows.push({ items: row, width: width });
        row = [];
        width = 0;
      }
      row.push({ i: i, pw: pw });
      width += (row.length > 1 ? GAP : 0) + pw;
    });
    if (row.length) rows.push({ items: row, width: width });

    var pos = [];
    rows.forEach(function (r, ri) {
      var x = -r.width / 2;
      var shift = (ri % 2 ? 1 : -1) * Math.min(16, spread * 0.1);
      r.items.forEach(function (cell) {
        var j = jitter(cell.i);
        pos[cell.i] = {
          x: x + cell.pw / 2 + shift + (j - 0.5) * 6,
          y: -lift - ri * ROW - j * 6,
          r: tilt * (j * 2 - 1)
        };
        x += cell.pw + GAP;
      });
    });
    return pos;
  };

  /* 向右展开：药丸像从抽屉里抽出来，纵向叠放、整体向右错落 */
  var layoutRight = function (list, width, height, tilt, sizes, gap) {
    gap = gap || 10;
    var total = 0;
    sizes.forEach(function (sz) { total += sz.h + gap; });
    total -= gap;

    var top = Math.max(-6, (height - total) / 2);
    var pos = [];
    var cursor = top;
    for (var i = 0; i < list.length; i++) {
      var j = jitter(i);
      var h = sizes[i].h;
      /* 左边缘贴着文件夹右侧排开，越往后越向右探出，像抽屉被拉开一叠 */
      pos[i] = {
        x: width / 2 + 30 + sizes[i].w / 2 + i * 7 + (j - 0.5) * 8,
        y: cursor,
        r: tilt * 0.55 * (j * 2 - 1)
      };
      cursor += h + gap;
    }
    return pos;
  };

  function createFolderFloat(root, options) {
    if (!root) return null;
    var o = options || {};

    var items = (o.items || []).map(function (it) {
      return typeof it === "string" ? { label: it, value: it } : it;
    });
    if (!items.length) return null;

    var label = o.label != null ? o.label : "Design feedback";
    var sublabel = o.sublabel != null ? o.sublabel : "";
    var trigger = o.trigger === "click" ? "click" : "hover";
    var closeOnSelect = o.closeOnSelect !== false;
    var physics = o.physics !== false;
    var drift = o.drift != null ? Number(o.drift) : 0.5;
    var onSelect = o.onSelect;
    var onOpenChange = o.onOpenChange;

    var width = o.width != null ? Number(o.width) : 200;
    var height = o.height != null ? Number(o.height) : 148;
    var radius = o.radius != null ? Number(o.radius) : 14;
    var spread = o.spread != null ? Number(o.spread) : 180;
    var lift = o.lift != null ? Number(o.lift) : 26;
    var tilt = o.tilt != null ? Number(o.tilt) : 8;
    var flapAngle = o.flapAngle != null ? Number(o.flapAngle) : 34;
    var restAngle = o.restAngle != null ? Number(o.restAngle) : 16;
    var openDuration = o.openDuration != null ? Number(o.openDuration) : 520;
    var stagger = o.stagger != null ? Number(o.stagger) : 45;
    var bounce = o.bounce != null ? Number(o.bounce) : 0.3;
    var direction = o.direction === "right" ? "right" : "up";

    var n = items.length;
    var sub = sublabel || n + (n === 1 ? " note" : " notes");

    var reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    var fineMQ = window.matchMedia("(hover: hover) and (pointer: fine)");
    var reduced = reduceMQ.matches;

    /* ---------- 结构 ---------- */
    /* 保留容器自带的 class（.folder-slot 靠它定位），再挂组件类名 */
    var keepClass = root.className && root.className !== "folder-float" ? " " + root.className.trim() : "";
    root.className = ("folder-float" + keepClass + (o.className ? " " + o.className : "")).trim();
    root.style.setProperty("--ff-w", width + "px");
    root.style.setProperty("--ff-h", height + "px");
    root.style.setProperty("--ff-r", radius + "px");
    root.style.setProperty("--ff-back", o.folderColor || "#3f3f46");
    root.style.setProperty("--ff-front", o.frontColor || "#52525b");
    root.style.setProperty("--ff-paper", o.paperColor || "#f5f5f5");
    root.style.setProperty("--ff-item", o.itemColor || "#f5f5f5");
    root.style.setProperty("--ff-item-ink", o.itemTextColor || "#18181b");
    root.style.setProperty("--ff-label", o.labelColor || "#f5f5f5");
    root.style.setProperty("--ff-spread", spread + "px");
    root.style.setProperty("--ff-lift", lift + "px");
    root.style.setProperty("--ff-angle", flapAngle + "deg");
    root.style.setProperty("--ff-rest", restAngle + "deg");
    root.style.setProperty("--ff-open", openDuration + "ms");
    root.style.setProperty("--ff-close", Math.round(openDuration * 0.6) + "ms");
    root.style.setProperty("--ff-stagger", stagger + "ms");
    root.style.setProperty("--ff-n", n);
    root.style.setProperty("--ff-spring", "cubic-bezier(0.34, " + (1 + bounce * 1.9).toFixed(2) + ", 0.64, 1)");
    root.setAttribute("data-trigger", trigger);
    root.setAttribute("data-direction", direction);
    if (o.fontSize) root.style.fontSize = Number(o.fontSize) + "px";
    if (!physics) root.setAttribute("data-physics", "");

    var anchor = document.createElement("div");
    anchor.className = "folder-float__items";

    var pills = [];
    items.forEach(function (item, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "folder-float__item";
      btn.tabIndex = -1;
      btn.setAttribute("aria-hidden", "true");
      btn.style.setProperty("--i", i);
      btn.style.setProperty("--x", "0px");
      btn.style.setProperty("--y", "0px");
      btn.style.setProperty("--r", "0deg");

      var inner = document.createElement("span");
      inner.className = "folder-float__drift";
      inner.textContent = item.label;
      btn.appendChild(inner);

      bindPill(btn, i);
      anchor.appendChild(btn);
      pills.push(btn);
    });

    var folder = document.createElement("div");
    folder.className = "folder-float__folder";
    folder.innerHTML =
      '<span class="folder-float__back" aria-hidden="true"></span>' +
      '<span class="folder-float__paper" aria-hidden="true"></span>' +
      '<span class="folder-float__front" aria-hidden="true">' +
      '<span class="folder-float__label"></span>' +
      '<span class="folder-float__sub"></span>' +
      "</span>" +
      '<button type="button" class="folder-float__trigger" aria-expanded="false"></button>';
    folder.querySelector(".folder-float__label").textContent = label;
    folder.querySelector(".folder-float__sub").textContent = sub;

    root.textContent = "";
    root.appendChild(anchor);
    root.appendChild(folder);

    var triggerBtn = folder.querySelector(".folder-float__trigger");
    triggerBtn.setAttribute("aria-label", label + ", " + sub);

    /* ---------- 布局 ---------- */
    var sizes = [];
    var pos = [];

    function measure() {
      sizes = pills.map(function (el) {
        return { w: el.offsetWidth, h: el.offsetHeight };
      });
      pos = direction === "right"
        ? layoutRight(items, width, height, tilt, sizes, o.gap)
        : layout(items, spread, lift, tilt, sizes);
      writePose();
    }

    function writePose() {
      for (var i = 0; i < pills.length; i++) {
        if (!pos[i]) continue;
        pills[i].style.setProperty("--x", pos[i].x.toFixed(1) + "px");
        pills[i].style.setProperty("--y", pos[i].y.toFixed(1) + "px");
        pills[i].style.setProperty("--r", pos[i].r.toFixed(2) + "deg");
      }
    }

    /* ---------- 开合 ---------- */
    var open = !!o.defaultOpen;

    function setOpen(next, silent) {
      if (next === open) return;
      open = next;
      if (!open) stopPhysics();
      if (open) root.setAttribute("data-open", "");
      else root.removeAttribute("data-open");
      triggerBtn.setAttribute("aria-expanded", open ? "true" : "false");
      pills.forEach(function (el) {
        el.tabIndex = open ? 0 : -1;
        if (open) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", "true");
      });
      if (!silent && onOpenChange) onOpenChange(open);
      schedulePhysics();
    }

    if (open) {
      root.setAttribute("data-open", "");
      triggerBtn.setAttribute("aria-expanded", "true");
      pills.forEach(function (el) { el.tabIndex = 0; el.removeAttribute("aria-hidden"); });
    }

    /* ---------- 物理世界 ---------- */
    var world = {
      engine: null,
      bodies: [],
      raf: 0,
      last: 0,
      t0: 0,
      drag: null,
      zone: null,
      live: false,
      sizes: []
    };
    var physicsTimer = 0;

    function Matter() { return window.Matter; }

    function stopPhysics() {
      clearTimeout(physicsTimer);
      cancelAnimationFrame(world.raf);
      world.raf = 0;
      var M = Matter();
      if (world.engine && M) {
        world.bodies.forEach(function (b, i) {
          var el = pills[i];
          if (!el) return;
          el.style.setProperty("--x", b.position.x.toFixed(1) + "px");
          el.style.setProperty("--y", (b.position.y - world.sizes[i].h / 2).toFixed(1) + "px");
        });
        M.Composite.clear(world.engine.world, false, true);
        M.Engine.clear(world.engine);
        world.engine = null;
      }
      world.bodies = [];
      world.drag = null;
      world.live = false;
      root.removeAttribute("data-live");
    }

    function startPhysics() {
      var M = Matter();
      if (world.engine || !M || reduced) return;
      var els = pills.slice();
      if (!els.length) return;

      var engine = M.Engine.create({ gravity: { x: 0, y: 0 } });
      engine.enableSleeping = false;
      world.engine = engine;
      world.sizes = els.map(function (el) { return { w: el.offsetWidth, h: el.offsetHeight }; });

      var ys = pos.map(function (p) { return p.y; });
      var maxH = Math.max.apply(null, world.sizes.map(function (s) { return s.h; }));
      var zone;
      if (direction === "right") {
        /* 右向：活动范围是文件夹右侧那块，左边留一道墙挡住，别让药丸飘回去压住文件夹 */
        var maxX = 0;
        var bottomMost = 0;
        pos.forEach(function (p, i) {
          maxX = Math.max(maxX, p.x + world.sizes[i].w / 2);
          bottomMost = Math.max(bottomMost, p.y + world.sizes[i].h);
        });
        zone = {
          left: width / 2 + 10,
          right: maxX + spread * 0.4 + 24,
          top: Math.min.apply(null, ys) - ZONE_PAD,
          bottom: bottomMost + ZONE_PAD
        };
      } else {
        zone = {
          left: -spread - ZONE_PAD,
          right: spread + ZONE_PAD,
          top: Math.min.apply(null, ys) - ZONE_PAD,
          bottom: -lift + maxH
        };
      }
      world.zone = zone;

      world.bodies = els.map(function (el, i) {
        var bw = world.sizes[i].w;
        var bh = world.sizes[i].h;
        var b = M.Bodies.rectangle(pos[i].x, pos[i].y + bh / 2, bw, bh, {
          chamfer: { radius: Math.min(bh / 2 - 1, 16) },
          restitution: 0.55,
          friction: 0,
          frictionAir: 0.08,
          inertia: Infinity
        });
        b.plugin = { phase: jitter(i) * Math.PI * 2 };
        return b;
      });

      var T = 80;
      var walls = [
        M.Bodies.rectangle((zone.left + zone.right) / 2, zone.top - T / 2, zone.right - zone.left + 2 * T, T, { isStatic: true }),
        M.Bodies.rectangle((zone.left + zone.right) / 2, zone.bottom + T / 2, zone.right - zone.left + 2 * T, T, { isStatic: true }),
        M.Bodies.rectangle(zone.left - T / 2, (zone.top + zone.bottom) / 2, T, zone.bottom - zone.top + 2 * T, { isStatic: true }),
        M.Bodies.rectangle(zone.right + T / 2, (zone.top + zone.bottom) / 2, T, zone.bottom - zone.top + 2 * T, { isStatic: true })
      ];

      M.Composite.add(engine.world, world.bodies.concat(walls));
      world.live = true;
      world.last = 0;
      world.t0 = performance.now();
      root.setAttribute("data-live", "");

      var tick = function (now) {
        var w = world;
        if (!w.engine) return;
        var dt = w.last ? Math.min(32, now - w.last) : 16;
        w.last = now;
        var t = (now - w.t0) / 1000;
        var k = drift * 0.00005 * Math.min(1, t / 2);

        w.bodies.forEach(function (b, i) {
          if (w.drag && w.drag.i === i) return;
          var ph = b.plugin.phase;
          M.Body.applyForce(b, b.position, {
            x: Math.sin(t * 0.9 + ph) * k * b.mass,
            y: Math.cos(t * 1.3 + ph * 1.7) * k * b.mass
          });
        });

        M.Engine.update(w.engine, dt);

        w.bodies.forEach(function (b, i) {
          var el = pills[i];
          if (!el) return;
          el.style.setProperty("--x", b.position.x.toFixed(1) + "px");
          el.style.setProperty("--y", (b.position.y - w.sizes[i].h / 2).toFixed(1) + "px");
        });

        w.raf = requestAnimationFrame(tick);
      };
      world.raf = requestAnimationFrame(tick);
    }

    function schedulePhysics() {
      clearTimeout(physicsTimer);
      if (!open || !physics || reduced) {
        if (!open) stopPhysics();
        return;
      }
      /* 等药丸升到位再交给物理，否则会被墙和重力拉扯 */
      physicsTimer = setTimeout(startPhysics, openDuration + (n - 1) * stagger + 80);
    }

    /* ---------- 药丸交互 ---------- */
    var popTimer = 0;
    var suppressClick = false;

    function pick(item, i) {
      if (onSelect) onSelect(item.value, i);
      clearTimeout(popTimer);
      pills[i].setAttribute("data-pop", "");
      popTimer = setTimeout(function () { pills[i].removeAttribute("data-pop"); }, 320);
      if (closeOnSelect) setOpen(false);
    }

    function pointerAt(e) {
      var r = anchor.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function bindPill(btn, i) {
      btn.addEventListener("pointerdown", function (e) {
        var w = world;
        if (!w.live || e.button !== 0) return;
        var b = w.bodies[i];
        if (!b) return;
        var p = pointerAt(e);
        w.drag = {
          i: i,
          id: e.pointerId,
          dx: b.position.x - p.x,
          dy: b.position.y - p.y,
          sx: e.clientX,
          sy: e.clientY,
          moved: false,
          el: btn
        };
        try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      });

      btn.addEventListener("pointermove", function (e) {
        var w = world;
        var d = w.drag;
        if (!d || d.i !== i || d.id !== e.pointerId) return;
        var M = Matter();
        if (!M) return;
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= DRAG_MIN) {
          d.moved = true;
          btn.setAttribute("data-drag", "");
        }
        if (!d.moved) return;
        var b = w.bodies[i];
        var bw = w.sizes[i].w;
        var bh = w.sizes[i].h;
        var z = w.zone;
        var p = pointerAt(e);
        var x = Math.min(z.right - bw / 2, Math.max(z.left + bw / 2, p.x + d.dx));
        var y = Math.min(z.bottom - bh / 2, Math.max(z.top + bh / 2, p.y + d.dy));
        M.Body.setVelocity(b, { x: (x - b.position.x) * 0.6, y: (y - b.position.y) * 0.6 });
        M.Body.setPosition(b, { x: x, y: y });
      });

      var endDrag = function (e) {
        var w = world;
        var d = w.drag;
        if (!d || d.i !== i || d.id !== e.pointerId) return;
        w.drag = null;
        btn.removeAttribute("data-drag");
        try { btn.releasePointerCapture(e.pointerId); } catch (err) {}
        if (!d.moved && e.type === "pointerup") {
          suppressClick = true;
          pick(items[i], i);
        }
      };
      btn.addEventListener("pointerup", endDrag);
      btn.addEventListener("pointercancel", endDrag);

      btn.addEventListener("click", function (e) {
        /* 键盘触发（detail 0）直接选；指针的选在 pointerup 里处理过了 */
        if (e.detail === 0) { pick(items[i], i); return; }
        if (suppressClick) { suppressClick = false; return; }
        if (!world.live) pick(items[i], i);
      });
    }

    /* ---------- 触发器 ---------- */
    var hoverTrigger = trigger === "hover" && fineMQ.matches;

    triggerBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(!open);
    });

    if (hoverTrigger) {
      root.addEventListener("pointerenter", function (e) {
        if (e.pointerType === "mouse" || e.pointerType === "pen") setOpen(true);
      });
      root.addEventListener("pointerleave", function () {
        if (!world.drag) setOpen(false);
      });
    }

    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        setOpen(false);
      }
    });

    /* ---------- 尺寸 / 动效偏好变化 ---------- */
    var resizeTimer = 0;
    var ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (world.live) return;   // 物理接管期间尺寸由引擎决定
        measure();
      }, 120);
    });
    if (ro) ro.observe(root);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { if (!world.live) measure(); });
    }

    var syncReduce = function () {
      reduced = reduceMQ.matches;
      if (reduced) stopPhysics();
      else schedulePhysics();
    };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", syncReduce);

    measure();
    schedulePhysics();

    return {
      open: function () { setOpen(true); },
      close: function () { setOpen(false); },
      toggle: function () { setOpen(!open); },
      measure: measure,
      destroy: function () {
        clearTimeout(physicsTimer);
        clearTimeout(popTimer);
        clearTimeout(resizeTimer);
        if (ro) ro.disconnect();
        if (reduceMQ.removeEventListener) reduceMQ.removeEventListener("change", syncReduce);
        stopPhysics();
        root.textContent = "";
      }
    };
  }

  window.createFolderFloat = createFolderFloat;
})();
