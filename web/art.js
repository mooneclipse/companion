new p5(function (p) {
  // ---- 共通設定 ----
  var BG = { r: 11, g: 15, b: 21 };
  var DEFAULT_ROTATE_MS = 30 * 60 * 1000; // 30 分
  var FADE_MS = 3000; // 切替時のフェードアウト時間

  var w, h;
  var bgColor; // setup 時に RGB モードで生成した p5.Color (HSB モード中でも fill に使える)

  function bgOpaque() {
    p.push();
    p.colorMode(p.RGB, 255);
    p.background(BG.r, BG.g, BG.b);
    p.pop();
  }

  function bgTrail(alpha255) {
    p.push();
    p.colorMode(p.RGB, 255);
    p.noStroke();
    p.fill(BG.r, BG.g, BG.b, alpha255);
    p.rect(0, 0, w, h);
    p.pop();
  }

  // ---- パターン: flow (既存 Perlin noise flow field、見た目は初期実装のまま) ----
  var flowPattern = (function () {
    var PARTICLE_COUNT = 1500;
    var NOISE_SCALE = 0.003;
    var NOISE_Z_SPEED = 0.0003;
    var SPEED = 1.8;
    var TRAIL_ALPHA = 8;

    var palette = [
      { h: 30 },
      { h: 15 },
      { h: 355 },
      { h: 190 },
      { h: 220 },
      { h: 270 },
    ];

    var particles = [];
    var zoff = 0;
    var paletteTime = 0;

    function currentHue() {
      var total = palette.length;
      var t = (paletteTime % 1 + 1) % 1;
      var idx = t * total;
      var i0 = Math.floor(idx) % total;
      var i1 = (i0 + 1) % total;
      var frac = idx - Math.floor(idx);
      var h0 = palette[i0].h;
      var h1 = palette[i1].h;
      var diff = h1 - h0;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return (h0 + diff * frac + 360) % 360;
    }

    function makeParticle() {
      return {
        x: p.random(w),
        y: p.random(h),
        px: 0,
        py: 0,
        lifespan: p.floor(p.random(250, 600)),
        age: 0,
        hueOffset: p.random(-20, 20),
        sat: p.random(55, 75),
        bri: p.random(65, 90),
      };
    }

    function resetParticle(pt) {
      pt.x = p.random(w);
      pt.y = p.random(h);
      pt.px = pt.x;
      pt.py = pt.y;
      pt.lifespan = p.floor(p.random(250, 600));
      pt.age = 0;
      pt.hueOffset = p.random(-20, 20);
      pt.sat = p.random(55, 75);
      pt.bri = p.random(65, 90);
    }

    return {
      name: "flow",
      init: function () {
        particles = [];
        zoff = 0;
        paletteTime = 0;
        for (var i = 0; i < PARTICLE_COUNT; i++) {
          var pt = makeParticle();
          pt.px = pt.x;
          pt.py = pt.y;
          particles.push(pt);
        }
      },
      draw: function () {
        bgTrail(TRAIL_ALPHA);

        zoff += NOISE_Z_SPEED;
        var baseHue = currentHue();

        for (var i = 0; i < particles.length; i++) {
          var pt = particles[i];
          pt.px = pt.x;
          pt.py = pt.y;

          var angle = p.noise(pt.x * NOISE_SCALE, pt.y * NOISE_SCALE, zoff) * p.TAU * 2;
          pt.x += p.cos(angle) * SPEED;
          pt.y += p.sin(angle) * SPEED;
          pt.age++;

          if (pt.x < 0 || pt.x > w || pt.y < 0 || pt.y > h || pt.age > pt.lifespan) {
            resetParticle(pt);
            continue;
          }

          var fadeIn = pt.age < pt.lifespan * 0.1 ? pt.age / (pt.lifespan * 0.1) : 1;
          var fadeOut = pt.age > pt.lifespan * 0.8 ? (pt.lifespan - pt.age) / (pt.lifespan * 0.2) : 1;
          var alpha = fadeIn * fadeOut * 0.2;

          var hue = (baseHue + pt.hueOffset + 360) % 360;
          p.stroke(hue, pt.sat, pt.bri, alpha);
          p.strokeWeight(1.5);
          p.line(pt.px, pt.py, pt.x, pt.y);
        }

        paletteTime += 0.0005;
      },
    };
  })();

  // ---- パターン: ridge (noise 稜線、Joy Division 風の静かなラインアート) ----
  var ridgePattern = (function () {
    var LINE_COUNT = 30;
    var X_STEP = 20;
    var NOISE_X_SCALE = 0.004;
    var T_SPEED = 0.003;

    var lines = [];
    var t = 0;

    return {
      name: "ridge",
      init: function () {
        lines = [];
        t = p.random(1000);
        var top = h * 0.3;
        var bottom = h * 0.86;
        for (var i = 0; i < LINE_COUNT; i++) {
          lines.push({
            baseY: top + ((bottom - top) * i) / (LINE_COUNT - 1),
            seed: i * 7.31,
            amp: p.random(110, 170),
            // 手前 (下) の線ほどわずかに明るく
            bri: 40 + (i / (LINE_COUNT - 1)) * 30,
          });
        }
      },
      draw: function () {
        bgOpaque();
        t += T_SPEED;

        p.strokeWeight(1.2);
        // 奥 (上) から手前 (下) へ描き、fill で背後の線を隠す
        for (var i = 0; i < lines.length; i++) {
          var ln = lines[i];
          p.stroke(205, 25, ln.bri, 0.7);
          p.fill(bgColor); // 背景色 fill で背後の線を隠す (Joy Division 的オクルージョン)
          p.beginShape();
          p.vertex(-10, h + 10);
          for (var x = 0; x <= w + X_STEP; x += X_STEP) {
            var n = p.noise(x * NOISE_X_SCALE + t * 0.05, ln.seed, t);
            var env = Math.pow(Math.sin((Math.PI * Math.min(x, w)) / w), 1.4);
            var y = ln.baseY - Math.pow(n, 2.4) * ln.amp * env * 2.2;
            p.vertex(x, y);
          }
          p.vertex(w + 10, h + 10);
          p.endShape(p.CLOSE);
        }
      },
    };
  })();

  // ---- パターン: orbit (中心の周りを回る発光点群 + トレイル、星の軌跡風) ----
  var orbitPattern = (function () {
    var STAR_COUNT = 420;
    var TRAIL_ALPHA = 6;

    var stars = [];
    var cx, cy;

    var starHues = [35, 45, 200, 220];

    return {
      name: "orbit",
      init: function () {
        stars = [];
        cx = w / 2;
        cy = h / 2;
        var maxR = Math.min(w, h) * 0.66;
        for (var i = 0; i < STAR_COUNT; i++) {
          var r = maxR * Math.sqrt(p.random());
          stars.push({
            r: r,
            angle: p.random(p.TAU),
            // 内側ほど速く、全体としてはごくゆっくり
            speed: p.random(0.0006, 0.0028) * (1.4 - (r / maxR) * 0.8) * (p.random() < 0.5 ? 1 : -1),
            weight: p.random(1.2, 2.4),
            hue: starHues[p.floor(p.random(starHues.length))],
            sat: p.random(8, 38),
            bri: p.random(60, 92),
            alpha: p.random(0.35, 0.75),
          });
        }
      },
      draw: function () {
        bgTrail(TRAIL_ALPHA);
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          s.angle += s.speed;
          var x = cx + Math.cos(s.angle) * s.r;
          var y = cy + Math.sin(s.angle) * s.r;
          p.stroke(s.hue, s.sat, s.bri, s.alpha);
          p.strokeWeight(s.weight);
          p.point(x, y);
        }
      },
    };
  })();

  // ---- パターン: fireflies (漂い明滅する発光ドット、蛍風) ----
  var firefliesPattern = (function () {
    var FLY_COUNT = 110;
    var TRAIL_ALPHA = 28;
    var T_SPEED = 0.0022;
    var WANDER = 0.22; // アンカーからの漂い半径 (画面幅比)

    var flies = [];
    var t = 0;

    return {
      name: "fireflies",
      init: function () {
        flies = [];
        t = p.random(1000);
        for (var i = 0; i < FLY_COUNT; i++) {
          flies.push({
            ax: p.random(w),
            ay: p.random(h),
            nx: p.random(1000),
            ny: p.random(1000),
            phase: p.random(p.TAU),
            pulse: p.random(0.015, 0.05),
            hue: p.random(58, 82),
            sat: p.random(40, 62),
            size: p.random(2, 4),
          });
        }
      },
      draw: function () {
        bgTrail(TRAIL_ALPHA);
        t += T_SPEED;
        var wander = w * WANDER;
        p.noStroke();
        for (var i = 0; i < flies.length; i++) {
          var f = flies[i];
          f.phase += f.pulse;
          var x = f.ax + (p.noise(f.nx, t) - 0.5) * wander;
          var y = f.ay + (p.noise(f.ny, t) - 0.5) * wander;
          // 明滅: sin を 2 乗して「消えている時間」を長めに
          var pulse = Math.pow(0.5 + 0.5 * Math.sin(f.phase), 2);
          var alpha = pulse * 0.85;
          if (alpha < 0.02) continue;
          // 外側のにじみ + 中心の点
          p.fill(f.hue, f.sat * 0.8, 70, alpha * 0.15);
          p.ellipse(x, y, f.size * 3.2, f.size * 3.2);
          p.fill(f.hue, f.sat, 88, alpha);
          p.ellipse(x, y, f.size, f.size);
        }
      },
    };
  })();

  // ---- レジストリ + ローテーション ----
  var patterns = [flowPattern, ridgePattern, orbitPattern, firefliesPattern];

  var rotateMs = DEFAULT_ROTATE_MS;
  var fixedIndex = -1; // >=0 なら ?p= 固定 (ローテーション無効)

  (function parseQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      var pv = params.get("p");
      if (pv) {
        for (var i = 0; i < patterns.length; i++) {
          if (patterns[i].name === pv) {
            fixedIndex = i;
            break;
          }
        }
      }
      var rv = params.get("rot");
      if (rv) {
        var sec = parseFloat(rv);
        if (isFinite(sec) && sec > 0) rotateMs = sec * 1000;
      }
    } catch (e) {
      // 不正値・非対応環境は無視してデフォルト動作
    }
  })();

  var order = [];
  var orderIdx = 0;
  var current = null;
  var nextSwitchAt = 0;
  var fading = false;
  var fadeStart = 0;

  function shuffleOrder() {
    order = [];
    for (var i = 0; i < patterns.length; i++) order.push(i);
    for (var j = order.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = order[j];
      order[j] = order[k];
      order[k] = tmp;
    }
  }

  function startPattern(idx) {
    current = patterns[idx];
    bgOpaque();
    current.init();
    nextSwitchAt = p.millis() + rotateMs;
    window.__ssPattern = current.name; // デバッグ/検証用フック
  }

  p.setup = function () {
    w = p.windowWidth;
    h = p.windowHeight;
    p.createCanvas(w, h);
    p.push();
    p.colorMode(p.RGB, 255);
    bgColor = p.color(BG.r, BG.g, BG.b);
    p.pop();
    p.colorMode(p.HSB, 360, 100, 100, 1);
    p.frameRate(30);

    if (fixedIndex >= 0) {
      startPattern(fixedIndex);
    } else {
      shuffleOrder();
      orderIdx = 0;
      startPattern(order[orderIdx]);
    }
  };

  p.draw = function () {
    if (fading) {
      bgTrail(30);
      if (p.millis() - fadeStart >= FADE_MS) {
        fading = false;
        orderIdx = (orderIdx + 1) % order.length;
        startPattern(order[orderIdx]);
      }
      return;
    }

    current.draw();

    if (fixedIndex < 0 && p.millis() >= nextSwitchAt) {
      fading = true;
      fadeStart = p.millis();
    }
  };

  p.windowResized = function () {
    w = p.windowWidth;
    h = p.windowHeight;
    p.resizeCanvas(w, h);
    bgOpaque();
    if (current) current.init();
  };
});
