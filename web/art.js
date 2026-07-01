new p5(function (p) {
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
  var w, h;

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

  p.setup = function () {
    w = p.windowWidth;
    h = p.windowHeight;
    p.createCanvas(w, h);
    p.colorMode(p.HSB, 360, 100, 100, 1);
    p.push();
    p.colorMode(p.RGB, 255);
    p.background(11, 15, 21);
    p.pop();
    p.frameRate(30);
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      var pt = makeParticle();
      pt.px = pt.x;
      pt.py = pt.y;
      particles.push(pt);
    }
  };

  p.draw = function () {
    p.push();
    p.colorMode(p.RGB, 255);
    p.fill(11, 15, 21, TRAIL_ALPHA);
    p.noStroke();
    p.rect(0, 0, w, h);
    p.pop();

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
  };

  p.windowResized = function () {
    w = p.windowWidth;
    h = p.windowHeight;
    p.resizeCanvas(w, h);
  };
});
