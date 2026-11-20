/*
 * A small MIPS32 assembler and interpreter, in the spirit of the MARS simulator.
 *
 *   var program = MipsSim.assemble(sourceText);   // MARS-dialect assembly -> machine code
 *   var machine = new MipsSim.Machine(program, { print: fn, random: fn });
 *   machine.run(1000);                            // execute up to 1000 instructions
 *
 * What it covers:
 *   - Directives: .data .text .word .half .byte .space .ascii .asciiz .align .eqv (.globl is ignored)
 *   - The common integer instructions (arithmetic, logic, shifts, mult/div, loads/stores,
 *     branches, jumps, syscall) and the MARS pseudo-instructions built on them (li, la, move,
 *     blt/bge/..., immediates where a register is expected, "lw $t0, label($t1)", and so on).
 *     Pseudo-instructions are expanded into basic instructions using $at, as MARS does.
 *   - Syscalls: print int/string/char (1, 4, 11, 34, 35, 36), exit (10, 17), time (30),
 *     sleep (32, ignored), random (40, 41, 42).
 *   - No floating point, no delayed branches, no keyboard input.
 *
 * Memory layout matches MARS: text at 0x00400000, static data at 0x10010000,
 * $gp = 0x10008000, $sp = 0x7fffeffc. Words are little-endian.
 *
 * This file has no dependency on the page; the user interface is in mips-player.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MipsSim = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TEXT_BASE = 0x00400000;
  var DATA_BASE = 0x10010000;
  var DATA_LOW = 0x10000000;       // lowest address a program may load from or store to
  var GLOBAL_POINTER = 0x10008000;
  var STACK_POINTER = 0x7fffeffc;
  var MAX_PAGES = 4096;            // 16 MB of memory at most

  var REGISTER_NAMES = [
    "zero", "at", "v0", "v1", "a0", "a1", "a2", "a3",
    "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
    "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
    "t8", "t9", "k0", "k1", "gp", "sp", "fp", "ra"
  ];
  var REGISTER_NUMBER = {};
  REGISTER_NAMES.forEach(function (name, i) {
    REGISTER_NUMBER[name] = i;
    REGISTER_NUMBER[String(i)] = i;
  });
  REGISTER_NUMBER.s8 = 30;
  var AT = 1;

  /* ------------------------------------------------------------------ *
   * Instruction encodings
   * ------------------------------------------------------------------ */

  // opcode 0, selected by the function field
  var FUNCT = {
    sll: 0x00, srl: 0x02, sra: 0x03, sllv: 0x04, srlv: 0x06, srav: 0x07,
    jr: 0x08, jalr: 0x09, syscall: 0x0c, "break": 0x0d,
    mfhi: 0x10, mthi: 0x11, mflo: 0x12, mtlo: 0x13,
    mult: 0x18, multu: 0x19, div: 0x1a, divu: 0x1b,
    add: 0x20, addu: 0x21, sub: 0x22, subu: 0x23,
    and: 0x24, or: 0x25, xor: 0x26, nor: 0x27, slt: 0x2a, sltu: 0x2b
  };
  // selected by the opcode field
  var OPCODE = {
    j: 0x02, jal: 0x03, beq: 0x04, bne: 0x05, blez: 0x06, bgtz: 0x07,
    addi: 0x08, addiu: 0x09, slti: 0x0a, sltiu: 0x0b, andi: 0x0c, ori: 0x0d, xori: 0x0e, lui: 0x0f,
    lb: 0x20, lh: 0x21, lw: 0x23, lbu: 0x24, lhu: 0x25, sb: 0x28, sh: 0x29, sw: 0x2b
  };
  var REGIMM = { bltz: 0, bgez: 1 };   // opcode 1, selected by the rt field
  var OPCODE_MUL = 0x1c;               // "mul" is opcode 0x1c, function 2

  function invert(table) {
    var out = {};
    Object.keys(table).forEach(function (name) { out[table[name]] = name; });
    return out;
  }
  var FUNCT_NAME = invert(FUNCT);
  var OPCODE_NAME = invert(OPCODE);

  // Every basic instruction gets a small integer so the interpreter can switch on it quickly.
  var KIND = {};
  var KIND_NAMES = Object.keys(FUNCT).concat(Object.keys(OPCODE), Object.keys(REGIMM), ["mul"]);
  KIND_NAMES.forEach(function (name, i) { KIND[name] = i + 1; });

  var K_SLL = KIND.sll, K_SRL = KIND.srl, K_SRA = KIND.sra, K_SLLV = KIND.sllv, K_SRLV = KIND.srlv,
      K_SRAV = KIND.srav, K_JR = KIND.jr, K_JALR = KIND.jalr, K_SYSCALL = KIND.syscall,
      K_BREAK = KIND["break"], K_MFHI = KIND.mfhi, K_MTHI = KIND.mthi, K_MFLO = KIND.mflo,
      K_MTLO = KIND.mtlo, K_MULT = KIND.mult, K_MULTU = KIND.multu, K_DIV = KIND.div,
      K_DIVU = KIND.divu, K_ADD = KIND.add, K_ADDU = KIND.addu, K_SUB = KIND.sub,
      K_SUBU = KIND.subu, K_AND = KIND.and, K_OR = KIND.or, K_XOR = KIND.xor, K_NOR = KIND.nor,
      K_SLT = KIND.slt, K_SLTU = KIND.sltu, K_J = KIND.j, K_JAL = KIND.jal, K_BEQ = KIND.beq,
      K_BNE = KIND.bne, K_BLEZ = KIND.blez, K_BGTZ = KIND.bgtz, K_ADDI = KIND.addi,
      K_ADDIU = KIND.addiu, K_SLTI = KIND.slti, K_SLTIU = KIND.sltiu, K_ANDI = KIND.andi,
      K_ORI = KIND.ori, K_XORI = KIND.xori, K_LUI = KIND.lui, K_LB = KIND.lb, K_LH = KIND.lh,
      K_LW = KIND.lw, K_LBU = KIND.lbu, K_LHU = KIND.lhu, K_SB = KIND.sb, K_SH = KIND.sh,
      K_SW = KIND.sw, K_BLTZ = KIND.bltz, K_BGEZ = KIND.bgez, K_MUL = KIND.mul;

  function encode(b) {
    var name = b.name;
    var rs = b.rs || 0, rt = b.rt || 0, rd = b.rd || 0, sa = b.sa || 0;
    var imm = (b.imm || 0) & 0xffff;
    if (name === "mul") {
      return ((OPCODE_MUL << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 2) >>> 0;
    }
    if (FUNCT.hasOwnProperty(name)) {
      return ((rs << 21) | (rt << 16) | (rd << 11) | (sa << 6) | FUNCT[name]) >>> 0;
    }
    if (REGIMM.hasOwnProperty(name)) {
      return ((1 << 26) | (rs << 21) | (REGIMM[name] << 16) | imm) >>> 0;
    }
    if (name === "j" || name === "jal") {
      return ((OPCODE[name] << 26) | ((b.target >>> 2) & 0x03ffffff)) >>> 0;
    }
    return ((OPCODE[name] << 26) | (rs << 21) | (rt << 16) | imm) >>> 0;
  }

  function decode(word, address) {
    var opcode = word >>> 26;
    var d = {
      name: null, kind: 0,
      rs: (word >>> 21) & 31, rt: (word >>> 16) & 31, rd: (word >>> 11) & 31, sa: (word >>> 6) & 31,
      imm: (word << 16) >> 16,          // sign-extended
      uimm: word & 0xffff,
      target: 0
    };
    if (opcode === 0) {
      d.name = FUNCT_NAME[word & 63] || null;
    } else if (opcode === 1) {
      d.name = d.rt === 0 ? "bltz" : d.rt === 1 ? "bgez" : null;
    } else if (opcode === OPCODE_MUL) {
      d.name = (word & 63) === 2 ? "mul" : null;
    } else {
      d.name = OPCODE_NAME[opcode] || null;
    }
    if (d.name === "j" || d.name === "jal") {
      d.target = ((((address + 4) & 0xf0000000) | ((word & 0x03ffffff) << 2)) >>> 0);
    } else {
      d.target = (address + 4 + (d.imm << 2)) >>> 0;   // where a branch would go
    }
    d.kind = d.name ? KIND[d.name] : 0;
    return d;
  }

  function hex(value, digits) {
    var s = (value >>> 0).toString(16);
    while (s.length < (digits || 8)) { s = "0" + s; }
    return "0x" + s;
  }

  // Text for the "Basic" column, with registers written as numbers the way MARS shows them.
  function disassemble(d) {
    var r = function (n) { return "$" + n; };
    switch (d.name) {
      case null: return ".word (unknown instruction)";
      case "sll": case "srl": case "sra":
        return d.name + " " + r(d.rd) + "," + r(d.rt) + "," + d.sa;
      case "sllv": case "srlv": case "srav":
        return d.name + " " + r(d.rd) + "," + r(d.rt) + "," + r(d.rs);
      case "jr": case "mthi": case "mtlo":
        return d.name + " " + r(d.rs);
      case "jalr":
        return d.name + " " + r(d.rd) + "," + r(d.rs);
      case "syscall": case "break":
        return d.name;
      case "mfhi": case "mflo":
        return d.name + " " + r(d.rd);
      case "mult": case "multu": case "div": case "divu":
        return d.name + " " + r(d.rs) + "," + r(d.rt);
      case "j": case "jal":
        return d.name + " " + hex(d.target);
      case "beq": case "bne":
        return d.name + " " + r(d.rs) + "," + r(d.rt) + "," + hex(d.target);
      case "blez": case "bgtz": case "bltz": case "bgez":
        return d.name + " " + r(d.rs) + "," + hex(d.target);
      case "addi": case "addiu": case "slti": case "sltiu":
        return d.name + " " + r(d.rt) + "," + r(d.rs) + "," + d.imm;
      case "andi": case "ori": case "xori":
        return d.name + " " + r(d.rt) + "," + r(d.rs) + "," + hex(d.uimm, 4);
      case "lui":
        return d.name + " " + r(d.rt) + "," + hex(d.uimm, 4);
      case "lb": case "lh": case "lw": case "lbu": case "lhu": case "sb": case "sh": case "sw":
        return d.name + " " + r(d.rt) + "," + d.imm + "(" + r(d.rs) + ")";
      default:
        return d.name + " " + r(d.rd) + "," + r(d.rs) + "," + r(d.rt);
    }
  }

  /* ------------------------------------------------------------------ *
   * Assembler
   * ------------------------------------------------------------------ */

  function AssemblyError(message, line) {
    this.name = "AssemblyError";
    this.line = line;
    this.message = "Line " + line + ": " + message;
  }
  AssemblyError.prototype = Object.create(Error.prototype);

  // Cut a "# comment" off a line, leaving "#" inside quotes alone.
  function splitComment(line) {
    var quote = null;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (quote) {
        if (c === "\\") { i++; } else if (c === quote) { quote = null; }
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "#") {
        return { code: line.slice(0, i), comment: line.slice(i) };
      }
    }
    return { code: line, comment: "" };
  }

  function parseInteger(text) {
    var m = /^([+-]?)(0x[0-9a-f]+|\d+)$/i.exec(text);
    if (m) {
      var value = parseInt(m[2], m[2].length > 1 && m[2][1].toLowerCase() === "x" ? 16 : 10);
      return m[1] === "-" ? -value : value;
    }
    m = /^'(\\?.)'$/.exec(text);
    if (m) {
      return unescapeString(m[1]).charCodeAt(0);
    }
    return null;
  }

  function unescapeString(text) {
    return text.replace(/\\(.)/g, function (_, c) {
      switch (c) {
        case "n": return "\n";
        case "t": return "\t";
        case "r": return "\r";
        case "0": return "\0";
        default: return c;
      }
    });
  }

  function parseRegister(text) {
    if (text[0] !== "$") { return null; }
    var n = REGISTER_NUMBER[text.slice(1).toLowerCase()];
    return n === undefined ? null : n;
  }

  // A number, a label, or label+number / label-number.
  function parseExpression(text) {
    var value = parseInteger(text);
    if (value !== null) { return { label: null, value: value }; }
    var m = /^([A-Za-z_.][\w.]*)(?:\s*([+-])\s*(0x[0-9a-f]+|\d+))?$/i.exec(text);
    if (!m) { return null; }
    var addend = m[3] ? parseInteger(m[3]) : 0;
    return { label: m[1], value: m[2] === "-" ? -addend : addend };
  }

  // An operand is a register, a number/label, or a memory reference like 4($sp), label($t1) or ($t0).
  function parseOperand(text, line) {
    var reg = parseRegister(text);
    if (reg !== null) { return { type: "reg", reg: reg }; }
    if (text[0] === "$") { throw new AssemblyError("unknown register " + text, line); }
    var m = /^(.*)\(\s*(\$\w+)\s*\)$/.exec(text);
    if (m) {
      var base = parseRegister(m[2]);
      if (base === null) { throw new AssemblyError("unknown register " + m[2], line); }
      var inner = m[1].trim() === "" ? { label: null, value: 0 } : parseExpression(m[1].trim());
      if (!inner) { throw new AssemblyError("cannot read operand " + text, line); }
      return { type: "mem", base: base, label: inner.label, value: inner.value };
    }
    var expr = parseExpression(text);
    if (!expr) { throw new AssemblyError("cannot read operand " + text, line); }
    return { type: expr.label ? "label" : "imm", label: expr.label, value: expr.value };
  }

  function fitsSigned16(v) { return v >= -32768 && v <= 32767; }
  function fitsUnsigned16(v) { return v >= 0 && v <= 65535; }

  var THREE_REGISTER = ["add", "addu", "sub", "subu", "and", "or", "xor", "nor", "slt", "sltu", "mul"];
  var LOAD_STORE = ["lw", "sw", "lb", "lbu", "lh", "lhu", "sb", "sh"];
  // Pseudo-instruction comparisons: [use sltu?, swap operands?, branch when $at is set?]
  var COMPARE_BRANCH = {
    blt: [false, false, true], bge: [false, false, false], bgt: [false, true, true], ble: [false, true, false],
    bltu: [true, false, true], bgeu: [true, false, false], bgtu: [true, true, true], bleu: [true, true, false]
  };

  /*
   * Turn one source statement into one or more basic instructions.
   * Label references are left symbolic ("ref") and filled in once every address is known.
   */
  function expand(mnemonic, ops, line) {
    var out = [];
    function emit(name, fields) {
      var b = fields || {};
      b.name = name;
      out.push(b);
      return b;
    }
    function fail(message) { throw new AssemblyError(message, line); }
    function count(n) {
      if (ops.length !== n) {
        fail(mnemonic + " expects " + n + " operand" + (n === 1 ? "" : "s") + ", found " + ops.length);
      }
    }
    function reg(i) {
      if (!ops[i] || ops[i].type !== "reg") { fail("operand " + (i + 1) + " of " + mnemonic + " must be a register"); }
      return ops[i].reg;
    }
    function imm(i) {
      if (!ops[i] || ops[i].type !== "imm") { fail("operand " + (i + 1) + " of " + mnemonic + " must be a number"); }
      return ops[i].value;
    }
    function branchRef(i) {
      var o = ops[i];
      if (!o || o.type !== "label") { fail(mnemonic + " needs a label to branch to"); }
      return { kind: "branch", label: o.label, value: o.value };
    }
    // Put a constant into a register: one instruction if it fits in 16 bits, otherwise lui + ori.
    function loadConstant(target, value, small) {
      if (fitsSigned16(value)) {
        emit(small || "addi", { rt: target, rs: 0, imm: value });
      } else if (fitsUnsigned16(value)) {
        emit("ori", { rt: target, rs: 0, imm: value });
      } else {
        emit("lui", { rt: AT, imm: (value >>> 16) & 0xffff });
        emit("ori", { rt: target, rs: AT, imm: value & 0xffff });
      }
    }

    var m = mnemonic;

    if (m === "syscall" || m === "break") { emit(m); return out; }
    if (m === "nop") { count(0); emit("sll", { rd: 0, rt: 0, sa: 0 }); return out; }

    if (m === "li") {
      count(2);
      loadConstant(reg(0), imm(1), "addiu");
      return out;
    }
    if (m === "la") {
      count(2);
      if (ops[1].type === "label") {
        emit("lui", { rt: AT, ref: { kind: "upper", label: ops[1].label, value: ops[1].value } });
        emit("ori", { rt: reg(0), rs: AT, ref: { kind: "lower", label: ops[1].label, value: ops[1].value } });
      } else if (ops[1].type === "imm") {
        loadConstant(reg(0), ops[1].value, "addiu");
      } else {
        fail("la needs a label");
      }
      return out;
    }
    if (m === "move") { count(2); emit("addu", { rd: reg(0), rs: 0, rt: reg(1) }); return out; }
    if (m === "neg") { count(2); emit("sub", { rd: reg(0), rs: 0, rt: reg(1) }); return out; }
    if (m === "not") { count(2); emit("nor", { rd: reg(0), rs: reg(1), rt: 0 }); return out; }

    if (m === "lui") { count(2); emit("lui", { rt: reg(0), imm: imm(1) & 0xffff }); return out; }

    if (m === "sll" || m === "srl" || m === "sra") {
      count(3);
      emit(m, { rd: reg(0), rt: reg(1), sa: imm(2) & 31 });
      return out;
    }
    if (m === "sllv" || m === "srlv" || m === "srav") {
      count(3);
      emit(m, { rd: reg(0), rt: reg(1), rs: reg(2) });
      return out;
    }

    if (m === "mult" || m === "multu" || m === "divu" || (m === "div" && ops.length === 2)) {
      count(2);
      emit(m, { rs: reg(0), rt: reg(1) });
      return out;
    }
    if (m === "div" || m === "rem") {
      // Three-operand forms: quotient (div) or remainder (rem) straight into a register.
      count(3);
      var from = m === "div" ? "mflo" : "mfhi";
      if (ops[2].type === "reg") {
        emit("bne", { rs: reg(2), rt: 0, imm: 1 });   // skip the break unless dividing by zero
        emit("break");
        emit("div", { rs: reg(1), rt: reg(2) });
      } else {
        loadConstant(AT, imm(2));
        emit("div", { rs: reg(1), rt: AT });
      }
      emit(from, { rd: reg(0) });
      return out;
    }
    if (m === "mfhi" || m === "mflo") { count(1); emit(m, { rd: reg(0) }); return out; }
    if (m === "mthi" || m === "mtlo" || m === "jr") { count(1); emit(m, { rs: reg(0) }); return out; }
    if (m === "jalr") {
      if (ops.length === 1) { emit(m, { rd: 31, rs: reg(0) }); } else { count(2); emit(m, { rd: reg(0), rs: reg(1) }); }
      return out;
    }

    if (m === "j" || m === "jal") {
      count(1);
      if (ops[0].type === "label") {
        emit(m, { ref: { kind: "jump", label: ops[0].label, value: ops[0].value } });
      } else {
        emit(m, { target: imm(0) });
      }
      return out;
    }
    if (m === "b") { count(1); emit("bgez", { rs: 0, ref: branchRef(0) }); return out; }
    if (m === "beqz" || m === "bnez") {
      count(2);
      emit(m === "beqz" ? "beq" : "bne", { rs: reg(0), rt: 0, ref: branchRef(1) });
      return out;
    }
    if (m === "blez" || m === "bgtz" || m === "bltz" || m === "bgez") {
      count(2);
      emit(m, { rs: reg(0), ref: branchRef(1) });
      return out;
    }
    if (m === "beq" || m === "bne") {
      count(3);
      if (ops[1].type === "reg") {
        emit(m, { rs: reg(0), rt: reg(1), ref: branchRef(2) });
      } else {
        loadConstant(AT, imm(1));
        emit(m, { rs: AT, rt: reg(0), ref: branchRef(2) });
      }
      return out;
    }
    if (COMPARE_BRANCH.hasOwnProperty(m)) {
      count(3);
      var rule = COMPARE_BRANCH[m];
      var compare = rule[0] ? "sltu" : "slt";
      var other = ops[1].type === "reg" ? reg(1) : (loadConstant(AT, imm(1)), AT);
      if (rule[1]) {
        emit(compare, { rd: AT, rs: other, rt: reg(0) });
      } else {
        emit(compare, { rd: AT, rs: reg(0), rt: other });
      }
      emit(rule[2] ? "bne" : "beq", { rs: AT, rt: 0, ref: branchRef(2) });
      return out;
    }

    if (LOAD_STORE.indexOf(m) !== -1) {
      count(2);
      var rt = reg(0);
      var o = ops[1];
      if (o.type === "mem" && !o.label && fitsSigned16(o.value)) {
        emit(m, { rt: rt, rs: o.base, imm: o.value });                 // lw $t0, 4($sp)
      } else if (o.type === "mem" || o.type === "label" || o.type === "imm") {
        // A full 32-bit address: build the upper half in $at, then use the lower half as the offset.
        var ref = function (kind) {
          return o.label ? { kind: kind, label: o.label, value: o.value } : { kind: kind, label: null, value: o.value };
        };
        emit("lui", { rt: AT, ref: ref("high") });
        if (o.type === "mem") { emit("addu", { rd: AT, rs: AT, rt: o.base }); }
        emit(m, { rt: rt, rs: AT, ref: ref("low") });
      } else {
        fail(m + " needs an address");
      }
      return out;
    }

    // Arithmetic and logic, where the last operand may be a register or a constant.
    var base = { addi: "add", addiu: "addu", subi: "sub", subiu: "subu", andi: "and", ori: "or", xori: "xor", slti: "slt", sltiu: "sltu" }[m] || m;
    if (THREE_REGISTER.indexOf(base) !== -1) {
      count(3);
      var rd = reg(0), rs = reg(1);
      if (ops[2].type === "reg") {
        if (base !== m) { fail(m + " needs a number as its last operand"); }
        emit(base, { rd: rd, rs: rs, rt: reg(2) });
        return out;
      }
      var value = imm(2);
      var immediateForm = { add: "addi", addu: "addiu", slt: "slti", sltu: "sltiu" }[base];
      var logicalForm = { and: "andi", or: "ori", xor: "xori" }[base];
      if (immediateForm && fitsSigned16(value)) {
        emit(immediateForm, { rt: rd, rs: rs, imm: value });
      } else if (logicalForm && fitsUnsigned16(value)) {
        emit(logicalForm, { rt: rd, rs: rs, imm: value });
      } else {
        loadConstant(AT, value);
        emit(base, { rd: rd, rs: rs, rt: AT });
      }
      return out;
    }

    fail("instruction \"" + mnemonic + "\" is not supported by this simulator");
  }

  function assemble(source) {
    var lines = String(source).replace(/\r\n?/g, "\n").split("\n");
    var labels = {};
    var data = [];                // bytes of the data segment
    var items = [];               // basic instructions, in order
    var pending = [];             // labels waiting for the next thing to be placed
    var segment = "text";
    var constants = {};           // names defined with .eqv

    // Replace .eqv names with their text. "$t0" and ".word" are never names, and strings are left alone.
    function substitute(code) {
      if (/^\.asciiz?\b/i.test(code)) { return code; }
      return code.replace(/[A-Za-z_]\w*/g, function (name, offset) {
        var before = offset > 0 ? code[offset - 1] : "";
        if (before === "$" || before === "." || !constants.hasOwnProperty(name)) { return name; }
        return constants[name];
      });
    }

    function defineLabel(name, address, line) {
      if (labels.hasOwnProperty(name)) { throw new AssemblyError("label " + name + " is defined twice", line); }
      labels[name] = address;
    }
    function placePending(address, line) {
      pending.forEach(function (name) { defineLabel(name, address >>> 0, line); });
      pending = [];
    }
    function alignData(size) {
      while (data.length % size !== 0) { data.push(0); }
    }
    function pushValue(value, size) {
      for (var i = 0; i < size; i++) { data.push((value >>> (8 * i)) & 0xff); }
    }
    function splitList(text) {
      return text.split(/[\s,]+/).filter(function (s) { return s !== ""; });
    }

    var dataFixups = [];          // .word entries that name a label

    lines.forEach(function (raw, index) {
      var line = index + 1;
      var parts = splitComment(raw);
      var code = parts.code;

      var m;
      while ((m = /^\s*([A-Za-z_.][\w.]*)\s*:/.exec(code))) {
        pending.push(m[1]);
        code = code.slice(m[0].length);
      }
      code = code.trim();
      if (code === "") { return; }

      m = /^\.eqv\s+([A-Za-z_]\w*)\s+(.+)$/i.exec(code);
      if (m) {
        constants[m[1]] = substitute(m[2].trim());
        return;
      }
      code = substitute(code);

      if (code[0] === ".") {
        m = /^(\.\w+)\s*(.*)$/.exec(code);
        var directive = m[1].toLowerCase();
        var rest = m[2].trim();
        if (directive === ".data" || directive === ".kdata") { segment = "data"; return; }
        if (directive === ".text" || directive === ".ktext") { segment = "text"; return; }
        if (directive === ".globl" || directive === ".extern" || directive === ".set") { return; }
        if (segment !== "data") { throw new AssemblyError(directive + " is only supported in the .data segment", line); }

        if (directive === ".word" || directive === ".half" || directive === ".byte") {
          var size = directive === ".word" ? 4 : directive === ".half" ? 2 : 1;
          alignData(size);
          placePending(DATA_BASE + data.length, line);
          splitList(rest).forEach(function (token) {
            var expr = parseExpression(token);
            if (!expr) { throw new AssemblyError("cannot read value " + token, line); }
            if (expr.label) {
              if (size !== 4) { throw new AssemblyError("labels can only be stored with .word", line); }
              dataFixups.push({ offset: data.length, label: expr.label, value: expr.value, line: line });
              pushValue(0, 4);
            } else {
              pushValue(expr.value, size);
            }
          });
        } else if (directive === ".space") {
          var amount = parseInteger(rest);
          if (amount === null || amount < 0) { throw new AssemblyError(".space needs a size in bytes", line); }
          placePending(DATA_BASE + data.length, line);
          for (var i = 0; i < amount; i++) { data.push(0); }
        } else if (directive === ".ascii" || directive === ".asciiz") {
          placePending(DATA_BASE + data.length, line);
          var strings = rest.match(/"(?:[^"\\]|\\.)*"/g);
          if (!strings) { throw new AssemblyError(directive + " needs a quoted string", line); }
          strings.forEach(function (quoted) {
            var text = unescapeString(quoted.slice(1, -1));
            for (var k = 0; k < text.length; k++) { data.push(text.charCodeAt(k) & 0xff); }
            if (directive === ".asciiz") { data.push(0); }
          });
        } else if (directive === ".align") {
          var power = parseInteger(rest);
          if (power === null || power < 0 || power > 12) { throw new AssemblyError(".align needs a small number", line); }
          alignData(1 << power);
          placePending(DATA_BASE + data.length, line);
        } else {
          throw new AssemblyError("directive " + directive + " is not supported by this simulator", line);
        }
        return;
      }

      if (segment !== "text") { throw new AssemblyError("instructions belong in the .text segment", line); }
      m = /^(\S+)\s*(.*)$/.exec(code);
      var mnemonic = m[1].toLowerCase();
      // Commas are treated as plain separators, as in MARS, so "addi $s3, ,$s3, 1" is accepted.
      var operands = splitList(m[2]).map(function (token) { return parseOperand(token, line); });
      var basics = expand(mnemonic, operands, line);
      placePending(TEXT_BASE + items.length * 4, line);
      basics.forEach(function (b, k) {
        b.line = line;
        b.first = k === 0;
        b.address = (TEXT_BASE + items.length * 4) >>> 0;
        items.push(b);
      });
    });
    // Labels at the very end of the file point just past the last thing placed.
    placePending(segment === "data" ? DATA_BASE + data.length : TEXT_BASE + items.length * 4, lines.length);

    function resolve(ref, line) {
      if (!ref.label) { return ref.value >>> 0; }
      if (!labels.hasOwnProperty(ref.label)) { throw new AssemblyError("label " + ref.label + " is not defined", line); }
      return (labels[ref.label] + ref.value) >>> 0;
    }

    dataFixups.forEach(function (fix) {
      var address = resolve(fix, fix.line);
      for (var i = 0; i < 4; i++) { data[fix.offset + i] = (address >>> (8 * i)) & 0xff; }
    });

    var text = items.map(function (b) {
      if (b.ref) {
        var address = resolve(b.ref, b.line);
        switch (b.ref.kind) {
          case "branch":
            var offset = ((address | 0) - ((b.address + 4) | 0)) >> 2;
            if (!fitsSigned16(offset)) { throw new AssemblyError("branch target is too far away", b.line); }
            b.imm = offset;
            break;
          case "jump": b.target = address; break;
          case "upper": b.imm = address >>> 16; break;                      // for lui + ori
          case "lower": b.imm = address & 0xffff; break;
          case "high": b.imm = ((address + 0x8000) >>> 16) & 0xffff; break;  // for lui + signed offset
          case "low": b.imm = (address << 16) >> 16; break;
        }
      }
      var word = encode(b);
      var decoded = decode(word, b.address);
      return {
        address: b.address,
        word: word,
        basic: disassemble(decoded),
        line: b.line,
        first: b.first
      };
    });

    return {
      textBase: TEXT_BASE,
      dataBase: DATA_BASE,
      text: text,
      data: new Uint8Array(data),
      labels: labels,
      lines: lines
    };
  }

  /* ------------------------------------------------------------------ *
   * Machine
   * ------------------------------------------------------------------ */

  function MipsError(message, pc) {
    this.name = "MipsError";
    this.pc = pc;
    this.message = message;
  }
  MipsError.prototype = Object.create(Error.prototype);

  function Machine(program, options) {
    options = options || {};
    this.program = program;
    this.print = options.print || function () {};
    this.random = options.random || Math.random;

    this.regs = new Int32Array(32);
    this.hi = 0;
    this.lo = 0;
    this.pc = program.textBase;
    this.executed = 0;             // instructions run so far
    this.halted = false;
    this.haltReason = "";
    this.error = null;

    // Optional address to count visits to (the player uses it to count generations).
    this.markAddress = -1;
    this.markHits = 0;
    this.stopAtMark = false;
    this._passedMark = false;

    this._pages = new Map();
    this._lastPageNumber = -1;
    this._lastPage = null;

    this._decoded = program.text.map(function (entry) { return decode(entry.word, entry.address); });
    this._textEnd = (program.textBase + program.text.length * 4) >>> 0;

    this.regs[28] = GLOBAL_POINTER | 0;
    this.regs[29] = STACK_POINTER | 0;
    for (var i = 0; i < program.data.length; i++) {
      this.storeByte(program.dataBase + i, program.data[i]);
    }
  }

  Machine.prototype._page = function (address) {
    var number = address >>> 12;
    if (number === this._lastPageNumber) { return this._lastPage; }
    var page = this._pages.get(number);
    if (!page) {
      if (this._pages.size >= MAX_PAGES) { throw new MipsError("out of memory", this.pc); }
      var buffer = new ArrayBuffer(4096);
      page = { bytes: new Uint8Array(buffer), view: new DataView(buffer) };
      this._pages.set(number, page);
    }
    this._lastPageNumber = number;
    this._lastPage = page;
    return page;
  };

  Machine.prototype._check = function (address, alignment, action) {
    // Signed compare: anything below the data area, and anything in kernel space, is refused.
    if ((address | 0) < DATA_LOW) {
      throw new MipsError("address out of range " + hex(address) + " (" + action + ")", this.pc);
    }
    if (address & (alignment - 1)) {
      throw new MipsError(action + " address not aligned on a " + (alignment === 4 ? "word" : "halfword") + " boundary " + hex(address), this.pc);
    }
  };

  Machine.prototype.loadWord = function (address) {
    this._check(address, 4, "load");
    return this._page(address).view.getInt32(address & 4095, true);
  };
  Machine.prototype.storeWord = function (address, value) {
    this._check(address, 4, "store");
    this._page(address).view.setInt32(address & 4095, value, true);
  };
  Machine.prototype.loadHalf = function (address, signed) {
    this._check(address, 2, "load");
    var view = this._page(address).view;
    return signed ? view.getInt16(address & 4095, true) : view.getUint16(address & 4095, true);
  };
  Machine.prototype.storeHalf = function (address, value) {
    this._check(address, 2, "store");
    this._page(address).view.setInt16(address & 4095, value, true);
  };
  Machine.prototype.loadByte = function (address, signed) {
    this._check(address, 1, "load");
    var b = this._page(address).bytes[address & 4095];
    return signed ? (b << 24) >> 24 : b;
  };
  Machine.prototype.storeByte = function (address, value) {
    this._check(address, 1, "store");
    this._page(address).bytes[address & 4095] = value & 0xff;
  };

  // Read a run of words without touching the access checks (used to draw the bitmap display).
  Machine.prototype.peekWords = function (address, target) {
    for (var i = 0; i < target.length; i++) {
      var a = (address + i * 4) >>> 0;
      var page = this._pages.get(a >>> 12);
      target[i] = page ? page.view.getInt32(a & 4095, true) : 0;
    }
    return target;
  };

  Machine.prototype.readString = function (address) {
    var out = "";
    for (var i = 0; i < 100000; i++) {
      var c = this.loadByte((address + i) | 0, false);
      if (c === 0) { break; }
      out += String.fromCharCode(c);
    }
    return out;
  };

  Machine.prototype._halt = function (reason) {
    this.halted = true;
    this.haltReason = reason;
  };

  Machine.prototype._syscall = function () {
    var regs = this.regs;
    var service = regs[2];
    switch (service) {
      case 1: this.print(String(regs[4])); break;
      case 4: this.print(this.readString(regs[4])); break;
      case 11: this.print(String.fromCharCode(regs[4] & 0xff)); break;
      case 34: this.print(hex(regs[4])); break;
      case 35: this.print(("0000000000000000000000000000000" + (regs[4] >>> 0).toString(2)).slice(-32)); break;
      case 36: this.print(String(regs[4] >>> 0)); break;
      case 10: this._halt("program is finished running"); break;
      case 17: this._halt("program is finished running (exit code " + regs[4] + ")"); break;
      case 30:
        var now = Date.now();
        regs[4] = now % 4294967296;
        regs[5] = Math.floor(now / 4294967296);
        break;
      case 32: break;                                   // sleep: the player controls the pace instead
      case 40: break;                                   // set seed: the player owns the seed
      case 41: regs[4] = Math.floor(this.random() * 4294967296) | 0; break;
      case 42:
        if (regs[5] <= 0) { throw new MipsError("syscall 42: upper bound of range cannot be negative or zero", this.pc); }
        regs[4] = Math.floor(this.random() * regs[5]);
        break;
      case 5: case 8: case 12:
        throw new MipsError("syscall " + service + " reads input, which this simulator does not support", this.pc);
      default:
        throw new MipsError("syscall " + service + " is not supported by this simulator", this.pc);
    }
  };

  function multiply(a, b, signed) {
    var product = signed ? BigInt(a) * BigInt(b) : BigInt(a >>> 0) * BigInt(b >>> 0);
    return {
      lo: Number(BigInt.asIntN(32, product)),
      hi: Number(BigInt.asIntN(32, product >> BigInt(32)))
    };
  }

  /*
   * Run up to `limit` instructions. Returns how many were executed. Stops early when the
   * program halts, hits an error (see this.error), or reaches the marked address with
   * stopAtMark set.
   */
  Machine.prototype.run = function (limit) {
    if (this.halted) { return 0; }
    var regs = this.regs;
    var decoded = this._decoded;
    var textBase = this.program.textBase;
    var textEnd = this._textEnd;
    var pc = this.pc;
    var done = 0;

    try {
      while (done < limit) {
        if (pc === this.markAddress) {
          if (!this._passedMark) {
            this.markHits++;
            this._passedMark = true;
            if (this.stopAtMark) { break; }
          }
        }
        if (pc < textBase || pc >= textEnd || (pc & 3)) {
          this.pc = pc;
          if (pc === textEnd) {
            this._halt("program is finished running (dropped off bottom)");
          } else {
            throw new MipsError("invalid program counter value " + hex(pc), pc);
          }
          break;
        }
        var d = decoded[(pc - textBase) >>> 2];
        this.pc = pc;                 // so errors and syscalls report the right place
        var next = (pc + 4) >>> 0;
        var a = regs[d.rs];
        var b = regs[d.rt];
        var result, address;

        switch (d.kind) {
          case K_ADDI:
            result = a + d.imm;
            if (result > 2147483647 || result < -2147483648) { throw new MipsError("arithmetic overflow", pc); }
            regs[d.rt] = result;
            break;
          case K_ADDIU: regs[d.rt] = a + d.imm; break;
          case K_ADD:
            result = a + b;
            if (result > 2147483647 || result < -2147483648) { throw new MipsError("arithmetic overflow", pc); }
            regs[d.rd] = result;
            break;
          case K_ADDU: regs[d.rd] = a + b; break;
          case K_SUB:
            result = a - b;
            if (result > 2147483647 || result < -2147483648) { throw new MipsError("arithmetic overflow", pc); }
            regs[d.rd] = result;
            break;
          case K_SUBU: regs[d.rd] = a - b; break;
          case K_AND: regs[d.rd] = a & b; break;
          case K_OR: regs[d.rd] = a | b; break;
          case K_XOR: regs[d.rd] = a ^ b; break;
          case K_NOR: regs[d.rd] = ~(a | b); break;
          case K_SLT: regs[d.rd] = a < b ? 1 : 0; break;
          case K_SLTU: regs[d.rd] = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
          case K_SLTI: regs[d.rt] = a < d.imm ? 1 : 0; break;
          case K_SLTIU: regs[d.rt] = (a >>> 0) < (d.imm >>> 0) ? 1 : 0; break;
          case K_ANDI: regs[d.rt] = a & d.uimm; break;
          case K_ORI: regs[d.rt] = a | d.uimm; break;
          case K_XORI: regs[d.rt] = a ^ d.uimm; break;
          case K_LUI: regs[d.rt] = d.uimm << 16; break;
          case K_SLL: regs[d.rd] = b << d.sa; break;
          case K_SRL: regs[d.rd] = b >>> d.sa; break;
          case K_SRA: regs[d.rd] = b >> d.sa; break;
          case K_SLLV: regs[d.rd] = b << (a & 31); break;
          case K_SRLV: regs[d.rd] = b >>> (a & 31); break;
          case K_SRAV: regs[d.rd] = b >> (a & 31); break;

          case K_LW: regs[d.rt] = this.loadWord((a + d.imm) | 0); break;
          case K_SW: this.storeWord((a + d.imm) | 0, b); break;
          case K_LB: regs[d.rt] = this.loadByte((a + d.imm) | 0, true); break;
          case K_LBU: regs[d.rt] = this.loadByte((a + d.imm) | 0, false); break;
          case K_LH: regs[d.rt] = this.loadHalf((a + d.imm) | 0, true); break;
          case K_LHU: regs[d.rt] = this.loadHalf((a + d.imm) | 0, false); break;
          case K_SB: this.storeByte((a + d.imm) | 0, b); break;
          case K_SH: this.storeHalf((a + d.imm) | 0, b); break;

          case K_BEQ: if (a === b) { next = d.target; } break;
          case K_BNE: if (a !== b) { next = d.target; } break;
          case K_BLEZ: if (a <= 0) { next = d.target; } break;
          case K_BGTZ: if (a > 0) { next = d.target; } break;
          case K_BLTZ: if (a < 0) { next = d.target; } break;
          case K_BGEZ: if (a >= 0) { next = d.target; } break;
          case K_J: next = d.target; break;
          case K_JAL: regs[31] = next | 0; next = d.target; break;
          case K_JR: next = a >>> 0; break;
          case K_JALR: regs[d.rd] = next | 0; next = a >>> 0; break;

          case K_MULT: result = multiply(a, b, true); this.hi = result.hi; this.lo = result.lo; break;
          case K_MULTU: result = multiply(a, b, false); this.hi = result.hi; this.lo = result.lo; break;
          case K_MUL:
            result = multiply(a, b, true);
            this.hi = result.hi;
            this.lo = result.lo;
            regs[d.rd] = result.lo;
            break;
          case K_DIV:
            if (b !== 0) {            // dividing by zero leaves HI and LO alone, as on real MIPS
              this.lo = (a / b) | 0;
              this.hi = a % b;
            }
            break;
          case K_DIVU:
            if (b !== 0) {
              this.lo = Math.floor((a >>> 0) / (b >>> 0)) | 0;
              this.hi = ((a >>> 0) % (b >>> 0)) | 0;
            }
            break;
          case K_MFHI: regs[d.rd] = this.hi; break;
          case K_MFLO: regs[d.rd] = this.lo; break;
          case K_MTHI: this.hi = a; break;
          case K_MTLO: this.lo = a; break;

          case K_SYSCALL: this._syscall(); break;
          case K_BREAK: throw new MipsError("break instruction executed (division by zero?)", pc);
          default: throw new MipsError("unknown instruction " + hex(this.program.text[(pc - textBase) >>> 2].word), pc);
        }

        regs[0] = 0;
        pc = next;
        done++;
        this._passedMark = false;
        if (this.halted) { break; }
      }
    } catch (error) {
      if (!(error instanceof MipsError)) { throw error; }
      this.error = error;
      this._halt("Runtime exception at " + hex(error.pc) + ": " + error.message);
      pc = this.pc;
    }

    this.pc = pc;
    this.executed += done;
    return done;
  };

  // Index into program.text of the instruction about to run, or -1 if the PC is elsewhere.
  Machine.prototype.currentIndex = function () {
    var index = (this.pc - this.program.textBase) / 4;
    return index >= 0 && index < this.program.text.length && index % 1 === 0 ? index : -1;
  };

  return {
    assemble: assemble,
    Machine: Machine,
    AssemblyError: AssemblyError,
    MipsError: MipsError,
    REGISTER_NAMES: REGISTER_NAMES,
    splitComment: splitComment,
    hex: hex,
    decode: decode,
    disassemble: disassemble
  };
});
