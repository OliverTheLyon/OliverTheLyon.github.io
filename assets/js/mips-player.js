/*
 * MARS-style front end for the MIPS simulator in mips-sim.js.
 *
 * It downloads an assembly file, assembles it, and runs it at a chosen speed while showing
 * the bitmap display, the instruction being executed, the text segment, the registers and
 * the program's console output.
 *
 * Markup lives in _includes/mips-player.html, styles in _sass/_page.scss.
 */
(function () {
  "use strict";

  var Sim = window.MipsSim;

  // Positions of the speed slider, in instructions per second. The last one is "as fast as possible".
  var SPEEDS = [1, 2, 5, 10, 30, 100, 1000, 10000, 50000, 200000, 500000, 1000000, 5000000, Infinity];
  var DEFAULT_SPEED = 200000;
  var FOLLOW_LIMIT = 30;          // at or below this speed the listing follows every instruction
  var FRAME_BUDGET_MS = 12;       // most time to spend simulating per animation frame
  var INFO_INTERVAL_MS = 120;     // how often the read-outs refresh when running fast
  var CONSOLE_LIMIT = 6000;       // characters of program output to keep
  var SETTLED_GENERATIONS = 12;   // repeated frames before a random field is replaced

  function formatNumber(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function randomSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      return window.crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return Math.floor(Math.random() * 4294967296);
  }

  // Small seeded generator (mulberry32), so one seed fully determines a random field.
  function makeRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function Player(root, source) {
    var find = function (name) { return root.querySelector("[data-mips-" + name + "]"); };
    this.root = root;
    this.source = source;
    this.ui = {
      canvas: find("display"), run: find("run"), step: find("step"), reset: find("reset"),
      pattern: find("pattern"), patternField: find("pattern-field"),
      speed: find("speed"), speedLabel: find("speed-label"),
      address: find("address"), code: find("code"), basic: find("basic"), line: find("line"),
      executed: find("executed"), generation: find("generation"), measured: find("measured"), seed: find("seed"),
      status: find("status"), listing: find("listing"), hint: find("hint"),
      registers: find("registers"), console: find("console")
    };

    // Settings for this particular program, from the markup.
    this.displayBase = parseInt(root.getAttribute("data-display-base") || "0x10000000", 16);
    this.displaySize = parseInt(root.getAttribute("data-display-size") || "32", 10);
    this.frameLabel = root.getAttribute("data-frame-label");
    this.patternPrefix = root.getAttribute("data-pattern-prefix");
    this.randomPattern = root.getAttribute("data-random-pattern");

    this.paused = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.visible = true;
    this.speedIndex = SPEEDS.indexOf(DEFAULT_SPEED);
    this.budget = 0;
    this.lastFrame = 0;
    this.lastInfo = 0;
    this.measured = 0;
    this.frameRequest = null;
    this.listedSource = null;
    this.rows = [];
    this.highlighted = -1;
    this.registerCells = [];
    this.registerValues = [];

    // The program's pixels go to a small off-screen bitmap, one pixel per word, which is then
    // copied to the canvas on the page at a whole-number scale (see fitDisplay).
    this.pixels = new Int32Array(this.displaySize * this.displaySize);
    this.bitmap = document.createElement("canvas");
    this.bitmap.width = this.displaySize;
    this.bitmap.height = this.displaySize;
    this.bitmapContext = this.bitmap.getContext("2d");
    this.image = this.bitmapContext.createImageData(this.displaySize, this.displaySize);
    this.ui.canvas.width = this.displaySize;
    this.ui.canvas.height = this.displaySize;
    this.context = this.ui.canvas.getContext("2d");
    this.fitDisplay();

    this.setUpPatterns();
    this.buildRegisters();
    this.bindControls();
    this.load();
    this.schedule();
  }

  /* ---------------- program set-up ---------------- */

  // The program picks its starting pattern with a single "j startX" line near the top.
  // The pattern menu rewrites that one line before assembling, like editing it in MARS.
  Player.prototype.patternJump = function () {
    return this.patternPrefix ? new RegExp("^(\\s*j\\s+)" + this.patternPrefix + "\\w+", "m") : null;
  };

  Player.prototype.setUpPatterns = function () {
    var select = this.ui.pattern;
    var jump = this.patternJump();
    if (!select || !jump || !jump.test(this.source)) {
      if (this.ui.patternField) { this.ui.patternField.hidden = true; }
      this.ui.pattern = null;
      return;
    }
    var source = this.source;
    Array.prototype.forEach.call(select.options, function (option) {
      option.disabled = !new RegExp("^\\s*" + option.value + "\\s*:", "m").test(source);
    });
  };

  Player.prototype.load = function () {
    var ui = this.ui;
    var text = this.source;
    if (ui.pattern) {
      text = text.replace(this.patternJump(), "$1" + ui.pattern.value);
    }

    this.console = "";
    this.consoleDirty = true;
    this.generation = 0;
    this.frames = [];
    this.settled = 0;
    this.budget = 0;
    this.seed = randomSeed();
    this.machine = null;

    var self = this;
    try {
      this.program = Sim.assemble(text);
      this.machine = new Sim.Machine(this.program, {
        print: function (output) {
          self.console = (self.console + output).slice(-CONSOLE_LIMIT);
          self.consoleDirty = true;
        },
        random: makeRandom(this.seed)
      });
    } catch (error) {
      if (!(error instanceof Sim.AssemblyError) && !(error instanceof Sim.MipsError)) { throw error; }
      ui.status.textContent = "Could not assemble the program. " + error.message;
      ui.status.classList.add("mips-player__status--error");
      return;
    }

    var mark = this.frameLabel && this.program.labels[this.frameLabel];
    if (mark !== undefined && mark !== null && this.frameLabel) {
      this.machine.markAddress = mark;
      this.machine.stopAtMark = true;
    }
    if (this.listedSource !== text) {
      this.buildListing();
      this.listedSource = text;
    }
    ui.seed.textContent = Sim.hex(this.seed).toUpperCase().replace("0X", "0x");
    ui.status.classList.remove("mips-player__status--error");
    this.render(true);
  };

  Player.prototype.buildListing = function () {
    var program = this.program;
    var body = element("tbody");
    var rows = [];
    program.text.forEach(function (entry) {
      var row = element("tr");
      row.appendChild(element("td", "mips-player__cell-address", Sim.hex(entry.address)));
      row.appendChild(element("td", "mips-player__cell-code", Sim.hex(entry.word)));
      row.appendChild(element("td", "mips-player__cell-basic", entry.basic));
      var sourceCell = element("td", "mips-player__cell-source");
      if (entry.first) {
        var parts = Sim.splitComment(program.lines[entry.line - 1]);
        sourceCell.appendChild(element("span", "mips-player__line-number", entry.line + ":"));
        sourceCell.appendChild(document.createTextNode(" " + parts.code.trim().replace(/\s+/g, " ") + " "));
        if (parts.comment) { sourceCell.appendChild(element("span", "mips-player__comment", parts.comment.trim())); }
      }
      row.appendChild(sourceCell);
      body.appendChild(row);
      rows.push(row);
    });
    var table = this.ui.listing.querySelector("table");
    var old = table.querySelector("tbody");
    if (old) { table.removeChild(old); }
    table.appendChild(body);
    this.rows = rows;
    this.highlighted = -1;
  };

  Player.prototype.buildRegisters = function () {
    var holder = this.ui.registers;
    var names = Sim.REGISTER_NAMES.map(function (name) { return "$" + name; }).concat(["pc", "hi", "lo"]);
    var cells = [];
    names.forEach(function (name) {
      var item = element("div", "mips-player__register");
      item.appendChild(element("span", "mips-player__register-name", name));
      var value = element("span", "mips-player__register-value", "0x00000000");
      item.appendChild(value);
      holder.appendChild(item);
      cells.push(value);
    });
    this.registerCells = cells;
    this.registerValues = names.map(function () { return null; });
  };

  /* ---------------- controls ---------------- */

  Player.prototype.bindControls = function () {
    var self = this;
    var ui = this.ui;

    ui.run.addEventListener("click", function () {
      if (self.machine && self.machine.halted) { self.load(); self.paused = false; } else { self.paused = !self.paused; }
      self.budget = 0;
      self.render(true);
      self.schedule();
    });
    ui.step.addEventListener("click", function () {
      self.paused = true;
      self.advance(1);
      self.render(true);
    });
    ui.reset.addEventListener("click", function () {
      self.load();
      self.schedule();
    });
    if (ui.pattern) {
      ui.pattern.addEventListener("change", function () {
        self.load();
        self.schedule();
      });
    }
    ui.speed.min = 0;
    ui.speed.max = SPEEDS.length - 1;
    ui.speed.step = 1;
    ui.speed.value = this.speedIndex;
    ui.speed.addEventListener("input", function () {
      self.speedIndex = parseInt(ui.speed.value, 10);
      self.budget = 0;
      self.render(true);
    });

    // Only simulate while the player is on screen.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        self.visible = entries[entries.length - 1].isIntersecting;
        self.schedule();
      }).observe(this.root);
    }

    // Refit the display when the page is resized or zoomed, or the layout around it changes.
    var refit = function () {
      if (self.fitDisplay()) { self.drawDisplay(); }
    };
    window.addEventListener("resize", refit);
    if ("ResizeObserver" in window) {
      new ResizeObserver(refit).observe(this.root);
    }
  };

  /* ---------------- running ---------------- */

  Player.prototype.isRunning = function () {
    return !this.paused && this.visible && this.machine && !this.machine.halted;
  };

  Player.prototype.schedule = function () {
    if (this.frameRequest === null && this.isRunning()) {
      this.lastFrame = 0;
      this.frameRequest = window.requestAnimationFrame(this.frame.bind(this));
    }
  };

  // Execute up to n instructions, pausing at the start of each generation to take stock.
  Player.prototype.advance = function (n) {
    var machine = this.machine;
    if (!machine) { return 0; }
    var total = 0;
    while (total < n && !machine.halted) {
      var hits = machine.markHits;
      var done = machine.run(n - total);
      total += done;
      if (machine.markHits !== hits) {
        if (this.onGeneration()) { break; }
      } else if (done === 0) {
        break;
      }
    }
    return total;
  };

  // Called each time the program reaches the top of its main loop, with a finished frame on
  // the display. The first visit shows the starting pattern. Returns true if it restarted.
  Player.prototype.onGeneration = function () {
    this.generation = this.machine.markHits - 1;
    if (!this.ui.pattern || this.ui.pattern.value !== this.randomPattern) { return false; }

    // A random field that has died, frozen, or settled into a two-step cycle is replaced.
    this.machine.peekWords(this.displayBase, this.pixels);
    var hash = 2166136261;
    for (var i = 0; i < this.pixels.length; i++) {
      hash = Math.imul(hash ^ this.pixels[i], 16777619);
    }
    var frames = this.frames;
    var repeat = frames.length >= 2 && (hash === frames[frames.length - 1] || hash === frames[frames.length - 2]);
    this.settled = repeat ? this.settled + 1 : 0;
    frames.push(hash);
    if (frames.length > 2) { frames.shift(); }
    if (this.settled >= SETTLED_GENERATIONS) {
      this.load();
      return true;
    }
    return false;
  };

  Player.prototype.frame = function (now) {
    this.frameRequest = null;
    if (!this.isRunning()) { this.render(true); return; }

    var elapsed = this.lastFrame ? Math.min(now - this.lastFrame, 100) : 16;
    this.lastFrame = now;
    var speed = SPEEDS[this.speedIndex];
    var deadline = performance.now() + FRAME_BUDGET_MS;
    var executed = 0;

    if (speed === Infinity) {
      do { executed += this.advance(20000); } while (this.isRunning() && performance.now() < deadline);
    } else {
      this.budget += speed * elapsed / 1000;
      var due = Math.floor(this.budget);
      this.budget -= due;
      while (due > 0 && this.isRunning()) {
        var chunk = Math.min(due, 20000);
        executed += this.advance(chunk);
        due -= chunk;
        if (performance.now() > deadline) { this.budget = 0; break; }   // the browser cannot keep up
      }
    }

    var rate = executed * 1000 / elapsed;
    this.measured = this.measured ? this.measured * 0.9 + rate * 0.1 : rate;
    this.render(false, now);
    this.schedule();
    if (this.frameRequest !== null) { this.lastFrame = now; }
  };

  /* ---------------- drawing ---------------- */

  // Size the canvas so that every pixel of the display covers the same whole number of screen
  // pixels. At any other size, which is what most browser zoom levels would give it, some rows
  // and columns come out a screen pixel bigger than their neighbours. The stylesheet says how
  // much room the display may take; this picks the largest size that fits and narrows the box
  // around the canvas to match. Returns true if the canvas was cleared and needs redrawing.
  Player.prototype.fitDisplay = function () {
    var canvas = this.ui.canvas;
    var box = canvas.parentNode;
    var ratio = window.devicePixelRatio || 1;                      // screen pixels per CSS pixel
    box.style.flexBasis = canvas.style.width = canvas.style.height = "";   // the stylesheet's size
    var room = canvas.getBoundingClientRect().width * ratio;
    if (!room) { return false; }                                   // not laid out: leave it be
    var side = Math.max(1, Math.floor(room / this.displaySize + 1e-6)) * this.displaySize;
    box.style.flexBasis = canvas.style.width = canvas.style.height = (side / ratio) + "px";
    if (canvas.width === side) { return false; }
    canvas.width = side;
    canvas.height = side;
    return true;
  };

  // Bitmap display: one pixel per word, read straight out of simulated memory.
  Player.prototype.drawDisplay = function () {
    if (!this.machine) { return; }
    this.machine.peekWords(this.displayBase, this.pixels);
    var data = this.image.data;
    for (var i = 0; i < this.pixels.length; i++) {
      var colour = this.pixels[i];
      data[i * 4] = (colour >>> 16) & 255;
      data[i * 4 + 1] = (colour >>> 8) & 255;
      data[i * 4 + 2] = colour & 255;
      data[i * 4 + 3] = 255;
    }
    this.bitmapContext.putImageData(this.image, 0, 0);
    this.context.imageSmoothingEnabled = false;                    // resizing the canvas resets this
    this.context.drawImage(this.bitmap, 0, 0, this.ui.canvas.width, this.ui.canvas.height);
  };

  Player.prototype.render = function (force, now) {
    var ui = this.ui;
    var machine = this.machine;
    var speed = SPEEDS[this.speedIndex];

    ui.speedLabel.textContent = speed === Infinity ? "max" : formatNumber(speed) + " inst/sec";
    if (!machine) {
      ui.run.textContent = "Run";
      return;
    }
    var running = this.isRunning() || (!this.paused && !machine.halted);
    ui.run.textContent = machine.halted ? "Restart" : this.paused ? "Run" : "Pause";
    ui.step.disabled = machine.halted;

    this.drawDisplay();

    if (this.consoleDirty) {
      ui.console.textContent = this.console;
      ui.console.scrollTop = ui.console.scrollHeight;
      this.consoleDirty = false;
    }

    // Slow enough to read: follow every instruction. Otherwise sample a few times a second.
    var follow = force || !running || speed <= FOLLOW_LIMIT;
    var time = now || performance.now();
    if (!follow && time - this.lastInfo < INFO_INTERVAL_MS) { return; }
    this.lastInfo = time;

    var index = machine.currentIndex();
    var entry = index >= 0 ? this.program.text[index] : null;
    ui.address.textContent = Sim.hex(machine.pc);
    ui.code.textContent = entry ? Sim.hex(entry.word) : "";
    ui.basic.textContent = entry ? entry.basic : "";
    ui.line.textContent = entry ? entry.line + ": " + Sim.splitComment(this.program.lines[entry.line - 1]).code.trim().replace(/\s+/g, " ") : "";

    ui.executed.textContent = formatNumber(machine.executed);
    ui.generation.textContent = formatNumber(this.generation);
    ui.measured.textContent = running ? formatNumber(this.measured) + " inst/sec" : "paused";

    if (machine.halted) {
      ui.status.textContent = machine.haltReason;
      ui.status.classList.toggle("mips-player__status--error", !!machine.error);
    } else {
      ui.status.textContent = this.paused ? "Paused. Step runs one instruction at a time." : "Running.";
    }

    var showRow = follow && (speed <= FOLLOW_LIMIT || !running);
    ui.hint.hidden = showRow;
    this.highlight(showRow ? index : -1);
    this.renderRegisters(showRow);
  };

  Player.prototype.highlight = function (index) {
    if (index === this.highlighted) { return; }
    if (this.highlighted >= 0 && this.rows[this.highlighted]) {
      this.rows[this.highlighted].classList.remove("mips-player__row--current");
    }
    this.highlighted = index;
    var row = index >= 0 ? this.rows[index] : null;
    if (!row) { return; }
    row.classList.add("mips-player__row--current");
    // Keep the current row in view by scrolling the listing itself, never the page.
    var box = this.ui.listing;
    var top = row.offsetTop;
    if (top < box.scrollTop + row.offsetHeight * 2 || top > box.scrollTop + box.clientHeight - row.offsetHeight * 3) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    }
  };

  Player.prototype.renderRegisters = function (markChanges) {
    var machine = this.machine;
    for (var i = 0; i < this.registerCells.length; i++) {
      var value = i < 32 ? machine.regs[i] : i === 32 ? machine.pc : i === 33 ? machine.hi : machine.lo;
      var cell = this.registerCells[i];
      var changed = this.registerValues[i] !== null && this.registerValues[i] !== value;
      if (this.registerValues[i] !== value) {
        cell.textContent = Sim.hex(value);
        this.registerValues[i] = value;
      }
      cell.parentNode.classList.toggle("mips-player__register--changed", markChanges && changed && i !== 32);
    }
  };

  /* ---------------- start-up ---------------- */

  function start(root) {
    var status = root.querySelector("[data-mips-status]");
    var url = root.getAttribute("data-src");
    if (!Sim || !window.fetch) {
      status.textContent = "This browser cannot run the simulator.";
      return;
    }
    window.fetch(url).then(function (response) {
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      return response.text();
    }).then(function (source) {
      root.classList.add("mips-player--ready");
      new Player(root, source);
    }).catch(function (error) {
      status.textContent = "Could not load the program (" + error.message + ").";
      status.classList.add("mips-player__status--error");
    });
  }

  function init() {
    var players = document.querySelectorAll("[data-mips-player]");
    for (var i = 0; i < players.length; i++) { start(players[i]); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
