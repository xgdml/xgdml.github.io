/* ==========================================================================
   ElasticMesh — 弹性材质文字/图形（React Bits 组件的原生移植版）
   去掉 React，保留完整逻辑：距离场膨胀、质点弹簧网格、指针抓取拖拽、
   四种材质（balloon / chrome / jelly / clay）、逐字母入场、工作室环境光反射。
   用法：window.createElasticMesh(containerEl, { text: 'YANG ZHAO', material: 'chrome', ... })
   依赖：WebGL2（不支持时返回 null，调用方应保留平面降级）
   ========================================================================== */
(function () {
  "use strict";

  var VERTEX = "#version 300 es\n" +
    "in vec2 aPosition;\n" +
    "in vec2 aRest;\n" +
    "in vec4 aStrain;\n" +
    "in vec3 aDent;\n" +
    "uniform vec2 uViewport;\n" +
    "uniform vec2 uOffset;\n" +
    "out vec2 vRest;\n" +
    "out vec4 vStrain;\n" +
    "out vec3 vDent;\n" +
    "void main() {\n" +
    "  vRest = aRest;\n" +
    "  vStrain = aStrain;\n" +
    "  vDent = aDent;\n" +
    "  vec2 clip = (aPosition + uOffset) / uViewport * 2.0 - 1.0;\n" +
    "  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);\n" +
    "}";

  var SHADOW = "#version 300 es\n" +
    "precision highp float;\n" +
    "in vec2 vRest;\n" +
    "in vec4 vStrain;\n" +
    "in vec3 vDent;\n" +
    "uniform sampler2D uField;\n" +
    "uniform vec3 uShadowColor;\n" +
    "uniform float uShadow;\n" +
    "uniform vec4 uParts[64];\n" +
    "uniform float uClock;\n" +
    "\n" +
    "float arrival(float delay) {\n" +
    "  float t = max(uClock - delay, 0.0);\n" +
    "  float omega = 15.0;\n" +
    "  float zeta = 0.38;\n" +
    "  float damped = omega * sqrt(1.0 - zeta * zeta);\n" +
    "  return 1.0 - exp(-zeta * omega * t) * (cos(damped * t) + zeta * omega / damped * sin(damped * t));\n" +
    "}\n" +
    "\n" +
    "float owner(vec2 rest) {\n" +
    "  ivec2 size = textureSize(uField, 0);\n" +
    "  ivec2 texel = clamp(ivec2(rest * vec2(size)), ivec2(0), size - 1);\n" +
    "  return floor(texelFetch(uField, texel, 0).w + 0.5);\n" +
    "}\n" +
    "\n" +
    "vec3 settle(vec2 rest) {\n" +
    "  if (uClock > 9.0) return vec3(rest, 1.0);\n" +
    "  float id = owner(rest);\n" +
    "  if (id < 0.5 || id > 64.5) return vec3(rest, 1.0);\n" +
    "  vec4 part = uParts[int(id) - 1];\n" +
    "  float presence = arrival(part.z);\n" +
    "  float size = max(mix(0.5, 1.0, presence), 0.05);\n" +
    "  vec2 moved = part.xy + (rest - part.xy) / size;\n" +
    "  return vec3(moved, presence * step(abs(owner(moved) - id), 0.5));\n" +
    "}\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  vec3 arrived = settle(vRest);\n" +
    "  float shade = texture(uField, arrived.xy).z * uShadow * clamp(arrived.z, 0.0, 1.0) * (1.0 - 0.35 * clamp(vDent.x, 0.0, 1.0));\n" +
    "  outColor = vec4(uShadowColor * shade, shade);\n" +
    "}";

  var SURFACE = "#version 300 es\n" +
    "precision highp float;\n" +
    "in vec2 vRest;\n" +
    "in vec4 vStrain;\n" +
    "in vec3 vDent;\n" +
    "uniform sampler2D uField;\n" +
    "uniform sampler2D uSlope;\n" +
    "uniform sampler2D uPaint;\n" +
    "uniform vec3 uColor;\n" +
    "uniform float uPaintMix;\n" +
    "uniform float uMaterial;\n" +
    "uniform float uLight;\n" +
    "uniform float uInflate;\n" +
    "uniform mat3 uTurn;\n" +
    "uniform vec4 uParts[64];\n" +
    "uniform float uClock;\n" +
    "out vec4 outColor;\n" +
    "\n" +
    "float arrival(float delay) {\n" +
    "  float t = max(uClock - delay, 0.0);\n" +
    "  float omega = 15.0;\n" +
    "  float zeta = 0.38;\n" +
    "  float damped = omega * sqrt(1.0 - zeta * zeta);\n" +
    "  return 1.0 - exp(-zeta * omega * t) * (cos(damped * t) + zeta * omega / damped * sin(damped * t));\n" +
    "}\n" +
    "\n" +
    "float owner(vec2 rest) {\n" +
    "  ivec2 size = textureSize(uField, 0);\n" +
    "  ivec2 texel = clamp(ivec2(rest * vec2(size)), ivec2(0), size - 1);\n" +
    "  return floor(texelFetch(uField, texel, 0).w + 0.5);\n" +
    "}\n" +
    "\n" +
    "vec3 settle(vec2 rest) {\n" +
    "  if (uClock > 9.0) return vec3(rest, 1.0);\n" +
    "  float id = owner(rest);\n" +
    "  if (id < 0.5 || id > 64.5) return vec3(rest, 1.0);\n" +
    "  vec4 part = uParts[int(id) - 1];\n" +
    "  float presence = arrival(part.z);\n" +
    "  float size = max(mix(0.5, 1.0, presence), 0.05);\n" +
    "  vec2 moved = part.xy + (rest - part.xy) / size;\n" +
    "  return vec3(moved, presence * step(abs(owner(moved) - id), 0.5));\n" +
    "}\n" +
    "vec4 cubic(float v) {\n" +
    "  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;\n" +
    "  vec4 s = n * n * n;\n" +
    "  float x = s.x;\n" +
    "  float y = s.y - 4.0 * s.x;\n" +
    "  float z = s.z - 4.0 * s.y + 6.0 * s.x;\n" +
    "  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;\n" +
    "}\n" +
    "\n" +
    "vec2 smoothSlope(vec2 uv) {\n" +
    "  vec2 size = vec2(textureSize(uSlope, 0));\n" +
    "  vec2 cell = uv * size - 0.5;\n" +
    "  vec2 f = fract(cell);\n" +
    "  cell -= f;\n" +
    "  vec4 xc = cubic(f.x);\n" +
    "  vec4 yc = cubic(f.y);\n" +
    "  vec4 corner = cell.xxyy + vec2(-0.5, 1.5).xyxy;\n" +
    "  vec4 sum = vec4(xc.xz + xc.yw, yc.xz + yc.yw);\n" +
    "  vec4 offset = (corner + vec4(xc.yw, yc.yw) / sum) / size.xxyy;\n" +
    "  vec2 a = texture(uSlope, offset.xz).xy;\n" +
    "  vec2 b = texture(uSlope, offset.yz).xy;\n" +
    "  vec2 c = texture(uSlope, offset.xw).xy;\n" +
    "  vec2 d = texture(uSlope, offset.yw).xy;\n" +
    "  float sx = sum.x / (sum.x + sum.y);\n" +
    "  float sy = sum.z / (sum.z + sum.w);\n" +
    "  return mix(mix(d, c, sx), mix(b, a, sx), sy);\n" +
    "}\n" +
    "\n" +
    "float panel(vec3 r, vec3 center, vec2 size, float soft) {\n" +
    "  vec3 forward = normalize(center);\n" +
    "  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), forward));\n" +
    "  vec3 lift = cross(forward, side);\n" +
    "  float facing = dot(r, forward);\n" +
    "  vec2 local = vec2(dot(r, side), dot(r, lift)) / max(facing, 0.1);\n" +
    "  vec2 q = abs(local) - size;\n" +
    "  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);\n" +
    "  return smoothstep(soft, -soft, d) * smoothstep(0.05, 0.3, facing);\n" +
    "}\n" +
    "\n" +
    "vec3 studio(vec3 r, float blur) {\n" +
    "  float y = r.y;\n" +
    "  vec3 skyLow = mix(vec3(0.92, 0.95, 1.0), vec3(1.0), uLight);\n" +
    "  vec3 skyHigh = mix(vec3(0.1, 0.11, 0.14), vec3(0.62, 0.64, 0.7), uLight);\n" +
    "  vec3 groundNear = mix(vec3(0.12, 0.11, 0.1), vec3(0.3, 0.29, 0.28), uLight);\n" +
    "  vec3 groundFar = mix(vec3(0.005), vec3(0.1), uLight);\n" +
    "  vec3 sky = mix(skyLow, skyHigh, smoothstep(0.0, 0.75, y));\n" +
    "  vec3 ground = mix(groundNear, groundFar, smoothstep(0.0, -0.4, y));\n" +
    "  float edge = 0.004 + blur;\n" +
    "  vec3 c = mix(ground, sky, smoothstep(-edge, edge, y));\n" +
    "  float glow = 0.035 + blur;\n" +
    "  c += vec3(2.2) * exp(-pow((y - 0.02) / glow, 2.0)) * (0.035 / glow);\n" +
    "  c += vec3(7.0) * panel(r, vec3(-0.55, 0.55, 0.62), vec2(0.36, 0.2), 0.025 + blur);\n" +
    "  c += vec3(4.5) * panel(r, vec3(0.9, 0.18, 0.4), vec2(0.045, 0.85), 0.01 + blur) * (0.045 / (0.045 + blur));\n" +
    "  c += vec3(3.2) * panel(r, vec3(-0.95, 0.1, 0.32), vec2(0.035, 0.7), 0.01 + blur) * (0.035 / (0.035 + blur));\n" +
    "  c += vec3(2.4) * panel(r, vec3(0.0, 0.92, 0.38), vec2(1.1, 0.045), 0.01 + blur) * (0.045 / (0.045 + blur));\n" +
    "  return c;\n" +
    "}\n" +
    "\n" +
    "vec3 tone(vec3 x) {\n" +
    "  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);\n" +
    "}\n" +
    "\n" +
    "void main() {\n" +
    "  vec3 arrived = settle(vRest);\n" +
    "  vec2 rest = arrived.xy;\n" +
    "  float presence = arrived.z;\n" +
    "  vec4 field = texture(uField, rest);\n" +
    "  float edge = field.y;\n" +
    "  float edgeWidth = max(fwidth(edge), 0.0001);\n" +
    "  if (edge < -3.0 * edgeWidth || presence <= 0.001) discard;\n" +
    "  float cover = clamp(edge / edgeWidth + 0.5, 0.0, 1.0);\n" +
    "\n" +
    "  vec2 slope = smoothSlope(rest);\n" +
    "  mat2 strain = mat2(vStrain.xy, vStrain.zw);\n" +
    "  float area = max(determinant(strain), 0.2);\n" +
    "  float lift = uInflate * presence * inversesqrt(area);\n" +
    "  float keep = clamp(1.0 - vDent.x, 0.15, 1.6);\n" +
    "  vec2 restGradient = (slope * keep - field.x * vDent.yz) * lift;\n" +
    "  vec2 gradient = inverse(transpose(strain)) * restGradient;\n" +
    "  vec3 normal = normalize(vec3(-gradient.x, gradient.y, 1.0));\n" +
    "  float depth = field.x * keep * lift;\n" +
    "\n" +
    "  vec3 turned = uTurn * normal;\n" +
    "  vec3 reflected = uTurn * reflect(vec3(0.0, 0.0, -1.0), normal);\n" +
    "  float footprint = length(fwidth(reflected));\n" +
    "  float facing = max(normal.z, 0.0);\n" +
    "  float fresnel = pow(1.0 - facing, 5.0);\n" +
    "  vec3 lightDir = normalize(vec3(-0.5, 0.62, 0.62));\n" +
    "  float wrap = max((dot(turned, lightDir) + 0.45) / 1.45, 0.0);\n" +
    "  float key = max(dot(turned, lightDir), 0.0);\n" +
    "  float occlusion = mix(0.55, 1.0, smoothstep(0.0, 12.0, depth));\n" +
    "\n" +
    "  vec3 paint = texture(uPaint, rest).rgb;\n" +
    "  vec3 base = mix(uColor, paint, uPaintMix);\n" +
    "  vec3 color;\n" +
    "  if (uMaterial < 0.5) {\n" +
    "    vec3 env = studio(reflected, 0.04 + footprint * 0.6);\n" +
    "    float reflectance = 0.045 + 0.955 * fresnel;\n" +
    "    vec3 deep = base * base * 0.55;\n" +
    "    vec3 body = mix(deep, base * 1.08, wrap) * occlusion;\n" +
    "    body += base * pow(1.0 - facing, 2.0) * 0.18;\n" +
    "    color = body * (1.0 - reflectance) + tone(env * reflectance * 0.9);\n" +
    "  } else if (uMaterial < 1.5) {\n" +
    "    vec3 env = studio(reflected, footprint * 0.6);\n" +
    "    vec3 tint = mix(vec3(1.0), base, 0.6) * 0.92;\n" +
    "    vec3 reflectance = tint + (1.0 - tint) * fresnel;\n" +
    "    color = tone(env * reflectance * mix(0.55, 1.0, occlusion) * 1.1);\n" +
    "  } else if (uMaterial < 2.5) {\n" +
    "    vec3 env = studio(reflected, 0.03 + footprint * 0.6);\n" +
    "    float core = smoothstep(0.0, 1.0, facing);\n" +
    "    vec3 glow = mix(base * base * 0.35, min(base * 1.45 + 0.08, vec3(1.0)), core * core);\n" +
    "    vec3 body = glow * mix(0.7, 1.0, occlusion) + base * wrap * 0.18;\n" +
    "    float reflectance = 0.03 + 0.97 * fresnel;\n" +
    "    color = body * (1.0 - reflectance) + tone(env * reflectance * 0.85);\n" +
    "  } else {\n" +
    "    vec3 env = studio(reflected, 0.35 + footprint * 0.6);\n" +
    "    vec3 body = base * (0.3 + 0.7 * wrap) * mix(0.68, 1.0, occlusion);\n" +
    "    body += base * key * 0.12;\n" +
    "    color = body + tone(env * (0.012 + 0.18 * fresnel)) * 0.5;\n" +
    "  }\n" +
    "  float alpha = cover * smoothstep(0.0, 0.18, presence);\n" +
    "  outColor = vec4(color * alpha, alpha);\n" +
    "}";

  var MATERIALS = { balloon: 0, chrome: 1, jelly: 2, clay: 3 };
  var MAX_FIELD = 720;
  var MAX_NODES = 5200;
  var STEP = 1 / 480;

  var clamp = function (value, min, max) { return Math.min(max, Math.max(min, value)); };

  var compile = function (gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };

  var link = function (gl, fragmentSource) {
    var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    var fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.bindAttribLocation(program, 1, "aRest");
    gl.bindAttribLocation(program, 2, "aStrain");
    gl.bindAttribLocation(program, 3, "aDent");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
    gl.deleteProgram(program);
    return null;
  };

  var locate = function (gl, program, names) {
    var result = {};
    for (var i = 0; i < names.length; i++) result[names[i]] = gl.getUniformLocation(program, names[i]);
    return result;
  };

  var distance1d = function (f, n, d, v, z) {
    var k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (var q = 1; q < n; q++) {
      var s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  var distanceField = function (grid, width, height) {
    var n = Math.max(width, height);
    var f = new Float64Array(n);
    var d = new Float64Array(n);
    var v = new Int32Array(n);
    var z = new Float64Array(n + 1);
    var x, y;
    for (x = 0; x < width; x++) {
      for (y = 0; y < height; y++) f[y] = grid[y * width + x];
      distance1d(f, height, d, v, z);
      for (y = 0; y < height; y++) grid[y * width + x] = d[y];
    }
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) f[x] = grid[y * width + x];
      distance1d(f, width, d, v, z);
      for (x = 0; x < width; x++) grid[y * width + x] = Math.sqrt(d[x]);
    }
    return grid;
  };

  var nearestLabels = function (labels, width, height) {
    var far = 1e20;
    var column = new Float64Array(width * height);
    var site = new Int32Array(width * height);
    var x, y, i, last;
    for (x = 0; x < width; x++) {
      last = -1;
      for (y = 0; y < height; y++) {
        i = y * width + x;
        if (labels[i]) last = y;
        site[i] = last;
        column[i] = last >= 0 ? (y - last) * (y - last) : far;
      }
      last = -1;
      for (y = height - 1; y >= 0; y--) {
        i = y * width + x;
        if (labels[i]) last = y;
        if (last >= 0 && (last - y) * (last - y) < column[i]) {
          column[i] = (last - y) * (last - y);
          site[i] = last;
        }
      }
    }
    var out = new Float32Array(width * height);
    var f = new Float64Array(width);
    var v = new Int32Array(width);
    var z = new Float64Array(width + 1);
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) f[x] = column[y * width + x];
      var k = 0;
      v[0] = 0;
      z[0] = -Infinity;
      z[1] = Infinity;
      for (var q = 1; q < width; q++) {
        var cut = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (cut <= z[k]) {
          k--;
          cut = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        z[k] = cut;
        z[k + 1] = Infinity;
      }
      k = 0;
      for (x = 0; x < width; x++) {
        while (z[k + 1] < x) k++;
        var sx = v[k];
        var sy = site[y * width + sx];
        out[y * width + x] = sy >= 0 ? labels[sy * width + sx] : 0;
      }
    }
    return out;
  };

  var inflateField = function (mask, width, height) {
    var levels = [{ width: width, height: height, mask: mask }];
    while (Math.max(levels[levels.length - 1].width, levels[levels.length - 1].height) > 48) {
      var prev = levels[levels.length - 1];
      var w = Math.ceil(prev.width / 2);
      var h = Math.ceil(prev.height / 2);
      var next = new Float32Array(w * h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var sum = 0;
          var count = 0;
          for (var dy = 0; dy < 2; dy++) {
            for (var dx = 0; dx < 2; dx++) {
              var sx = x * 2 + dx;
              var sy = y * 2 + dy;
              if (sx < prev.width && sy < prev.height) {
                sum += prev.mask[sy * prev.width + sx];
                count++;
              }
            }
          }
          next[y * w + x] = sum / count;
        }
      }
      levels.push({ width: w, height: h, mask: next });
    }

    var solution = null;
    for (var level = levels.length - 1; level >= 0; level--) {
      var lw = levels[level].width;
      var lh = levels[level].height;
      var m = levels[level].mask;
      var current = new Float32Array(lw * lh);
      if (solution) {
        var pw = levels[level + 1].width;
        var ph = levels[level + 1].height;
        for (var yy = 0; yy < lh; yy++) {
          for (var xx = 0; xx < lw; xx++) {
            var fx = clamp((xx + 0.5) / 2 - 0.5, 0, pw - 1);
            var fy = clamp((yy + 0.5) / 2 - 0.5, 0, ph - 1);
            var x0 = Math.floor(fx);
            var y0 = Math.floor(fy);
            var x1 = Math.min(pw - 1, x0 + 1);
            var y1 = Math.min(ph - 1, y0 + 1);
            var tx = fx - x0;
            var ty = fy - y0;
            var top = solution[y0 * pw + x0] * (1 - tx) + solution[y0 * pw + x1] * tx;
            var bottom = solution[y1 * pw + x0] * (1 - tx) + solution[y1 * pw + x1] * tx;
            current[yy * lw + xx] = top * (1 - ty) + bottom * ty;
          }
        }
      }
      var source = Math.pow(4, level);
      var iterations = level === levels.length - 1 ? 300 : 60;
      for (var iteration = 0; iteration < iterations; iteration++) {
        for (var ry = 0; ry < lh; ry++) {
          for (var rx = 0; rx < lw; rx++) {
            var i2 = ry * lw + rx;
            if (m[i2] < 0.5) { current[i2] = 0; continue; }
            var l = rx > 0 ? current[i2 - 1] : 0;
            var r = rx < lw - 1 ? current[i2 + 1] : 0;
            var u = ry > 0 ? current[i2 - lw] : 0;
            var dn = ry < lh - 1 ? current[i2 + lw] : 0;
            current[i2] += ((l + r + u + dn + source) * 0.25 - current[i2]) * 1.85;
          }
        }
      }
      solution = current;
    }
    return solution;
  };

  var blurField = function (source, width, height, radius) {
    var r = Math.max(1, Math.round(radius));
    var sigma = r / 2.5;
    var kernel = [];
    var total = 0;
    for (var i = -r; i <= r; i++) {
      var weight = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel.push(weight);
      total += weight;
    }
    for (i = 0; i < kernel.length; i++) kernel[i] /= total;
    var temp = new Float32Array(width * height);
    var out = new Float32Array(width * height);
    var x, y, k2, sum;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        sum = 0;
        for (k2 = -r; k2 <= r; k2++) sum += source[y * width + clamp(x + k2, 0, width - 1)] * kernel[k2 + r];
        temp[y * width + x] = sum;
      }
    }
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        sum = 0;
        for (k2 = -r; k2 <= r; k2++) sum += temp[clamp(y + k2, 0, height - 1) * width + x] * kernel[k2 + r];
        out[y * width + x] = sum;
      }
    }
    return out;
  };

  function createElasticMesh(container, options) {
    if (!container) return null;
    var o = options || {};
    var settings = {
      text: String(o.text != null ? o.text : "Squish"),
      src: String(o.src || ""),
      fontFamily: String(o.fontFamily || "system-ui, sans-serif"),
      fontWeight: o.fontWeight || 900,
      /* 加粗：按字号的比例向外描边，等于把字“撑胖”（0.05 ≈ 加粗一档） */
      bold: clamp(o.bold != null ? o.bold : 0, 0, 0.16),
      color: String(o.color || "#3b5bff"),
      imageColors: o.imageColors !== false,
      material: MATERIALS[o.material] != null ? MATERIALS[o.material] : 0,
      inflate: clamp(o.inflate != null ? o.inflate : 1, 0.1, 3),
      stiffness: clamp(o.stiffness != null ? o.stiffness : 0.5, 0, 1),
      wobble: clamp(o.wobble != null ? o.wobble : 0.6, 0, 1),
      grabRadius: clamp(o.grabRadius != null ? o.grabRadius : 70, 10, 400),
      stretch: clamp(o.stretch != null ? o.stretch : 0.5, 0, 1),
      press: clamp(o.press != null ? o.press : 0.5, 0, 1),
      shadow: clamp(o.shadow != null ? o.shadow : 0.5, 0, 1),
      intro: o.intro !== false,
      light: (o.theme || "dark") === "light",
      dpr: o.dpr
    };

    // WebGL2 不可用时直接退出，交给调用方的平面降级
    var probeCanvas = document.createElement("canvas");
    if (!probeCanvas.getContext("webgl2")) return null;

    var canvas = document.createElement("canvas");
    canvas.className = "elastic-mesh-canvas";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);

    var gl = canvas.getContext("webgl2", {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false
    });
    if (!gl) {
      container.removeChild(canvas);
      return null;
    }

    var surfaceProgram = link(gl, SURFACE);
    var shadowProgram = link(gl, SHADOW);
    if (!surfaceProgram || !shadowProgram) {
      container.removeChild(canvas);
      return null;
    }
    var surface = locate(gl, surfaceProgram, ["uViewport", "uOffset", "uField", "uPaint", "uSlope", "uColor",
      "uPaintMix", "uMaterial", "uLight", "uInflate", "uTurn", "uClock", "uParts"]);
    var shade = locate(gl, shadowProgram, ["uViewport", "uOffset", "uField", "uShadowColor", "uShadow", "uClock", "uParts"]);

    var fieldTexture = gl.createTexture();
    var paintTexture = gl.createTexture();
    var slopeTexture = gl.createTexture();
    var texList = [fieldTexture, paintTexture, slopeTexture];
    for (var ti = 0; ti < texList.length; ti++) {
      gl.bindTexture(gl.TEXTURE_2D, texList[ti]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }

    var vao = gl.createVertexArray();
    var restBuffer = gl.createBuffer();
    var dynamicBuffer = gl.createBuffer();
    var indexBuffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, restBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, dynamicBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 8);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);

    var probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var partData = new Float32Array(256);
    var turnMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    var mesh = {
      cols: 0, rows: 0, spacing: 1, count: 0, indices: 0,
      restX: new Float32Array(0), restY: new Float32Array(0),
      x: new Float32Array(0), y: new Float32Array(0),
      vx: new Float32Array(0), vy: new Float32Array(0),
      dent: new Float32Array(0), dentV: new Float32Array(0),
      grip: new Float32Array(0), gripX: new Float32Array(0), gripY: new Float32Array(0),
      active: new Uint8Array(0), neighbors: new Int32Array(0),
      dynamic: new Float32Array(0),
      anchorX: new Float32Array(0), anchorY: new Float32Array(0),
      indexType: gl.UNSIGNED_SHORT, activeCount: 0, width: 1, height: 1
    };

    var state = {
      width: 1, height: 1, ready: false,
      fieldWidth: 1, fieldHeight: 1, fieldScale: 1,
      sdf: new Float32Array(0), parts: [],
      clock: settings.intro && !reduce ? 0 : 10,
      colorKey: "", color: [0.31, 0.42, 1],
      pointer: { x: 0, y: 0, inside: false, down: false, startX: 0, startY: 0, startTime: 0, dragging: false },
      hover: { x: 0, y: 0, vx: 0, vy: 0, power: 0 },
      turn: { x: 0, y: 0, vx: 0, vy: 0 },
      accumulator: 0, energy: 1, buildToken: 0
    };

    var raf = 0;
    var last = 0;
    var visible = true;
    var alive = true;
    var resizeTimer = 0;

    var toRgb = function (value) {
      if (!probe || !value) return [0.31, 0.42, 1];
      probe.fillStyle = "#000000";
      probe.fillStyle = /^[0-9a-f]{3,8}$/i.test(value) ? "#" + value : value;
      probe.fillRect(0, 0, 1, 1);
      var px = probe.getImageData(0, 0, 1, 1).data;
      return [px[0] / 255, px[1] / 255, px[2] / 255];
    };

    var sampleSdf = function (px, py) {
      var fx = clamp(Math.round(px * state.fieldScale), 0, state.fieldWidth - 1);
      var fy = clamp(Math.round(py * state.fieldScale), 0, state.fieldHeight - 1);
      return state.sdf[fy * state.fieldWidth + fx] || -1e6;
    };

    var buildMesh = function () {
      var width = state.width;
      var height = state.height;
      var spacing = Math.max(7, Math.sqrt((width * height) / MAX_NODES));
      var cols = Math.ceil(width / spacing) + 1;
      var rows = Math.ceil(height / spacing) + 1;
      var count = cols * rows;
      var sx = width / (cols - 1);
      var sy = height / (rows - 1);
      mesh.cols = cols;
      mesh.rows = rows;
      mesh.width = width;
      mesh.height = height;
      mesh.spacing = (sx + sy) / 2;
      mesh.count = count;
      mesh.restX = new Float32Array(count);
      mesh.restY = new Float32Array(count);
      mesh.x = new Float32Array(count);
      mesh.y = new Float32Array(count);
      mesh.vx = new Float32Array(count);
      mesh.vy = new Float32Array(count);
      mesh.dent = new Float32Array(count);
      mesh.dentV = new Float32Array(count);
      mesh.grip = new Float32Array(count);
      mesh.gripX = new Float32Array(count);
      mesh.gripY = new Float32Array(count);
      mesh.active = new Uint8Array(count);
      mesh.dynamic = new Float32Array(count * 9);
      var rest = new Float32Array(count * 2);
      var reach = -2.5 * mesh.spacing;
      var i, j, k;
      for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) {
          k = j * cols + i;
          var px = i * sx;
          var py = j * sy;
          mesh.restX[k] = px;
          mesh.restY[k] = py;
          mesh.x[k] = px;
          mesh.y[k] = py;
          rest[k * 2] = px / width;
          rest[k * 2 + 1] = py / height;
          mesh.active[k] = state.ready && sampleSdf(px, py) > reach ? 1 : 0;
        }
      }
      var neighbors = new Int32Array(count * 8).fill(-1);
      var offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) {
          k = j * cols + i;
          if (!mesh.active[k]) continue;
          for (var n = 0; n < 8; n++) {
            var ni = i + offsets[n][0];
            var nj = j + offsets[n][1];
            if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
            var nk = nj * cols + ni;
            if (mesh.active[nk]) neighbors[k * 8 + n] = nk;
          }
        }
      }
      mesh.neighbors = neighbors;
      var activeCount = 0;
      for (k = 0; k < count; k++) activeCount += mesh.active[k];
      mesh.activeCount = activeCount;

      var margin = -(Math.min(width, height) * 0.14 + mesh.spacing * 3);
      var near = new Uint8Array(count);
      for (k = 0; k < count; k++) near[k] = state.ready && sampleSdf(mesh.restX[k], mesh.restY[k]) > margin ? 1 : 0;
      var quads = [];
      for (j = 0; j < rows - 1; j++) {
        for (i = 0; i < cols - 1; i++) {
          var a = j * cols + i;
          var b = a + 1;
          var c = a + cols;
          var d = c + 1;
          if (near[a] || near[b] || near[c] || near[d]) quads.push(a, c, b, b, c, d);
        }
      }
      var indexData = count > 65535 ? new Uint32Array(quads) : new Uint16Array(quads);
      mesh.indexType = count > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      mesh.indices = quads.length;
      gl.bindBuffer(gl.ARRAY_BUFFER, restBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, rest, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);
      writeDynamic();
    };

    var writeDynamic = function () {
      var cols = mesh.cols;
      var rows = mesh.rows;
      var x = mesh.x;
      var y = mesh.y;
      var dent = mesh.dent;
      var dynamic = mesh.dynamic;
      var spacing = mesh.spacing;
      var sx = mesh.width / Math.max(1, cols - 1);
      var sy = mesh.height / Math.max(1, rows - 1);
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var k = j * cols + i;
          var l = i > 0 ? k - 1 : k;
          var r = i < cols - 1 ? k + 1 : k;
          var u = j > 0 ? k - cols : k;
          var d = j < rows - 1 ? k + cols : k;
          var spanX = (r - l) * sx || spacing;
          var spanY = ((d - u) / cols) * sy || spacing;
          var o2 = k * 9;
          dynamic[o2] = x[k];
          dynamic[o2 + 1] = y[k];
          dynamic[o2 + 2] = (x[r] - x[l]) / spanX;
          dynamic[o2 + 3] = (y[r] - y[l]) / spanX;
          dynamic[o2 + 4] = (x[d] - x[u]) / spanY;
          dynamic[o2 + 5] = (y[d] - y[u]) / spanY;
          dynamic[o2 + 6] = dent[k];
          dynamic[o2 + 7] = (dent[r] - dent[l]) / spanX;
          dynamic[o2 + 8] = (dent[d] - dent[u]) / spanY;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, dynamicBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, dynamic, gl.DYNAMIC_DRAW);
    };

    var rasterize = function () {
      var token = ++state.buildToken;
      var width = state.width;
      var height = state.height;
      var scale = Math.min(1, MAX_FIELD / Math.max(width, height));
      var fw = Math.max(8, Math.round(width * scale));
      var fh = Math.max(8, Math.round(height * scale));
      var canvas2d = document.createElement("canvas");
      canvas2d.width = fw;
      canvas2d.height = fh;
      var ctx = canvas2d.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      var paintText = function () {
        if (token !== state.buildToken) return false;
        if (settings.src) {
          // 图形模式：需要图片完全加载，异步处理
          loadSource(ctx, fw, fh, token);
          return false;
        }
        var lines = settings.text.split("\n");
        ctx.font = settings.fontWeight + " 100px " + settings.fontFamily;
        var widest = 1;
        var ascent = 0;
        var descent = 0;
        var li;
        for (li = 0; li < lines.length; li++) {
          var m = ctx.measureText(lines[li] || " ");
          widest = Math.max(widest, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
          ascent = Math.max(ascent, m.actualBoundingBoxAscent);
          descent = Math.max(descent, m.actualBoundingBoxDescent);
        }
        var lineHeight = 100 * 1.02;
        var blockHeight = ascent + descent + lineHeight * (lines.length - 1);
        // 原版留边偏大（0.8 / 0.7），这里放宽到 0.82，让标题在版面里更有分量
        // 加粗会向外扩一圈，所以按 bold 比例回收一点边距，避免顶到画布边缘被切
        var fill = 0.82 - settings.bold;
        var size = Math.min((fw * fill) / widest, (fh * fill) / blockHeight) * 100;
        ctx.font = settings.fontWeight + " " + size + "px " + settings.fontFamily;
        ctx.fillStyle = "#ffffff";
        var strokeW = size * settings.bold;
        if (strokeW > 0) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = strokeW;
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        var k = size / 100;
        var top = (fh - blockHeight * k) / 2 + ascent * k;
        for (li = 0; li < lines.length; li++) {
          var mm = ctx.measureText(lines[li] || " ");
          var shift = (mm.actualBoundingBoxLeft - mm.actualBoundingBoxRight) / 2;
          var ly = top + li * lineHeight * k;
          if (strokeW > 0) ctx.strokeText(lines[li], fw / 2 + shift, ly);
          ctx.fillText(lines[li], fw / 2 + shift, ly);
        }
        finish();
        return true;
      };

      var loadSource = function (context2d, w, h, tk) {
        var image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = function () {
          if (tk !== state.buildToken) return;
          var fit = Math.min((w * 0.78) / image.naturalWidth, (h * 0.74) / image.naturalHeight);
          var dw = image.naturalWidth * fit;
          var dh = image.naturalHeight * fit;
          context2d.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
          finish();
        };
        image.src = settings.src;
      };

      var finish = function () {
        if (token !== state.buildToken) return;
        var pixels = ctx.getImageData(0, 0, fw, fh).data;
        var count = fw * fh;
        var mask = new Float32Array(count);
        var inside = new Float64Array(count);
        var outside = new Float64Array(count);
        var i, x, y;
        for (i = 0; i < count; i++) {
          var a = pixels[i * 4 + 3] / 255;
          mask[i] = a;
          inside[i] = a > 0.5 ? 1e10 : 0;
          outside[i] = a > 0.5 ? 0 : 1e10;
        }
        distanceField(inside, fw, fh);
        distanceField(outside, fw, fh);
        var binary = new Float32Array(count);
        var signed = new Float32Array(count);
        for (i = 0; i < count; i++) {
          binary[i] = mask[i] > 0.5 ? 1 : 0;
          signed[i] = mask[i] > 0.02 && mask[i] < 0.98
            ? mask[i] - 0.5
            : (inside[i] > 0 ? inside[i] - 0.5 : 0.5 - outside[i]);
        }

        var labels = new Int32Array(count);
        var parts = [];
        var queue = new Int32Array(count);
        for (var start = 0; start < count; start++) {
          if (!binary[start] || labels[start]) continue;
          var id = parts.length + 1;
          var head = 0;
          var tail = 0;
          var sumX = 0;
          var sumY = 0;
          var minX = Infinity;
          queue[tail++] = start;
          labels[start] = id;
          while (head < tail) {
            var cur = queue[head++];
            var cx = cur % fw;
            var cy = (cur - cx) / fw;
            sumX += cx;
            sumY += cy;
            if (cx < minX) minX = cx;
            if (cx > 0 && binary[cur - 1] && !labels[cur - 1]) { labels[cur - 1] = id; queue[tail++] = cur - 1; }
            if (cx < fw - 1 && binary[cur + 1] && !labels[cur + 1]) { labels[cur + 1] = id; queue[tail++] = cur + 1; }
            if (cy > 0 && binary[cur - fw] && !labels[cur - fw]) { labels[cur - fw] = id; queue[tail++] = cur - fw; }
            if (cy < fh - 1 && binary[cur + fw] && !labels[cur + fw]) { labels[cur + fw] = id; queue[tail++] = cur + fw; }
          }
          parts.push({ x: sumX / tail / scale, y: sumY / tail / scale, left: minX, size: tail, delay: 0 });
        }
        var order = parts.slice().sort(function (p, q) { return p.left - q.left; });
        var gap = order.length > 1 ? Math.min(0.07, 0.5 / (order.length - 1)) : 0;
        for (var rank = 0; rank < order.length; rank++) order[rank].delay = rank * gap;

        var owners = parts.length <= 64 ? nearestLabels(labels, fw, fh) : new Float32Array(count);
        var solution = blurField(inflateField(binary, fw, fh), fw, fh, 2);
        var edges = blurField(signed, fw, fh, 2);
        var shadowMask = blurField(binary, fw, fh, Math.max(4, Math.min(fw, fh) * 0.045));

        var field = new Float32Array(count * 4);
        var sdf = new Float32Array(count);
        var heights = new Float32Array(count);
        for (i = 0; i < count; i++) {
          sdf[i] = edges[i] / scale;
          heights[i] = Math.sqrt(Math.max(0, 2 * solution[i])) / scale;
          field[i * 4] = heights[i];
          field[i * 4 + 1] = sdf[i];
          field[i * 4 + 2] = shadowMask[i];
          field[i * 4 + 3] = owners[i];
        }
        var slopes = new Float32Array(count * 2);
        for (y = 0; y < fh; y++) {
          for (x = 0; x < fw; x++) {
            var idx = y * fw + x;
            var gx = (heights[y * fw + Math.min(fw - 1, x + 1)] - heights[y * fw + Math.max(0, x - 1)]) * 0.5 * scale;
            var gy = (heights[Math.min(fh - 1, y + 1) * fw + x] - heights[Math.max(0, y - 1) * fw + x]) * 0.5 * scale;
            var steep = Math.hypot(gx, gy);
            if (steep > 7) { gx *= 7 / steep; gy *= 7 / steep; }
            slopes[idx * 2] = gx;
            slopes[idx * 2 + 1] = gy;
          }
        }

        gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fw, fh, 0, gl.RGBA, gl.FLOAT, field);
        gl.bindTexture(gl.TEXTURE_2D, slopeTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, fw, fh, 0, gl.RG, gl.FLOAT, slopes);
        gl.bindTexture(gl.TEXTURE_2D, paintTexture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);

        state.fieldWidth = fw;
        state.fieldHeight = fh;
        state.fieldScale = scale;
        state.sdf = sdf;
        state.parts = parts;
        partData.fill(0);
        for (var pi = 0; pi < Math.min(parts.length, 64); pi++) {
          partData[pi * 4] = parts[pi].x / width;
          partData[pi * 4 + 1] = parts[pi].y / height;
          partData[pi * 4 + 2] = parts[pi].delay;
        }
        state.ready = true;
        buildMesh();
        wake();
      };

      // 字体没就绪时先等一等，避免用 fallback 字形烘焙出错误的距离场
      if (document.fonts && !settings.src) {
        document.fonts.load(settings.fontWeight + " 100px " + settings.fontFamily)
          .then(function () { paintText(); })
          .catch(function () { paintText(); });
      } else {
        paintText();
      }
    };

    var solve = function (dt, s) {
      var count = mesh.count;
      var x = mesh.x, y = mesh.y, vx = mesh.vx, vy = mesh.vy;
      var restX = mesh.restX, restY = mesh.restY;
      var dent = mesh.dent, dentV = mesh.dentV, active = mesh.active;
      var neighbors = mesh.neighbors, grip = mesh.grip, gripX = mesh.gripX, gripY = mesh.gripY;
      var spacing = mesh.spacing;
      var firm = 0.4 + s.stiffness * 1.2;
      var anchor = 350 * firm * firm;
      var couple = anchor * Math.pow(52 / Math.sqrt(firm) / spacing, 2);
      var ratio = reduce ? 0.8 : 0.5 - s.wobble * 0.42;
      var damping = 2 * ratio * Math.sqrt(anchor);
      var dentAnchor = anchor * 1.4;
      var dentCouple = dentAnchor * Math.pow(18 / spacing, 2);
      var dentDamping = 2 * (ratio + 0.06) * Math.sqrt(dentAnchor);
      var gripStiffness = anchor * 30;
      var gripDamping = 1.2 * Math.sqrt(gripStiffness);
      var brush = state.pointer.dragging ? 0 : 10;
      var hover = state.hover;
      var pressRadius = s.grabRadius * 0.32;
      var pressInv = 1 / (2 * pressRadius * pressRadius);
      var pressPower = hover.power * s.press;
      var pressDepth = state.pointer.dragging ? 1.6 : 1;
      var energy = 0;
      var k, n, m, weight;

      for (k = 0; k < count; k++) {
        if (!active[k]) continue;
        var ux = x[k] - restX[k];
        var uy = y[k] - restY[k];
        var ax = -anchor * ux - damping * vx[k];
        var ay = -anchor * uy - damping * vy[k];
        var ad = -dentAnchor * dent[k] - dentDamping * dentV[k];
        var base = k * 8;
        for (n = 0; n < 8; n++) {
          m = neighbors[base + n];
          if (m < 0) continue;
          weight = n < 4 ? 1 : 0.5;
          ax += couple * weight * (x[m] - restX[m] - ux);
          ay += couple * weight * (y[m] - restY[m] - uy);
          ad += dentCouple * weight * (dent[m] - dent[k]);
        }
        if (pressPower > 0.001) {
          var dx = x[k] - hover.x;
          var dy = y[k] - hover.y;
          var falloff = Math.exp(-(dx * dx + dy * dy) * pressInv);
          ad += dentAnchor * 2.6 * pressDepth * pressPower * falloff;
          ax += (anchor * 0.3 * dx + brush * hover.vx) * pressPower * falloff;
          ay += (anchor * 0.3 * dy + brush * hover.vy) * pressPower * falloff;
        }
        if (grip[k] > 0) {
          ax += grip[k] * (gripStiffness * (gripX[k] - x[k]) - gripDamping * vx[k]);
          ay += grip[k] * (gripStiffness * (gripY[k] - y[k]) - gripDamping * vy[k]);
        }
        vx[k] += ax * dt;
        vy[k] += ay * dt;
        dentV[k] += ad * dt;
        energy += Math.abs(vx[k]) + Math.abs(vy[k]) + Math.abs(dentV[k]) * spacing;
      }
      for (k = 0; k < count; k++) {
        if (!active[k]) continue;
        x[k] += vx[k] * dt;
        y[k] += vy[k] * dt;
        dent[k] = clamp(dent[k] + dentV[k] * dt, -0.6, 0.85);
      }
      return energy;
    };

    var updateGrip = function (s) {
      var pointer = state.pointer;
      if (!pointer.dragging) return;
      var limit = Math.max(20, Math.min(state.width, state.height) * (0.08 + s.stretch * 0.32));
      var dx = pointer.x - pointer.startX;
      var dy = pointer.y - pointer.startY;
      var length = Math.hypot(dx, dy);
      var eased = length > 0 ? (limit * Math.tanh(length / limit)) / length : 0;
      for (var k = 0; k < mesh.count; k++) {
        if (mesh.grip[k] <= 0) continue;
        mesh.gripX[k] = mesh.anchorX[k] + dx * eased;
        mesh.gripY[k] = mesh.anchorY[k] + dy * eased;
      }
    };

    var grab = function (px, py, s) {
      var count = mesh.count;
      var radius = s.grabRadius * 0.3;
      var inv = 1 / (2 * radius * radius);
      mesh.anchorX = new Float32Array(count);
      mesh.anchorY = new Float32Array(count);
      var total = 0;
      for (var k = 0; k < count; k++) {
        if (!mesh.active[k]) continue;
        var dx = mesh.x[k] - px;
        var dy = mesh.y[k] - py;
        var w = Math.exp(-(dx * dx + dy * dy) * inv);
        mesh.grip[k] = w > 0.03 ? w : 0;
        mesh.anchorX[k] = mesh.x[k];
        mesh.anchorY[k] = mesh.y[k];
        total += mesh.grip[k];
      }
      return total > 0;
    };

    var release = function () {
      mesh.grip.fill(0);
      state.pointer.dragging = false;
    };

    var poke = function (px, py, s) {
      var radius = s.grabRadius;
      var inv = 1 / (2 * radius * radius);
      var strength = 0.4 + s.press;
      for (var k = 0; k < mesh.count; k++) {
        if (!mesh.active[k]) continue;
        var dx = mesh.x[k] - px;
        var dy = mesh.y[k] - py;
        var falloff = Math.exp(-(dx * dx + dy * dy) * inv);
        mesh.dentV[k] += 9 * strength * falloff;
        mesh.vx[k] += dx * 9 * strength * falloff;
        mesh.vy[k] += dy * 9 * strength * falloff;
      }
    };

    var onSurface = function (px, py) {
      var cols = mesh.cols, rows = mesh.rows;
      var best = Infinity;
      var bestK = -1;
      var range = Math.ceil(80 / mesh.spacing);
      var ci = clamp(Math.round(px / (mesh.width / Math.max(1, cols - 1))), 0, cols - 1);
      var cj = clamp(Math.round(py / (mesh.height / Math.max(1, rows - 1))), 0, rows - 1);
      for (var j = Math.max(0, cj - range); j <= Math.min(rows - 1, cj + range); j++) {
        for (var i = Math.max(0, ci - range); i <= Math.min(cols - 1, ci + range); i++) {
          var k = j * cols + i;
          if (!mesh.active[k]) continue;
          var d = Math.hypot(mesh.x[k] - px, mesh.y[k] - py);
          if (d < best) { best = d; bestK = k; }
        }
      }
      if (bestK < 0) return false;
      return sampleSdf(mesh.restX[bestK] + (px - mesh.x[bestK]), mesh.restY[bestK] + (py - mesh.y[bestK])) > -4;
    };

    var resize = function () {
      var width = Math.max(1, container.clientWidth);
      var height = Math.max(1, container.clientHeight);
      var ratio = Math.min(settings.dpr || window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      if (width !== state.width || height !== state.height) {
        var first = !state.ready && !state.buildToken;
        state.width = width;
        state.height = height;
        window.clearTimeout(resizeTimer);
        if (first) rasterize();
        else resizeTimer = window.setTimeout(rasterize, 160);
      }
      wake();
    };

    var render = function () {
      var s = settings;
      if (s.color !== state.colorKey) {
        state.colorKey = s.color;
        state.color = toRgb(s.color);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!state.ready || !mesh.indices) return;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, paintTexture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, slopeTexture);

      if (s.shadow > 0) {
        gl.useProgram(shadowProgram);
        gl.uniform2f(shade.uViewport, mesh.width, mesh.height);
        var drop = Math.min(mesh.width, mesh.height) * 0.035 * s.inflate;
        gl.uniform2f(shade.uOffset, drop * 0.25, drop);
        gl.uniform1i(shade.uField, 0);
        if (s.light) gl.uniform3f(shade.uShadowColor, 0.08, 0.08, 0.14);
        else gl.uniform3f(shade.uShadowColor, 0, 0, 0);
        gl.uniform1f(shade.uShadow, s.shadow * (s.light ? 0.35 : 0.7));
        gl.uniform1f(shade.uClock, state.clock);
        gl.uniform4fv(shade.uParts, partData);
        gl.drawElements(gl.TRIANGLES, mesh.indices, mesh.indexType, 0);
      }

      gl.useProgram(surfaceProgram);
      gl.uniform2f(surface.uViewport, mesh.width, mesh.height);
      gl.uniform2f(surface.uOffset, 0, 0);
      gl.uniform1i(surface.uField, 0);
      gl.uniform1i(surface.uPaint, 1);
      gl.uniform1i(surface.uSlope, 2);
      var yaw = state.turn.x;
      var pitch = state.turn.y;
      var cy = Math.cos(yaw);
      var sy = Math.sin(yaw);
      var cp = Math.cos(pitch);
      var sp = Math.sin(pitch);
      turnMatrix[0] = cy; turnMatrix[1] = sy * sp; turnMatrix[2] = -sy * cp;
      turnMatrix[3] = 0; turnMatrix[4] = cp; turnMatrix[5] = sp;
      turnMatrix[6] = sy; turnMatrix[7] = -cy * sp; turnMatrix[8] = cy * cp;
      gl.uniformMatrix3fv(surface.uTurn, false, turnMatrix);
      gl.uniform3f(surface.uColor, state.color[0], state.color[1], state.color[2]);
      gl.uniform1f(surface.uPaintMix, s.src && s.imageColors ? 1 : 0);
      gl.uniform1f(surface.uMaterial, s.material);
      gl.uniform1f(surface.uLight, s.light ? 1 : 0);
      gl.uniform1f(surface.uInflate, s.inflate);
      gl.uniform1f(surface.uClock, state.clock);
      gl.uniform4fv(surface.uParts, partData);
      gl.drawElements(gl.TRIANGLES, mesh.indices, mesh.indexType, 0);
      gl.bindVertexArray(null);
    };

    var frame = function (now) {
      raf = 0;
      if (!alive || !visible || document.hidden) return;
      var s = settings;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;

      if (reduce || !s.intro) state.clock = 10;
      else if (state.ready && state.clock < 10) state.clock = state.clock + dt > 1.8 ? 10 : state.clock + dt;

      var hover = state.hover;
      var pointer = state.pointer;
      var pressing = state.ready && (pointer.dragging || (pointer.inside && !pointer.down && onSurface(pointer.x, pointer.y)));
      var follow = 1 - Math.exp(-dt / 0.05);
      var nextX = hover.x + (pointer.x - hover.x) * follow;
      var nextY = hover.y + (pointer.y - hover.y) * follow;
      var blend = 1 - Math.exp(-dt / 0.04);
      hover.vx += ((nextX - hover.x) / Math.max(dt, 0.001) - hover.vx) * blend;
      hover.vy += ((nextY - hover.y) / Math.max(dt, 0.001) - hover.vy) * blend;
      hover.x = nextX;
      hover.y = nextY;
      var goal = pressing ? 1 : 0;
      hover.power += (goal - hover.power) * (1 - Math.exp(-dt / (pressing ? 0.12 : 0.25)));

      var turn = state.turn;
      var aimX = pointer.inside && !reduce ? (pointer.x / Math.max(1, mesh.width) - 0.5) * 0.7 : 0;
      var aimY = pointer.inside && !reduce ? (pointer.y / Math.max(1, mesh.height) - 0.5) * 0.4 : 0;
      turn.vx += (28 * (aimX - turn.x) - 10 * turn.vx) * dt;
      turn.vy += (28 * (aimY - turn.y) - 10 * turn.vy) * dt;
      turn.x += turn.vx * dt;
      turn.y += turn.vy * dt;
      var turning = Math.abs(aimX - turn.x) > 0.0005 || Math.abs(aimY - turn.y) > 0.0005 ||
        Math.abs(turn.vx) > 0.001 || Math.abs(turn.vy) > 0.001;

      var energy = 0;
      if (state.ready) {
        updateGrip(s);
        state.accumulator += dt;
        var steps = 0;
        while (state.accumulator >= STEP && steps < 40) {
          energy = solve(STEP, s);
          state.accumulator -= STEP;
          steps++;
        }
        if (steps === 40) state.accumulator = 0;
        writeDynamic();
      }
      state.energy = energy;
      render();

      var settling = !state.ready || state.clock < 10 ||
        Math.abs(goal - hover.power) > 0.002 || turning ||
        Math.hypot(pointer.x - hover.x, pointer.y - hover.y) > 0.1 || pointer.dragging ||
        energy > 0.05 * Math.max(1, mesh.activeCount);
      if (settling) raf = requestAnimationFrame(frame);
      else last = 0;
    };

    function wake() {
      if (!raf && alive && visible && !document.hidden) raf = requestAnimationFrame(frame);
    }

    var locatePointer = function (event) {
      var rect = container.getBoundingClientRect();
      state.pointer.x = event.clientX - rect.left;
      state.pointer.y = event.clientY - rect.top;
      state.pointer.inside = state.pointer.x >= 0 && state.pointer.y >= 0 &&
        state.pointer.x <= rect.width && state.pointer.y <= rect.height;
    };

    var onPointerMove = function (event) {
      locatePointer(event);
      wake();
    };

    var onPointerDown = function (event) {
      locatePointer(event);
      if (!state.ready || !onSurface(state.pointer.x, state.pointer.y)) return;
      state.pointer.down = true;
      state.pointer.startX = state.pointer.x;
      state.pointer.startY = state.pointer.y;
      state.pointer.startTime = performance.now();
      state.pointer.dragging = grab(state.pointer.x, state.pointer.y, settings);
      if (container.setPointerCapture) {
        try { container.setPointerCapture(event.pointerId); } catch (e) {}
      }
      wake();
    };

    var onPointerUp = function (event) {
      if (!state.pointer.down) return;
      locatePointer(event);
      var moved = Math.hypot(state.pointer.x - state.pointer.startX, state.pointer.y - state.pointer.startY);
      var quick = performance.now() - state.pointer.startTime < 260;
      release();
      if (moved < 8 && quick) poke(state.pointer.x, state.pointer.y, settings);
      state.pointer.down = false;
      wake();
    };

    var onPointerLeave = function () {
      state.pointer.inside = false;
      wake();
    };

    var onVisibility = function () {
      last = 0;
      wake();
    };

    var resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    var intersection = new IntersectionObserver(function (entries) {
      visible = entries.some(function (entry) { return entry.isIntersecting; });
      if (visible) { last = 0; wake(); }
    });
    intersection.observe(container);
    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    resize();

    return {
      refresh: function () {
        state.ready = false;
        state.clock = settings.intro && !reduce ? 0 : 10;
        rasterize();
      },
      destroy: function () {
        alive = false;
        state.buildToken++;
        cancelAnimationFrame(raf);
        window.clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        intersection.disconnect();
        container.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        container.removeEventListener("pointerleave", onPointerLeave);
        document.removeEventListener("visibilitychange", onVisibility);
        gl.deleteBuffer(restBuffer);
        gl.deleteBuffer(dynamicBuffer);
        gl.deleteBuffer(indexBuffer);
        gl.deleteVertexArray(vao);
        gl.deleteTexture(fieldTexture);
        gl.deleteTexture(paintTexture);
        gl.deleteTexture(slopeTexture);
        gl.deleteProgram(surfaceProgram);
        gl.deleteProgram(shadowProgram);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  window.createElasticMesh = createElasticMesh;
})();
