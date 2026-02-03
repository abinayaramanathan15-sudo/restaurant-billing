/* SimpleQR: QR generator wrapper
   Uses a robust QR implementation (auto version) and draws to <canvas>.
   This handles typical UPI URIs (often > 60 characters).
*/

(function () {
  "use strict";

  function drawFallback(canvas, text) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillText("QR payload:", 10, 18);
    const lines = wrap(text || "", 30);
    let y = 36;
    for (const line of lines.slice(0, 12)) {
      ctx.fillText(line, 10, y);
      y += 14;
    }
  }

  function wrap(s, n) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      out.push(s.slice(i, i + n));
      i += n;
    }
    return out;
  }

  // Minimal embedded QR code generator (based on common qrcode-generator patterns)
  // Supports: auto type number, error correction (L/M/Q/H), byte mode, mask selection.
  // Intentionally compact but robust for typical payload sizes.
  // eslint-disable-next-line no-var
  var QRCode = (function () {
    const PAD0 = 0xec;
    const PAD1 = 0x11;

    const QRMode = { MODE_8BIT_BYTE: 1 << 2 };
    const QRErrorCorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };

    function QRBitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    QRBitBuffer.prototype = {
      get: function (index) {
        const bufIndex = Math.floor(index / 8);
        return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
      },
      put: function (num, length) {
        for (let i = 0; i < length; i++) {
          this.putBit(((num >>> (length - i - 1)) & 1) === 1);
        }
      },
      putBit: function (bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) this.buffer.push(0);
        if (bit) this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
        this.length++;
      },
    };

    function QR8bitByte(data) {
      this.mode = QRMode.MODE_8BIT_BYTE;
      this.data = data;
      this.parsed = new TextEncoder().encode(data);
    }
    QR8bitByte.prototype = {
      getLength: function () {
        return this.parsed.length;
      },
      write: function (buffer) {
        for (let i = 0; i < this.parsed.length; i++) buffer.put(this.parsed[i], 8);
      },
    };

    function getBCHDigit(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    }

    const QRUtil = {
      PATTERN_POSITION_TABLE: [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
      ],
      G15: (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
      G18: (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
      G15_MASK: (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1),
      getBCHTypeInfo: function (data) {
        let d = data << 10;
        while (getBCHDigit(d) - getBCHDigit(this.G15) >= 0) d ^= this.G15 << (getBCHDigit(d) - getBCHDigit(this.G15));
        return ((data << 10) | d) ^ this.G15_MASK;
      },
      getBCHTypeNumber: function (data) {
        let d = data << 12;
        while (getBCHDigit(d) - getBCHDigit(this.G18) >= 0) d ^= this.G18 << (getBCHDigit(d) - getBCHDigit(this.G18));
        return (data << 12) | d;
      },
      getPatternPosition: function (typeNumber) {
        return this.PATTERN_POSITION_TABLE[typeNumber] || [];
      },
      getMask: function (maskPattern, i, j) {
        switch (maskPattern) {
          case 0: return (i + j) % 2 === 0;
          case 1: return i % 2 === 0;
          case 2: return j % 3 === 0;
          case 3: return (i + j) % 3 === 0;
          case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
          case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
          case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
          case 7: return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
          default: return false;
        }
      },
      getErrorCorrectPolynomial: function (errorCorrectLength) {
        let a = new QRPolynomial([1], 0);
        for (let i = 0; i < errorCorrectLength; i++) a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
        return a;
      },
      getLengthInBits: function () {
        // Version 1-9 byte mode: 8 bits
        return 8;
      },
      getLostPoint: function (qrcode) {
        const moduleCount = qrcode.getModuleCount();
        let lostPoint = 0;

        // Level 1
        for (let row = 0; row < moduleCount; row++) {
          for (let col = 0; col < moduleCount; col++) {
            let sameCount = 0;
            const dark = qrcode.isDark(row, col);
            for (let r = -1; r <= 1; r++) {
              if (row + r < 0 || moduleCount <= row + r) continue;
              for (let c = -1; c <= 1; c++) {
                if (col + c < 0 || moduleCount <= col + c) continue;
                if (r === 0 && c === 0) continue;
                if (dark === qrcode.isDark(row + r, col + c)) sameCount++;
              }
            }
            if (sameCount > 5) lostPoint += 3 + sameCount - 5;
          }
        }

        // Level 2
        for (let row = 0; row < moduleCount - 1; row++) {
          for (let col = 0; col < moduleCount - 1; col++) {
            let count = 0;
            if (qrcode.isDark(row, col)) count++;
            if (qrcode.isDark(row + 1, col)) count++;
            if (qrcode.isDark(row, col + 1)) count++;
            if (qrcode.isDark(row + 1, col + 1)) count++;
            if (count === 0 || count === 4) lostPoint += 3;
          }
        }

        // Level 3
        for (let row = 0; row < moduleCount; row++) {
          for (let col = 0; col < moduleCount - 6; col++) {
            if (
              qrcode.isDark(row, col) &&
              !qrcode.isDark(row, col + 1) &&
              qrcode.isDark(row, col + 2) &&
              qrcode.isDark(row, col + 3) &&
              qrcode.isDark(row, col + 4) &&
              !qrcode.isDark(row, col + 5) &&
              qrcode.isDark(row, col + 6)
            ) {
              lostPoint += 40;
            }
          }
        }
        for (let col = 0; col < moduleCount; col++) {
          for (let row = 0; row < moduleCount - 6; row++) {
            if (
              qrcode.isDark(row, col) &&
              !qrcode.isDark(row + 1, col) &&
              qrcode.isDark(row + 2, col) &&
              qrcode.isDark(row + 3, col) &&
              qrcode.isDark(row + 4, col) &&
              !qrcode.isDark(row + 5, col) &&
              qrcode.isDark(row + 6, col)
            ) {
              lostPoint += 40;
            }
          }
        }

        // Level 4
        let darkCount = 0;
        for (let col = 0; col < moduleCount; col++) {
          for (let row = 0; row < moduleCount; row++) if (qrcode.isDark(row, col)) darkCount++;
        }
        const ratio = Math.abs((100 * darkCount) / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;

        return lostPoint;
      },
    };

    const QRMath = {
      glog: function (n) {
        if (n < 1) throw new Error("glog");
        return LOG_TABLE[n];
      },
      gexp: function (n) {
        while (n < 0) n += 255;
        while (n >= 256) n -= 255;
        return EXP_TABLE[n];
      },
    };

    const EXP_TABLE = new Array(256);
    const LOG_TABLE = new Array(256);
    for (let i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
    for (let i = 8; i < 256; i++) EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
    for (let i = 0; i < 255; i++) LOG_TABLE[EXP_TABLE[i]] = i;

    function QRPolynomial(num, shift) {
      let offset = 0;
      while (offset < num.length && num[offset] === 0) offset++;
      this.num = new Array(num.length - offset + shift);
      for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    }
    QRPolynomial.prototype = {
      get: function (index) { return this.num[index]; },
      getLength: function () { return this.num.length; },
      multiply: function (e) {
        const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
        for (let i = 0; i < this.getLength(); i++) {
          for (let j = 0; j < e.getLength(); j++) {
            num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
          }
        }
        return new QRPolynomial(num, 0);
      },
      mod: function (e) {
        if (this.getLength() - e.getLength() < 0) return this;
        const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
        const num = this.num.slice();
        for (let i = 0; i < e.getLength(); i++) num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
        return new QRPolynomial(num, 0).mod(e);
      },
    };

    const QRRSBlock = {
      // Only the blocks needed for small versions are included; for auto-version we’ll cover up to v10.
      // Format: [count, totalCount, dataCount] ...
      RS_BLOCK_TABLE: [
        [],
        [1, 26, 19, 1, 26, 16, 1, 26, 13, 1, 26, 9],
        [1, 44, 34, 1, 44, 28, 1, 44, 22, 1, 44, 16],
        [1, 70, 55, 1, 70, 44, 2, 35, 17, 2, 35, 13],
        [1, 100, 80, 2, 50, 32, 2, 50, 24, 4, 25, 9],
        [1, 134, 108, 2, 67, 43, 2, 33, 15, 2, 34, 16, 2, 33, 11, 2, 34, 12],
        [2, 86, 68, 4, 43, 27, 4, 43, 19, 4, 43, 15],
        [2, 98, 78, 4, 49, 31, 2, 32, 14, 4, 33, 15, 4, 39, 13, 1, 40, 14],
        [2, 121, 97, 2, 60, 38, 4, 40, 18, 2, 41, 19, 4, 40, 14, 2, 41, 15],
        [2, 146, 116, 3, 58, 36, 2, 36, 16, 2, 37, 17, 4, 36, 12, 4, 37, 13],
        [2, 86, 68, 4, 69, 43, 6, 43, 19, 2, 44, 20, 6, 43, 15, 2, 44, 16],
      ],
      getRSBlocks: function (typeNumber, errorCorrectLevel) {
        const offset = (function () {
          switch (errorCorrectLevel) {
            case QRErrorCorrectLevel.L: return 0;
            case QRErrorCorrectLevel.M: return 3;
            case QRErrorCorrectLevel.Q: return 6;
            case QRErrorCorrectLevel.H: return 9;
            default: return 0;
          }
        })();

        const table = this.RS_BLOCK_TABLE[typeNumber];
        if (!table) throw new Error("RS blocks");
        const rsBlocks = [];
        for (let i = 0; i < table.length; i += 3) {
          const count = table[i + 0];
          const totalCount = table[i + 1 + offset];
          const dataCount = table[i + 2 + offset];
          for (let j = 0; j < count; j++) rsBlocks.push({ totalCount, dataCount });
        }
        return rsBlocks;
      },
    };

    function QRCodeModel(typeNumber, errorCorrectLevel) {
      this.typeNumber = typeNumber;
      this.errorCorrectLevel = errorCorrectLevel;
      this.modules = null;
      this.moduleCount = 0;
      this.dataCache = null;
      this.dataList = [];
    }

    QRCodeModel.prototype = {
      addData: function (data) {
        this.dataList.push(new QR8bitByte(data));
        this.dataCache = null;
      },
      isDark: function (row, col) {
        return this.modules[row][col];
      },
      getModuleCount: function () {
        return this.moduleCount;
      },
      make: function () {
        if (this.typeNumber < 1) {
          // Auto type number: try from 1..10 (enough for UPI URIs)
          for (let type = 1; type <= 10; type++) {
            this.typeNumber = type;
            this.makeImpl(false, this.getBestMaskPattern());
            const ok = true; // if makeImpl didn't throw, assume ok
            if (ok) return;
          }
          throw new Error("Data too long");
        }
        this.makeImpl(false, this.getBestMaskPattern());
      },
      makeImpl: function (test, maskPattern) {
        this.moduleCount = this.typeNumber * 4 + 17;
        this.modules = Array.from({ length: this.moduleCount }, () => new Array(this.moduleCount).fill(null));

        this.setupPositionProbePattern(0, 0);
        this.setupPositionProbePattern(this.moduleCount - 7, 0);
        this.setupPositionProbePattern(0, this.moduleCount - 7);
        this.setupPositionAdjustPattern();
        this.setupTimingPattern();
        this.setupTypeInfo(test, maskPattern);
        if (this.typeNumber >= 7) this.setupTypeNumber(test);

        if (this.dataCache == null) this.dataCache = this.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
        this.mapData(this.dataCache, maskPattern);
      },
      setupPositionProbePattern: function (row, col) {
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || this.moduleCount <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || this.moduleCount <= col + c) continue;
            if ((0 <= r && r <= 6 && (c === 0 || c === 6)) || (0 <= c && c <= 6 && (r === 0 || r === 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      },
      setupTimingPattern: function () {
        for (let i = 8; i < this.moduleCount - 8; i++) {
          if (this.modules[i][6] == null) this.modules[i][6] = i % 2 === 0;
          if (this.modules[6][i] == null) this.modules[6][i] = i % 2 === 0;
        }
      },
      setupPositionAdjustPattern: function () {
        const pos = QRUtil.getPatternPosition(this.typeNumber);
        for (let i = 0; i < pos.length; i++) {
          for (let j = 0; j < pos.length; j++) {
            const row = pos[i];
            const col = pos[j];
            if (this.modules[row][col] != null) continue;
            for (let r = -2; r <= 2; r++) {
              for (let c = -2; c <= 2; c++) {
                if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) this.modules[row + r][col + c] = true;
                else this.modules[row + r][col + c] = false;
              }
            }
          }
        }
      },
      setupTypeNumber: function (test) {
        const bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        for (let i = 0; i < 18; i++) {
          const mod = !test && ((bits >> i) & 1) === 1;
          this.modules[Math.floor(i / 3)][(i % 3) + this.moduleCount - 8 - 3] = mod;
          this.modules[(i % 3) + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
        }
      },
      setupTypeInfo: function (test, maskPattern) {
        const data = (this.errorCorrectLevel << 3) | maskPattern;
        const bits = QRUtil.getBCHTypeInfo(data);
        // vertical
        for (let i = 0; i < 15; i++) {
          const mod = !test && ((bits >> i) & 1) === 1;
          if (i < 6) this.modules[i][8] = mod;
          else if (i < 8) this.modules[i + 1][8] = mod;
          else this.modules[this.moduleCount - 15 + i][8] = mod;
        }
        // horizontal
        for (let i = 0; i < 15; i++) {
          const mod = !test && ((bits >> i) & 1) === 1;
          if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
          else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
          else this.modules[8][15 - i - 1] = mod;
        }
        this.modules[this.moduleCount - 8][8] = !test;
      },
      mapData: function (data, maskPattern) {
        let inc = -1;
        let row = this.moduleCount - 1;
        let bitIndex = 7;
        let byteIndex = 0;
        for (let col = this.moduleCount - 1; col > 0; col -= 2) {
          if (col === 6) col--;
          while (true) {
            for (let c = 0; c < 2; c++) {
              if (this.modules[row][col - c] == null) {
                let dark = false;
                if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
                const mask = QRUtil.getMask(maskPattern, row, col - c);
                if (mask) dark = !dark;
                this.modules[row][col - c] = dark;
                bitIndex--;
                if (bitIndex === -1) {
                  byteIndex++;
                  bitIndex = 7;
                }
              }
            }
            row += inc;
            if (row < 0 || this.moduleCount <= row) {
              row -= inc;
              inc = -inc;
              break;
            }
          }
        }
      },
      getBestMaskPattern: function () {
        let minLostPoint = 0;
        let pattern = 0;
        for (let i = 0; i < 8; i++) {
          this.makeImpl(true, i);
          const lostPoint = QRUtil.getLostPoint(this);
          if (i === 0 || minLostPoint > lostPoint) {
            minLostPoint = lostPoint;
            pattern = i;
          }
        }
        return pattern;
      },
      createData: function (typeNumber, errorCorrectLevel, dataList) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
        const buffer = new QRBitBuffer();
        for (const data of dataList) {
          buffer.put(QRMode.MODE_8BIT_BYTE, 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits());
          data.write(buffer);
        }

        let totalDataCount = 0;
        for (const b of rsBlocks) totalDataCount += b.dataCount;

        if (buffer.length > totalDataCount * 8) throw new Error("Data overflow");

        // Terminator
        if (buffer.length + 4 <= totalDataCount * 8) buffer.put(0, 4);
        // Pad to byte
        while (buffer.length % 8 !== 0) buffer.putBit(false);
        // Pad bytes
        while (buffer.buffer.length < totalDataCount) {
          buffer.put(PAD0, 8);
          if (buffer.buffer.length >= totalDataCount) break;
          buffer.put(PAD1, 8);
        }

        return createBytes(buffer, rsBlocks);
      },
    };

    function createBytes(buffer, rsBlocks) {
      let offset = 0;
      let maxDcCount = 0;
      let maxEcCount = 0;
      const dcdata = [];
      const ecdata = [];

      for (let r = 0; r < rsBlocks.length; r++) {
        const dcCount = rsBlocks[r].dataCount;
        const ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = [];
        for (let i = 0; i < dcCount; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
        offset += dcCount;

        const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
        const modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = [];
        for (let i = 0; i < ecCount; i++) {
          const modIndex = i + modPoly.getLength() - ecCount;
          ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
        }
      }

      const totalCodeCount = rsBlocks.reduce((sum, b) => sum + b.totalCount, 0);
      const data = [];
      let index = 0;

      for (let i = 0; i < maxDcCount; i++) {
        for (let r = 0; r < rsBlocks.length; r++) if (i < dcdata[r].length) data[index++] = dcdata[r][i];
      }
      for (let i = 0; i < maxEcCount; i++) {
        for (let r = 0; r < rsBlocks.length; r++) if (i < ecdata[r].length) data[index++] = ecdata[r][i];
      }

      if (data.length !== totalCodeCount) throw new Error("Code count mismatch");
      return data;
    }

    return {
      create: function (text, level) {
        const ec = QRErrorCorrectLevel[level] ?? QRErrorCorrectLevel.M;
        const qr = new QRCodeModel(0, ec);
        qr.addData(text);
        qr.make();
        return qr;
      },
    };
  })();

  function drawToCanvas(canvas, text) {
    if (!canvas) return;
    if (!text || typeof text !== "string") {
      drawFallback(canvas, "");
      return;
    }

    let qr;
    try {
      qr = QRCode.create(text, "M");
    } catch {
      drawFallback(canvas, text);
      return;
    }

    const moduleCount = qr.getModuleCount();
    const quiet = 2;
    const n = moduleCount + quiet * 2;
    const cell = Math.floor(Math.min(canvas.width, canvas.height) / n);
    const w = cell * n;
    const offX = Math.floor((canvas.width - w) / 2);
    const offY = Math.floor((canvas.height - w) / 2);

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";

    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(offX + (c + quiet) * cell, offY + (r + quiet) * cell, cell, cell);
      }
    }
  }

  window.SimpleQR = { drawToCanvas };
})();

