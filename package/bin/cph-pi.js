import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// node_modules/ws/lib/constants.js
var require_constants = __commonJS(function(exports, module) {
  var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
  var hasBlob = typeof Blob !== "undefined";
  if (hasBlob)
    BINARY_TYPES.push("blob");
  module.exports = {
    BINARY_TYPES,
    CLOSE_TIMEOUT: 30000,
    EMPTY_BUFFER: Buffer.alloc(0),
    GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    hasBlob,
    kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
    kListener: Symbol("kListener"),
    kStatusCode: Symbol("status-code"),
    kWebSocket: Symbol("websocket"),
    NOOP: () => {}
  };
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS(function(exports, module) {
  var { EMPTY_BUFFER } = require_constants();
  var FastBuffer = Buffer[Symbol.species];
  function concat(list, totalLength) {
    if (list.length === 0)
      return EMPTY_BUFFER;
    if (list.length === 1)
      return list[0];
    const target = Buffer.allocUnsafe(totalLength);
    let offset = 0;
    for (let i = 0;i < list.length; i++) {
      const buf = list[i];
      target.set(buf, offset);
      offset += buf.length;
    }
    if (offset < totalLength) {
      return new FastBuffer(target.buffer, target.byteOffset, offset);
    }
    return target;
  }
  function _mask(source, mask, output, offset, length) {
    for (let i = 0;i < length; i++) {
      output[offset + i] = source[i] ^ mask[i & 3];
    }
  }
  function _unmask(buffer, mask) {
    for (let i = 0;i < buffer.length; i++) {
      buffer[i] ^= mask[i & 3];
    }
  }
  function toArrayBuffer(buf) {
    if (buf.length === buf.buffer.byteLength) {
      return buf.buffer;
    }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  }
  function toBuffer(data) {
    toBuffer.readOnly = true;
    if (Buffer.isBuffer(data))
      return data;
    let buf;
    if (data instanceof ArrayBuffer) {
      buf = new FastBuffer(data);
    } else if (ArrayBuffer.isView(data)) {
      buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
    } else {
      buf = Buffer.from(data);
      toBuffer.readOnly = false;
    }
    return buf;
  }
  module.exports = {
    concat,
    mask: _mask,
    toArrayBuffer,
    toBuffer,
    unmask: _unmask
  };
  if (!process.env.WS_NO_BUFFER_UTIL) {
    try {
      const bufferUtil = (()=>{throw new Error("Cannot require module "+"bufferutil");})();
      module.exports.mask = function(source, mask2, output, offset, length) {
        if (length < 48)
          _mask(source, mask2, output, offset, length);
        else
          bufferUtil.mask(source, mask2, output, offset, length);
      };
      module.exports.unmask = function(buffer, mask) {
        if (buffer.length < 32)
          _unmask(buffer, mask);
        else
          bufferUtil.unmask(buffer, mask);
      };
    } catch (e) {}
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS(function(exports, module) {
  var kDone = Symbol("kDone");
  var kRun = Symbol("kRun");

  class Limiter {
    constructor(concurrency) {
      this[kDone] = () => {
        this.pending--;
        this[kRun]();
      };
      this.concurrency = concurrency || Infinity;
      this.jobs = [];
      this.pending = 0;
    }
    add(job) {
      this.jobs.push(job);
      this[kRun]();
    }
    [kRun]() {
      if (this.pending === this.concurrency)
        return;
      if (this.jobs.length) {
        const job = this.jobs.shift();
        this.pending++;
        job(this[kDone]);
      }
    }
  }
  module.exports = Limiter;
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS(function(exports, module) {
  var zlib = __require("zlib");
  var bufferUtil = require_buffer_util();
  var Limiter = require_limiter();
  var { kStatusCode } = require_constants();
  var FastBuffer = Buffer[Symbol.species];
  var TRAILER = Buffer.from([0, 0, 255, 255]);
  var kPerMessageDeflate = Symbol("permessage-deflate");
  var kTotalLength = Symbol("total-length");
  var kCallback = Symbol("callback");
  var kBuffers = Symbol("buffers");
  var kError = Symbol("error");
  var zlibLimiter;

  class PerMessageDeflate {
    constructor(options) {
      this._options = options || {};
      this._threshold = this._options.threshold !== undefined ? this._options.threshold : 1024;
      this._maxPayload = this._options.maxPayload | 0;
      this._isServer = !!this._options.isServer;
      this._deflate = null;
      this._inflate = null;
      this.params = null;
      if (!zlibLimiter) {
        const concurrency = this._options.concurrencyLimit !== undefined ? this._options.concurrencyLimit : 10;
        zlibLimiter = new Limiter(concurrency);
      }
    }
    static get extensionName() {
      return "permessage-deflate";
    }
    offer() {
      const params = {};
      if (this._options.serverNoContextTakeover) {
        params.server_no_context_takeover = true;
      }
      if (this._options.clientNoContextTakeover) {
        params.client_no_context_takeover = true;
      }
      if (this._options.serverMaxWindowBits) {
        params.server_max_window_bits = this._options.serverMaxWindowBits;
      }
      if (this._options.clientMaxWindowBits) {
        params.client_max_window_bits = this._options.clientMaxWindowBits;
      } else if (this._options.clientMaxWindowBits == null) {
        params.client_max_window_bits = true;
      }
      return params;
    }
    accept(configurations) {
      configurations = this.normalizeParams(configurations);
      this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
      return this.params;
    }
    cleanup() {
      if (this._inflate) {
        this._inflate.close();
        this._inflate = null;
      }
      if (this._deflate) {
        const callback = this._deflate[kCallback];
        this._deflate.close();
        this._deflate = null;
        if (callback) {
          callback(new Error("The deflate stream was closed while data was being processed"));
        }
      }
    }
    acceptAsServer(offers) {
      const opts = this._options;
      const accepted = offers.find((params) => {
        if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && (typeof params.client_max_window_bits === "number" ? opts.clientMaxWindowBits > params.client_max_window_bits : !params.client_max_window_bits)) {
          return false;
        }
        return true;
      });
      if (!accepted) {
        throw new Error("None of the extension offers can be accepted");
      }
      if (opts.serverNoContextTakeover) {
        accepted.server_no_context_takeover = true;
      }
      if (opts.clientNoContextTakeover) {
        accepted.client_no_context_takeover = true;
      }
      if (typeof opts.serverMaxWindowBits === "number") {
        accepted.server_max_window_bits = opts.serverMaxWindowBits;
      }
      if (typeof opts.clientMaxWindowBits === "number") {
        accepted.client_max_window_bits = opts.clientMaxWindowBits;
      } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
        delete accepted.client_max_window_bits;
      }
      return accepted;
    }
    acceptAsClient(response) {
      const params = response[0];
      if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
        throw new Error('Unexpected parameter "client_no_context_takeover"');
      }
      if (!params.client_max_window_bits) {
        if (typeof this._options.clientMaxWindowBits === "number") {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        }
      } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
        throw new Error('Unexpected or invalid parameter "client_max_window_bits"');
      }
      return params;
    }
    normalizeParams(configurations) {
      configurations.forEach((params) => {
        Object.keys(params).forEach((key) => {
          let value = params[key];
          if (value.length > 1) {
            throw new Error(`Parameter "${key}" must have only a single value`);
          }
          value = value[0];
          if (key === "client_max_window_bits") {
            if (value !== true) {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
              }
              value = num;
            } else if (!this._isServer) {
              throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
            }
          } else if (key === "server_max_window_bits") {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
            }
            value = num;
          } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
            if (value !== true) {
              throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
            }
          } else {
            throw new Error(`Unknown parameter "${key}"`);
          }
          params[key] = value;
        });
      });
      return configurations;
    }
    decompress(data, fin, callback) {
      zlibLimiter.add((done) => {
        this._decompress(data, fin, (err, result) => {
          done();
          callback(err, result);
        });
      });
    }
    compress(data, fin, callback) {
      zlibLimiter.add((done) => {
        this._compress(data, fin, (err, result) => {
          done();
          callback(err, result);
        });
      });
    }
    _decompress(data, fin, callback) {
      const endpoint = this._isServer ? "client" : "server";
      if (!this._inflate) {
        const key = `${endpoint}_max_window_bits`;
        const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
        this._inflate = zlib.createInflateRaw({
          ...this._options.zlibInflateOptions,
          windowBits
        });
        this._inflate[kPerMessageDeflate] = this;
        this._inflate[kTotalLength] = 0;
        this._inflate[kBuffers] = [];
        this._inflate.on("error", inflateOnError);
        this._inflate.on("data", inflateOnData);
      }
      this._inflate[kCallback] = callback;
      this._inflate.write(data);
      if (fin)
        this._inflate.write(TRAILER);
      this._inflate.flush(() => {
        const err = this._inflate[kError];
        if (err) {
          this._inflate.close();
          this._inflate = null;
          callback(err);
          return;
        }
        const data = bufferUtil.concat(this._inflate[kBuffers], this._inflate[kTotalLength]);
        if (this._inflate._readableState.endEmitted) {
          this._inflate.close();
          this._inflate = null;
        } else {
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._inflate.reset();
          }
        }
        callback(null, data);
      });
    }
    _compress(data, fin, callback) {
      const endpoint = this._isServer ? "server" : "client";
      if (!this._deflate) {
        const key = `${endpoint}_max_window_bits`;
        const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
        this._deflate = zlib.createDeflateRaw({
          ...this._options.zlibDeflateOptions,
          windowBits
        });
        this._deflate[kTotalLength] = 0;
        this._deflate[kBuffers] = [];
        this._deflate.on("data", deflateOnData);
      }
      this._deflate[kCallback] = callback;
      this._deflate.write(data);
      this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
        if (!this._deflate) {
          return;
        }
        let data = bufferUtil.concat(this._deflate[kBuffers], this._deflate[kTotalLength]);
        if (fin) {
          data = new FastBuffer(data.buffer, data.byteOffset, data.length - 4);
        }
        this._deflate[kCallback] = null;
        this._deflate[kTotalLength] = 0;
        this._deflate[kBuffers] = [];
        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
          this._deflate.reset();
        }
        callback(null, data);
      });
    }
  }
  module.exports = PerMessageDeflate;
  function deflateOnData(chunk) {
    this[kBuffers].push(chunk);
    this[kTotalLength] += chunk.length;
  }
  function inflateOnData(chunk) {
    this[kTotalLength] += chunk.length;
    if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
      this[kBuffers].push(chunk);
      return;
    }
    this[kError] = new RangeError("Max payload size exceeded");
    this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
    this[kError][kStatusCode] = 1009;
    this.removeListener("data", inflateOnData);
    this.reset();
  }
  function inflateOnError(err) {
    this[kPerMessageDeflate]._inflate = null;
    if (this[kError]) {
      this[kCallback](this[kError]);
      return;
    }
    err[kStatusCode] = 1007;
    this[kCallback](err);
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS(function(exports, module) {
  var { isUtf8 } = __require("buffer");
  var { hasBlob } = require_constants();
  var tokenChars = [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    1,
    1,
    0,
    1,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    1,
    0,
    1,
    0
  ];
  function isValidStatusCode(code) {
    return code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3000 && code <= 4999;
  }
  function _isValidUTF8(buf) {
    const len = buf.length;
    let i = 0;
    while (i < len) {
      if ((buf[i] & 128) === 0) {
        i++;
      } else if ((buf[i] & 224) === 192) {
        if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
          return false;
        }
        i += 2;
      } else if ((buf[i] & 240) === 224) {
        if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || buf[i] === 237 && (buf[i + 1] & 224) === 160) {
          return false;
        }
        i += 3;
      } else if ((buf[i] & 248) === 240) {
        if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
          return false;
        }
        i += 4;
      } else {
        return false;
      }
    }
    return true;
  }
  function isBlob(value) {
    return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
  }
  module.exports = {
    isBlob,
    isValidStatusCode,
    isValidUTF8: _isValidUTF8,
    tokenChars
  };
  if (isUtf8) {
    module.exports.isValidUTF8 = function(buf) {
      return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
    };
  } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
    try {
      const isValidUTF8 = (()=>{throw new Error("Cannot require module "+"utf-8-validate");})();
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
      };
    } catch (e) {}
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS(function(exports, module) {
  var { Writable } = __require("stream");
  var PerMessageDeflate = require_permessage_deflate();
  var {
    BINARY_TYPES,
    EMPTY_BUFFER,
    kStatusCode,
    kWebSocket
  } = require_constants();
  var { concat, toArrayBuffer, unmask } = require_buffer_util();
  var { isValidStatusCode, isValidUTF8 } = require_validation();
  var FastBuffer = Buffer[Symbol.species];
  var GET_INFO = 0;
  var GET_PAYLOAD_LENGTH_16 = 1;
  var GET_PAYLOAD_LENGTH_64 = 2;
  var GET_MASK = 3;
  var GET_DATA = 4;
  var INFLATING = 5;
  var DEFER_EVENT = 6;

  class Receiver extends Writable {
    constructor(options = {}) {
      super();
      this._allowSynchronousEvents = options.allowSynchronousEvents !== undefined ? options.allowSynchronousEvents : true;
      this._binaryType = options.binaryType || BINARY_TYPES[0];
      this._extensions = options.extensions || {};
      this._isServer = !!options.isServer;
      this._maxBufferedChunks = options.maxBufferedChunks | 0;
      this._maxFragments = options.maxFragments | 0;
      this._maxPayload = options.maxPayload | 0;
      this._skipUTF8Validation = !!options.skipUTF8Validation;
      this[kWebSocket] = undefined;
      this._bufferedBytes = 0;
      this._buffers = [];
      this._compressed = false;
      this._payloadLength = 0;
      this._mask = undefined;
      this._fragmented = 0;
      this._masked = false;
      this._fin = false;
      this._opcode = 0;
      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._numFragments = 0;
      this._fragments = [];
      this._errored = false;
      this._loop = false;
      this._state = GET_INFO;
    }
    _write(chunk, encoding, cb) {
      if (this._opcode === 8 && this._state == GET_INFO)
        return cb();
      if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
        cb(this.createError(RangeError, "Too many buffered chunks", false, 1008, "WS_ERR_TOO_MANY_BUFFERED_PARTS"));
        return;
      }
      this._bufferedBytes += chunk.length;
      this._buffers.push(chunk);
      this.startLoop(cb);
    }
    consume(n) {
      this._bufferedBytes -= n;
      if (n === this._buffers[0].length)
        return this._buffers.shift();
      if (n < this._buffers[0].length) {
        const buf = this._buffers[0];
        this._buffers[0] = new FastBuffer(buf.buffer, buf.byteOffset + n, buf.length - n);
        return new FastBuffer(buf.buffer, buf.byteOffset, n);
      }
      const dst = Buffer.allocUnsafe(n);
      do {
        const buf = this._buffers[0];
        const offset = dst.length - n;
        if (n >= buf.length) {
          dst.set(this._buffers.shift(), offset);
        } else {
          dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
          this._buffers[0] = new FastBuffer(buf.buffer, buf.byteOffset + n, buf.length - n);
        }
        n -= buf.length;
      } while (n > 0);
      return dst;
    }
    startLoop(cb) {
      this._loop = true;
      do {
        switch (this._state) {
          case GET_INFO:
            this.getInfo(cb);
            break;
          case GET_PAYLOAD_LENGTH_16:
            this.getPayloadLength16(cb);
            break;
          case GET_PAYLOAD_LENGTH_64:
            this.getPayloadLength64(cb);
            break;
          case GET_MASK:
            this.getMask();
            break;
          case GET_DATA:
            this.getData(cb);
            break;
          case INFLATING:
          case DEFER_EVENT:
            this._loop = false;
            return;
        }
      } while (this._loop);
      if (!this._errored)
        cb();
    }
    getInfo(cb) {
      if (this._bufferedBytes < 2) {
        this._loop = false;
        return;
      }
      const buf = this.consume(2);
      if ((buf[0] & 48) !== 0) {
        const error = this.createError(RangeError, "RSV2 and RSV3 must be clear", true, 1002, "WS_ERR_UNEXPECTED_RSV_2_3");
        cb(error);
        return;
      }
      const compressed = (buf[0] & 64) === 64;
      if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
        const error = this.createError(RangeError, "RSV1 must be clear", true, 1002, "WS_ERR_UNEXPECTED_RSV_1");
        cb(error);
        return;
      }
      this._fin = (buf[0] & 128) === 128;
      this._opcode = buf[0] & 15;
      this._payloadLength = buf[1] & 127;
      if (this._opcode === 0) {
        if (compressed) {
          const error = this.createError(RangeError, "RSV1 must be clear", true, 1002, "WS_ERR_UNEXPECTED_RSV_1");
          cb(error);
          return;
        }
        if (!this._fragmented) {
          const error = this.createError(RangeError, "invalid opcode 0", true, 1002, "WS_ERR_INVALID_OPCODE");
          cb(error);
          return;
        }
        this._opcode = this._fragmented;
      } else if (this._opcode === 1 || this._opcode === 2) {
        if (this._fragmented) {
          const error = this.createError(RangeError, `invalid opcode ${this._opcode}`, true, 1002, "WS_ERR_INVALID_OPCODE");
          cb(error);
          return;
        }
        this._compressed = compressed;
      } else if (this._opcode > 7 && this._opcode < 11) {
        if (!this._fin) {
          const error = this.createError(RangeError, "FIN must be set", true, 1002, "WS_ERR_EXPECTED_FIN");
          cb(error);
          return;
        }
        if (compressed) {
          const error = this.createError(RangeError, "RSV1 must be clear", true, 1002, "WS_ERR_UNEXPECTED_RSV_1");
          cb(error);
          return;
        }
        if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
          const error = this.createError(RangeError, `invalid payload length ${this._payloadLength}`, true, 1002, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH");
          cb(error);
          return;
        }
      } else {
        const error = this.createError(RangeError, `invalid opcode ${this._opcode}`, true, 1002, "WS_ERR_INVALID_OPCODE");
        cb(error);
        return;
      }
      if (!this._fin && !this._fragmented)
        this._fragmented = this._opcode;
      this._masked = (buf[1] & 128) === 128;
      if (this._isServer) {
        if (!this._masked) {
          const error = this.createError(RangeError, "MASK must be set", true, 1002, "WS_ERR_EXPECTED_MASK");
          cb(error);
          return;
        }
      } else if (this._masked) {
        const error = this.createError(RangeError, "MASK must be clear", true, 1002, "WS_ERR_UNEXPECTED_MASK");
        cb(error);
        return;
      }
      if (this._payloadLength === 126)
        this._state = GET_PAYLOAD_LENGTH_16;
      else if (this._payloadLength === 127)
        this._state = GET_PAYLOAD_LENGTH_64;
      else
        this.haveLength(cb);
    }
    getPayloadLength16(cb) {
      if (this._bufferedBytes < 2) {
        this._loop = false;
        return;
      }
      this._payloadLength = this.consume(2).readUInt16BE(0);
      this.haveLength(cb);
    }
    getPayloadLength64(cb) {
      if (this._bufferedBytes < 8) {
        this._loop = false;
        return;
      }
      const buf = this.consume(8);
      const num = buf.readUInt32BE(0);
      if (num > Math.pow(2, 53 - 32) - 1) {
        const error = this.createError(RangeError, "Unsupported WebSocket frame: payload length > 2^53 - 1", false, 1009, "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH");
        cb(error);
        return;
      }
      this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
      this.haveLength(cb);
    }
    haveLength(cb) {
      if (this._payloadLength && this._opcode < 8) {
        this._totalPayloadLength += this._payloadLength;
        if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
          const error = this.createError(RangeError, "Max payload size exceeded", false, 1009, "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
          cb(error);
          return;
        }
      }
      if (this._masked)
        this._state = GET_MASK;
      else
        this._state = GET_DATA;
    }
    getMask() {
      if (this._bufferedBytes < 4) {
        this._loop = false;
        return;
      }
      this._mask = this.consume(4);
      this._state = GET_DATA;
    }
    getData(cb) {
      let data = EMPTY_BUFFER;
      if (this._payloadLength) {
        if (this._bufferedBytes < this._payloadLength) {
          this._loop = false;
          return;
        }
        data = this.consume(this._payloadLength);
        if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
          unmask(data, this._mask);
        }
      }
      if (this._opcode > 7) {
        this.controlMessage(data, cb);
        return;
      }
      if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
        const error = this.createError(RangeError, "Too many message fragments", false, 1008, "WS_ERR_TOO_MANY_BUFFERED_PARTS");
        cb(error);
        return;
      }
      if (this._compressed) {
        this._state = INFLATING;
        this.decompress(data, cb);
        return;
      }
      if (data.length) {
        this._messageLength = this._totalPayloadLength;
        this._fragments.push(data);
      }
      this.dataMessage(cb);
    }
    decompress(data, cb) {
      const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
      perMessageDeflate.decompress(data, this._fin, (err, buf) => {
        if (err)
          return cb(err);
        if (buf.length) {
          this._messageLength += buf.length;
          if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(RangeError, "Max payload size exceeded", false, 1009, "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
            cb(error);
            return;
          }
          this._fragments.push(buf);
        }
        this.dataMessage(cb);
        if (this._state === GET_INFO)
          this.startLoop(cb);
      });
    }
    dataMessage(cb) {
      if (!this._fin) {
        this._state = GET_INFO;
        return;
      }
      const messageLength = this._messageLength;
      const fragments = this._fragments;
      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._fragmented = 0;
      this._numFragments = 0;
      this._fragments = [];
      if (this._opcode === 2) {
        let data;
        if (this._binaryType === "nodebuffer") {
          data = concat(fragments, messageLength);
        } else if (this._binaryType === "arraybuffer") {
          data = toArrayBuffer(concat(fragments, messageLength));
        } else if (this._binaryType === "blob") {
          data = new Blob(fragments);
        } else {
          data = fragments;
        }
        if (this._allowSynchronousEvents) {
          this.emit("message", data, true);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit("message", data, true);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      } else {
        const buf = concat(fragments, messageLength);
        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
          const error = this.createError(Error, "invalid UTF-8 sequence", true, 1007, "WS_ERR_INVALID_UTF8");
          cb(error);
          return;
        }
        if (this._state === INFLATING || this._allowSynchronousEvents) {
          this.emit("message", buf, false);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit("message", buf, false);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
    }
    controlMessage(data, cb) {
      if (this._opcode === 8) {
        if (data.length === 0) {
          this._loop = false;
          this.emit("conclude", 1005, EMPTY_BUFFER);
          this.end();
        } else {
          const code = data.readUInt16BE(0);
          if (!isValidStatusCode(code)) {
            const error = this.createError(RangeError, `invalid status code ${code}`, true, 1002, "WS_ERR_INVALID_CLOSE_CODE");
            cb(error);
            return;
          }
          const buf = new FastBuffer(data.buffer, data.byteOffset + 2, data.length - 2);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(Error, "invalid UTF-8 sequence", true, 1007, "WS_ERR_INVALID_UTF8");
            cb(error);
            return;
          }
          this._loop = false;
          this.emit("conclude", code, buf);
          this.end();
        }
        this._state = GET_INFO;
        return;
      }
      if (this._allowSynchronousEvents) {
        this.emit(this._opcode === 9 ? "ping" : "pong", data);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    }
    createError(ErrorCtor, message, prefix, statusCode, errorCode) {
      this._loop = false;
      this._errored = true;
      const err = new ErrorCtor(prefix ? `Invalid WebSocket frame: ${message}` : message);
      Error.captureStackTrace(err, this.createError);
      err.code = errorCode;
      err[kStatusCode] = statusCode;
      return err;
    }
  }
  module.exports = Receiver;
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS(function(exports, module) {
  var { Duplex } = __require("stream");
  var { randomFillSync } = __require("crypto");
  var {
    types: { isUint8Array }
  } = __require("util");
  var PerMessageDeflate = require_permessage_deflate();
  var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
  var { isBlob, isValidStatusCode } = require_validation();
  var { mask: applyMask, toBuffer } = require_buffer_util();
  var kByteLength = Symbol("kByteLength");
  var maskBuffer = Buffer.alloc(4);
  var RANDOM_POOL_SIZE = 8 * 1024;
  var randomPool;
  var randomPoolPointer = RANDOM_POOL_SIZE;
  var DEFAULT = 0;
  var DEFLATING = 1;
  var GET_BLOB_DATA = 2;

  class Sender {
    constructor(socket, extensions, generateMask) {
      this._extensions = extensions || {};
      if (generateMask) {
        this._generateMask = generateMask;
        this._maskBuffer = Buffer.alloc(4);
      }
      this._socket = socket;
      this._firstFragment = true;
      this._compress = false;
      this._bufferedBytes = 0;
      this._queue = [];
      this._state = DEFAULT;
      this.onerror = NOOP;
      this[kWebSocket] = undefined;
    }
    static frame(data, options) {
      let mask;
      let merge = false;
      let offset = 2;
      let skipMasking = false;
      if (options.mask) {
        mask = options.maskBuffer || maskBuffer;
        if (options.generateMask) {
          options.generateMask(mask);
        } else {
          if (randomPoolPointer === RANDOM_POOL_SIZE) {
            if (randomPool === undefined) {
              randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
            }
            randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
            randomPoolPointer = 0;
          }
          mask[0] = randomPool[randomPoolPointer++];
          mask[1] = randomPool[randomPoolPointer++];
          mask[2] = randomPool[randomPoolPointer++];
          mask[3] = randomPool[randomPoolPointer++];
        }
        skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
        offset = 6;
      }
      let dataLength;
      if (typeof data === "string") {
        if ((!options.mask || skipMasking) && options[kByteLength] !== undefined) {
          dataLength = options[kByteLength];
        } else {
          data = Buffer.from(data);
          dataLength = data.length;
        }
      } else {
        dataLength = data.length;
        merge = options.mask && options.readOnly && !skipMasking;
      }
      let payloadLength = dataLength;
      if (dataLength >= 65536) {
        offset += 8;
        payloadLength = 127;
      } else if (dataLength > 125) {
        offset += 2;
        payloadLength = 126;
      }
      const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
      target[0] = options.fin ? options.opcode | 128 : options.opcode;
      if (options.rsv1)
        target[0] |= 64;
      target[1] = payloadLength;
      if (payloadLength === 126) {
        target.writeUInt16BE(dataLength, 2);
      } else if (payloadLength === 127) {
        target[2] = target[3] = 0;
        target.writeUIntBE(dataLength, 4, 6);
      }
      if (!options.mask)
        return [target, data];
      target[1] |= 128;
      target[offset - 4] = mask[0];
      target[offset - 3] = mask[1];
      target[offset - 2] = mask[2];
      target[offset - 1] = mask[3];
      if (skipMasking)
        return [target, data];
      if (merge) {
        applyMask(data, mask, target, offset, dataLength);
        return [target];
      }
      applyMask(data, mask, data, 0, dataLength);
      return [target, data];
    }
    close(code, data, mask, cb) {
      let buf;
      if (code === undefined) {
        buf = EMPTY_BUFFER;
      } else if (typeof code !== "number" || !isValidStatusCode(code)) {
        throw new TypeError("First argument must be a valid error code number");
      } else if (data === undefined || !data.length) {
        buf = Buffer.allocUnsafe(2);
        buf.writeUInt16BE(code, 0);
      } else {
        const length = Buffer.byteLength(data);
        if (length > 123) {
          throw new RangeError("The message must not be greater than 123 bytes");
        }
        buf = Buffer.allocUnsafe(2 + length);
        buf.writeUInt16BE(code, 0);
        if (typeof data === "string") {
          buf.write(data, 2);
        } else if (isUint8Array(data)) {
          buf.set(data, 2);
        } else {
          throw new TypeError("Second argument must be a string or a Uint8Array");
        }
      }
      const options = {
        [kByteLength]: buf.length,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 8,
        readOnly: false,
        rsv1: false
      };
      if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, buf, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(buf, options), cb);
      }
    }
    ping(data, mask, cb) {
      let byteLength;
      let readOnly;
      if (typeof data === "string") {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (byteLength > 125) {
        throw new RangeError("The data size must not be greater than 125 bytes");
      }
      const options = {
        [kByteLength]: byteLength,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 9,
        readOnly,
        rsv1: false
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, false, options, cb]);
        } else {
          this.getBlobData(data, false, options, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(data, options), cb);
      }
    }
    pong(data, mask, cb) {
      let byteLength;
      let readOnly;
      if (typeof data === "string") {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (byteLength > 125) {
        throw new RangeError("The data size must not be greater than 125 bytes");
      }
      const options = {
        [kByteLength]: byteLength,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 10,
        readOnly,
        rsv1: false
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, false, options, cb]);
        } else {
          this.getBlobData(data, false, options, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(data, options), cb);
      }
    }
    send(data, options, cb) {
      const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
      let opcode = options.binary ? 2 : 1;
      let rsv1 = options.compress;
      let byteLength;
      let readOnly;
      if (typeof data === "string") {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (this._firstFragment) {
        this._firstFragment = false;
        if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
          rsv1 = byteLength >= perMessageDeflate._threshold;
        }
        this._compress = rsv1;
      } else {
        rsv1 = false;
        opcode = 0;
      }
      if (options.fin)
        this._firstFragment = true;
      const opts = {
        [kByteLength]: byteLength,
        fin: options.fin,
        generateMask: this._generateMask,
        mask: options.mask,
        maskBuffer: this._maskBuffer,
        opcode,
        readOnly,
        rsv1
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
        } else {
          this.getBlobData(data, this._compress, opts, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, this._compress, opts, cb]);
      } else {
        this.dispatch(data, this._compress, opts, cb);
      }
    }
    getBlobData(blob, compress, options, cb) {
      this._bufferedBytes += options[kByteLength];
      this._state = GET_BLOB_DATA;
      blob.arrayBuffer().then((arrayBuffer) => {
        if (this._socket.destroyed) {
          const err = new Error("The socket was closed while the blob was being read");
          process.nextTick(callCallbacks, this, err, cb);
          return;
        }
        this._bufferedBytes -= options[kByteLength];
        const data = toBuffer(arrayBuffer);
        if (!compress) {
          this._state = DEFAULT;
          this.sendFrame(Sender.frame(data, options), cb);
          this.dequeue();
        } else {
          this.dispatch(data, compress, options, cb);
        }
      }).catch((err) => {
        process.nextTick(onError, this, err, cb);
      });
    }
    dispatch(data, compress, options, cb) {
      if (!compress) {
        this.sendFrame(Sender.frame(data, options), cb);
        return;
      }
      const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
      this._bufferedBytes += options[kByteLength];
      this._state = DEFLATING;
      perMessageDeflate.compress(data, options.fin, (_, buf) => {
        if (this._socket.destroyed) {
          const err = new Error("The socket was closed while data was being compressed");
          callCallbacks(this, err, cb);
          return;
        }
        this._bufferedBytes -= options[kByteLength];
        this._state = DEFAULT;
        options.readOnly = false;
        this.sendFrame(Sender.frame(buf, options), cb);
        this.dequeue();
      });
    }
    dequeue() {
      while (this._state === DEFAULT && this._queue.length) {
        const params = this._queue.shift();
        this._bufferedBytes -= params[3][kByteLength];
        Reflect.apply(params[0], this, params.slice(1));
      }
    }
    enqueue(params) {
      this._bufferedBytes += params[3][kByteLength];
      this._queue.push(params);
    }
    sendFrame(list, cb) {
      if (list.length === 2) {
        this._socket.cork();
        this._socket.write(list[0]);
        this._socket.write(list[1], cb);
        this._socket.uncork();
      } else {
        this._socket.write(list[0], cb);
      }
    }
  }
  module.exports = Sender;
  function callCallbacks(sender, err, cb) {
    if (typeof cb === "function")
      cb(err);
    for (let i = 0;i < sender._queue.length; i++) {
      const params = sender._queue[i];
      const callback = params[params.length - 1];
      if (typeof callback === "function")
        callback(err);
    }
  }
  function onError(sender, err, cb) {
    callCallbacks(sender, err, cb);
    sender.onerror(err);
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS(function(exports, module) {
  var { kForOnEventAttribute, kListener } = require_constants();
  var kCode = Symbol("kCode");
  var kData = Symbol("kData");
  var kError = Symbol("kError");
  var kMessage = Symbol("kMessage");
  var kReason = Symbol("kReason");
  var kTarget = Symbol("kTarget");
  var kType = Symbol("kType");
  var kWasClean = Symbol("kWasClean");

  class Event {
    constructor(type) {
      this[kTarget] = null;
      this[kType] = type;
    }
    get target() {
      return this[kTarget];
    }
    get type() {
      return this[kType];
    }
  }
  Object.defineProperty(Event.prototype, "target", { enumerable: true });
  Object.defineProperty(Event.prototype, "type", { enumerable: true });

  class CloseEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kCode] = options.code === undefined ? 0 : options.code;
      this[kReason] = options.reason === undefined ? "" : options.reason;
      this[kWasClean] = options.wasClean === undefined ? false : options.wasClean;
    }
    get code() {
      return this[kCode];
    }
    get reason() {
      return this[kReason];
    }
    get wasClean() {
      return this[kWasClean];
    }
  }
  Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
  Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
  Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });

  class ErrorEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kError] = options.error === undefined ? null : options.error;
      this[kMessage] = options.message === undefined ? "" : options.message;
    }
    get error() {
      return this[kError];
    }
    get message() {
      return this[kMessage];
    }
  }
  Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
  Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });

  class MessageEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kData] = options.data === undefined ? null : options.data;
    }
    get data() {
      return this[kData];
    }
  }
  Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
  var EventTarget = {
    addEventListener(type, handler, options = {}) {
      for (const listener of this.listeners(type)) {
        if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
          return;
        }
      }
      let wrapper;
      if (type === "message") {
        wrapper = function onMessage(data, isBinary) {
          const event = new MessageEvent("message", {
            data: isBinary ? data : data.toString()
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === "close") {
        wrapper = function onClose(code, message) {
          const event = new CloseEvent("close", {
            code,
            reason: message.toString(),
            wasClean: this._closeFrameReceived && this._closeFrameSent
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === "error") {
        wrapper = function onError(error) {
          const event = new ErrorEvent("error", {
            error,
            message: error.message
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === "open") {
        wrapper = function onOpen() {
          const event = new Event("open");
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else {
        return;
      }
      wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
      wrapper[kListener] = handler;
      if (options.once) {
        this.once(type, wrapper);
      } else {
        this.on(type, wrapper);
      }
    },
    removeEventListener(type, handler) {
      for (const listener of this.listeners(type)) {
        if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
          this.removeListener(type, listener);
          break;
        }
      }
    }
  };
  module.exports = {
    CloseEvent,
    ErrorEvent,
    Event,
    EventTarget,
    MessageEvent
  };
  function callListener(listener, thisArg, event) {
    if (typeof listener === "object" && listener.handleEvent) {
      listener.handleEvent.call(listener, event);
    } else {
      listener.call(thisArg, event);
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS(function(exports, module) {
  var { tokenChars } = require_validation();
  function push(dest, name, elem) {
    if (dest[name] === undefined)
      dest[name] = [elem];
    else
      dest[name].push(elem);
  }
  function parse(header) {
    const offers = Object.create(null);
    let params = Object.create(null);
    let mustUnescape = false;
    let isEscaping = false;
    let inQuotes = false;
    let extensionName;
    let paramName;
    let start = -1;
    let code = -1;
    let end = -1;
    let i = 0;
    for (;i < header.length; i++) {
      code = header.charCodeAt(i);
      if (extensionName === undefined) {
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1)
            start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1)
            end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1)
            end = i;
          const name = header.slice(start, end);
          if (code === 44) {
            push(offers, name, params);
            params = Object.create(null);
          } else {
            extensionName = name;
          }
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else if (paramName === undefined) {
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1)
            start = i;
        } else if (code === 32 || code === 9) {
          if (end === -1 && start !== -1)
            end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1)
            end = i;
          push(params, header.slice(start, end), true);
          if (code === 44) {
            push(offers, extensionName, params);
            params = Object.create(null);
            extensionName = undefined;
          }
          start = end = -1;
        } else if (code === 61 && start !== -1 && end === -1) {
          paramName = header.slice(start, i);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else {
        if (isEscaping) {
          if (tokenChars[code] !== 1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (start === -1)
            start = i;
          else if (!mustUnescape)
            mustUnescape = true;
          isEscaping = false;
        } else if (inQuotes) {
          if (tokenChars[code] === 1) {
            if (start === -1)
              start = i;
          } else if (code === 34 && start !== -1) {
            inQuotes = false;
            end = i;
          } else if (code === 92) {
            isEscaping = true;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
          inQuotes = true;
        } else if (end === -1 && tokenChars[code] === 1) {
          if (start === -1)
            start = i;
        } else if (start !== -1 && (code === 32 || code === 9)) {
          if (end === -1)
            end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1)
            end = i;
          let value = header.slice(start, end);
          if (mustUnescape) {
            value = value.replace(/\\/g, "");
            mustUnescape = false;
          }
          push(params, paramName, value);
          if (code === 44) {
            push(offers, extensionName, params);
            params = Object.create(null);
            extensionName = undefined;
          }
          paramName = undefined;
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
    }
    if (start === -1 || inQuotes || code === 32 || code === 9) {
      throw new SyntaxError("Unexpected end of input");
    }
    if (end === -1)
      end = i;
    const token = header.slice(start, end);
    if (extensionName === undefined) {
      push(offers, token, params);
    } else {
      if (paramName === undefined) {
        push(params, token, true);
      } else if (mustUnescape) {
        push(params, paramName, token.replace(/\\/g, ""));
      } else {
        push(params, paramName, token);
      }
      push(offers, extensionName, params);
    }
    return offers;
  }
  function format(extensions) {
    return Object.keys(extensions).map((extension) => {
      let configurations = extensions[extension];
      if (!Array.isArray(configurations))
        configurations = [configurations];
      return configurations.map((params) => {
        return [extension].concat(Object.keys(params).map((k) => {
          let values = params[k];
          if (!Array.isArray(values))
            values = [values];
          return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
        })).join("; ");
      }).join(", ");
    }).join(", ");
  }
  module.exports = { format, parse };
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS(function(exports, module) {
  var EventEmitter = __require("events");
  var https = __require("https");
  var http = __require("http");
  var net = __require("net");
  var tls = __require("tls");
  var { randomBytes, createHash } = __require("crypto");
  var { Duplex, Readable } = __require("stream");
  var { URL: URL2 } = __require("url");
  var PerMessageDeflate = require_permessage_deflate();
  var Receiver = require_receiver();
  var Sender = require_sender();
  var { isBlob } = require_validation();
  var {
    BINARY_TYPES,
    CLOSE_TIMEOUT,
    EMPTY_BUFFER,
    GUID,
    kForOnEventAttribute,
    kListener,
    kStatusCode,
    kWebSocket,
    NOOP
  } = require_constants();
  var {
    EventTarget: { addEventListener, removeEventListener }
  } = require_event_target();
  var { format, parse } = require_extension();
  var { toBuffer } = require_buffer_util();
  var kAborted = Symbol("kAborted");
  var protocolVersions = [8, 13];
  var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
  var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

  class WebSocket2 extends EventEmitter {
    constructor(address, protocols, options) {
      super();
      this._binaryType = BINARY_TYPES[0];
      this._closeCode = 1006;
      this._closeFrameReceived = false;
      this._closeFrameSent = false;
      this._closeMessage = EMPTY_BUFFER;
      this._closeTimer = null;
      this._errorEmitted = false;
      this._extensions = {};
      this._paused = false;
      this._protocol = "";
      this._readyState = WebSocket2.CONNECTING;
      this._receiver = null;
      this._sender = null;
      this._socket = null;
      if (address !== null) {
        this._bufferedAmount = 0;
        this._isServer = false;
        this._redirects = 0;
        if (protocols === undefined) {
          if (!options || options.protocols === undefined) {
            protocols = [];
          } else if (Array.isArray(options.protocols)) {
            protocols = options.protocols;
          } else {
            protocols = [options.protocols];
          }
        } else if (!Array.isArray(protocols)) {
          if (typeof protocols === "object" && protocols !== null) {
            options = protocols;
            if (options.protocols === undefined) {
              protocols = [];
            } else if (Array.isArray(options.protocols)) {
              protocols = options.protocols;
            } else {
              protocols = [options.protocols];
            }
          } else {
            protocols = [protocols];
          }
        }
        initAsClient(this, address, protocols, options);
      } else {
        this._autoPong = options.autoPong;
        this._closeTimeout = options.closeTimeout;
        this._isServer = true;
      }
    }
    get binaryType() {
      return this._binaryType;
    }
    set binaryType(type) {
      if (!BINARY_TYPES.includes(type))
        return;
      this._binaryType = type;
      if (this._receiver)
        this._receiver._binaryType = type;
    }
    get bufferedAmount() {
      if (!this._socket)
        return this._bufferedAmount;
      return this._socket._writableState.length + this._sender._bufferedBytes;
    }
    get extensions() {
      return Object.keys(this._extensions).join();
    }
    get isPaused() {
      return this._paused;
    }
    get onclose() {
      return null;
    }
    get onerror() {
      return null;
    }
    get onopen() {
      return null;
    }
    get onmessage() {
      return null;
    }
    get protocol() {
      return this._protocol;
    }
    get readyState() {
      return this._readyState;
    }
    get url() {
      return this._url;
    }
    setSocket(socket, head, options) {
      const receiver = new Receiver({
        allowSynchronousEvents: options.allowSynchronousEvents,
        binaryType: this.binaryType,
        extensions: this._extensions,
        isServer: this._isServer,
        maxBufferedChunks: options.maxBufferedChunks,
        maxFragments: options.maxFragments,
        maxPayload: options.maxPayload,
        skipUTF8Validation: options.skipUTF8Validation
      });
      const sender = new Sender(socket, this._extensions, options.generateMask);
      this._receiver = receiver;
      this._sender = sender;
      this._socket = socket;
      receiver[kWebSocket] = this;
      sender[kWebSocket] = this;
      socket[kWebSocket] = this;
      receiver.on("conclude", receiverOnConclude);
      receiver.on("drain", receiverOnDrain);
      receiver.on("error", receiverOnError);
      receiver.on("message", receiverOnMessage);
      receiver.on("ping", receiverOnPing);
      receiver.on("pong", receiverOnPong);
      sender.onerror = senderOnError;
      if (socket.setTimeout)
        socket.setTimeout(0);
      if (socket.setNoDelay)
        socket.setNoDelay();
      if (head.length > 0)
        socket.unshift(head);
      socket.on("close", socketOnClose);
      socket.on("data", socketOnData);
      socket.on("end", socketOnEnd);
      socket.on("error", socketOnError);
      this._readyState = WebSocket2.OPEN;
      this.emit("open");
    }
    emitClose() {
      if (!this._socket) {
        this._readyState = WebSocket2.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
        return;
      }
      if (this._extensions[PerMessageDeflate.extensionName]) {
        this._extensions[PerMessageDeflate.extensionName].cleanup();
      }
      this._receiver.removeAllListeners();
      this._readyState = WebSocket2.CLOSED;
      this.emit("close", this._closeCode, this._closeMessage);
    }
    close(code, data) {
      if (this.readyState === WebSocket2.CLOSED)
        return;
      if (this.readyState === WebSocket2.CONNECTING) {
        const msg = "WebSocket was closed before the connection was established";
        abortHandshake(this, this._req, msg);
        return;
      }
      if (this.readyState === WebSocket2.CLOSING) {
        if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
          this._socket.end();
        }
        return;
      }
      this._sender.close(code, data, !this._isServer, (err) => {
        if (err)
          return;
        this._closeFrameSent = true;
        if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
          this._socket.end();
        }
      });
      this._readyState = WebSocket2.CLOSING;
      setCloseTimer(this);
    }
    pause() {
      if (this.readyState === WebSocket2.CONNECTING || this.readyState === WebSocket2.CLOSED) {
        return;
      }
      this._paused = true;
      this._socket.pause();
    }
    ping(data, mask, cb) {
      if (this.readyState === WebSocket2.CONNECTING) {
        throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
      }
      if (typeof data === "function") {
        cb = data;
        data = mask = undefined;
      } else if (typeof mask === "function") {
        cb = mask;
        mask = undefined;
      }
      if (typeof data === "number")
        data = data.toString();
      if (this.readyState !== WebSocket2.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      if (mask === undefined)
        mask = !this._isServer;
      this._sender.ping(data || EMPTY_BUFFER, mask, cb);
    }
    pong(data, mask, cb) {
      if (this.readyState === WebSocket2.CONNECTING) {
        throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
      }
      if (typeof data === "function") {
        cb = data;
        data = mask = undefined;
      } else if (typeof mask === "function") {
        cb = mask;
        mask = undefined;
      }
      if (typeof data === "number")
        data = data.toString();
      if (this.readyState !== WebSocket2.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      if (mask === undefined)
        mask = !this._isServer;
      this._sender.pong(data || EMPTY_BUFFER, mask, cb);
    }
    resume() {
      if (this.readyState === WebSocket2.CONNECTING || this.readyState === WebSocket2.CLOSED) {
        return;
      }
      this._paused = false;
      if (!this._receiver._writableState.needDrain)
        this._socket.resume();
    }
    send(data, options, cb) {
      if (this.readyState === WebSocket2.CONNECTING) {
        throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
      }
      if (typeof options === "function") {
        cb = options;
        options = {};
      }
      if (typeof data === "number")
        data = data.toString();
      if (this.readyState !== WebSocket2.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      const opts = {
        binary: typeof data !== "string",
        mask: !this._isServer,
        compress: true,
        fin: true,
        ...options
      };
      if (!this._extensions[PerMessageDeflate.extensionName]) {
        opts.compress = false;
      }
      this._sender.send(data || EMPTY_BUFFER, opts, cb);
    }
    terminate() {
      if (this.readyState === WebSocket2.CLOSED)
        return;
      if (this.readyState === WebSocket2.CONNECTING) {
        const msg = "WebSocket was closed before the connection was established";
        abortHandshake(this, this._req, msg);
        return;
      }
      if (this._socket) {
        this._readyState = WebSocket2.CLOSING;
        this._socket.destroy();
      }
    }
  }
  Object.defineProperty(WebSocket2, "CONNECTING", {
    enumerable: true,
    value: readyStates.indexOf("CONNECTING")
  });
  Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
    enumerable: true,
    value: readyStates.indexOf("CONNECTING")
  });
  Object.defineProperty(WebSocket2, "OPEN", {
    enumerable: true,
    value: readyStates.indexOf("OPEN")
  });
  Object.defineProperty(WebSocket2.prototype, "OPEN", {
    enumerable: true,
    value: readyStates.indexOf("OPEN")
  });
  Object.defineProperty(WebSocket2, "CLOSING", {
    enumerable: true,
    value: readyStates.indexOf("CLOSING")
  });
  Object.defineProperty(WebSocket2.prototype, "CLOSING", {
    enumerable: true,
    value: readyStates.indexOf("CLOSING")
  });
  Object.defineProperty(WebSocket2, "CLOSED", {
    enumerable: true,
    value: readyStates.indexOf("CLOSED")
  });
  Object.defineProperty(WebSocket2.prototype, "CLOSED", {
    enumerable: true,
    value: readyStates.indexOf("CLOSED")
  });
  [
    "binaryType",
    "bufferedAmount",
    "extensions",
    "isPaused",
    "protocol",
    "readyState",
    "url"
  ].forEach((property) => {
    Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
  });
  ["open", "error", "close", "message"].forEach((method) => {
    Object.defineProperty(WebSocket2.prototype, `on${method}`, {
      enumerable: true,
      get() {
        for (const listener of this.listeners(method)) {
          if (listener[kForOnEventAttribute])
            return listener[kListener];
        }
        return null;
      },
      set(handler) {
        for (const listener of this.listeners(method)) {
          if (listener[kForOnEventAttribute]) {
            this.removeListener(method, listener);
            break;
          }
        }
        if (typeof handler !== "function")
          return;
        this.addEventListener(method, handler, {
          [kForOnEventAttribute]: true
        });
      }
    });
  });
  WebSocket2.prototype.addEventListener = addEventListener;
  WebSocket2.prototype.removeEventListener = removeEventListener;
  module.exports = WebSocket2;
  function initAsClient(websocket, address, protocols, options) {
    const opts = {
      allowSynchronousEvents: true,
      autoPong: true,
      closeTimeout: CLOSE_TIMEOUT,
      protocolVersion: protocolVersions[1],
      maxBufferedChunks: 256 * 1024,
      maxFragments: 16 * 1024,
      maxPayload: 100 * 1024 * 1024,
      skipUTF8Validation: false,
      perMessageDeflate: true,
      followRedirects: false,
      maxRedirects: 10,
      ...options,
      socketPath: undefined,
      hostname: undefined,
      protocol: undefined,
      protocols: undefined,
      timeout: undefined,
      method: "GET",
      host: undefined,
      path: undefined,
      port: undefined
    };
    websocket._autoPong = opts.autoPong;
    websocket._closeTimeout = opts.closeTimeout;
    if (!protocolVersions.includes(opts.protocolVersion)) {
      throw new RangeError(`Unsupported protocol version: ${opts.protocolVersion} ` + `(supported versions: ${protocolVersions.join(", ")})`);
    }
    let parsedUrl;
    if (address instanceof URL2) {
      parsedUrl = address;
    } else {
      try {
        parsedUrl = new URL2(address);
      } catch {
        throw new SyntaxError(`Invalid URL: ${address}`);
      }
    }
    if (parsedUrl.protocol === "http:") {
      parsedUrl.protocol = "ws:";
    } else if (parsedUrl.protocol === "https:") {
      parsedUrl.protocol = "wss:";
    }
    websocket._url = parsedUrl.href;
    const isSecure = parsedUrl.protocol === "wss:";
    const isIpcUrl = parsedUrl.protocol === "ws+unix:";
    let invalidUrlMessage;
    if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
      invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", ` + '"http:", "https:", or "ws+unix:"';
    } else if (isIpcUrl && !parsedUrl.pathname) {
      invalidUrlMessage = "The URL's pathname is empty";
    } else if (parsedUrl.hash) {
      invalidUrlMessage = "The URL contains a fragment identifier";
    }
    if (invalidUrlMessage) {
      const err = new SyntaxError(invalidUrlMessage);
      if (websocket._redirects === 0) {
        throw err;
      } else {
        emitErrorAndClose(websocket, err);
        return;
      }
    }
    const defaultPort = isSecure ? 443 : 80;
    const key = randomBytes(16).toString("base64");
    const request3 = isSecure ? https.request : http.request;
    const protocolSet = new Set;
    let perMessageDeflate;
    opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
    opts.defaultPort = opts.defaultPort || defaultPort;
    opts.port = parsedUrl.port || defaultPort;
    opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
    opts.headers = {
      ...opts.headers,
      "Sec-WebSocket-Version": opts.protocolVersion,
      "Sec-WebSocket-Key": key,
      Connection: "Upgrade",
      Upgrade: "websocket"
    };
    opts.path = parsedUrl.pathname + parsedUrl.search;
    opts.timeout = opts.handshakeTimeout;
    if (opts.perMessageDeflate) {
      perMessageDeflate = new PerMessageDeflate({
        ...opts.perMessageDeflate,
        isServer: false,
        maxPayload: opts.maxPayload
      });
      opts.headers["Sec-WebSocket-Extensions"] = format({
        [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
      });
    }
    if (protocols.length) {
      for (const protocol of protocols) {
        if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
          throw new SyntaxError("An invalid or duplicated subprotocol was specified");
        }
        protocolSet.add(protocol);
      }
      opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
    }
    if (opts.origin) {
      if (opts.protocolVersion < 13) {
        opts.headers["Sec-WebSocket-Origin"] = opts.origin;
      } else {
        opts.headers.Origin = opts.origin;
      }
    }
    if (parsedUrl.username || parsedUrl.password) {
      opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
    }
    if (isIpcUrl) {
      const parts = opts.path.split(":");
      opts.socketPath = parts[0];
      opts.path = parts[1];
    }
    let req;
    if (opts.followRedirects) {
      if (websocket._redirects === 0) {
        websocket._originalIpc = isIpcUrl;
        websocket._originalSecure = isSecure;
        websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
        const headers = options && options.headers;
        options = { ...options, headers: {} };
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            options.headers[key.toLowerCase()] = value;
          }
        }
      } else if (websocket.listenerCount("redirect") === 0) {
        const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
        if (!isSameHost || websocket._originalSecure && !isSecure) {
          delete opts.headers.authorization;
          delete opts.headers.cookie;
          if (!isSameHost)
            delete opts.headers.host;
          opts.auth = undefined;
        }
      }
      if (opts.auth && !options.headers.authorization) {
        options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
      }
      req = websocket._req = request3(opts);
      if (websocket._redirects) {
        websocket.emit("redirect", websocket.url, req);
      }
    } else {
      req = websocket._req = request3(opts);
    }
    if (opts.timeout) {
      req.on("timeout", () => {
        abortHandshake(websocket, req, "Opening handshake has timed out");
      });
    }
    req.on("error", (err) => {
      if (req === null || req[kAborted])
        return;
      req = websocket._req = null;
      emitErrorAndClose(websocket, err);
    });
    req.on("response", (res) => {
      const location = res.headers.location;
      const statusCode = res.statusCode;
      if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
        if (++websocket._redirects > opts.maxRedirects) {
          abortHandshake(websocket, req, "Maximum redirects exceeded");
          return;
        }
        req.abort();
        let addr;
        try {
          addr = new URL2(location, address);
        } catch (e) {
          const err = new SyntaxError(`Invalid URL: ${location}`);
          emitErrorAndClose(websocket, err);
          return;
        }
        initAsClient(websocket, addr, protocols, options);
      } else if (!websocket.emit("unexpected-response", req, res)) {
        abortHandshake(websocket, req, `Unexpected server response: ${res.statusCode}`);
      }
    });
    req.on("upgrade", (res, socket, head) => {
      websocket.emit("upgrade", res);
      if (websocket.readyState !== WebSocket2.CONNECTING)
        return;
      req = websocket._req = null;
      const upgrade = res.headers.upgrade;
      if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
        abortHandshake(websocket, socket, "Invalid Upgrade header");
        return;
      }
      const digest = createHash("sha1").update(key + GUID).digest("base64");
      if (res.headers["sec-websocket-accept"] !== digest) {
        abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
        return;
      }
      const serverProt = res.headers["sec-websocket-protocol"];
      let protError;
      if (serverProt !== undefined) {
        if (!protocolSet.size) {
          protError = "Server sent a subprotocol but none was requested";
        } else if (!protocolSet.has(serverProt)) {
          protError = "Server sent an invalid subprotocol";
        }
      } else if (protocolSet.size) {
        protError = "Server sent no subprotocol";
      }
      if (protError) {
        abortHandshake(websocket, socket, protError);
        return;
      }
      if (serverProt)
        websocket._protocol = serverProt;
      const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
      if (secWebSocketExtensions !== undefined) {
        if (!perMessageDeflate) {
          const message = "Server sent a Sec-WebSocket-Extensions header but no extension " + "was requested";
          abortHandshake(websocket, socket, message);
          return;
        }
        let extensions;
        try {
          extensions = parse(secWebSocketExtensions);
        } catch (err) {
          const message = "Invalid Sec-WebSocket-Extensions header";
          abortHandshake(websocket, socket, message);
          return;
        }
        const extensionNames = Object.keys(extensions);
        if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
          const message = "Server indicated an extension that was not requested";
          abortHandshake(websocket, socket, message);
          return;
        }
        try {
          perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
        } catch (err) {
          const message = "Invalid Sec-WebSocket-Extensions header";
          abortHandshake(websocket, socket, message);
          return;
        }
        websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
      }
      websocket.setSocket(socket, head, {
        allowSynchronousEvents: opts.allowSynchronousEvents,
        generateMask: opts.generateMask,
        maxBufferedChunks: opts.maxBufferedChunks,
        maxFragments: opts.maxFragments,
        maxPayload: opts.maxPayload,
        skipUTF8Validation: opts.skipUTF8Validation
      });
    });
    if (opts.finishRequest) {
      opts.finishRequest(req, websocket);
    } else {
      req.end();
    }
  }
  function emitErrorAndClose(websocket, err) {
    websocket._readyState = WebSocket2.CLOSING;
    websocket._errorEmitted = true;
    websocket.emit("error", err);
    websocket.emitClose();
  }
  function netConnect(options) {
    options.path = options.socketPath;
    return net.connect(options);
  }
  function tlsConnect(options) {
    options.path = undefined;
    if (!options.servername && options.servername !== "") {
      options.servername = net.isIP(options.host) ? "" : options.host;
    }
    return tls.connect(options);
  }
  function abortHandshake(websocket, stream, message) {
    websocket._readyState = WebSocket2.CLOSING;
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshake);
    if (stream.setHeader) {
      stream[kAborted] = true;
      stream.abort();
      if (stream.socket && !stream.socket.destroyed) {
        stream.socket.destroy();
      }
      process.nextTick(emitErrorAndClose, websocket, err);
    } else {
      stream.destroy(err);
      stream.once("error", websocket.emit.bind(websocket, "error"));
      stream.once("close", websocket.emitClose.bind(websocket));
    }
  }
  function sendAfterClose(websocket, data, cb) {
    if (data) {
      const length = isBlob(data) ? data.size : toBuffer(data).length;
      if (websocket._socket)
        websocket._sender._bufferedBytes += length;
      else
        websocket._bufferedAmount += length;
    }
    if (cb) {
      const err = new Error(`WebSocket is not open: readyState ${websocket.readyState} ` + `(${readyStates[websocket.readyState]})`);
      process.nextTick(cb, err);
    }
  }
  function receiverOnConclude(code, reason) {
    const websocket = this[kWebSocket];
    websocket._closeFrameReceived = true;
    websocket._closeMessage = reason;
    websocket._closeCode = code;
    if (websocket._socket[kWebSocket] === undefined)
      return;
    websocket._socket.removeListener("data", socketOnData);
    process.nextTick(resume, websocket._socket);
    if (code === 1005)
      websocket.close();
    else
      websocket.close(code, reason);
  }
  function receiverOnDrain() {
    const websocket = this[kWebSocket];
    if (!websocket.isPaused)
      websocket._socket.resume();
  }
  function receiverOnError(err) {
    const websocket = this[kWebSocket];
    if (websocket._socket[kWebSocket] !== undefined) {
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      websocket.close(err[kStatusCode]);
    }
    if (!websocket._errorEmitted) {
      websocket._errorEmitted = true;
      websocket.emit("error", err);
    }
  }
  function receiverOnFinish() {
    this[kWebSocket].emitClose();
  }
  function receiverOnMessage(data, isBinary) {
    this[kWebSocket].emit("message", data, isBinary);
  }
  function receiverOnPing(data) {
    const websocket = this[kWebSocket];
    if (websocket._autoPong)
      websocket.pong(data, !this._isServer, NOOP);
    websocket.emit("ping", data);
  }
  function receiverOnPong(data) {
    this[kWebSocket].emit("pong", data);
  }
  function resume(stream) {
    stream.resume();
  }
  function senderOnError(err) {
    const websocket = this[kWebSocket];
    if (websocket.readyState === WebSocket2.CLOSED)
      return;
    if (websocket.readyState === WebSocket2.OPEN) {
      websocket._readyState = WebSocket2.CLOSING;
      setCloseTimer(websocket);
    }
    this._socket.end();
    if (!websocket._errorEmitted) {
      websocket._errorEmitted = true;
      websocket.emit("error", err);
    }
  }
  function setCloseTimer(websocket) {
    websocket._closeTimer = setTimeout(websocket._socket.destroy.bind(websocket._socket), websocket._closeTimeout);
  }
  function socketOnClose() {
    const websocket = this[kWebSocket];
    this.removeListener("close", socketOnClose);
    this.removeListener("data", socketOnData);
    this.removeListener("end", socketOnEnd);
    websocket._readyState = WebSocket2.CLOSING;
    if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
      const chunk = this.read(this._readableState.length);
      websocket._receiver.write(chunk);
    }
    websocket._receiver.end();
    this[kWebSocket] = undefined;
    clearTimeout(websocket._closeTimer);
    if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
      websocket.emitClose();
    } else {
      websocket._receiver.on("error", receiverOnFinish);
      websocket._receiver.on("finish", receiverOnFinish);
    }
  }
  function socketOnData(chunk) {
    if (!this[kWebSocket]._receiver.write(chunk)) {
      this.pause();
    }
  }
  function socketOnEnd() {
    const websocket = this[kWebSocket];
    websocket._readyState = WebSocket2.CLOSING;
    websocket._receiver.end();
    this.end();
  }
  function socketOnError() {
    const websocket = this[kWebSocket];
    this.removeListener("error", socketOnError);
    this.on("error", NOOP);
    if (websocket) {
      websocket._readyState = WebSocket2.CLOSING;
      this.destroy();
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS(function(exports, module) {
  var WebSocket2 = require_websocket();
  var { Duplex } = __require("stream");
  function emitClose(stream) {
    stream.emit("close");
  }
  function duplexOnEnd() {
    if (!this.destroyed && this._writableState.finished) {
      this.destroy();
    }
  }
  function duplexOnError(err) {
    this.removeListener("error", duplexOnError);
    this.destroy();
    if (this.listenerCount("error") === 0) {
      this.emit("error", err);
    }
  }
  function createWebSocketStream(ws, options) {
    let terminateOnDestroy = true;
    const duplex = new Duplex({
      ...options,
      autoDestroy: false,
      emitClose: false,
      objectMode: false,
      writableObjectMode: false
    });
    ws.on("message", function message(msg, isBinary) {
      const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
      if (!duplex.push(data))
        ws.pause();
    });
    ws.once("error", function error(err) {
      if (duplex.destroyed)
        return;
      terminateOnDestroy = false;
      duplex.destroy(err);
    });
    ws.once("close", function close() {
      if (duplex.destroyed)
        return;
      duplex.push(null);
    });
    duplex._destroy = function(err, callback) {
      if (ws.readyState === ws.CLOSED) {
        callback(err);
        process.nextTick(emitClose, duplex);
        return;
      }
      let called = false;
      ws.once("error", function error(err) {
        called = true;
        callback(err);
      });
      ws.once("close", function close() {
        if (!called)
          callback(err);
        process.nextTick(emitClose, duplex);
      });
      if (terminateOnDestroy)
        ws.terminate();
    };
    duplex._final = function(callback) {
      if (ws.readyState === ws.CONNECTING) {
        ws.once("open", function open() {
          duplex._final(callback);
        });
        return;
      }
      if (ws._socket === null)
        return;
      if (ws._socket._writableState.finished) {
        callback();
        if (duplex._readableState.endEmitted)
          duplex.destroy();
      } else {
        ws._socket.once("finish", function finish() {
          callback();
        });
        ws.close();
      }
    };
    duplex._read = function() {
      if (ws.isPaused)
        ws.resume();
    };
    duplex._write = function(chunk, encoding, callback) {
      if (ws.readyState === ws.CONNECTING) {
        ws.once("open", function open() {
          duplex._write(chunk, encoding, callback);
        });
        return;
      }
      ws.send(chunk, callback);
    };
    duplex.on("end", duplexOnEnd);
    duplex.on("error", duplexOnError);
    return duplex;
  }
  module.exports = createWebSocketStream;
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS(function(exports, module) {
  var { tokenChars } = require_validation();
  function parse(header) {
    const protocols = new Set;
    let start = -1;
    let end = -1;
    let i = 0;
    for (i;i < header.length; i++) {
      const code = header.charCodeAt(i);
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1)
          start = i;
      } else if (i !== 0 && (code === 32 || code === 9)) {
        if (end === -1 && start !== -1)
          end = i;
      } else if (code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1)
          end = i;
        const protocol = header.slice(start, end);
        if (protocols.has(protocol)) {
          throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
        }
        protocols.add(protocol);
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
    if (start === -1 || end !== -1) {
      throw new SyntaxError("Unexpected end of input");
    }
    const protocol = header.slice(start, i);
    if (protocols.has(protocol)) {
      throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
    }
    protocols.add(protocol);
    return protocols;
  }
  module.exports = { parse };
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS(function(exports, module) {
  var EventEmitter = __require("events");
  var http = __require("http");
  var { Duplex } = __require("stream");
  var { createHash } = __require("crypto");
  var extension = require_extension();
  var PerMessageDeflate = require_permessage_deflate();
  var subprotocol = require_subprotocol();
  var WebSocket2 = require_websocket();
  var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
  var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
  var RUNNING = 0;
  var CLOSING = 1;
  var CLOSED = 2;

  class WebSocketServer extends EventEmitter {
    constructor(options, callback) {
      super();
      options = {
        allowSynchronousEvents: true,
        autoPong: true,
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: false,
        handleProtocols: null,
        clientTracking: true,
        closeTimeout: CLOSE_TIMEOUT,
        verifyClient: null,
        noServer: false,
        backlog: null,
        server: null,
        host: null,
        path: null,
        port: null,
        WebSocket: WebSocket2,
        ...options
      };
      if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
        throw new TypeError('One and only one of the "port", "server", or "noServer" options ' + "must be specified");
      }
      if (options.port != null) {
        this._server = http.createServer((req, res) => {
          const body = http.STATUS_CODES[426];
          res.writeHead(426, {
            "Content-Length": body.length,
            "Content-Type": "text/plain"
          });
          res.end(body);
        });
        this._server.listen(options.port, options.host, options.backlog, callback);
      } else if (options.server) {
        this._server = options.server;
      }
      if (this._server) {
        const emitConnection = this.emit.bind(this, "connection");
        this._removeListeners = addListeners(this._server, {
          listening: this.emit.bind(this, "listening"),
          error: this.emit.bind(this, "error"),
          upgrade: (req, socket, head) => {
            this.handleUpgrade(req, socket, head, emitConnection);
          }
        });
      }
      if (options.perMessageDeflate === true)
        options.perMessageDeflate = {};
      if (options.clientTracking) {
        this.clients = new Set;
        this._shouldEmitClose = false;
      }
      this.options = options;
      this._state = RUNNING;
    }
    address() {
      if (this.options.noServer) {
        throw new Error('The server is operating in "noServer" mode');
      }
      if (!this._server)
        return null;
      return this._server.address();
    }
    close(cb) {
      if (this._state === CLOSED) {
        if (cb) {
          this.once("close", () => {
            cb(new Error("The server is not running"));
          });
        }
        process.nextTick(emitClose, this);
        return;
      }
      if (cb)
        this.once("close", cb);
      if (this._state === CLOSING)
        return;
      this._state = CLOSING;
      if (this.options.noServer || this.options.server) {
        if (this._server) {
          this._removeListeners();
          this._removeListeners = this._server = null;
        }
        if (this.clients) {
          if (!this.clients.size) {
            process.nextTick(emitClose, this);
          } else {
            this._shouldEmitClose = true;
          }
        } else {
          process.nextTick(emitClose, this);
        }
      } else {
        const server = this._server;
        this._removeListeners();
        this._removeListeners = this._server = null;
        server.close(() => {
          emitClose(this);
        });
      }
    }
    shouldHandle(req) {
      if (this.options.path) {
        const index = req.url.indexOf("?");
        const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
        if (pathname !== this.options.path)
          return false;
      }
      return true;
    }
    handleUpgrade(req, socket, head, cb) {
      socket.on("error", socketOnError);
      const key = req.headers["sec-websocket-key"];
      const upgrade = req.headers.upgrade;
      const version = +req.headers["sec-websocket-version"];
      if (req.method !== "GET") {
        const message = "Invalid HTTP method";
        abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
        return;
      }
      if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
        const message = "Invalid Upgrade header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
      if (key === undefined || !keyRegex.test(key)) {
        const message = "Missing or invalid Sec-WebSocket-Key header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
      if (version !== 13 && version !== 8) {
        const message = "Missing or invalid Sec-WebSocket-Version header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
          "Sec-WebSocket-Version": "13, 8"
        });
        return;
      }
      if (!this.shouldHandle(req)) {
        abortHandshake(socket, 400);
        return;
      }
      const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
      let protocols = new Set;
      if (secWebSocketProtocol !== undefined) {
        try {
          protocols = subprotocol.parse(secWebSocketProtocol);
        } catch (err) {
          const message = "Invalid Sec-WebSocket-Protocol header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
      }
      const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
      const extensions = {};
      if (this.options.perMessageDeflate && secWebSocketExtensions !== undefined) {
        const perMessageDeflate = new PerMessageDeflate({
          ...this.options.perMessageDeflate,
          isServer: true,
          maxPayload: this.options.maxPayload
        });
        try {
          const offers = extension.parse(secWebSocketExtensions);
          if (offers[PerMessageDeflate.extensionName]) {
            perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
            extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
          }
        } catch (err) {
          const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
      }
      if (this.options.verifyClient) {
        const info = {
          origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
          secure: !!(req.socket.authorized || req.socket.encrypted),
          req
        };
        if (this.options.verifyClient.length === 2) {
          this.options.verifyClient(info, (verified, code, message, headers) => {
            if (!verified) {
              return abortHandshake(socket, code || 401, message, headers);
            }
            this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
          });
          return;
        }
        if (!this.options.verifyClient(info))
          return abortHandshake(socket, 401);
      }
      this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
    }
    completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
      if (!socket.readable || !socket.writable)
        return socket.destroy();
      if (socket[kWebSocket]) {
        throw new Error("server.handleUpgrade() was called more than once with the same " + "socket, possibly due to a misconfiguration");
      }
      if (this._state > RUNNING)
        return abortHandshake(socket, 503);
      const digest = createHash("sha1").update(key + GUID).digest("base64");
      const headers = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${digest}`
      ];
      const ws = new this.options.WebSocket(null, undefined, this.options);
      if (protocols.size) {
        const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
        if (protocol) {
          headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
          ws._protocol = protocol;
        }
      }
      if (extensions[PerMessageDeflate.extensionName]) {
        const params = extensions[PerMessageDeflate.extensionName].params;
        const value = extension.format({
          [PerMessageDeflate.extensionName]: [params]
        });
        headers.push(`Sec-WebSocket-Extensions: ${value}`);
        ws._extensions = extensions;
      }
      this.emit("headers", headers, req);
      socket.write(headers.concat(`\r
`).join(`\r
`));
      socket.removeListener("error", socketOnError);
      ws.setSocket(socket, head, {
        allowSynchronousEvents: this.options.allowSynchronousEvents,
        maxBufferedChunks: this.options.maxBufferedChunks,
        maxFragments: this.options.maxFragments,
        maxPayload: this.options.maxPayload,
        skipUTF8Validation: this.options.skipUTF8Validation
      });
      if (this.clients) {
        this.clients.add(ws);
        ws.on("close", () => {
          this.clients.delete(ws);
          if (this._shouldEmitClose && !this.clients.size) {
            process.nextTick(emitClose, this);
          }
        });
      }
      cb(ws, req);
    }
  }
  module.exports = WebSocketServer;
  function addListeners(server, map) {
    for (const event of Object.keys(map))
      server.on(event, map[event]);
    return function removeListeners() {
      for (const event of Object.keys(map)) {
        server.removeListener(event, map[event]);
      }
    };
  }
  function emitClose(server) {
    server._state = CLOSED;
    server.emit("close");
  }
  function socketOnError() {
    this.destroy();
  }
  function abortHandshake(socket, code, message, headers) {
    message = message || http.STATUS_CODES[code];
    headers = {
      Connection: "close",
      "Content-Type": "text/html",
      "Content-Length": Buffer.byteLength(message),
      ...headers
    };
    socket.once("finish", socket.destroy);
    socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join(`\r
`) + `\r
\r
` + message);
  }
  function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
    if (server.listenerCount("wsClientError")) {
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
      server.emit("wsClientError", err, socket, req);
    } else {
      abortHandshake(socket, code, message, headers);
    }
  }
});

// node_modules/diff/lib/diff/base.js
var require_base = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = Diff;
  function Diff() {}
  Diff.prototype = {
    diff: function diff(oldString, newString) {
      var _options$timeout;
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
      var callback = options.callback;
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      var self = this;
      function done(value) {
        value = self.postProcess(value, options);
        if (callback) {
          setTimeout(function() {
            callback(value);
          }, 0);
          return true;
        } else {
          return value;
        }
      }
      oldString = this.castInput(oldString, options);
      newString = this.castInput(newString, options);
      oldString = this.removeEmpty(this.tokenize(oldString, options));
      newString = this.removeEmpty(this.tokenize(newString, options));
      var newLen = newString.length, oldLen = oldString.length;
      var editLength = 1;
      var maxEditLength = newLen + oldLen;
      if (options.maxEditLength != null) {
        maxEditLength = Math.min(maxEditLength, options.maxEditLength);
      }
      var maxExecutionTime = (_options$timeout = options.timeout) !== null && _options$timeout !== undefined ? _options$timeout : Infinity;
      var abortAfterTimestamp = Date.now() + maxExecutionTime;
      var bestPath = [{
        oldPos: -1,
        lastComponent: undefined
      }];
      var newPos = this.extractCommon(bestPath[0], newString, oldString, 0, options);
      if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
        return done(buildValues(self, bestPath[0].lastComponent, newString, oldString, self.useLongestToken));
      }
      var minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
      function execEditLength() {
        for (var diagonalPath = Math.max(minDiagonalToConsider, -editLength);diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
          var basePath = undefined;
          var removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
          if (removePath) {
            bestPath[diagonalPath - 1] = undefined;
          }
          var canAdd = false;
          if (addPath) {
            var addPathNewPos = addPath.oldPos - diagonalPath;
            canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
          }
          var canRemove = removePath && removePath.oldPos + 1 < oldLen;
          if (!canAdd && !canRemove) {
            bestPath[diagonalPath] = undefined;
            continue;
          }
          if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
            basePath = self.addToPath(addPath, true, false, 0, options);
          } else {
            basePath = self.addToPath(removePath, false, true, 1, options);
          }
          newPos = self.extractCommon(basePath, newString, oldString, diagonalPath, options);
          if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
            return done(buildValues(self, basePath.lastComponent, newString, oldString, self.useLongestToken));
          } else {
            bestPath[diagonalPath] = basePath;
            if (basePath.oldPos + 1 >= oldLen) {
              maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
            }
            if (newPos + 1 >= newLen) {
              minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
            }
          }
        }
        editLength++;
      }
      if (callback) {
        (function exec() {
          setTimeout(function() {
            if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
              return callback();
            }
            if (!execEditLength()) {
              exec();
            }
          }, 0);
        })();
      } else {
        while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
          var ret = execEditLength();
          if (ret) {
            return ret;
          }
        }
      }
    },
    addToPath: function addToPath(path, added, removed, oldPosInc, options) {
      var last = path.lastComponent;
      if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
        return {
          oldPos: path.oldPos + oldPosInc,
          lastComponent: {
            count: last.count + 1,
            added,
            removed,
            previousComponent: last.previousComponent
          }
        };
      } else {
        return {
          oldPos: path.oldPos + oldPosInc,
          lastComponent: {
            count: 1,
            added,
            removed,
            previousComponent: last
          }
        };
      }
    },
    extractCommon: function extractCommon(basePath, newString, oldString, diagonalPath, options) {
      var newLen = newString.length, oldLen = oldString.length, oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
      while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldString[oldPos + 1], newString[newPos + 1], options)) {
        newPos++;
        oldPos++;
        commonCount++;
        if (options.oneChangePerToken) {
          basePath.lastComponent = {
            count: 1,
            previousComponent: basePath.lastComponent,
            added: false,
            removed: false
          };
        }
      }
      if (commonCount && !options.oneChangePerToken) {
        basePath.lastComponent = {
          count: commonCount,
          previousComponent: basePath.lastComponent,
          added: false,
          removed: false
        };
      }
      basePath.oldPos = oldPos;
      return newPos;
    },
    equals: function equals(left, right, options) {
      if (options.comparator) {
        return options.comparator(left, right);
      } else {
        return left === right || options.ignoreCase && left.toLowerCase() === right.toLowerCase();
      }
    },
    removeEmpty: function removeEmpty(array) {
      var ret = [];
      for (var i = 0;i < array.length; i++) {
        if (array[i]) {
          ret.push(array[i]);
        }
      }
      return ret;
    },
    castInput: function castInput(value) {
      return value;
    },
    tokenize: function tokenize(value) {
      return Array.from(value);
    },
    join: function join(chars) {
      return chars.join("");
    },
    postProcess: function postProcess(changeObjects) {
      return changeObjects;
    }
  };
  function buildValues(diff, lastComponent, newString, oldString, useLongestToken) {
    var components = [];
    var nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    var componentPos = 0, componentLen = components.length, newPos = 0, oldPos = 0;
    for (;componentPos < componentLen; componentPos++) {
      var component = components[componentPos];
      if (!component.removed) {
        if (!component.added && useLongestToken) {
          var value = newString.slice(newPos, newPos + component.count);
          value = value.map(function(value, i) {
            var oldValue = oldString[oldPos + i];
            return oldValue.length > value.length ? oldValue : value;
          });
          component.value = diff.join(value);
        } else {
          component.value = diff.join(newString.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = diff.join(oldString.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
});

// node_modules/diff/lib/diff/character.js
var require_character = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.characterDiff = undefined;
  exports.diffChars = diffChars;
  var _base = _interopRequireDefault(require_base());
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  var characterDiff = exports.characterDiff = new _base["default"];
  function diffChars(oldStr, newStr, options) {
    return characterDiff.diff(oldStr, newStr, options);
  }
});

// node_modules/diff/lib/util/string.js
var require_string = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.hasOnlyUnixLineEndings = hasOnlyUnixLineEndings;
  exports.hasOnlyWinLineEndings = hasOnlyWinLineEndings;
  exports.longestCommonPrefix = longestCommonPrefix;
  exports.longestCommonSuffix = longestCommonSuffix;
  exports.maximumOverlap = maximumOverlap;
  exports.removePrefix = removePrefix;
  exports.removeSuffix = removeSuffix;
  exports.replacePrefix = replacePrefix;
  exports.replaceSuffix = replaceSuffix;
  function longestCommonPrefix(str1, str2) {
    var i;
    for (i = 0;i < str1.length && i < str2.length; i++) {
      if (str1[i] != str2[i]) {
        return str1.slice(0, i);
      }
    }
    return str1.slice(0, i);
  }
  function longestCommonSuffix(str1, str2) {
    var i;
    if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) {
      return "";
    }
    for (i = 0;i < str1.length && i < str2.length; i++) {
      if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) {
        return str1.slice(-i);
      }
    }
    return str1.slice(-i);
  }
  function replacePrefix(string, oldPrefix, newPrefix) {
    if (string.slice(0, oldPrefix.length) != oldPrefix) {
      throw Error("string ".concat(JSON.stringify(string), " doesn't start with prefix ").concat(JSON.stringify(oldPrefix), "; this is a bug"));
    }
    return newPrefix + string.slice(oldPrefix.length);
  }
  function replaceSuffix(string, oldSuffix, newSuffix) {
    if (!oldSuffix) {
      return string + newSuffix;
    }
    if (string.slice(-oldSuffix.length) != oldSuffix) {
      throw Error("string ".concat(JSON.stringify(string), " doesn't end with suffix ").concat(JSON.stringify(oldSuffix), "; this is a bug"));
    }
    return string.slice(0, -oldSuffix.length) + newSuffix;
  }
  function removePrefix(string, oldPrefix) {
    return replacePrefix(string, oldPrefix, "");
  }
  function removeSuffix(string, oldSuffix) {
    return replaceSuffix(string, oldSuffix, "");
  }
  function maximumOverlap(string1, string2) {
    return string2.slice(0, overlapCount(string1, string2));
  }
  function overlapCount(a, b) {
    var startA = 0;
    if (a.length > b.length) {
      startA = a.length - b.length;
    }
    var endB = b.length;
    if (a.length < b.length) {
      endB = a.length;
    }
    var map = Array(endB);
    var k = 0;
    map[0] = 0;
    for (var j = 1;j < endB; j++) {
      if (b[j] == b[k]) {
        map[j] = map[k];
      } else {
        map[j] = k;
      }
      while (k > 0 && b[j] != b[k]) {
        k = map[k];
      }
      if (b[j] == b[k]) {
        k++;
      }
    }
    k = 0;
    for (var i = startA;i < a.length; i++) {
      while (k > 0 && a[i] != b[k]) {
        k = map[k];
      }
      if (a[i] == b[k]) {
        k++;
      }
    }
    return k;
  }
  function hasOnlyWinLineEndings(string) {
    return string.includes(`\r
`) && !string.startsWith(`
`) && !string.match(/[^\r]\n/);
  }
  function hasOnlyUnixLineEndings(string) {
    return !string.includes(`\r
`) && string.includes(`
`);
  }
});

// node_modules/diff/lib/diff/word.js
var require_word = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.diffWords = diffWords;
  exports.diffWordsWithSpace = diffWordsWithSpace;
  exports.wordWithSpaceDiff = exports.wordDiff = undefined;
  var _base = _interopRequireDefault(require_base());
  var _string = require_string();
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  var extendedWordChars = "a-zA-Z0-9_\\u{C0}-\\u{FF}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
  var tokenizeIncludingWhitespace = new RegExp("[".concat(extendedWordChars, "]+|\\s+|[^").concat(extendedWordChars, "]"), "ug");
  var wordDiff = exports.wordDiff = new _base["default"];
  wordDiff.equals = function(left, right, options) {
    if (options.ignoreCase) {
      left = left.toLowerCase();
      right = right.toLowerCase();
    }
    return left.trim() === right.trim();
  };
  wordDiff.tokenize = function(value) {
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    var parts;
    if (options.intlSegmenter) {
      if (options.intlSegmenter.resolvedOptions().granularity != "word") {
        throw new Error('The segmenter passed must have a granularity of "word"');
      }
      parts = Array.from(options.intlSegmenter.segment(value), function(segment) {
        return segment.segment;
      });
    } else {
      parts = value.match(tokenizeIncludingWhitespace) || [];
    }
    var tokens = [];
    var prevPart = null;
    parts.forEach(function(part) {
      if (/\s/.test(part)) {
        if (prevPart == null) {
          tokens.push(part);
        } else {
          tokens.push(tokens.pop() + part);
        }
      } else if (/\s/.test(prevPart)) {
        if (tokens[tokens.length - 1] == prevPart) {
          tokens.push(tokens.pop() + part);
        } else {
          tokens.push(prevPart + part);
        }
      } else {
        tokens.push(part);
      }
      prevPart = part;
    });
    return tokens;
  };
  wordDiff.join = function(tokens) {
    return tokens.map(function(token, i) {
      if (i == 0) {
        return token;
      } else {
        return token.replace(/^\s+/, "");
      }
    }).join("");
  };
  wordDiff.postProcess = function(changes, options) {
    if (!changes || options.oneChangePerToken) {
      return changes;
    }
    var lastKeep = null;
    var insertion = null;
    var deletion = null;
    changes.forEach(function(change) {
      if (change.added) {
        insertion = change;
      } else if (change.removed) {
        deletion = change;
      } else {
        if (insertion || deletion) {
          dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change);
        }
        lastKeep = change;
        insertion = null;
        deletion = null;
      }
    });
    if (insertion || deletion) {
      dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null);
    }
    return changes;
  };
  function diffWords(oldStr, newStr, options) {
    if ((options === null || options === undefined ? undefined : options.ignoreWhitespace) != null && !options.ignoreWhitespace) {
      return diffWordsWithSpace(oldStr, newStr, options);
    }
    return wordDiff.diff(oldStr, newStr, options);
  }
  function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep) {
    if (deletion && insertion) {
      var oldWsPrefix = deletion.value.match(/^\s*/)[0];
      var oldWsSuffix = deletion.value.match(/\s*$/)[0];
      var newWsPrefix = insertion.value.match(/^\s*/)[0];
      var newWsSuffix = insertion.value.match(/\s*$/)[0];
      if (startKeep) {
        var commonWsPrefix = (0, _string.longestCommonPrefix)(oldWsPrefix, newWsPrefix);
        startKeep.value = (0, _string.replaceSuffix)(startKeep.value, newWsPrefix, commonWsPrefix);
        deletion.value = (0, _string.removePrefix)(deletion.value, commonWsPrefix);
        insertion.value = (0, _string.removePrefix)(insertion.value, commonWsPrefix);
      }
      if (endKeep) {
        var commonWsSuffix = (0, _string.longestCommonSuffix)(oldWsSuffix, newWsSuffix);
        endKeep.value = (0, _string.replacePrefix)(endKeep.value, newWsSuffix, commonWsSuffix);
        deletion.value = (0, _string.removeSuffix)(deletion.value, commonWsSuffix);
        insertion.value = (0, _string.removeSuffix)(insertion.value, commonWsSuffix);
      }
    } else if (insertion) {
      if (startKeep) {
        insertion.value = insertion.value.replace(/^\s*/, "");
      }
      if (endKeep) {
        endKeep.value = endKeep.value.replace(/^\s*/, "");
      }
    } else if (startKeep && endKeep) {
      var newWsFull = endKeep.value.match(/^\s*/)[0], delWsStart = deletion.value.match(/^\s*/)[0], delWsEnd = deletion.value.match(/\s*$/)[0];
      var newWsStart = (0, _string.longestCommonPrefix)(newWsFull, delWsStart);
      deletion.value = (0, _string.removePrefix)(deletion.value, newWsStart);
      var newWsEnd = (0, _string.longestCommonSuffix)((0, _string.removePrefix)(newWsFull, newWsStart), delWsEnd);
      deletion.value = (0, _string.removeSuffix)(deletion.value, newWsEnd);
      endKeep.value = (0, _string.replacePrefix)(endKeep.value, newWsFull, newWsEnd);
      startKeep.value = (0, _string.replaceSuffix)(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
    } else if (endKeep) {
      var endKeepWsPrefix = endKeep.value.match(/^\s*/)[0];
      var deletionWsSuffix = deletion.value.match(/\s*$/)[0];
      var overlap = (0, _string.maximumOverlap)(deletionWsSuffix, endKeepWsPrefix);
      deletion.value = (0, _string.removeSuffix)(deletion.value, overlap);
    } else if (startKeep) {
      var startKeepWsSuffix = startKeep.value.match(/\s*$/)[0];
      var deletionWsPrefix = deletion.value.match(/^\s*/)[0];
      var _overlap = (0, _string.maximumOverlap)(startKeepWsSuffix, deletionWsPrefix);
      deletion.value = (0, _string.removePrefix)(deletion.value, _overlap);
    }
  }
  var wordWithSpaceDiff = exports.wordWithSpaceDiff = new _base["default"];
  wordWithSpaceDiff.tokenize = function(value) {
    var regex = new RegExp("(\\r?\\n)|[".concat(extendedWordChars, "]+|[^\\S\\n\\r]+|[^").concat(extendedWordChars, "]"), "ug");
    return value.match(regex) || [];
  };
  function diffWordsWithSpace(oldStr, newStr, options) {
    return wordWithSpaceDiff.diff(oldStr, newStr, options);
  }
});

// node_modules/diff/lib/util/params.js
var require_params = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.generateOptions = generateOptions;
  function generateOptions(options, defaults) {
    if (typeof options === "function") {
      defaults.callback = options;
    } else if (options) {
      for (var name in options) {
        if (options.hasOwnProperty(name)) {
          defaults[name] = options[name];
        }
      }
    }
    return defaults;
  }
});

// node_modules/diff/lib/diff/line.js
var require_line = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.diffLines = diffLines;
  exports.diffTrimmedLines = diffTrimmedLines;
  exports.lineDiff = undefined;
  var _base = _interopRequireDefault(require_base());
  var _params = require_params();
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  var lineDiff = exports.lineDiff = new _base["default"];
  lineDiff.tokenize = function(value, options) {
    if (options.stripTrailingCr) {
      value = value.replace(/\r\n/g, `
`);
    }
    var retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
    if (!linesAndNewlines[linesAndNewlines.length - 1]) {
      linesAndNewlines.pop();
    }
    for (var i = 0;i < linesAndNewlines.length; i++) {
      var line = linesAndNewlines[i];
      if (i % 2 && !options.newlineIsToken) {
        retLines[retLines.length - 1] += line;
      } else {
        retLines.push(line);
      }
    }
    return retLines;
  };
  lineDiff.equals = function(left, right, options) {
    if (options.ignoreWhitespace) {
      if (!options.newlineIsToken || !left.includes(`
`)) {
        left = left.trim();
      }
      if (!options.newlineIsToken || !right.includes(`
`)) {
        right = right.trim();
      }
    } else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
      if (left.endsWith(`
`)) {
        left = left.slice(0, -1);
      }
      if (right.endsWith(`
`)) {
        right = right.slice(0, -1);
      }
    }
    return _base["default"].prototype.equals.call(this, left, right, options);
  };
  function diffLines(oldStr, newStr, callback) {
    return lineDiff.diff(oldStr, newStr, callback);
  }
  function diffTrimmedLines(oldStr, newStr, callback) {
    var options = (0, _params.generateOptions)(callback, {
      ignoreWhitespace: true
    });
    return lineDiff.diff(oldStr, newStr, options);
  }
});

// node_modules/diff/lib/diff/sentence.js
var require_sentence = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.diffSentences = diffSentences;
  exports.sentenceDiff = undefined;
  var _base = _interopRequireDefault(require_base());
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  var sentenceDiff = exports.sentenceDiff = new _base["default"];
  sentenceDiff.tokenize = function(value) {
    return value.split(/(\S.+?[.!?])(?=\s+|$)/);
  };
  function diffSentences(oldStr, newStr, callback) {
    return sentenceDiff.diff(oldStr, newStr, callback);
  }
});

// node_modules/diff/lib/diff/css.js
var require_css = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.cssDiff = undefined;
  exports.diffCss = diffCss;
  var _base = _interopRequireDefault(require_base());
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  var cssDiff = exports.cssDiff = new _base["default"];
  cssDiff.tokenize = function(value) {
    return value.split(/([{}:;,]|\s+)/);
  };
  function diffCss(oldStr, newStr, callback) {
    return cssDiff.diff(oldStr, newStr, callback);
  }
});

// node_modules/diff/lib/diff/json.js
var require_json = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.canonicalize = canonicalize;
  exports.diffJson = diffJson;
  exports.jsonDiff = undefined;
  var _base = _interopRequireDefault(require_base());
  var _line = require_line();
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o) {
      return typeof o;
    } : function(o) {
      return o && typeof Symbol == "function" && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
    }, _typeof(o);
  }
  var jsonDiff = exports.jsonDiff = new _base["default"];
  jsonDiff.useLongestToken = true;
  jsonDiff.tokenize = _line.lineDiff.tokenize;
  jsonDiff.castInput = function(value, options) {
    var { undefinedReplacement, stringifyReplacer: _options$stringifyRep } = options, stringifyReplacer = _options$stringifyRep === undefined ? function(k, v) {
      return typeof v === "undefined" ? undefinedReplacement : v;
    } : _options$stringifyRep;
    return typeof value === "string" ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), stringifyReplacer, "  ");
  };
  jsonDiff.equals = function(left, right, options) {
    return _base["default"].prototype.equals.call(jsonDiff, left.replace(/,([\r\n])/g, "$1"), right.replace(/,([\r\n])/g, "$1"), options);
  };
  function diffJson(oldObj, newObj, options) {
    return jsonDiff.diff(oldObj, newObj, options);
  }
  function canonicalize(obj, stack, replacementStack, replacer, key) {
    stack = stack || [];
    replacementStack = replacementStack || [];
    if (replacer) {
      obj = replacer(key, obj);
    }
    var i;
    for (i = 0;i < stack.length; i += 1) {
      if (stack[i] === obj) {
        return replacementStack[i];
      }
    }
    var canonicalizedObj;
    if (Object.prototype.toString.call(obj) === "[object Array]") {
      stack.push(obj);
      canonicalizedObj = new Array(obj.length);
      replacementStack.push(canonicalizedObj);
      for (i = 0;i < obj.length; i += 1) {
        canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, key);
      }
      stack.pop();
      replacementStack.pop();
      return canonicalizedObj;
    }
    if (obj && obj.toJSON) {
      obj = obj.toJSON();
    }
    if (_typeof(obj) === "object" && obj !== null) {
      stack.push(obj);
      canonicalizedObj = {};
      replacementStack.push(canonicalizedObj);
      var sortedKeys = [], _key;
      for (_key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, _key)) {
          sortedKeys.push(_key);
        }
      }
      sortedKeys.sort();
      for (i = 0;i < sortedKeys.length; i += 1) {
        _key = sortedKeys[i];
        canonicalizedObj[_key] = canonicalize(obj[_key], stack, replacementStack, replacer, _key);
      }
      stack.pop();
      replacementStack.pop();
    } else {
      canonicalizedObj = obj;
    }
    return canonicalizedObj;
  }
});

// node_modules/diff/lib/diff/array.js
var require_array = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.arrayDiff = undefined;
  exports.diffArrays = diffArrays;
  var _base = _interopRequireDefault(require_base());
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  var arrayDiff = exports.arrayDiff = new _base["default"];
  arrayDiff.tokenize = function(value) {
    return value.slice();
  };
  arrayDiff.join = arrayDiff.removeEmpty = function(value) {
    return value;
  };
  function diffArrays(oldArr, newArr, callback) {
    return arrayDiff.diff(oldArr, newArr, callback);
  }
});

// node_modules/diff/lib/patch/line-endings.js
var require_line_endings = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.isUnix = isUnix;
  exports.isWin = isWin;
  exports.unixToWin = unixToWin;
  exports.winToUnix = winToUnix;
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o) {
      return typeof o;
    } : function(o) {
      return o && typeof Symbol == "function" && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
    }, _typeof(o);
  }
  function ownKeys(e, r) {
    var t = Object.keys(e);
    if (Object.getOwnPropertySymbols) {
      var o = Object.getOwnPropertySymbols(e);
      r && (o = o.filter(function(r) {
        return Object.getOwnPropertyDescriptor(e, r).enumerable;
      })), t.push.apply(t, o);
    }
    return t;
  }
  function _objectSpread(e) {
    for (var r = 1;r < arguments.length; r++) {
      var t = arguments[r] != null ? arguments[r] : {};
      r % 2 ? ownKeys(Object(t), true).forEach(function(r) {
        _defineProperty(e, r, t[r]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
        Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
      });
    }
    return e;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return _typeof(i) == "symbol" ? i : i + "";
  }
  function _toPrimitive(t, r) {
    if (_typeof(t) != "object" || !t)
      return t;
    var e = t[Symbol.toPrimitive];
    if (e !== undefined) {
      var i = e.call(t, r || "default");
      if (_typeof(i) != "object")
        return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (r === "string" ? String : Number)(t);
  }
  function unixToWin(patch) {
    if (Array.isArray(patch)) {
      return patch.map(unixToWin);
    }
    return _objectSpread(_objectSpread({}, patch), {}, {
      hunks: patch.hunks.map(function(hunk) {
        return _objectSpread(_objectSpread({}, hunk), {}, {
          lines: hunk.lines.map(function(line, i) {
            var _hunk$lines;
            return line.startsWith("\\") || line.endsWith("\r") || (_hunk$lines = hunk.lines[i + 1]) !== null && _hunk$lines !== undefined && _hunk$lines.startsWith("\\") ? line : line + "\r";
          })
        });
      })
    });
  }
  function winToUnix(patch) {
    if (Array.isArray(patch)) {
      return patch.map(winToUnix);
    }
    return _objectSpread(_objectSpread({}, patch), {}, {
      hunks: patch.hunks.map(function(hunk) {
        return _objectSpread(_objectSpread({}, hunk), {}, {
          lines: hunk.lines.map(function(line) {
            return line.endsWith("\r") ? line.substring(0, line.length - 1) : line;
          })
        });
      })
    });
  }
  function isUnix(patch) {
    if (!Array.isArray(patch)) {
      patch = [patch];
    }
    return !patch.some(function(index) {
      return index.hunks.some(function(hunk) {
        return hunk.lines.some(function(line) {
          return !line.startsWith("\\") && line.endsWith("\r");
        });
      });
    });
  }
  function isWin(patch) {
    if (!Array.isArray(patch)) {
      patch = [patch];
    }
    return patch.some(function(index) {
      return index.hunks.some(function(hunk) {
        return hunk.lines.some(function(line) {
          return line.endsWith("\r");
        });
      });
    }) && patch.every(function(index) {
      return index.hunks.every(function(hunk) {
        return hunk.lines.every(function(line, i) {
          var _hunk$lines2;
          return line.startsWith("\\") || line.endsWith("\r") || ((_hunk$lines2 = hunk.lines[i + 1]) === null || _hunk$lines2 === undefined ? undefined : _hunk$lines2.startsWith("\\"));
        });
      });
    });
  }
});

// node_modules/diff/lib/patch/parse.js
var require_parse = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.parsePatch = parsePatch;
  function parsePatch(uniDiff) {
    var diffstr = uniDiff.split(/\n/), list = [], i = 0;
    function parseIndex() {
      var index = {};
      list.push(index);
      while (i < diffstr.length) {
        var line = diffstr[i];
        if (/^(\-\-\-|\+\+\+|@@)\s/.test(line)) {
          break;
        }
        var header = /^(?:Index:|diff(?: -r \w+)+)\s+(.+?)\s*$/.exec(line);
        if (header) {
          index.index = header[1];
        }
        i++;
      }
      parseFileHeader(index);
      parseFileHeader(index);
      index.hunks = [];
      while (i < diffstr.length) {
        var _line = diffstr[i];
        if (/^(Index:\s|diff\s|\-\-\-\s|\+\+\+\s|===================================================================)/.test(_line)) {
          break;
        } else if (/^@@/.test(_line)) {
          index.hunks.push(parseHunk());
        } else if (_line) {
          throw new Error("Unknown line " + (i + 1) + " " + JSON.stringify(_line));
        } else {
          i++;
        }
      }
    }
    function parseFileHeader(index) {
      var fileHeader = /^(---|\+\+\+)\s+(.*)\r?$/.exec(diffstr[i]);
      if (fileHeader) {
        var keyPrefix = fileHeader[1] === "---" ? "old" : "new";
        var data = fileHeader[2].split("\t", 2);
        var fileName = data[0].replace(/\\\\/g, "\\");
        if (/^".*"$/.test(fileName)) {
          fileName = fileName.substr(1, fileName.length - 2);
        }
        index[keyPrefix + "FileName"] = fileName;
        index[keyPrefix + "Header"] = (data[1] || "").trim();
        i++;
      }
    }
    function parseHunk() {
      var chunkHeaderIndex = i, chunkHeaderLine = diffstr[i++], chunkHeader = chunkHeaderLine.split(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      var hunk = {
        oldStart: +chunkHeader[1],
        oldLines: typeof chunkHeader[2] === "undefined" ? 1 : +chunkHeader[2],
        newStart: +chunkHeader[3],
        newLines: typeof chunkHeader[4] === "undefined" ? 1 : +chunkHeader[4],
        lines: []
      };
      if (hunk.oldLines === 0) {
        hunk.oldStart += 1;
      }
      if (hunk.newLines === 0) {
        hunk.newStart += 1;
      }
      var addCount = 0, removeCount = 0;
      for (;i < diffstr.length && (removeCount < hunk.oldLines || addCount < hunk.newLines || (_diffstr$i = diffstr[i]) !== null && _diffstr$i !== undefined && _diffstr$i.startsWith("\\")); i++) {
        var _diffstr$i;
        var operation = diffstr[i].length == 0 && i != diffstr.length - 1 ? " " : diffstr[i][0];
        if (operation === "+" || operation === "-" || operation === " " || operation === "\\") {
          hunk.lines.push(diffstr[i]);
          if (operation === "+") {
            addCount++;
          } else if (operation === "-") {
            removeCount++;
          } else if (operation === " ") {
            addCount++;
            removeCount++;
          }
        } else {
          throw new Error("Hunk at line ".concat(chunkHeaderIndex + 1, " contained invalid line ").concat(diffstr[i]));
        }
      }
      if (!addCount && hunk.newLines === 1) {
        hunk.newLines = 0;
      }
      if (!removeCount && hunk.oldLines === 1) {
        hunk.oldLines = 0;
      }
      if (addCount !== hunk.newLines) {
        throw new Error("Added line count did not match for hunk at line " + (chunkHeaderIndex + 1));
      }
      if (removeCount !== hunk.oldLines) {
        throw new Error("Removed line count did not match for hunk at line " + (chunkHeaderIndex + 1));
      }
      return hunk;
    }
    while (i < diffstr.length) {
      parseIndex();
    }
    return list;
  }
});

// node_modules/diff/lib/util/distance-iterator.js
var require_distance_iterator = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = _default;
  function _default(start, minLine, maxLine) {
    var wantForward = true, backwardExhausted = false, forwardExhausted = false, localOffset = 1;
    return function iterator() {
      if (wantForward && !forwardExhausted) {
        if (backwardExhausted) {
          localOffset++;
        } else {
          wantForward = false;
        }
        if (start + localOffset <= maxLine) {
          return start + localOffset;
        }
        forwardExhausted = true;
      }
      if (!backwardExhausted) {
        if (!forwardExhausted) {
          wantForward = true;
        }
        if (minLine <= start - localOffset) {
          return start - localOffset++;
        }
        backwardExhausted = true;
        return iterator();
      }
    };
  }
});

// node_modules/diff/lib/patch/apply.js
var require_apply = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.applyPatch = applyPatch;
  exports.applyPatches = applyPatches;
  var _string = require_string();
  var _lineEndings = require_line_endings();
  var _parse = require_parse();
  var _distanceIterator = _interopRequireDefault(require_distance_iterator());
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function applyPatch(source, uniDiff) {
    var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    if (typeof uniDiff === "string") {
      uniDiff = (0, _parse.parsePatch)(uniDiff);
    }
    if (Array.isArray(uniDiff)) {
      if (uniDiff.length > 1) {
        throw new Error("applyPatch only works with a single input.");
      }
      uniDiff = uniDiff[0];
    }
    if (options.autoConvertLineEndings || options.autoConvertLineEndings == null) {
      if ((0, _string.hasOnlyWinLineEndings)(source) && (0, _lineEndings.isUnix)(uniDiff)) {
        uniDiff = (0, _lineEndings.unixToWin)(uniDiff);
      } else if ((0, _string.hasOnlyUnixLineEndings)(source) && (0, _lineEndings.isWin)(uniDiff)) {
        uniDiff = (0, _lineEndings.winToUnix)(uniDiff);
      }
    }
    var lines = source.split(`
`), hunks = uniDiff.hunks, compareLine = options.compareLine || function(lineNumber, line, operation, patchContent) {
      return line === patchContent;
    }, fuzzFactor = options.fuzzFactor || 0, minLine = 0;
    if (fuzzFactor < 0 || !Number.isInteger(fuzzFactor)) {
      throw new Error("fuzzFactor must be a non-negative integer");
    }
    if (!hunks.length) {
      return source;
    }
    var prevLine = "", removeEOFNL = false, addEOFNL = false;
    for (var i = 0;i < hunks[hunks.length - 1].lines.length; i++) {
      var line = hunks[hunks.length - 1].lines[i];
      if (line[0] == "\\") {
        if (prevLine[0] == "+") {
          removeEOFNL = true;
        } else if (prevLine[0] == "-") {
          addEOFNL = true;
        }
      }
      prevLine = line;
    }
    if (removeEOFNL) {
      if (addEOFNL) {
        if (!fuzzFactor && lines[lines.length - 1] == "") {
          return false;
        }
      } else if (lines[lines.length - 1] == "") {
        lines.pop();
      } else if (!fuzzFactor) {
        return false;
      }
    } else if (addEOFNL) {
      if (lines[lines.length - 1] != "") {
        lines.push("");
      } else if (!fuzzFactor) {
        return false;
      }
    }
    function applyHunk(hunkLines, toPos, maxErrors) {
      var hunkLinesI = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;
      var lastContextLineMatched = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : true;
      var patchedLines = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : [];
      var patchedLinesLength = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : 0;
      var nConsecutiveOldContextLines = 0;
      var nextContextLineMustMatch = false;
      for (;hunkLinesI < hunkLines.length; hunkLinesI++) {
        var hunkLine = hunkLines[hunkLinesI], operation = hunkLine.length > 0 ? hunkLine[0] : " ", content = hunkLine.length > 0 ? hunkLine.substr(1) : hunkLine;
        if (operation === "-") {
          if (compareLine(toPos + 1, lines[toPos], operation, content)) {
            toPos++;
            nConsecutiveOldContextLines = 0;
          } else {
            if (!maxErrors || lines[toPos] == null) {
              return null;
            }
            patchedLines[patchedLinesLength] = lines[toPos];
            return applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1);
          }
        }
        if (operation === "+") {
          if (!lastContextLineMatched) {
            return null;
          }
          patchedLines[patchedLinesLength] = content;
          patchedLinesLength++;
          nConsecutiveOldContextLines = 0;
          nextContextLineMustMatch = true;
        }
        if (operation === " ") {
          nConsecutiveOldContextLines++;
          patchedLines[patchedLinesLength] = lines[toPos];
          if (compareLine(toPos + 1, lines[toPos], operation, content)) {
            patchedLinesLength++;
            lastContextLineMatched = true;
            nextContextLineMustMatch = false;
            toPos++;
          } else {
            if (nextContextLineMustMatch || !maxErrors) {
              return null;
            }
            return lines[toPos] && (applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength + 1) || applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1)) || applyHunk(hunkLines, toPos, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength);
          }
        }
      }
      patchedLinesLength -= nConsecutiveOldContextLines;
      toPos -= nConsecutiveOldContextLines;
      patchedLines.length = patchedLinesLength;
      return {
        patchedLines,
        oldLineLastI: toPos - 1
      };
    }
    var resultLines = [];
    var prevHunkOffset = 0;
    for (var _i = 0;_i < hunks.length; _i++) {
      var hunk = hunks[_i];
      var hunkResult = undefined;
      var maxLine = lines.length - hunk.oldLines + fuzzFactor;
      var toPos = undefined;
      for (var maxErrors = 0;maxErrors <= fuzzFactor; maxErrors++) {
        toPos = hunk.oldStart + prevHunkOffset - 1;
        var iterator = (0, _distanceIterator["default"])(toPos, minLine, maxLine);
        for (;toPos !== undefined; toPos = iterator()) {
          hunkResult = applyHunk(hunk.lines, toPos, maxErrors);
          if (hunkResult) {
            break;
          }
        }
        if (hunkResult) {
          break;
        }
      }
      if (!hunkResult) {
        return false;
      }
      for (var _i2 = minLine;_i2 < toPos; _i2++) {
        resultLines.push(lines[_i2]);
      }
      for (var _i3 = 0;_i3 < hunkResult.patchedLines.length; _i3++) {
        var _line = hunkResult.patchedLines[_i3];
        resultLines.push(_line);
      }
      minLine = hunkResult.oldLineLastI + 1;
      prevHunkOffset = toPos + 1 - hunk.oldStart;
    }
    for (var _i4 = minLine;_i4 < lines.length; _i4++) {
      resultLines.push(lines[_i4]);
    }
    return resultLines.join(`
`);
  }
  function applyPatches(uniDiff, options) {
    if (typeof uniDiff === "string") {
      uniDiff = (0, _parse.parsePatch)(uniDiff);
    }
    var currentIndex = 0;
    function processIndex() {
      var index = uniDiff[currentIndex++];
      if (!index) {
        return options.complete();
      }
      options.loadFile(index, function(err, data) {
        if (err) {
          return options.complete(err);
        }
        var updatedContent = applyPatch(data, index, options);
        options.patched(index, updatedContent, function(err) {
          if (err) {
            return options.complete(err);
          }
          processIndex();
        });
      });
    }
    processIndex();
  }
});

// node_modules/diff/lib/patch/create.js
var require_create = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.createPatch = createPatch;
  exports.createTwoFilesPatch = createTwoFilesPatch;
  exports.formatPatch = formatPatch;
  exports.structuredPatch = structuredPatch;
  var _line = require_line();
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o) {
      return typeof o;
    } : function(o) {
      return o && typeof Symbol == "function" && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
    }, _typeof(o);
  }
  function _toConsumableArray(arr) {
    return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
  }
  function _nonIterableSpread() {
    throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
  }
  function _unsupportedIterableToArray(o, minLen) {
    if (!o)
      return;
    if (typeof o === "string")
      return _arrayLikeToArray(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor)
      n = o.constructor.name;
    if (n === "Map" || n === "Set")
      return Array.from(o);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))
      return _arrayLikeToArray(o, minLen);
  }
  function _iterableToArray(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null)
      return Array.from(iter);
  }
  function _arrayWithoutHoles(arr) {
    if (Array.isArray(arr))
      return _arrayLikeToArray(arr);
  }
  function _arrayLikeToArray(arr, len) {
    if (len == null || len > arr.length)
      len = arr.length;
    for (var i = 0, arr2 = new Array(len);i < len; i++)
      arr2[i] = arr[i];
    return arr2;
  }
  function ownKeys(e, r) {
    var t = Object.keys(e);
    if (Object.getOwnPropertySymbols) {
      var o = Object.getOwnPropertySymbols(e);
      r && (o = o.filter(function(r) {
        return Object.getOwnPropertyDescriptor(e, r).enumerable;
      })), t.push.apply(t, o);
    }
    return t;
  }
  function _objectSpread(e) {
    for (var r = 1;r < arguments.length; r++) {
      var t = arguments[r] != null ? arguments[r] : {};
      r % 2 ? ownKeys(Object(t), true).forEach(function(r) {
        _defineProperty(e, r, t[r]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
        Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
      });
    }
    return e;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return _typeof(i) == "symbol" ? i : i + "";
  }
  function _toPrimitive(t, r) {
    if (_typeof(t) != "object" || !t)
      return t;
    var e = t[Symbol.toPrimitive];
    if (e !== undefined) {
      var i = e.call(t, r || "default");
      if (_typeof(i) != "object")
        return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (r === "string" ? String : Number)(t);
  }
  function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
    if (!options) {
      options = {};
    }
    if (typeof options === "function") {
      options = {
        callback: options
      };
    }
    if (typeof options.context === "undefined") {
      options.context = 4;
    }
    if (options.newlineIsToken) {
      throw new Error("newlineIsToken may not be used with patch-generation functions, only with diffing functions");
    }
    if (!options.callback) {
      return diffLinesResultToPatch((0, _line.diffLines)(oldStr, newStr, options));
    } else {
      var _options = options, _callback = _options.callback;
      (0, _line.diffLines)(oldStr, newStr, _objectSpread(_objectSpread({}, options), {}, {
        callback: function callback(diff) {
          var patch = diffLinesResultToPatch(diff);
          _callback(patch);
        }
      }));
    }
    function diffLinesResultToPatch(diff) {
      if (!diff) {
        return;
      }
      diff.push({
        value: "",
        lines: []
      });
      function contextLines(lines) {
        return lines.map(function(entry) {
          return " " + entry;
        });
      }
      var hunks = [];
      var oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
      var _loop = function _loop() {
        var current = diff[i], lines = current.lines || splitLines(current.value);
        current.lines = lines;
        if (current.added || current.removed) {
          var _curRange;
          if (!oldRangeStart) {
            var prev = diff[i - 1];
            oldRangeStart = oldLine;
            newRangeStart = newLine;
            if (prev) {
              curRange = options.context > 0 ? contextLines(prev.lines.slice(-options.context)) : [];
              oldRangeStart -= curRange.length;
              newRangeStart -= curRange.length;
            }
          }
          (_curRange = curRange).push.apply(_curRange, _toConsumableArray(lines.map(function(entry) {
            return (current.added ? "+" : "-") + entry;
          })));
          if (current.added) {
            newLine += lines.length;
          } else {
            oldLine += lines.length;
          }
        } else {
          if (oldRangeStart) {
            if (lines.length <= options.context * 2 && i < diff.length - 2) {
              var _curRange2;
              (_curRange2 = curRange).push.apply(_curRange2, _toConsumableArray(contextLines(lines)));
            } else {
              var _curRange3;
              var contextSize = Math.min(lines.length, options.context);
              (_curRange3 = curRange).push.apply(_curRange3, _toConsumableArray(contextLines(lines.slice(0, contextSize))));
              var _hunk = {
                oldStart: oldRangeStart,
                oldLines: oldLine - oldRangeStart + contextSize,
                newStart: newRangeStart,
                newLines: newLine - newRangeStart + contextSize,
                lines: curRange
              };
              hunks.push(_hunk);
              oldRangeStart = 0;
              newRangeStart = 0;
              curRange = [];
            }
          }
          oldLine += lines.length;
          newLine += lines.length;
        }
      };
      for (var i = 0;i < diff.length; i++) {
        _loop();
      }
      for (var _i = 0, _hunks = hunks;_i < _hunks.length; _i++) {
        var hunk = _hunks[_i];
        for (var _i2 = 0;_i2 < hunk.lines.length; _i2++) {
          if (hunk.lines[_i2].endsWith(`
`)) {
            hunk.lines[_i2] = hunk.lines[_i2].slice(0, -1);
          } else {
            hunk.lines.splice(_i2 + 1, 0, "\\ No newline at end of file");
            _i2++;
          }
        }
      }
      return {
        oldFileName,
        newFileName,
        oldHeader,
        newHeader,
        hunks
      };
    }
  }
  function formatPatch(diff) {
    if (Array.isArray(diff)) {
      return diff.map(formatPatch).join(`
`);
    }
    var ret = [];
    if (diff.oldFileName == diff.newFileName) {
      ret.push("Index: " + diff.oldFileName);
    }
    ret.push("===================================================================");
    ret.push("--- " + diff.oldFileName + (typeof diff.oldHeader === "undefined" ? "" : "\t" + diff.oldHeader));
    ret.push("+++ " + diff.newFileName + (typeof diff.newHeader === "undefined" ? "" : "\t" + diff.newHeader));
    for (var i = 0;i < diff.hunks.length; i++) {
      var hunk = diff.hunks[i];
      if (hunk.oldLines === 0) {
        hunk.oldStart -= 1;
      }
      if (hunk.newLines === 0) {
        hunk.newStart -= 1;
      }
      ret.push("@@ -" + hunk.oldStart + "," + hunk.oldLines + " +" + hunk.newStart + "," + hunk.newLines + " @@");
      ret.push.apply(ret, hunk.lines);
    }
    return ret.join(`
`) + `
`;
  }
  function createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
    var _options2;
    if (typeof options === "function") {
      options = {
        callback: options
      };
    }
    if (!((_options2 = options) !== null && _options2 !== undefined && _options2.callback)) {
      var patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
      if (!patchObj) {
        return;
      }
      return formatPatch(patchObj);
    } else {
      var _options3 = options, _callback2 = _options3.callback;
      structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, _objectSpread(_objectSpread({}, options), {}, {
        callback: function callback(patchObj) {
          if (!patchObj) {
            _callback2();
          } else {
            _callback2(formatPatch(patchObj));
          }
        }
      }));
    }
  }
  function createPatch(fileName, oldStr, newStr, oldHeader, newHeader, options) {
    return createTwoFilesPatch(fileName, fileName, oldStr, newStr, oldHeader, newHeader, options);
  }
  function splitLines(text) {
    var hasTrailingNl = text.endsWith(`
`);
    var result = text.split(`
`).map(function(line) {
      return line + `
`;
    });
    if (hasTrailingNl) {
      result.pop();
    } else {
      result.push(result.pop().slice(0, -1));
    }
    return result;
  }
});

// node_modules/diff/lib/util/array.js
var require_array2 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.arrayEqual = arrayEqual;
  exports.arrayStartsWith = arrayStartsWith;
  function arrayEqual(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    return arrayStartsWith(a, b);
  }
  function arrayStartsWith(array, start) {
    if (start.length > array.length) {
      return false;
    }
    for (var i = 0;i < start.length; i++) {
      if (start[i] !== array[i]) {
        return false;
      }
    }
    return true;
  }
});

// node_modules/diff/lib/patch/merge.js
var require_merge = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.calcLineCount = calcLineCount;
  exports.merge = merge;
  var _create = require_create();
  var _parse = require_parse();
  var _array = require_array2();
  function _toConsumableArray(arr) {
    return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
  }
  function _nonIterableSpread() {
    throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
  }
  function _unsupportedIterableToArray(o, minLen) {
    if (!o)
      return;
    if (typeof o === "string")
      return _arrayLikeToArray(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor)
      n = o.constructor.name;
    if (n === "Map" || n === "Set")
      return Array.from(o);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))
      return _arrayLikeToArray(o, minLen);
  }
  function _iterableToArray(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null)
      return Array.from(iter);
  }
  function _arrayWithoutHoles(arr) {
    if (Array.isArray(arr))
      return _arrayLikeToArray(arr);
  }
  function _arrayLikeToArray(arr, len) {
    if (len == null || len > arr.length)
      len = arr.length;
    for (var i = 0, arr2 = new Array(len);i < len; i++)
      arr2[i] = arr[i];
    return arr2;
  }
  function calcLineCount(hunk) {
    var _calcOldNewLineCount = calcOldNewLineCount(hunk.lines), { oldLines, newLines } = _calcOldNewLineCount;
    if (oldLines !== undefined) {
      hunk.oldLines = oldLines;
    } else {
      delete hunk.oldLines;
    }
    if (newLines !== undefined) {
      hunk.newLines = newLines;
    } else {
      delete hunk.newLines;
    }
  }
  function merge(mine, theirs, base) {
    mine = loadPatch(mine, base);
    theirs = loadPatch(theirs, base);
    var ret = {};
    if (mine.index || theirs.index) {
      ret.index = mine.index || theirs.index;
    }
    if (mine.newFileName || theirs.newFileName) {
      if (!fileNameChanged(mine)) {
        ret.oldFileName = theirs.oldFileName || mine.oldFileName;
        ret.newFileName = theirs.newFileName || mine.newFileName;
        ret.oldHeader = theirs.oldHeader || mine.oldHeader;
        ret.newHeader = theirs.newHeader || mine.newHeader;
      } else if (!fileNameChanged(theirs)) {
        ret.oldFileName = mine.oldFileName;
        ret.newFileName = mine.newFileName;
        ret.oldHeader = mine.oldHeader;
        ret.newHeader = mine.newHeader;
      } else {
        ret.oldFileName = selectField(ret, mine.oldFileName, theirs.oldFileName);
        ret.newFileName = selectField(ret, mine.newFileName, theirs.newFileName);
        ret.oldHeader = selectField(ret, mine.oldHeader, theirs.oldHeader);
        ret.newHeader = selectField(ret, mine.newHeader, theirs.newHeader);
      }
    }
    ret.hunks = [];
    var mineIndex = 0, theirsIndex = 0, mineOffset = 0, theirsOffset = 0;
    while (mineIndex < mine.hunks.length || theirsIndex < theirs.hunks.length) {
      var mineCurrent = mine.hunks[mineIndex] || {
        oldStart: Infinity
      }, theirsCurrent = theirs.hunks[theirsIndex] || {
        oldStart: Infinity
      };
      if (hunkBefore(mineCurrent, theirsCurrent)) {
        ret.hunks.push(cloneHunk(mineCurrent, mineOffset));
        mineIndex++;
        theirsOffset += mineCurrent.newLines - mineCurrent.oldLines;
      } else if (hunkBefore(theirsCurrent, mineCurrent)) {
        ret.hunks.push(cloneHunk(theirsCurrent, theirsOffset));
        theirsIndex++;
        mineOffset += theirsCurrent.newLines - theirsCurrent.oldLines;
      } else {
        var mergedHunk = {
          oldStart: Math.min(mineCurrent.oldStart, theirsCurrent.oldStart),
          oldLines: 0,
          newStart: Math.min(mineCurrent.newStart + mineOffset, theirsCurrent.oldStart + theirsOffset),
          newLines: 0,
          lines: []
        };
        mergeLines(mergedHunk, mineCurrent.oldStart, mineCurrent.lines, theirsCurrent.oldStart, theirsCurrent.lines);
        theirsIndex++;
        mineIndex++;
        ret.hunks.push(mergedHunk);
      }
    }
    return ret;
  }
  function loadPatch(param, base) {
    if (typeof param === "string") {
      if (/^@@/m.test(param) || /^Index:/m.test(param)) {
        return (0, _parse.parsePatch)(param)[0];
      }
      if (!base) {
        throw new Error("Must provide a base reference or pass in a patch");
      }
      return (0, _create.structuredPatch)(undefined, undefined, base, param);
    }
    return param;
  }
  function fileNameChanged(patch) {
    return patch.newFileName && patch.newFileName !== patch.oldFileName;
  }
  function selectField(index, mine, theirs) {
    if (mine === theirs) {
      return mine;
    } else {
      index.conflict = true;
      return {
        mine,
        theirs
      };
    }
  }
  function hunkBefore(test, check) {
    return test.oldStart < check.oldStart && test.oldStart + test.oldLines < check.oldStart;
  }
  function cloneHunk(hunk, offset) {
    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart + offset,
      newLines: hunk.newLines,
      lines: hunk.lines
    };
  }
  function mergeLines(hunk, mineOffset, mineLines, theirOffset, theirLines) {
    var mine = {
      offset: mineOffset,
      lines: mineLines,
      index: 0
    }, their = {
      offset: theirOffset,
      lines: theirLines,
      index: 0
    };
    insertLeading(hunk, mine, their);
    insertLeading(hunk, their, mine);
    while (mine.index < mine.lines.length && their.index < their.lines.length) {
      var mineCurrent = mine.lines[mine.index], theirCurrent = their.lines[their.index];
      if ((mineCurrent[0] === "-" || mineCurrent[0] === "+") && (theirCurrent[0] === "-" || theirCurrent[0] === "+")) {
        mutualChange(hunk, mine, their);
      } else if (mineCurrent[0] === "+" && theirCurrent[0] === " ") {
        var _hunk$lines;
        (_hunk$lines = hunk.lines).push.apply(_hunk$lines, _toConsumableArray(collectChange(mine)));
      } else if (theirCurrent[0] === "+" && mineCurrent[0] === " ") {
        var _hunk$lines2;
        (_hunk$lines2 = hunk.lines).push.apply(_hunk$lines2, _toConsumableArray(collectChange(their)));
      } else if (mineCurrent[0] === "-" && theirCurrent[0] === " ") {
        removal(hunk, mine, their);
      } else if (theirCurrent[0] === "-" && mineCurrent[0] === " ") {
        removal(hunk, their, mine, true);
      } else if (mineCurrent === theirCurrent) {
        hunk.lines.push(mineCurrent);
        mine.index++;
        their.index++;
      } else {
        conflict(hunk, collectChange(mine), collectChange(their));
      }
    }
    insertTrailing(hunk, mine);
    insertTrailing(hunk, their);
    calcLineCount(hunk);
  }
  function mutualChange(hunk, mine, their) {
    var myChanges = collectChange(mine), theirChanges = collectChange(their);
    if (allRemoves(myChanges) && allRemoves(theirChanges)) {
      if ((0, _array.arrayStartsWith)(myChanges, theirChanges) && skipRemoveSuperset(their, myChanges, myChanges.length - theirChanges.length)) {
        var _hunk$lines3;
        (_hunk$lines3 = hunk.lines).push.apply(_hunk$lines3, _toConsumableArray(myChanges));
        return;
      } else if ((0, _array.arrayStartsWith)(theirChanges, myChanges) && skipRemoveSuperset(mine, theirChanges, theirChanges.length - myChanges.length)) {
        var _hunk$lines4;
        (_hunk$lines4 = hunk.lines).push.apply(_hunk$lines4, _toConsumableArray(theirChanges));
        return;
      }
    } else if ((0, _array.arrayEqual)(myChanges, theirChanges)) {
      var _hunk$lines5;
      (_hunk$lines5 = hunk.lines).push.apply(_hunk$lines5, _toConsumableArray(myChanges));
      return;
    }
    conflict(hunk, myChanges, theirChanges);
  }
  function removal(hunk, mine, their, swap) {
    var myChanges = collectChange(mine), theirChanges = collectContext(their, myChanges);
    if (theirChanges.merged) {
      var _hunk$lines6;
      (_hunk$lines6 = hunk.lines).push.apply(_hunk$lines6, _toConsumableArray(theirChanges.merged));
    } else {
      conflict(hunk, swap ? theirChanges : myChanges, swap ? myChanges : theirChanges);
    }
  }
  function conflict(hunk, mine, their) {
    hunk.conflict = true;
    hunk.lines.push({
      conflict: true,
      mine,
      theirs: their
    });
  }
  function insertLeading(hunk, insert, their) {
    while (insert.offset < their.offset && insert.index < insert.lines.length) {
      var line = insert.lines[insert.index++];
      hunk.lines.push(line);
      insert.offset++;
    }
  }
  function insertTrailing(hunk, insert) {
    while (insert.index < insert.lines.length) {
      var line = insert.lines[insert.index++];
      hunk.lines.push(line);
    }
  }
  function collectChange(state) {
    var ret = [], operation = state.lines[state.index][0];
    while (state.index < state.lines.length) {
      var line = state.lines[state.index];
      if (operation === "-" && line[0] === "+") {
        operation = "+";
      }
      if (operation === line[0]) {
        ret.push(line);
        state.index++;
      } else {
        break;
      }
    }
    return ret;
  }
  function collectContext(state, matchChanges) {
    var changes = [], merged = [], matchIndex = 0, contextChanges = false, conflicted = false;
    while (matchIndex < matchChanges.length && state.index < state.lines.length) {
      var change = state.lines[state.index], match = matchChanges[matchIndex];
      if (match[0] === "+") {
        break;
      }
      contextChanges = contextChanges || change[0] !== " ";
      merged.push(match);
      matchIndex++;
      if (change[0] === "+") {
        conflicted = true;
        while (change[0] === "+") {
          changes.push(change);
          change = state.lines[++state.index];
        }
      }
      if (match.substr(1) === change.substr(1)) {
        changes.push(change);
        state.index++;
      } else {
        conflicted = true;
      }
    }
    if ((matchChanges[matchIndex] || "")[0] === "+" && contextChanges) {
      conflicted = true;
    }
    if (conflicted) {
      return changes;
    }
    while (matchIndex < matchChanges.length) {
      merged.push(matchChanges[matchIndex++]);
    }
    return {
      merged,
      changes
    };
  }
  function allRemoves(changes) {
    return changes.reduce(function(prev, change) {
      return prev && change[0] === "-";
    }, true);
  }
  function skipRemoveSuperset(state, removeChanges, delta) {
    for (var i = 0;i < delta; i++) {
      var changeContent = removeChanges[removeChanges.length - delta + i].substr(1);
      if (state.lines[state.index + i] !== " " + changeContent) {
        return false;
      }
    }
    state.index += delta;
    return true;
  }
  function calcOldNewLineCount(lines) {
    var oldLines = 0;
    var newLines = 0;
    lines.forEach(function(line) {
      if (typeof line !== "string") {
        var myCount = calcOldNewLineCount(line.mine);
        var theirCount = calcOldNewLineCount(line.theirs);
        if (oldLines !== undefined) {
          if (myCount.oldLines === theirCount.oldLines) {
            oldLines += myCount.oldLines;
          } else {
            oldLines = undefined;
          }
        }
        if (newLines !== undefined) {
          if (myCount.newLines === theirCount.newLines) {
            newLines += myCount.newLines;
          } else {
            newLines = undefined;
          }
        }
      } else {
        if (newLines !== undefined && (line[0] === "+" || line[0] === " ")) {
          newLines++;
        }
        if (oldLines !== undefined && (line[0] === "-" || line[0] === " ")) {
          oldLines++;
        }
      }
    });
    return {
      oldLines,
      newLines
    };
  }
});

// node_modules/diff/lib/patch/reverse.js
var require_reverse = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.reversePatch = reversePatch;
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o) {
      return typeof o;
    } : function(o) {
      return o && typeof Symbol == "function" && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
    }, _typeof(o);
  }
  function ownKeys(e, r) {
    var t = Object.keys(e);
    if (Object.getOwnPropertySymbols) {
      var o = Object.getOwnPropertySymbols(e);
      r && (o = o.filter(function(r) {
        return Object.getOwnPropertyDescriptor(e, r).enumerable;
      })), t.push.apply(t, o);
    }
    return t;
  }
  function _objectSpread(e) {
    for (var r = 1;r < arguments.length; r++) {
      var t = arguments[r] != null ? arguments[r] : {};
      r % 2 ? ownKeys(Object(t), true).forEach(function(r) {
        _defineProperty(e, r, t[r]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
        Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
      });
    }
    return e;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return _typeof(i) == "symbol" ? i : i + "";
  }
  function _toPrimitive(t, r) {
    if (_typeof(t) != "object" || !t)
      return t;
    var e = t[Symbol.toPrimitive];
    if (e !== undefined) {
      var i = e.call(t, r || "default");
      if (_typeof(i) != "object")
        return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (r === "string" ? String : Number)(t);
  }
  function reversePatch(structuredPatch) {
    if (Array.isArray(structuredPatch)) {
      return structuredPatch.map(reversePatch).reverse();
    }
    return _objectSpread(_objectSpread({}, structuredPatch), {}, {
      oldFileName: structuredPatch.newFileName,
      oldHeader: structuredPatch.newHeader,
      newFileName: structuredPatch.oldFileName,
      newHeader: structuredPatch.oldHeader,
      hunks: structuredPatch.hunks.map(function(hunk) {
        return {
          oldLines: hunk.newLines,
          oldStart: hunk.newStart,
          newLines: hunk.oldLines,
          newStart: hunk.oldStart,
          lines: hunk.lines.map(function(l) {
            if (l.startsWith("-")) {
              return "+".concat(l.slice(1));
            }
            if (l.startsWith("+")) {
              return "-".concat(l.slice(1));
            }
            return l;
          })
        };
      })
    });
  }
});

// node_modules/diff/lib/convert/dmp.js
var require_dmp = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.convertChangesToDMP = convertChangesToDMP;
  function convertChangesToDMP(changes) {
    var ret = [], change, operation;
    for (var i = 0;i < changes.length; i++) {
      change = changes[i];
      if (change.added) {
        operation = 1;
      } else if (change.removed) {
        operation = -1;
      } else {
        operation = 0;
      }
      ret.push([operation, change.value]);
    }
    return ret;
  }
});

// node_modules/diff/lib/convert/xml.js
var require_xml = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.convertChangesToXML = convertChangesToXML;
  function convertChangesToXML(changes) {
    var ret = [];
    for (var i = 0;i < changes.length; i++) {
      var change = changes[i];
      if (change.added) {
        ret.push("<ins>");
      } else if (change.removed) {
        ret.push("<del>");
      }
      ret.push(escapeHTML(change.value));
      if (change.added) {
        ret.push("</ins>");
      } else if (change.removed) {
        ret.push("</del>");
      }
    }
    return ret.join("");
  }
  function escapeHTML(s) {
    var n = s;
    n = n.replace(/&/g, "&amp;");
    n = n.replace(/</g, "&lt;");
    n = n.replace(/>/g, "&gt;");
    n = n.replace(/"/g, "&quot;");
    return n;
  }
});

// node_modules/diff/lib/index.js
var require_lib = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  Object.defineProperty(exports, "Diff", {
    enumerable: true,
    get: function get() {
      return _base["default"];
    }
  });
  Object.defineProperty(exports, "applyPatch", {
    enumerable: true,
    get: function get() {
      return _apply.applyPatch;
    }
  });
  Object.defineProperty(exports, "applyPatches", {
    enumerable: true,
    get: function get() {
      return _apply.applyPatches;
    }
  });
  Object.defineProperty(exports, "canonicalize", {
    enumerable: true,
    get: function get() {
      return _json.canonicalize;
    }
  });
  Object.defineProperty(exports, "convertChangesToDMP", {
    enumerable: true,
    get: function get() {
      return _dmp.convertChangesToDMP;
    }
  });
  Object.defineProperty(exports, "convertChangesToXML", {
    enumerable: true,
    get: function get() {
      return _xml.convertChangesToXML;
    }
  });
  Object.defineProperty(exports, "createPatch", {
    enumerable: true,
    get: function get() {
      return _create.createPatch;
    }
  });
  Object.defineProperty(exports, "createTwoFilesPatch", {
    enumerable: true,
    get: function get() {
      return _create.createTwoFilesPatch;
    }
  });
  Object.defineProperty(exports, "diffArrays", {
    enumerable: true,
    get: function get() {
      return _array.diffArrays;
    }
  });
  Object.defineProperty(exports, "diffChars", {
    enumerable: true,
    get: function get() {
      return _character.diffChars;
    }
  });
  Object.defineProperty(exports, "diffCss", {
    enumerable: true,
    get: function get() {
      return _css.diffCss;
    }
  });
  Object.defineProperty(exports, "diffJson", {
    enumerable: true,
    get: function get() {
      return _json.diffJson;
    }
  });
  Object.defineProperty(exports, "diffLines", {
    enumerable: true,
    get: function get() {
      return _line.diffLines;
    }
  });
  Object.defineProperty(exports, "diffSentences", {
    enumerable: true,
    get: function get() {
      return _sentence.diffSentences;
    }
  });
  Object.defineProperty(exports, "diffTrimmedLines", {
    enumerable: true,
    get: function get() {
      return _line.diffTrimmedLines;
    }
  });
  Object.defineProperty(exports, "diffWords", {
    enumerable: true,
    get: function get() {
      return _word.diffWords;
    }
  });
  Object.defineProperty(exports, "diffWordsWithSpace", {
    enumerable: true,
    get: function get() {
      return _word.diffWordsWithSpace;
    }
  });
  Object.defineProperty(exports, "formatPatch", {
    enumerable: true,
    get: function get() {
      return _create.formatPatch;
    }
  });
  Object.defineProperty(exports, "merge", {
    enumerable: true,
    get: function get() {
      return _merge.merge;
    }
  });
  Object.defineProperty(exports, "parsePatch", {
    enumerable: true,
    get: function get() {
      return _parse.parsePatch;
    }
  });
  Object.defineProperty(exports, "reversePatch", {
    enumerable: true,
    get: function get() {
      return _reverse.reversePatch;
    }
  });
  Object.defineProperty(exports, "structuredPatch", {
    enumerable: true,
    get: function get() {
      return _create.structuredPatch;
    }
  });
  var _base = _interopRequireDefault(require_base());
  var _character = require_character();
  var _word = require_word();
  var _line = require_line();
  var _sentence = require_sentence();
  var _css = require_css();
  var _json = require_json();
  var _array = require_array();
  var _apply = require_apply();
  var _parse = require_parse();
  var _merge = require_merge();
  var _reverse = require_reverse();
  var _create = require_create();
  var _dmp = require_dmp();
  var _xml = require_xml();
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
});

// node_modules/adm-zip/util/constants.js
var require_constants2 = __commonJS(function(exports, module) {
  module.exports = {
    LOCHDR: 30,
    LOCSIG: 67324752,
    LOCVER: 4,
    LOCFLG: 6,
    LOCHOW: 8,
    LOCTIM: 10,
    LOCCRC: 14,
    LOCSIZ: 18,
    LOCLEN: 22,
    LOCNAM: 26,
    LOCEXT: 28,
    EXTSIG: 134695760,
    EXTHDR: 16,
    EXTCRC: 4,
    EXTSIZ: 8,
    EXTLEN: 12,
    CENHDR: 46,
    CENSIG: 33639248,
    CENVEM: 4,
    CENVER: 6,
    CENFLG: 8,
    CENHOW: 10,
    CENTIM: 12,
    CENCRC: 16,
    CENSIZ: 20,
    CENLEN: 24,
    CENNAM: 28,
    CENEXT: 30,
    CENCOM: 32,
    CENDSK: 34,
    CENATT: 36,
    CENATX: 38,
    CENOFF: 42,
    ENDHDR: 22,
    ENDSIG: 101010256,
    ENDSUB: 8,
    ENDTOT: 10,
    ENDSIZ: 12,
    ENDOFF: 16,
    ENDCOM: 20,
    END64HDR: 20,
    END64SIG: 117853008,
    END64START: 4,
    END64OFF: 8,
    END64NUMDISKS: 16,
    ZIP64SIG: 101075792,
    ZIP64HDR: 56,
    ZIP64LEAD: 12,
    ZIP64SIZE: 4,
    ZIP64VEM: 12,
    ZIP64VER: 14,
    ZIP64DSK: 16,
    ZIP64DSKDIR: 20,
    ZIP64SUB: 24,
    ZIP64TOT: 32,
    ZIP64SIZB: 40,
    ZIP64OFF: 48,
    ZIP64EXTRA: 56,
    STORED: 0,
    SHRUNK: 1,
    REDUCED1: 2,
    REDUCED2: 3,
    REDUCED3: 4,
    REDUCED4: 5,
    IMPLODED: 6,
    DEFLATED: 8,
    ENHANCED_DEFLATED: 9,
    PKWARE: 10,
    BZIP2: 12,
    LZMA: 14,
    IBM_TERSE: 18,
    IBM_LZ77: 19,
    AES_ENCRYPT: 99,
    FLG_ENC: 1,
    FLG_COMP1: 2,
    FLG_COMP2: 4,
    FLG_DESC: 8,
    FLG_ENH: 16,
    FLG_PATCH: 32,
    FLG_STR: 64,
    FLG_EFS: 2048,
    FLG_MSK: 4096,
    FILE: 2,
    BUFFER: 1,
    NONE: 0,
    EF_ID: 0,
    EF_SIZE: 2,
    ID_ZIP64: 1,
    ID_AVINFO: 7,
    ID_PFS: 8,
    ID_OS2: 9,
    ID_NTFS: 10,
    ID_OPENVMS: 12,
    ID_UNIX: 13,
    ID_FORK: 14,
    ID_PATCH: 15,
    ID_X509_PKCS7: 20,
    ID_X509_CERTID_F: 21,
    ID_X509_CERTID_C: 22,
    ID_STRONGENC: 23,
    ID_RECORD_MGT: 24,
    ID_X509_PKCS7_RL: 25,
    ID_IBM1: 101,
    ID_IBM2: 102,
    ID_POSZIP: 18064,
    EF_ZIP64_OR_32: 4294967295,
    EF_ZIP64_OR_16: 65535,
    EF_ZIP64_SUNCOMP: 0,
    EF_ZIP64_SCOMP: 8,
    EF_ZIP64_RHO: 16,
    EF_ZIP64_DSN: 24
  };
});

// node_modules/adm-zip/util/errors.js
var require_errors = __commonJS(function(exports) {
  var errors = {
    INVALID_LOC: "Invalid LOC header (bad signature)",
    INVALID_CEN: "Invalid CEN header (bad signature)",
    INVALID_END: "Invalid END header (bad signature)",
    DESCRIPTOR_NOT_EXIST: "No descriptor present",
    DESCRIPTOR_UNKNOWN: "Unknown descriptor format",
    DESCRIPTOR_FAULTY: "Descriptor data is malformed",
    NO_DATA: "Nothing to decompress",
    BAD_CRC: "CRC32 checksum failed {0}",
    MAX_OUTPUT_EXCEEDED: "Decompressed data exceeds the declared uncompressed size",
    FILE_IN_THE_WAY: "There is a file in the way: {0}",
    UNKNOWN_METHOD: "Invalid/unsupported compression method",
    AVAIL_DATA: "inflate::Available inflate data did not terminate",
    INVALID_DISTANCE: "inflate::Invalid literal/length or distance code in fixed or dynamic block",
    TO_MANY_CODES: "inflate::Dynamic block code description: too many length or distance codes",
    INVALID_REPEAT_LEN: "inflate::Dynamic block code description: repeat more than specified lengths",
    INVALID_REPEAT_FIRST: "inflate::Dynamic block code description: repeat lengths with no first length",
    INCOMPLETE_CODES: "inflate::Dynamic block code description: code lengths codes incomplete",
    INVALID_DYN_DISTANCE: "inflate::Dynamic block code description: invalid distance code lengths",
    INVALID_CODES_LEN: "inflate::Dynamic block code description: invalid literal/length code lengths",
    INVALID_STORE_BLOCK: "inflate::Stored block length did not match one's complement",
    INVALID_BLOCK_TYPE: "inflate::Invalid block type (type == 3)",
    CANT_EXTRACT_FILE: "Could not extract the file",
    CANT_OVERRIDE: "Target file already exists",
    DISK_ENTRY_TOO_LARGE: "Number of disk entries is too large",
    NO_ZIP: "No zip file was loaded",
    NO_ENTRY: "Entry doesn't exist",
    DUPLICATE_ENTRY: "Duplicate entry name {0}",
    DIRECTORY_CONTENT_ERROR: "A directory cannot have content",
    FILE_NOT_FOUND: 'File not found: "{0}"',
    NOT_IMPLEMENTED: "Not implemented",
    INVALID_FILENAME: "Invalid filename",
    INVALID_FORMAT: "Invalid or unsupported zip format. No END header found",
    ZIP64_VALUE_TOO_LARGE: "Zip64 value exceeds the maximum safe integer",
    INVALID_PASS_PARAM: "Incompatible password parameter",
    WRONG_PASSWORD: "Wrong Password",
    COMMENT_TOO_LONG: "Comment is too long",
    EXTRA_FIELD_PARSE_ERROR: "Extra field parsing error"
  };
  function E(message) {
    return function(...args) {
      if (args.length) {
        message = message.replace(/\{(\d)\}/g, (_, n) => args[n] || "");
      }
      return new Error("ADM-ZIP: " + message);
    };
  }
  for (const msg of Object.keys(errors)) {
    exports[msg] = E(errors[msg]);
  }
});

// node_modules/adm-zip/util/utils.js
var require_utils = __commonJS(function(exports, module) {
  var fsystem = __require("fs");
  var pth = __require("path");
  var Constants = require_constants2();
  var Errors = require_errors();
  var isWin = typeof process === "object" && process.platform === "win32";
  var is_Obj = (obj) => typeof obj === "object" && obj !== null;
  var crcTable = new Uint32Array(256).map((t, c) => {
    for (let k = 0;k < 8; k++) {
      if ((c & 1) !== 0) {
        c = 3988292384 ^ c >>> 1;
      } else {
        c >>>= 1;
      }
    }
    return c >>> 0;
  });
  function Utils(opts) {
    this.sep = pth.sep;
    this.fs = fsystem;
    if (is_Obj(opts)) {
      if (is_Obj(opts.fs) && typeof opts.fs.statSync === "function") {
        this.fs = opts.fs;
      }
    }
  }
  module.exports = Utils;
  Utils.prototype.makeDir = function(folder) {
    const self = this;
    function mkdirSync(fpath) {
      let resolvedPath = fpath.split(self.sep)[0];
      fpath.split(self.sep).forEach(function(name) {
        if (!name || name.substr(-1, 1) === ":")
          return;
        resolvedPath += self.sep + name;
        var stat;
        try {
          stat = self.fs.statSync(resolvedPath);
        } catch (e) {
          if (e.message && e.message.startsWith("ENOENT")) {
            self.fs.mkdirSync(resolvedPath);
          } else {
            throw e;
          }
        }
        if (stat && stat.isFile())
          throw Errors.FILE_IN_THE_WAY(`"${resolvedPath}"`);
      });
    }
    mkdirSync(folder);
  };
  Utils.prototype.writeFileTo = function(path, content, overwrite, attr) {
    const self = this;
    if (self.fs.existsSync(path)) {
      if (!overwrite)
        return false;
      var stat = self.fs.statSync(path);
      if (stat.isDirectory()) {
        return false;
      }
    }
    var folder = pth.dirname(path);
    if (!self.fs.existsSync(folder)) {
      self.makeDir(folder);
    }
    var fd;
    try {
      fd = self.fs.openSync(path, "w", 438);
    } catch (e) {
      self.fs.chmodSync(path, 438);
      fd = self.fs.openSync(path, "w", 438);
    }
    if (fd) {
      try {
        self.fs.writeSync(fd, content, 0, content.length, 0);
      } finally {
        self.fs.closeSync(fd);
      }
    }
    self.fs.chmodSync(path, attr || 438);
    return true;
  };
  Utils.prototype.writeFileToAsync = function(path, content, overwrite, attr, callback) {
    if (typeof attr === "function") {
      callback = attr;
      attr = undefined;
    }
    const self = this;
    self.fs.exists(path, function(exist) {
      if (exist && !overwrite)
        return callback(false);
      self.fs.stat(path, function(err, stat) {
        if (exist && stat && stat.isDirectory()) {
          return callback(false);
        }
        var folder = pth.dirname(path);
        self.fs.exists(folder, function(exists) {
          if (!exists) {
            try {
              self.makeDir(folder);
            } catch (e) {
              return callback(false);
            }
          }
          const writeToFd = function(fd) {
            self.fs.write(fd, content, 0, content.length, 0, function(writeErr) {
              self.fs.close(fd, function() {
                if (writeErr)
                  return callback(false);
                self.fs.chmod(path, attr || 438, function() {
                  callback(true);
                });
              });
            });
          };
          self.fs.open(path, "w", 438, function(err, fd) {
            if (err) {
              self.fs.chmod(path, 438, function() {
                self.fs.open(path, "w", 438, function(retryErr, fd) {
                  if (retryErr || !fd)
                    return callback(false);
                  writeToFd(fd);
                });
              });
            } else if (fd) {
              writeToFd(fd);
            } else {
              callback(false);
            }
          });
        });
      });
    });
  };
  Utils.prototype.assertPathSafe = function(root, target) {
    const self = this;
    if (typeof self.fs.lstatSync !== "function")
      return;
    const resolvedRoot = pth.resolve(root);
    const resolvedTarget = pth.resolve(target);
    if (resolvedTarget === resolvedRoot)
      return;
    const rel = pth.relative(resolvedRoot, resolvedTarget);
    if (!rel || rel === ".." || rel.startsWith(".." + pth.sep) || pth.isAbsolute(rel))
      return;
    let cur = resolvedRoot;
    for (const part of rel.split(pth.sep)) {
      if (!part || part === ".")
        continue;
      cur = pth.join(cur, part);
      let stat;
      try {
        stat = self.fs.lstatSync(cur);
      } catch (e) {
        break;
      }
      if (stat.isSymbolicLink())
        throw Errors.FILE_IN_THE_WAY(`"${cur}"`);
    }
  };
  Utils.prototype.findFiles = function(path) {
    const self = this;
    const canLstat = typeof self.fs.lstatSync === "function";
    const rootReal = self.fs.realpathSync(path);
    function escapesRoot(p) {
      if (!canLstat)
        return false;
      if (!self.fs.lstatSync(p).isSymbolicLink())
        return false;
      let real;
      try {
        real = self.fs.realpathSync(p);
      } catch (e) {
        return true;
      }
      return !(real === rootReal || real.startsWith(rootReal + pth.sep));
    }
    function findSync(dir, pattern, recursive, visited) {
      if (typeof pattern === "boolean") {
        recursive = pattern;
        pattern = undefined;
      }
      let files = [];
      self.fs.readdirSync(dir).forEach(function(file) {
        const path = pth.join(dir, file);
        if (escapesRoot(path))
          return;
        const stat = self.fs.statSync(path);
        if (!pattern || pattern.test(path)) {
          files.push(pth.normalize(path) + (stat.isDirectory() ? self.sep : ""));
        }
        if (stat.isDirectory() && recursive) {
          const realDir = self.fs.realpathSync(path);
          if (!visited.has(realDir)) {
            visited.add(realDir);
            files = files.concat(findSync(path, pattern, recursive, visited));
          }
        }
      });
      return files;
    }
    return findSync(path, undefined, true, new Set([rootReal]));
  };
  Utils.prototype.findFilesAsync = function(dir, cb) {
    const self = this;
    const results = [];
    let finished = false;
    const finish = function(err) {
      if (finished)
        return;
      finished = true;
      cb(err, err ? undefined : results);
    };
    const canLstat = typeof self.fs.lstat === "function";
    let rootReal = null;
    const escapesRoot = function(file, cb) {
      if (!canLstat)
        return cb(null, false);
      self.fs.lstat(file, function(err, lst) {
        if (err)
          return cb(err);
        if (!lst || !lst.isSymbolicLink())
          return cb(null, false);
        self.fs.realpath(file, function(err, real) {
          if (err)
            return cb(null, true);
          cb(null, !(real === rootReal || real.startsWith(rootReal + pth.sep)));
        });
      });
    };
    const walk = function(dir, visited, done) {
      self.fs.readdir(dir, function(err, list) {
        if (err)
          return done(err);
        let pending = list.length;
        if (!pending)
          return done();
        list.forEach(function(name) {
          const file = pth.join(dir, name);
          escapesRoot(file, function(err, escapes) {
            if (err)
              return done(err);
            if (escapes) {
              if (!--pending)
                done();
              return;
            }
            self.fs.stat(file, function(err, stat) {
              if (err)
                return done(err);
              if (!stat) {
                if (!--pending)
                  done();
                return;
              }
              results.push(pth.normalize(file) + (stat.isDirectory() ? self.sep : ""));
              if (!stat.isDirectory()) {
                if (!--pending)
                  done();
                return;
              }
              self.fs.realpath(file, function(err, realDir) {
                if (err)
                  return done(err);
                if (visited.has(realDir)) {
                  if (!--pending)
                    done();
                  return;
                }
                visited.add(realDir);
                walk(file, visited, function(err) {
                  if (err)
                    return done(err);
                  if (!--pending)
                    done();
                });
              });
            });
          });
        });
      });
    };
    self.fs.realpath(dir, function(err, realDir) {
      if (err)
        return finish(err);
      rootReal = realDir;
      walk(dir, new Set([realDir]), finish);
    });
  };
  Utils.prototype.getAttributes = function() {};
  Utils.prototype.setAttributes = function() {};
  Utils.crc32update = function(crc, byte) {
    return crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  };
  Utils.crc32 = function(buf) {
    if (typeof buf === "string") {
      buf = Buffer.from(buf, "utf8");
    }
    let len = buf.length;
    let crc = ~0;
    for (let off = 0;off < len; )
      crc = Utils.crc32update(crc, buf[off++]);
    return ~crc >>> 0;
  };
  Utils.methodToString = function(method) {
    switch (method) {
      case Constants.STORED:
        return "STORED (" + method + ")";
      case Constants.DEFLATED:
        return "DEFLATED (" + method + ")";
      default:
        return "UNSUPPORTED (" + method + ")";
    }
  };
  Utils.canonical = function(path) {
    if (!path)
      return "";
    const safeSuffix = pth.posix.normalize("/" + path.split("\\").join("/"));
    return pth.join(".", safeSuffix);
  };
  Utils.zipnamefix = function(path) {
    if (!path)
      return "";
    const safeSuffix = pth.posix.normalize("/" + path.split("\\").join("/"));
    return pth.posix.join(".", safeSuffix);
  };
  Utils.findLast = function(arr, callback) {
    if (!Array.isArray(arr))
      throw new TypeError("arr is not array");
    const len = arr.length >>> 0;
    for (let i = len - 1;i >= 0; i--) {
      if (callback(arr[i], i, arr)) {
        return arr[i];
      }
    }
    return;
  };
  Utils.sanitize = function(prefix, name) {
    prefix = pth.resolve(pth.normalize(prefix));
    var parts = name.split("/");
    for (var i = 0, l = parts.length;i < l; i++) {
      var path = pth.normalize(pth.join(prefix, parts.slice(i, l).join(pth.sep)));
      if (path === prefix || path.startsWith(prefix + pth.sep)) {
        return path;
      }
    }
    return pth.normalize(pth.join(prefix, pth.basename(name)));
  };
  Utils.toBuffer = function toBuffer(input, encoder) {
    if (Buffer.isBuffer(input)) {
      return input;
    } else if (input instanceof Uint8Array) {
      return Buffer.from(input);
    } else {
      return typeof input === "string" ? encoder(input) : Buffer.alloc(0);
    }
  };
  Utils.readBigUInt64LE = function(buffer, index) {
    const lo = buffer.readUInt32LE(index);
    const hi = buffer.readUInt32LE(index + 4);
    const value = hi * 4294967296 + lo;
    if (value > Number.MAX_SAFE_INTEGER) {
      throw Errors.ZIP64_VALUE_TOO_LARGE();
    }
    return value;
  };
  Utils.writeBigUInt64LE = function(buffer, value, index) {
    const lo = value >>> 0;
    const hi = Math.floor(value / 4294967296) >>> 0;
    buffer.writeUInt32LE(lo, index);
    buffer.writeUInt32LE(hi, index + 4);
  };
  Utils.fromDOS2Date = function(val) {
    return new Date((val >> 25 & 127) + 1980, Math.max((val >> 21 & 15) - 1, 0), Math.max(val >> 16 & 31, 1), val >> 11 & 31, val >> 5 & 63, (val & 31) << 1);
  };
  Utils.fromDate2DOS = function(val) {
    let date = 0;
    let time = 0;
    if (val.getFullYear() > 1979) {
      date = (val.getFullYear() - 1980 & 127) << 9 | val.getMonth() + 1 << 5 | val.getDate();
      time = val.getHours() << 11 | val.getMinutes() << 5 | val.getSeconds() >> 1;
    }
    return date << 16 | time;
  };
  Utils.isWin = isWin;
  Utils.crcTable = crcTable;
});

// node_modules/adm-zip/util/fattr.js
var require_fattr = __commonJS(function(exports, module) {
  var pth = __require("path");
  module.exports = function(path, { fs }) {
    var _path = path || "", _obj = newAttr(), _stat = null;
    function newAttr() {
      return {
        directory: false,
        readonly: false,
        hidden: false,
        executable: false,
        mtime: 0,
        atime: 0
      };
    }
    if (_path && fs.existsSync(_path)) {
      _stat = fs.statSync(_path);
      _obj.directory = _stat.isDirectory();
      _obj.mtime = _stat.mtime;
      _obj.atime = _stat.atime;
      _obj.executable = (73 & _stat.mode) !== 0;
      _obj.readonly = (128 & _stat.mode) === 0;
      _obj.hidden = pth.basename(_path)[0] === ".";
    } else {
      console.warn("Invalid path: " + _path);
    }
    return {
      get directory() {
        return _obj.directory;
      },
      get readOnly() {
        return _obj.readonly;
      },
      get hidden() {
        return _obj.hidden;
      },
      get mtime() {
        return _obj.mtime;
      },
      get atime() {
        return _obj.atime;
      },
      get executable() {
        return _obj.executable;
      },
      decodeAttributes: function() {},
      encodeAttributes: function() {},
      toJSON: function() {
        return {
          path: _path,
          isDirectory: _obj.directory,
          isReadOnly: _obj.readonly,
          isHidden: _obj.hidden,
          isExecutable: _obj.executable,
          mTime: _obj.mtime,
          aTime: _obj.atime
        };
      },
      toString: function() {
        return JSON.stringify(this.toJSON(), null, "\t");
      }
    };
  };
});

// node_modules/adm-zip/util/decoder.js
var require_decoder = __commonJS(function(exports, module) {
  module.exports = {
    efs: true,
    encode: (data) => Buffer.from(data, "utf8"),
    decode: (data) => data.toString("utf8")
  };
});

// node_modules/adm-zip/util/index.js
var require_util = __commonJS(function(exports, module) {
  module.exports = require_utils();
  module.exports.Constants = require_constants2();
  module.exports.Errors = require_errors();
  module.exports.FileAttr = require_fattr();
  module.exports.decoder = require_decoder();
});

// node_modules/adm-zip/headers/entryHeader.js
var require_entryHeader = __commonJS(function(exports, module) {
  var Utils = require_util();
  var Constants = Utils.Constants;
  module.exports = function() {
    var _verMade = 20, _version = 10, _flags = 0, _method = 0, _time = 0, _crc = 0, _compressedSize = 0, _size = 0, _fnameLen = 0, _extraLen = 0, _comLen = 0, _diskStart = 0, _inattr = 0, _attr = 0, _offset = 0;
    _verMade |= Utils.isWin ? 2560 : 768;
    _flags |= Constants.FLG_EFS;
    const _localHeader = {
      extraLen: 0
    };
    const uint32 = (val) => Math.max(0, val) >>> 0;
    const uint16 = (val) => Math.max(0, val) & 65535;
    const uint8 = (val) => Math.max(0, val) & 255;
    _time = Utils.fromDate2DOS(new Date);
    return {
      get made() {
        return _verMade;
      },
      set made(val) {
        _verMade = val;
      },
      get version() {
        return _version;
      },
      set version(val) {
        _version = val;
      },
      get flags() {
        return _flags;
      },
      set flags(val) {
        _flags = val;
      },
      get flags_efs() {
        return (_flags & Constants.FLG_EFS) > 0;
      },
      set flags_efs(val) {
        if (val) {
          _flags |= Constants.FLG_EFS;
        } else {
          _flags &= ~Constants.FLG_EFS;
        }
      },
      get flags_desc() {
        return (_flags & Constants.FLG_DESC) > 0;
      },
      set flags_desc(val) {
        if (val) {
          _flags |= Constants.FLG_DESC;
        } else {
          _flags &= ~Constants.FLG_DESC;
        }
      },
      get method() {
        return _method;
      },
      set method(val) {
        switch (val) {
          case Constants.STORED:
            this.version = 10;
            break;
          case Constants.DEFLATED:
          default:
            this.version = 20;
        }
        _method = val;
      },
      get time() {
        return Utils.fromDOS2Date(this.timeval);
      },
      set time(val) {
        val = new Date(val);
        this.timeval = Utils.fromDate2DOS(val);
      },
      get timeval() {
        return _time;
      },
      set timeval(val) {
        _time = uint32(val);
      },
      get timeHighByte() {
        return uint8(_time >>> 8);
      },
      get crc() {
        return _crc;
      },
      set crc(val) {
        _crc = uint32(val);
      },
      get compressedSize() {
        return _compressedSize;
      },
      set compressedSize(val) {
        _compressedSize = uint32(val);
      },
      get size() {
        return _size;
      },
      set size(val) {
        _size = uint32(val);
      },
      get fileNameLength() {
        return _fnameLen;
      },
      set fileNameLength(val) {
        _fnameLen = val;
      },
      get extraLength() {
        return _extraLen;
      },
      set extraLength(val) {
        _extraLen = val;
      },
      get extraLocalLength() {
        return _localHeader.extraLen;
      },
      set extraLocalLength(val) {
        _localHeader.extraLen = val;
      },
      get commentLength() {
        return _comLen;
      },
      set commentLength(val) {
        _comLen = val;
      },
      get diskNumStart() {
        return _diskStart;
      },
      set diskNumStart(val) {
        _diskStart = uint32(val);
      },
      get inAttr() {
        return _inattr;
      },
      set inAttr(val) {
        _inattr = uint32(val);
      },
      get attr() {
        return _attr;
      },
      set attr(val) {
        _attr = uint32(val);
      },
      get fileAttr() {
        return (_attr || 0) >> 16 & 511;
      },
      get offset() {
        return _offset;
      },
      set offset(val) {
        _offset = uint32(val);
      },
      get encrypted() {
        return (_flags & Constants.FLG_ENC) === Constants.FLG_ENC;
      },
      get centralHeaderSize() {
        return Constants.CENHDR + _fnameLen + _extraLen + _comLen;
      },
      get realDataOffset() {
        return _offset + Constants.LOCHDR + _localHeader.fnameLen + _localHeader.extraLen;
      },
      get localHeader() {
        return _localHeader;
      },
      loadLocalHeaderFromBinary: function(input) {
        if (_offset < 0 || _offset + Constants.LOCHDR > input.length) {
          throw Utils.Errors.INVALID_LOC();
        }
        var data = input.slice(_offset, _offset + Constants.LOCHDR);
        if (data.readUInt32LE(0) !== Constants.LOCSIG) {
          throw Utils.Errors.INVALID_LOC();
        }
        _localHeader.version = data.readUInt16LE(Constants.LOCVER);
        _localHeader.flags = data.readUInt16LE(Constants.LOCFLG);
        _localHeader.flags_desc = (_localHeader.flags & Constants.FLG_DESC) > 0;
        _localHeader.method = data.readUInt16LE(Constants.LOCHOW);
        _localHeader.time = data.readUInt32LE(Constants.LOCTIM);
        _localHeader.crc = data.readUInt32LE(Constants.LOCCRC);
        _localHeader.compressedSize = data.readUInt32LE(Constants.LOCSIZ);
        _localHeader.size = data.readUInt32LE(Constants.LOCLEN);
        _localHeader.fnameLen = data.readUInt16LE(Constants.LOCNAM);
        _localHeader.extraLen = data.readUInt16LE(Constants.LOCEXT);
        const extraStart = _offset + Constants.LOCHDR + _localHeader.fnameLen;
        const extraEnd = extraStart + _localHeader.extraLen;
        return input.slice(extraStart, extraEnd);
      },
      loadFromBinary: function(data) {
        if (data.length !== Constants.CENHDR || data.readUInt32LE(0) !== Constants.CENSIG) {
          throw Utils.Errors.INVALID_CEN();
        }
        _verMade = data.readUInt16LE(Constants.CENVEM);
        _version = data.readUInt16LE(Constants.CENVER);
        _flags = data.readUInt16LE(Constants.CENFLG);
        _method = data.readUInt16LE(Constants.CENHOW);
        _time = data.readUInt32LE(Constants.CENTIM);
        _crc = data.readUInt32LE(Constants.CENCRC);
        _compressedSize = data.readUInt32LE(Constants.CENSIZ);
        _size = data.readUInt32LE(Constants.CENLEN);
        _fnameLen = data.readUInt16LE(Constants.CENNAM);
        _extraLen = data.readUInt16LE(Constants.CENEXT);
        _comLen = data.readUInt16LE(Constants.CENCOM);
        _diskStart = data.readUInt16LE(Constants.CENDSK);
        _inattr = data.readUInt16LE(Constants.CENATT);
        _attr = data.readUInt32LE(Constants.CENATX);
        _offset = data.readUInt32LE(Constants.CENOFF);
      },
      localHeaderToBinary: function() {
        var data = Buffer.alloc(Constants.LOCHDR);
        data.writeUInt32LE(Constants.LOCSIG, 0);
        data.writeUInt16LE(_version, Constants.LOCVER);
        data.writeUInt16LE(_flags & ~Constants.FLG_DESC, Constants.LOCFLG);
        data.writeUInt16LE(_method, Constants.LOCHOW);
        data.writeUInt32LE(_time, Constants.LOCTIM);
        data.writeUInt32LE(_crc, Constants.LOCCRC);
        data.writeUInt32LE(_compressedSize, Constants.LOCSIZ);
        data.writeUInt32LE(_size, Constants.LOCLEN);
        data.writeUInt16LE(_fnameLen, Constants.LOCNAM);
        data.writeUInt16LE(_localHeader.extraLen, Constants.LOCEXT);
        return data;
      },
      centralHeaderToBinary: function() {
        var data = Buffer.alloc(Constants.CENHDR + _fnameLen + _extraLen + _comLen);
        data.writeUInt32LE(Constants.CENSIG, 0);
        data.writeUInt16LE(_verMade, Constants.CENVEM);
        data.writeUInt16LE(_version, Constants.CENVER);
        data.writeUInt16LE(_flags & ~Constants.FLG_DESC, Constants.CENFLG);
        data.writeUInt16LE(_method, Constants.CENHOW);
        data.writeUInt32LE(_time, Constants.CENTIM);
        data.writeUInt32LE(_crc, Constants.CENCRC);
        data.writeUInt32LE(_compressedSize, Constants.CENSIZ);
        data.writeUInt32LE(_size, Constants.CENLEN);
        data.writeUInt16LE(_fnameLen, Constants.CENNAM);
        data.writeUInt16LE(_extraLen, Constants.CENEXT);
        data.writeUInt16LE(_comLen, Constants.CENCOM);
        data.writeUInt16LE(_diskStart, Constants.CENDSK);
        data.writeUInt16LE(_inattr, Constants.CENATT);
        data.writeUInt32LE(_attr, Constants.CENATX);
        data.writeUInt32LE(_offset, Constants.CENOFF);
        return data;
      },
      toJSON: function() {
        const bytes = function(nr) {
          return nr + " bytes";
        };
        return {
          made: _verMade,
          version: _version,
          flags: _flags,
          method: Utils.methodToString(_method),
          time: this.time,
          crc: "0x" + _crc.toString(16).toUpperCase(),
          compressedSize: bytes(_compressedSize),
          size: bytes(_size),
          fileNameLength: bytes(_fnameLen),
          extraLength: bytes(_extraLen),
          commentLength: bytes(_comLen),
          diskNumStart: _diskStart,
          inAttr: _inattr,
          attr: _attr,
          offset: _offset,
          centralHeaderSize: bytes(Constants.CENHDR + _fnameLen + _extraLen + _comLen)
        };
      },
      toString: function() {
        return JSON.stringify(this.toJSON(), null, "\t");
      }
    };
  };
});

// node_modules/adm-zip/headers/mainHeader.js
var require_mainHeader = __commonJS(function(exports, module) {
  var Utils = require_util();
  var Constants = Utils.Constants;
  module.exports = function() {
    var _volumeEntries = 0, _totalEntries = 0, _size = 0, _offset = 0, _commentLength = 0;
    const needsZip64 = () => _volumeEntries > Constants.EF_ZIP64_OR_16 || _totalEntries > Constants.EF_ZIP64_OR_16 || _size > Constants.EF_ZIP64_OR_32 || _offset > Constants.EF_ZIP64_OR_32;
    return {
      get diskEntries() {
        return _volumeEntries;
      },
      set diskEntries(val) {
        _volumeEntries = _totalEntries = val;
      },
      get totalEntries() {
        return _totalEntries;
      },
      set totalEntries(val) {
        _totalEntries = _volumeEntries = val;
      },
      get size() {
        return _size;
      },
      set size(val) {
        _size = val;
      },
      get offset() {
        return _offset;
      },
      set offset(val) {
        _offset = val;
      },
      get commentLength() {
        return _commentLength;
      },
      set commentLength(val) {
        _commentLength = val;
      },
      get mainHeaderSize() {
        return (needsZip64() ? Constants.ZIP64HDR + Constants.END64HDR : 0) + Constants.ENDHDR + _commentLength;
      },
      loadFromBinary: function(data) {
        if ((data.length !== Constants.ENDHDR || data.readUInt32LE(0) !== Constants.ENDSIG) && (data.length < Constants.ZIP64HDR || data.readUInt32LE(0) !== Constants.ZIP64SIG)) {
          throw Utils.Errors.INVALID_END();
        }
        if (data.readUInt32LE(0) === Constants.ENDSIG) {
          _volumeEntries = data.readUInt16LE(Constants.ENDSUB);
          _totalEntries = data.readUInt16LE(Constants.ENDTOT);
          _size = data.readUInt32LE(Constants.ENDSIZ);
          _offset = data.readUInt32LE(Constants.ENDOFF);
          _commentLength = data.readUInt16LE(Constants.ENDCOM);
        } else {
          _volumeEntries = Utils.readBigUInt64LE(data, Constants.ZIP64SUB);
          _totalEntries = Utils.readBigUInt64LE(data, Constants.ZIP64TOT);
          _size = Utils.readBigUInt64LE(data, Constants.ZIP64SIZB);
          _offset = Utils.readBigUInt64LE(data, Constants.ZIP64OFF);
          _commentLength = 0;
        }
      },
      toBinary: function() {
        if (!needsZip64()) {
          var b = Buffer.alloc(Constants.ENDHDR + _commentLength);
          b.writeUInt32LE(Constants.ENDSIG, 0);
          b.writeUInt32LE(0, 4);
          b.writeUInt16LE(_volumeEntries, Constants.ENDSUB);
          b.writeUInt16LE(_totalEntries, Constants.ENDTOT);
          b.writeUInt32LE(_size, Constants.ENDSIZ);
          b.writeUInt32LE(_offset, Constants.ENDOFF);
          b.writeUInt16LE(_commentLength, Constants.ENDCOM);
          b.fill(" ", Constants.ENDHDR);
          return b;
        }
        var b = Buffer.alloc(this.mainHeaderSize);
        let offset = 0;
        b.writeUInt32LE(Constants.ZIP64SIG, offset);
        Utils.writeBigUInt64LE(b, Constants.ZIP64HDR - Constants.ZIP64LEAD, offset + Constants.ZIP64SIZE);
        b.writeUInt16LE(45, offset + Constants.ZIP64VEM);
        b.writeUInt16LE(45, offset + Constants.ZIP64VER);
        b.writeUInt32LE(0, offset + Constants.ZIP64DSK);
        b.writeUInt32LE(0, offset + Constants.ZIP64DSKDIR);
        Utils.writeBigUInt64LE(b, _volumeEntries, offset + Constants.ZIP64SUB);
        Utils.writeBigUInt64LE(b, _totalEntries, offset + Constants.ZIP64TOT);
        Utils.writeBigUInt64LE(b, _size, offset + Constants.ZIP64SIZB);
        Utils.writeBigUInt64LE(b, _offset, offset + Constants.ZIP64OFF);
        const zip64EndOffset = _offset + _size;
        offset += Constants.ZIP64HDR;
        b.writeUInt32LE(Constants.END64SIG, offset);
        b.writeUInt32LE(0, offset + Constants.END64START);
        Utils.writeBigUInt64LE(b, zip64EndOffset, offset + Constants.END64OFF);
        b.writeUInt32LE(1, offset + Constants.END64NUMDISKS);
        offset += Constants.END64HDR;
        b.writeUInt32LE(Constants.ENDSIG, offset);
        b.writeUInt32LE(0, offset + 4);
        b.writeUInt16LE(Math.min(_volumeEntries, Constants.EF_ZIP64_OR_16), offset + Constants.ENDSUB);
        b.writeUInt16LE(Math.min(_totalEntries, Constants.EF_ZIP64_OR_16), offset + Constants.ENDTOT);
        b.writeUInt32LE(Math.min(_size, Constants.EF_ZIP64_OR_32), offset + Constants.ENDSIZ);
        b.writeUInt32LE(Math.min(_offset, Constants.EF_ZIP64_OR_32), offset + Constants.ENDOFF);
        b.writeUInt16LE(_commentLength, offset + Constants.ENDCOM);
        b.fill(" ", offset + Constants.ENDHDR);
        return b;
      },
      toJSON: function() {
        const offset = function(nr, len) {
          let offs = nr.toString(16).toUpperCase();
          while (offs.length < len)
            offs = "0" + offs;
          return "0x" + offs;
        };
        return {
          diskEntries: _volumeEntries,
          totalEntries: _totalEntries,
          size: _size + " bytes",
          offset: offset(_offset, 4),
          commentLength: _commentLength
        };
      },
      toString: function() {
        return JSON.stringify(this.toJSON(), null, "\t");
      }
    };
  };
});

// node_modules/adm-zip/headers/index.js
var require_headers = __commonJS(function(exports) {
  exports.EntryHeader = require_entryHeader();
  exports.MainHeader = require_mainHeader();
});

// node_modules/adm-zip/methods/deflater.js
var require_deflater = __commonJS(function(exports, module) {
  module.exports = function(inbuf) {
    var zlib = __require("zlib");
    var opts = { chunkSize: (parseInt(inbuf.length / 1024) + 1) * 1024 };
    return {
      deflate: function() {
        return zlib.deflateRawSync(inbuf, opts);
      },
      deflateAsync: function(callback) {
        var tmp = zlib.createDeflateRaw(opts), parts = [], total = 0;
        tmp.on("data", function(data) {
          parts.push(data);
          total += data.length;
        });
        tmp.on("end", function() {
          var buf = Buffer.alloc(total), written = 0;
          buf.fill(0);
          for (var i = 0;i < parts.length; i++) {
            var part = parts[i];
            part.copy(buf, written);
            written += part.length;
          }
          callback && callback(buf);
        });
        tmp.end(inbuf);
      }
    };
  };
});

// node_modules/adm-zip/methods/inflater.js
var require_inflater = __commonJS(function(exports, module) {
  var version = +(process?.versions?.node ?? "").split(".")[0] || 0;
  var Errors = require_errors();
  module.exports = function(inbuf, expectedLength) {
    var zlib = __require("zlib");
    const maxOutputLength = expectedLength > 0 ? expectedLength : 1;
    const option = version >= 15 ? { maxOutputLength } : {};
    return {
      inflate: function() {
        return zlib.inflateRawSync(inbuf, option);
      },
      inflateAsync: function(callback) {
        var tmp = zlib.createInflateRaw(option), parts = [], total = 0, done = false;
        const fail = function(err) {
          if (done)
            return;
          done = true;
          tmp.destroy();
          callback && callback(Buffer.alloc(0), err);
        };
        tmp.on("error", function(err) {
          fail(err);
        });
        tmp.on("data", function(data) {
          if (done)
            return;
          total += data.length;
          if (total > maxOutputLength) {
            return fail(Errors.MAX_OUTPUT_EXCEEDED());
          }
          parts.push(data);
        });
        tmp.on("end", function() {
          if (done)
            return;
          done = true;
          var buf = Buffer.alloc(total), written = 0;
          buf.fill(0);
          for (var i = 0;i < parts.length; i++) {
            var part = parts[i];
            part.copy(buf, written);
            written += part.length;
          }
          callback && callback(buf);
        });
        tmp.end(inbuf);
      }
    };
  };
});

// node_modules/adm-zip/methods/zipcrypto.js
var require_zipcrypto = __commonJS(function(exports, module) {
  var { randomFillSync } = __require("crypto");
  var Errors = require_errors();
  var crctable = new Uint32Array(256).map((t, crc) => {
    for (let j = 0;j < 8; j++) {
      if ((crc & 1) !== 0) {
        crc = crc >>> 1 ^ 3988292384;
      } else {
        crc >>>= 1;
      }
    }
    return crc >>> 0;
  });
  var uMul = (a, b) => Math.imul(a, b) >>> 0;
  var crc32update = (pCrc32, bval) => {
    return crctable[(pCrc32 ^ bval) & 255] ^ pCrc32 >>> 8;
  };
  var genSalt = () => {
    if (typeof randomFillSync === "function") {
      return randomFillSync(Buffer.alloc(12));
    } else {
      return genSalt.node();
    }
  };
  genSalt.node = () => {
    const salt = Buffer.alloc(12);
    const len = salt.length;
    for (let i = 0;i < len; i++)
      salt[i] = Math.random() * 256 & 255;
    return salt;
  };
  var config = {
    genSalt
  };
  function Initkeys(pw) {
    const pass = Buffer.isBuffer(pw) ? pw : Buffer.from(pw);
    this.keys = new Uint32Array([305419896, 591751049, 878082192]);
    for (let i = 0;i < pass.length; i++) {
      this.updateKeys(pass[i]);
    }
  }
  Initkeys.prototype.updateKeys = function(byteValue) {
    const keys = this.keys;
    keys[0] = crc32update(keys[0], byteValue);
    keys[1] += keys[0] & 255;
    keys[1] = uMul(keys[1], 134775813) + 1;
    keys[2] = crc32update(keys[2], keys[1] >>> 24);
    return byteValue;
  };
  Initkeys.prototype.next = function() {
    const k = (this.keys[2] | 2) >>> 0;
    return uMul(k, k ^ 1) >> 8 & 255;
  };
  function make_decrypter(pwd) {
    const keys = new Initkeys(pwd);
    return function(data) {
      const result = Buffer.alloc(data.length);
      let pos = 0;
      for (let c of data) {
        result[pos++] = keys.updateKeys(c ^ keys.next());
      }
      return result;
    };
  }
  function make_encrypter(pwd) {
    const keys = new Initkeys(pwd);
    return function(data, result, pos = 0) {
      if (!result)
        result = Buffer.alloc(data.length);
      for (let c of data) {
        const k = keys.next();
        result[pos++] = c ^ k;
        keys.updateKeys(c);
      }
      return result;
    };
  }
  function decrypt(data, header, pwd) {
    if (!data || !Buffer.isBuffer(data) || data.length < 12) {
      return Buffer.alloc(0);
    }
    const decrypter = make_decrypter(pwd);
    const salt = decrypter(data.slice(0, 12));
    const verifyByte = (header.flags & 8) === 8 ? header.timeHighByte : header.crc >>> 24;
    if (salt[11] !== verifyByte) {
      throw Errors.WRONG_PASSWORD();
    }
    return decrypter(data.slice(12));
  }
  function _salter(data) {
    if (Buffer.isBuffer(data) && data.length >= 12) {
      config.genSalt = function() {
        return data.slice(0, 12);
      };
    } else if (data === "node") {
      config.genSalt = genSalt.node;
    } else {
      config.genSalt = genSalt;
    }
  }
  function encrypt(data, header, pwd, oldlike = false) {
    if (data == null)
      data = Buffer.alloc(0);
    if (!Buffer.isBuffer(data))
      data = Buffer.from(data.toString());
    const encrypter = make_encrypter(pwd);
    const salt = config.genSalt();
    salt[11] = header.crc >>> 24 & 255;
    if (oldlike)
      salt[10] = header.crc >>> 16 & 255;
    const result = Buffer.alloc(data.length + 12);
    encrypter(salt, result);
    return encrypter(data, result, 12);
  }
  module.exports = { decrypt, encrypt, _salter };
});

// node_modules/adm-zip/methods/index.js
var require_methods = __commonJS(function(exports) {
  exports.Deflater = require_deflater();
  exports.Inflater = require_inflater();
  exports.ZipCrypto = require_zipcrypto();
});

// node_modules/adm-zip/zipEntry.js
var require_zipEntry = __commonJS(function(exports, module) {
  var Utils = require_util();
  var Headers = require_headers();
  var Constants = Utils.Constants;
  var Methods = require_methods();
  module.exports = function(options, input) {
    var _centralHeader = new Headers.EntryHeader, _entryName = Buffer.alloc(0), _comment = Buffer.alloc(0), _isDirectory = false, uncompressedData = null, _extra = Buffer.alloc(0), _extralocal = Buffer.alloc(0), _efs = true;
    const opts = options;
    const decoder = typeof opts.decoder === "object" ? opts.decoder : Utils.decoder;
    _efs = decoder.hasOwnProperty("efs") ? decoder.efs : false;
    function getCompressedDataFromZip() {
      if (!input || !(input instanceof Uint8Array)) {
        return Buffer.alloc(0);
      }
      _extralocal = _centralHeader.loadLocalHeaderFromBinary(input);
      const dataOffset = _centralHeader.realDataOffset;
      const dataEnd = dataOffset + _centralHeader.compressedSize;
      if (dataOffset < 0 || dataEnd < dataOffset || dataEnd > input.length) {
        throw Utils.Errors.INVALID_LOC();
      }
      return input.slice(dataOffset, dataEnd);
    }
    function crc32OK(data) {
      const expectedCrc = _centralHeader.flags_desc || _centralHeader.localHeader.flags_desc ? _centralHeader.crc : _centralHeader.localHeader.crc;
      return Utils.crc32(data) === expectedCrc;
    }
    function decompress(async, callback, pass) {
      if (typeof callback === "undefined" && typeof async === "string") {
        pass = async;
        async = undefined;
      }
      if (_isDirectory) {
        if (async && callback) {
          callback(Buffer.alloc(0), Utils.Errors.DIRECTORY_CONTENT_ERROR());
        }
        return Buffer.alloc(0);
      }
      var compressedData;
      try {
        compressedData = getCompressedDataFromZip();
        if (compressedData.length === 0) {
          if (async && callback)
            callback(compressedData);
          return compressedData;
        }
        if (_centralHeader.encrypted) {
          if (typeof pass !== "string" && !Buffer.isBuffer(pass)) {
            throw Utils.Errors.INVALID_PASS_PARAM();
          }
          compressedData = Methods.ZipCrypto.decrypt(compressedData, _centralHeader, pass);
        }
      } catch (err) {
        if (async && callback) {
          callback(Buffer.alloc(0), err);
          return Buffer.alloc(0);
        }
        throw err;
      }
      var data;
      switch (_centralHeader.method) {
        case Utils.Constants.STORED:
          data = Buffer.alloc(compressedData.length);
          compressedData.copy(data);
          if (!crc32OK(data)) {
            if (async && callback)
              callback(data, Utils.Errors.BAD_CRC());
            throw Utils.Errors.BAD_CRC();
          } else {
            if (async && callback)
              callback(data);
            return data;
          }
        case Utils.Constants.DEFLATED:
          var inflater = new Methods.Inflater(compressedData, _centralHeader.size);
          if (!async) {
            data = inflater.inflate();
            if (!crc32OK(data)) {
              throw Utils.Errors.BAD_CRC(`"${decoder.decode(_entryName)}"`);
            }
            return data;
          } else {
            inflater.inflateAsync(function(result, err) {
              if (!callback)
                return;
              if (err) {
                callback(Buffer.alloc(0), err);
              } else if (!crc32OK(result)) {
                callback(result, Utils.Errors.BAD_CRC());
              } else {
                callback(result);
              }
            });
          }
          break;
        default:
          if (async && callback)
            callback(Buffer.alloc(0), Utils.Errors.UNKNOWN_METHOD());
          throw Utils.Errors.UNKNOWN_METHOD();
      }
    }
    function compress(async, callback) {
      if ((!uncompressedData || !uncompressedData.length) && Buffer.isBuffer(input)) {
        if (async && callback)
          callback(getCompressedDataFromZip());
        return getCompressedDataFromZip();
      }
      if (uncompressedData.length && !_isDirectory) {
        var compressedData;
        switch (_centralHeader.method) {
          case Utils.Constants.STORED:
            _centralHeader.compressedSize = _centralHeader.size;
            compressedData = Buffer.alloc(uncompressedData.length);
            uncompressedData.copy(compressedData);
            if (async && callback)
              callback(compressedData);
            return compressedData;
          default:
          case Utils.Constants.DEFLATED:
            var deflater = new Methods.Deflater(uncompressedData);
            if (!async) {
              var deflated = deflater.deflate();
              _centralHeader.compressedSize = deflated.length;
              return deflated;
            } else {
              deflater.deflateAsync(function(data) {
                compressedData = Buffer.alloc(data.length);
                _centralHeader.compressedSize = data.length;
                data.copy(compressedData);
                callback && callback(compressedData);
              });
            }
            deflater = null;
            break;
        }
      } else if (async && callback) {
        callback(Buffer.alloc(0));
      } else {
        return Buffer.alloc(0);
      }
    }
    function readUInt64LE(buffer, offset) {
      return Utils.readBigUInt64LE(buffer, offset);
    }
    function parseExtra(data) {
      try {
        var offset = 0;
        var signature, size, part;
        while (offset + 4 < data.length) {
          signature = data.readUInt16LE(offset);
          offset += 2;
          size = data.readUInt16LE(offset);
          offset += 2;
          part = data.slice(offset, offset + size);
          offset += size;
          if (Constants.ID_ZIP64 === signature) {
            parseZip64ExtendedInformation(part);
          }
        }
      } catch (error) {
        throw Utils.Errors.EXTRA_FIELD_PARSE_ERROR();
      }
    }
    function parseZip64ExtendedInformation(data) {
      var size, compressedSize, offset, diskNumStart;
      if (data.length >= Constants.EF_ZIP64_SCOMP) {
        size = readUInt64LE(data, Constants.EF_ZIP64_SUNCOMP);
        if (_centralHeader.size === Constants.EF_ZIP64_OR_32) {
          _centralHeader.size = size;
        }
      }
      if (data.length >= Constants.EF_ZIP64_RHO) {
        compressedSize = readUInt64LE(data, Constants.EF_ZIP64_SCOMP);
        if (_centralHeader.compressedSize === Constants.EF_ZIP64_OR_32) {
          _centralHeader.compressedSize = compressedSize;
        }
      }
      if (data.length >= Constants.EF_ZIP64_DSN) {
        offset = readUInt64LE(data, Constants.EF_ZIP64_RHO);
        if (_centralHeader.offset === Constants.EF_ZIP64_OR_32) {
          _centralHeader.offset = offset;
        }
      }
      if (data.length >= Constants.EF_ZIP64_DSN + 4) {
        diskNumStart = data.readUInt32LE(Constants.EF_ZIP64_DSN);
        if (_centralHeader.diskNumStart === Constants.EF_ZIP64_OR_16) {
          _centralHeader.diskNumStart = diskNumStart;
        }
      }
    }
    return {
      get entryName() {
        return decoder.decode(_entryName);
      },
      get rawEntryName() {
        return _entryName;
      },
      set entryName(val) {
        _entryName = Utils.toBuffer(val, decoder.encode);
        var lastChar = _entryName[_entryName.length - 1];
        _isDirectory = lastChar === 47 || lastChar === 92;
        _centralHeader.fileNameLength = _entryName.length;
      },
      get efs() {
        if (typeof _efs === "function") {
          return _efs(this.entryName);
        } else {
          return _efs;
        }
      },
      get extra() {
        return _extra;
      },
      set extra(val) {
        _extra = val;
        _centralHeader.extraLength = val.length;
        parseExtra(val);
      },
      get comment() {
        return decoder.decode(_comment);
      },
      set comment(val) {
        _comment = Utils.toBuffer(val, decoder.encode);
        _centralHeader.commentLength = _comment.length;
        if (_comment.length > 65535)
          throw Utils.Errors.COMMENT_TOO_LONG();
      },
      get name() {
        const n = decoder.decode(_entryName);
        return _isDirectory ? n.replace(/[/\\]$/, "").split("/").pop() : n.split("/").pop();
      },
      get isDirectory() {
        return _isDirectory;
      },
      getCompressedData: function() {
        return compress(false, null);
      },
      getCompressedDataAsync: function(callback) {
        compress(true, callback);
      },
      setData: function(value) {
        uncompressedData = Utils.toBuffer(value, Utils.decoder.encode);
        if (!_isDirectory && uncompressedData.length) {
          _centralHeader.size = uncompressedData.length;
          _centralHeader.method = Utils.Constants.DEFLATED;
          _centralHeader.crc = Utils.crc32(value);
          _centralHeader.changed = true;
        } else {
          _centralHeader.method = Utils.Constants.STORED;
        }
      },
      getData: function(pass) {
        if (_centralHeader.changed) {
          return uncompressedData;
        } else {
          return decompress(false, null, pass);
        }
      },
      getDataAsync: function(callback, pass) {
        if (_centralHeader.changed) {
          callback(uncompressedData);
        } else {
          decompress(true, callback, pass);
        }
      },
      set attr(attr) {
        _centralHeader.attr = attr;
      },
      get attr() {
        return _centralHeader.attr;
      },
      set header(data) {
        _centralHeader.loadFromBinary(data);
      },
      get header() {
        return _centralHeader;
      },
      packCentralHeader: function() {
        _centralHeader.flags_efs = this.efs;
        _centralHeader.extraLength = _extra.length;
        var header = _centralHeader.centralHeaderToBinary();
        var addpos = Utils.Constants.CENHDR;
        _entryName.copy(header, addpos);
        addpos += _entryName.length;
        _extra.copy(header, addpos);
        addpos += _centralHeader.extraLength;
        _comment.copy(header, addpos);
        return header;
      },
      packLocalHeader: function() {
        let addpos = 0;
        _centralHeader.flags_efs = this.efs;
        _centralHeader.extraLocalLength = _extralocal.length;
        const localHeaderBuf = _centralHeader.localHeaderToBinary();
        const localHeader = Buffer.alloc(localHeaderBuf.length + _entryName.length + _centralHeader.extraLocalLength);
        localHeaderBuf.copy(localHeader, addpos);
        addpos += localHeaderBuf.length;
        _entryName.copy(localHeader, addpos);
        addpos += _entryName.length;
        _extralocal.copy(localHeader, addpos);
        addpos += _extralocal.length;
        return localHeader;
      },
      toJSON: function() {
        const bytes = function(nr) {
          return "<" + (nr && nr.length + " bytes buffer" || "null") + ">";
        };
        return {
          entryName: this.entryName,
          name: this.name,
          comment: this.comment,
          isDirectory: this.isDirectory,
          header: _centralHeader.toJSON(),
          compressedData: bytes(input),
          data: bytes(uncompressedData)
        };
      },
      toString: function() {
        return JSON.stringify(this.toJSON(), null, "\t");
      }
    };
  };
});

// node_modules/adm-zip/zipFile.js
var require_zipFile = __commonJS(function(exports, module) {
  var ZipEntry = require_zipEntry();
  var Headers = require_headers();
  var Utils = require_util();
  module.exports = function(inBuffer, options) {
    var entryList = [], entryTable = Object.create(null), _comment = Buffer.alloc(0), mainHeader = new Headers.MainHeader, loadedEntries = false;
    var password = null;
    const temporary = new Set;
    const opts = options;
    const { noSort, decoder } = opts;
    if (inBuffer) {
      readMainHeader(opts.readEntries);
    } else {
      loadedEntries = true;
    }
    function makeTemporaryFolders() {
      const foldersList = new Set;
      for (const elem of Object.keys(entryTable)) {
        const elements = elem.split("/");
        elements.pop();
        if (!elements.length)
          continue;
        for (let i = 0;i < elements.length; i++) {
          const sub = elements.slice(0, i + 1).join("/") + "/";
          foldersList.add(sub);
        }
      }
      for (const elem of foldersList) {
        if (!(elem in entryTable)) {
          const tempfolder = new ZipEntry(opts);
          tempfolder.entryName = elem;
          tempfolder.attr = 16;
          tempfolder.temporary = true;
          entryList.push(tempfolder);
          entryTable[tempfolder.entryName] = tempfolder;
          temporary.add(tempfolder);
        }
      }
    }
    function readEntries() {
      loadedEntries = true;
      entryTable = Object.create(null);
      if (mainHeader.diskEntries > (inBuffer.length - mainHeader.offset) / Utils.Constants.CENHDR) {
        throw Utils.Errors.DISK_ENTRY_TOO_LARGE();
      }
      entryList = new Array(mainHeader.diskEntries);
      var index = mainHeader.offset;
      for (var i = 0;i < entryList.length; i++) {
        var tmp = index, entry = new ZipEntry(opts, inBuffer);
        entry.header = inBuffer.slice(tmp, tmp += Utils.Constants.CENHDR);
        entry.entryName = inBuffer.slice(tmp, tmp += entry.header.fileNameLength);
        if (entry.header.extraLength) {
          entry.extra = inBuffer.slice(tmp, tmp += entry.header.extraLength);
        }
        if (entry.header.commentLength)
          entry.comment = inBuffer.slice(tmp, tmp + entry.header.commentLength);
        index += entry.header.centralHeaderSize;
        if (entry.entryName in entryTable) {
          throw Utils.Errors.DUPLICATE_ENTRY(`"${entry.entryName}"`);
        }
        entryList[i] = entry;
        entryTable[entry.entryName] = entry;
      }
      temporary.clear();
      makeTemporaryFolders();
    }
    function readMainHeader(readNow) {
      var i = inBuffer.length - Utils.Constants.ENDHDR, max = Math.max(0, i - 65535), n = max, endStart = inBuffer.length, endOffset = -1, commentEnd = 0;
      const trailingSpace = typeof opts.trailingSpace === "boolean" ? opts.trailingSpace : false;
      if (trailingSpace)
        max = 0;
      for (i;i >= n; i--) {
        if (inBuffer[i] !== 80)
          continue;
        if (inBuffer.readUInt32LE(i) === Utils.Constants.ENDSIG) {
          endOffset = i;
          commentEnd = i;
          endStart = i + Utils.Constants.ENDHDR;
          n = i - Utils.Constants.END64HDR;
          continue;
        }
        if (inBuffer.readUInt32LE(i) === Utils.Constants.END64SIG) {
          n = max;
          continue;
        }
        if (inBuffer.readUInt32LE(i) === Utils.Constants.ZIP64SIG) {
          endOffset = i;
          endStart = i + Utils.readBigUInt64LE(inBuffer, i + Utils.Constants.ZIP64SIZE) + Utils.Constants.ZIP64LEAD;
          break;
        }
      }
      if (endOffset == -1)
        throw Utils.Errors.INVALID_FORMAT();
      mainHeader.loadFromBinary(inBuffer.slice(endOffset, endStart));
      if (mainHeader.commentLength) {
        _comment = inBuffer.slice(commentEnd + Utils.Constants.ENDHDR);
      }
      if (readNow)
        readEntries();
    }
    function sortEntries() {
      if (entryList.length > 1 && !noSort) {
        entryList = entryList.map((entry) => ({ entry, key: entry.entryName.toLowerCase() })).sort((a, b) => a.key.localeCompare(b.key)).map((pair) => pair.entry);
      }
    }
    return {
      get entries() {
        if (!loadedEntries) {
          readEntries();
        }
        return entryList.filter((e) => !temporary.has(e));
      },
      get comment() {
        return decoder.decode(_comment);
      },
      set comment(val) {
        _comment = Utils.toBuffer(val, decoder.encode);
        mainHeader.commentLength = _comment.length;
      },
      getEntryCount: function() {
        if (!loadedEntries) {
          return mainHeader.diskEntries;
        }
        return entryList.length;
      },
      forEach: function(callback) {
        this.entries.forEach(callback);
      },
      getEntry: function(entryName) {
        if (!loadedEntries) {
          readEntries();
        }
        return entryTable[entryName] || null;
      },
      setEntry: function(entry) {
        if (!loadedEntries) {
          readEntries();
        }
        entryList.push(entry);
        entryTable[entry.entryName] = entry;
        mainHeader.totalEntries = entryList.length;
      },
      deleteFile: function(entryName, withsubfolders = true) {
        if (!loadedEntries) {
          readEntries();
        }
        const entry = entryTable[entryName];
        const list = this.getEntryChildren(entry, withsubfolders).map((child) => child.entryName);
        list.forEach(this.deleteEntry);
      },
      deleteEntry: function(entryName) {
        if (!loadedEntries) {
          readEntries();
        }
        const entry = entryTable[entryName];
        const index = entryList.indexOf(entry);
        if (index >= 0) {
          entryList.splice(index, 1);
          delete entryTable[entryName];
          mainHeader.totalEntries = entryList.length;
        }
      },
      getEntryChildren: function(entry, subfolders = true) {
        if (!loadedEntries) {
          readEntries();
        }
        if (typeof entry === "object") {
          if (entry.isDirectory && subfolders) {
            const list = [];
            const name = entry.entryName;
            for (const zipEntry of entryList) {
              if (zipEntry.entryName.startsWith(name)) {
                list.push(zipEntry);
              }
            }
            return list;
          } else {
            return [entry];
          }
        }
        return [];
      },
      getChildCount: function(entry) {
        if (entry && entry.isDirectory) {
          const list = this.getEntryChildren(entry);
          return list.includes(entry) ? list.length - 1 : list.length;
        }
        return 0;
      },
      compressToBuffer: function() {
        if (!loadedEntries) {
          readEntries();
        }
        sortEntries();
        const dataBlock = [];
        const headerBlocks = [];
        let totalSize = 0;
        let dindex = 0;
        mainHeader.size = 0;
        mainHeader.offset = 0;
        let totalEntries = 0;
        for (const entry of this.entries) {
          const compressedData = entry.getCompressedData();
          entry.header.offset = dindex;
          const localHeader = entry.packLocalHeader();
          const dataLength = localHeader.length + compressedData.length;
          dindex += dataLength;
          dataBlock.push(localHeader);
          dataBlock.push(compressedData);
          const centralHeader = entry.packCentralHeader();
          headerBlocks.push(centralHeader);
          mainHeader.size += centralHeader.length;
          totalSize += dataLength + centralHeader.length;
          totalEntries++;
        }
        totalSize += mainHeader.mainHeaderSize;
        mainHeader.offset = dindex;
        mainHeader.totalEntries = totalEntries;
        dindex = 0;
        const outBuffer = Buffer.alloc(totalSize);
        for (const content of dataBlock) {
          content.copy(outBuffer, dindex);
          dindex += content.length;
        }
        for (const content of headerBlocks) {
          content.copy(outBuffer, dindex);
          dindex += content.length;
        }
        const mh = mainHeader.toBinary();
        if (_comment) {
          _comment.copy(mh, mh.length - _comment.length);
        }
        mh.copy(outBuffer, dindex);
        inBuffer = outBuffer;
        loadedEntries = false;
        return outBuffer;
      },
      toAsyncBuffer: function(onSuccess, onFail, onItemStart, onItemEnd) {
        try {
          if (!loadedEntries) {
            readEntries();
          }
          sortEntries();
          const dataBlock = [];
          const centralHeaders = [];
          let totalSize = 0;
          let dindex = 0;
          let totalEntries = 0;
          mainHeader.size = 0;
          mainHeader.offset = 0;
          const compress2Buffer = function(entryLists) {
            if (entryLists.length > 0) {
              const entry = entryLists.shift();
              const name = entry.entryName + entry.extra.toString();
              if (onItemStart)
                onItemStart(name);
              entry.getCompressedDataAsync(function(compressedData) {
                if (onItemEnd)
                  onItemEnd(name);
                entry.header.offset = dindex;
                const localHeader = entry.packLocalHeader();
                const dataLength = localHeader.length + compressedData.length;
                dindex += dataLength;
                dataBlock.push(localHeader);
                dataBlock.push(compressedData);
                const centalHeader = entry.packCentralHeader();
                centralHeaders.push(centalHeader);
                mainHeader.size += centalHeader.length;
                totalSize += dataLength + centalHeader.length;
                totalEntries++;
                compress2Buffer(entryLists);
              });
            } else {
              totalSize += mainHeader.mainHeaderSize;
              mainHeader.offset = dindex;
              mainHeader.totalEntries = totalEntries;
              dindex = 0;
              const outBuffer = Buffer.alloc(totalSize);
              dataBlock.forEach(function(content) {
                content.copy(outBuffer, dindex);
                dindex += content.length;
              });
              centralHeaders.forEach(function(content) {
                content.copy(outBuffer, dindex);
                dindex += content.length;
              });
              const mh = mainHeader.toBinary();
              if (_comment) {
                _comment.copy(mh, mh.length - _comment.length);
              }
              mh.copy(outBuffer, dindex);
              inBuffer = outBuffer;
              loadedEntries = false;
              onSuccess(outBuffer);
            }
          };
          compress2Buffer(Array.from(this.entries));
        } catch (e) {
          onFail(e);
        }
      }
    };
  };
});

// node_modules/adm-zip/adm-zip.js
var require_adm_zip = __commonJS(function(exports, module) {
  var Utils = require_util();
  var pth = __require("path");
  var ZipEntry = require_zipEntry();
  var ZipFile = require_zipFile();
  var get_Bool = (...val) => Utils.findLast(val, (c) => typeof c === "boolean");
  var get_Str = (...val) => Utils.findLast(val, (c) => typeof c === "string");
  var get_Fun = (...val) => Utils.findLast(val, (c) => typeof c === "function");
  var defaultOptions = {
    noSort: false,
    readEntries: false,
    method: Utils.Constants.NONE,
    fs: null
  };
  module.exports = function(input, options) {
    let inBuffer = null;
    const opts = Object.assign(Object.create(null), defaultOptions);
    if (input && typeof input === "object") {
      if (!(input instanceof Uint8Array)) {
        Object.assign(opts, input);
        input = opts.input ? opts.input : undefined;
        if (opts.input)
          delete opts.input;
      }
      if (Buffer.isBuffer(input)) {
        inBuffer = input;
        opts.method = Utils.Constants.BUFFER;
        input = undefined;
      }
    }
    Object.assign(opts, options);
    const filetools = new Utils(opts);
    const applyDirAttributes = (dirEntries) => {
      dirEntries.filter((d) => d.attr).sort((a, b) => b.path.length - a.path.length).forEach((d) => filetools.fs.chmodSync(d.path, d.attr));
    };
    if (typeof opts.decoder !== "object" || typeof opts.decoder.encode !== "function" || typeof opts.decoder.decode !== "function") {
      opts.decoder = Utils.decoder;
    }
    if (input && typeof input === "string") {
      if (filetools.fs.existsSync(input)) {
        opts.method = Utils.Constants.FILE;
        opts.filename = input;
        inBuffer = filetools.fs.readFileSync(input);
      } else {
        throw Utils.Errors.INVALID_FILENAME();
      }
    }
    const _zip = new ZipFile(inBuffer, opts);
    const { canonical, sanitize, zipnamefix } = Utils;
    function getEntry(entry) {
      if (entry && _zip) {
        var item;
        if (typeof entry === "string")
          item = _zip.getEntry(pth.posix.normalize(entry));
        if (typeof entry === "object" && typeof entry.entryName !== "undefined" && typeof entry.header !== "undefined")
          item = _zip.getEntry(entry.entryName);
        if (item) {
          return item;
        }
      }
      return null;
    }
    function fixPath(zipPath) {
      const { join, normalize, sep } = pth.posix;
      return join(pth.isAbsolute(zipPath) ? "/" : ".", normalize(sep + zipPath.split("\\").join(sep) + sep));
    }
    function filenameFilter(filterfn) {
      if (filterfn instanceof RegExp) {
        return function(rx) {
          return function(filename) {
            return rx.test(filename);
          };
        }(filterfn);
      } else if (typeof filterfn !== "function") {
        return () => true;
      }
      return filterfn;
    }
    const relativePath = (local, entry) => {
      let lastChar = entry.slice(-1);
      lastChar = lastChar === filetools.sep ? filetools.sep : "";
      return pth.relative(local, entry) + lastChar;
    };
    return {
      readFile: function(entry, pass) {
        var item = getEntry(entry);
        return item && item.getData(pass) || null;
      },
      childCount: function(entry) {
        const item = getEntry(entry);
        if (item) {
          return _zip.getChildCount(item);
        }
      },
      readFileAsync: function(entry, callback) {
        var item = getEntry(entry);
        if (item) {
          item.getDataAsync(callback);
        } else {
          callback(null, "getEntry failed for:" + entry);
        }
      },
      readAsText: function(entry, encoding) {
        var item = getEntry(entry);
        if (item) {
          var data = item.getData();
          if (data && data.length) {
            return data.toString(encoding || "utf8");
          }
        }
        return "";
      },
      readAsTextAsync: function(entry, callback, encoding) {
        var item = getEntry(entry);
        if (item) {
          item.getDataAsync(function(data, err) {
            if (err) {
              callback(data, err);
              return;
            }
            if (data && data.length) {
              callback(data.toString(encoding || "utf8"));
            } else {
              callback("");
            }
          });
        } else {
          callback("");
        }
      },
      deleteFile: function(entry, withsubfolders = true) {
        var item = getEntry(entry);
        if (item) {
          _zip.deleteFile(item.entryName, withsubfolders);
        }
      },
      deleteEntry: function(entry) {
        var item = getEntry(entry);
        if (item) {
          _zip.deleteEntry(item.entryName);
        }
      },
      addZipComment: function(comment) {
        _zip.comment = comment;
      },
      getZipComment: function() {
        return _zip.comment || "";
      },
      addZipEntryComment: function(entry, comment) {
        var item = getEntry(entry);
        if (item) {
          item.comment = comment;
        }
      },
      getZipEntryComment: function(entry) {
        var item = getEntry(entry);
        if (item) {
          return item.comment || "";
        }
        return "";
      },
      updateFile: function(entry, content) {
        var item = getEntry(entry);
        if (item) {
          item.setData(content);
        }
      },
      addLocalFile: function(localPath, zipPath, zipName, comment) {
        if (filetools.fs.existsSync(localPath)) {
          zipPath = zipPath ? fixPath(zipPath) : "";
          const p = pth.win32.basename(pth.win32.normalize(localPath));
          zipPath += zipName ? zipName : p;
          const _attr = filetools.fs.statSync(localPath);
          const data = _attr.isFile() ? filetools.fs.readFileSync(localPath) : Buffer.alloc(0);
          if (_attr.isDirectory())
            zipPath += filetools.sep;
          this.addFile(zipPath, data, comment, _attr);
        } else {
          throw Utils.Errors.FILE_NOT_FOUND(localPath);
        }
      },
      addLocalFileAsync: function(options, callback) {
        options = typeof options === "object" ? options : { localPath: options };
        const localPath = pth.resolve(options.localPath);
        const { comment } = options;
        let { zipPath, zipName } = options;
        const self = this;
        filetools.fs.stat(localPath, function(err, stats) {
          if (err)
            return callback(err, false);
          zipPath = zipPath ? fixPath(zipPath) : "";
          const p = pth.win32.basename(pth.win32.normalize(localPath));
          zipPath += zipName ? zipName : p;
          if (stats.isFile()) {
            filetools.fs.readFile(localPath, function(err, data) {
              if (err)
                return callback(err, false);
              self.addFile(zipPath, data, comment, stats);
              return setImmediate(callback, undefined, true);
            });
          } else if (stats.isDirectory()) {
            zipPath += filetools.sep;
            self.addFile(zipPath, Buffer.alloc(0), comment, stats);
            return setImmediate(callback, undefined, true);
          }
        });
      },
      addLocalFolder: function(localPath, zipPath, filter) {
        filter = filenameFilter(filter);
        zipPath = zipPath ? fixPath(zipPath) : "";
        localPath = pth.normalize(localPath);
        if (filetools.fs.existsSync(localPath)) {
          const items = filetools.findFiles(localPath);
          const self = this;
          if (items.length) {
            for (const filepath of items) {
              const p = pth.join(zipPath, relativePath(localPath, filepath));
              if (filter(p)) {
                self.addLocalFile(filepath, pth.dirname(p));
              }
            }
          }
        } else {
          throw Utils.Errors.FILE_NOT_FOUND(localPath);
        }
      },
      addLocalFolderAsync: function(localPath, callback, zipPath, filter) {
        filter = filenameFilter(filter);
        zipPath = zipPath ? fixPath(zipPath) : "";
        localPath = pth.normalize(localPath);
        var self = this;
        filetools.fs.open(localPath, "r", function(err) {
          if (err && err.code === "ENOENT") {
            callback(undefined, Utils.Errors.FILE_NOT_FOUND(localPath));
          } else if (err) {
            callback(undefined, err);
          } else {
            var items = filetools.findFiles(localPath);
            var i = -1;
            var next = function() {
              i += 1;
              if (i < items.length) {
                var filepath = items[i];
                var p = relativePath(localPath, filepath).split("\\").join("/");
                p = p.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");
                if (filter(p)) {
                  filetools.fs.stat(filepath, function(er0, stats) {
                    if (er0)
                      callback(undefined, er0);
                    if (stats.isFile()) {
                      filetools.fs.readFile(filepath, function(er1, data) {
                        if (er1) {
                          callback(undefined, er1);
                        } else {
                          self.addFile(zipPath + p, data, "", stats);
                          next();
                        }
                      });
                    } else {
                      self.addFile(zipPath + p + "/", Buffer.alloc(0), "", stats);
                      next();
                    }
                  });
                } else {
                  process.nextTick(() => {
                    next();
                  });
                }
              } else {
                callback(true, undefined);
              }
            };
            next();
          }
        });
      },
      addLocalFolderAsync2: function(options, callback) {
        const self = this;
        options = typeof options === "object" ? options : { localPath: options };
        const localPath = pth.resolve(options.localPath);
        let { zipPath, filter, namefix } = options;
        if (filter instanceof RegExp) {
          filter = function(rx) {
            return function(filename) {
              return rx.test(filename);
            };
          }(filter);
        } else if (typeof filter !== "function") {
          filter = function() {
            return true;
          };
        }
        zipPath = zipPath ? fixPath(zipPath) : "";
        if (namefix === "latin1") {
          namefix = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");
        }
        if (typeof namefix !== "function")
          namefix = (str) => str;
        const relPathFix = (entry) => pth.join(zipPath, namefix(relativePath(localPath, entry)));
        const fileNameFix = (entry) => pth.win32.basename(pth.win32.normalize(namefix(entry)));
        filetools.fs.open(localPath, "r", function(err) {
          if (err && err.code === "ENOENT") {
            callback(Utils.Errors.FILE_NOT_FOUND(localPath), false);
          } else if (err) {
            callback(err, false);
          } else {
            filetools.findFilesAsync(localPath, function(err, fileEntries) {
              if (err)
                return callback(err, false);
              fileEntries = fileEntries.filter((dir) => filter(relPathFix(dir)));
              if (!fileEntries.length)
                return callback(undefined, true);
              setImmediate(fileEntries.reverse().reduce(function(next, entry) {
                return function(err, done) {
                  if (err || done === false)
                    return setImmediate(next, err, false);
                  self.addLocalFileAsync({
                    localPath: entry,
                    zipPath: pth.dirname(relPathFix(entry)),
                    zipName: fileNameFix(entry)
                  }, next);
                };
              }, callback));
            });
          }
        });
      },
      addLocalFolderPromise: function(localPath, props) {
        return new Promise((resolve, reject) => {
          this.addLocalFolderAsync2(Object.assign({ localPath }, props), (err, done) => {
            if (err)
              return reject(err);
            if (done)
              resolve(this);
          });
        });
      },
      addFile: function(entryName, content, comment, attr) {
        entryName = zipnamefix(entryName);
        let entry = getEntry(entryName);
        const update = entry != null;
        if (!update) {
          entry = new ZipEntry(opts);
          entry.entryName = entryName;
        }
        entry.comment = comment || "";
        const isStat = typeof attr === "object" && attr instanceof filetools.fs.Stats;
        if (isStat) {
          entry.header.time = attr.mtime;
        }
        var fileattr = entry.isDirectory ? 16 : 0;
        let unix = entry.isDirectory ? 16384 : 32768;
        if (isStat) {
          unix |= 4095 & attr.mode;
        } else if (typeof attr === "number") {
          unix |= 4095 & attr;
        } else {
          unix |= entry.isDirectory ? 493 : 420;
        }
        fileattr = (fileattr | unix << 16) >>> 0;
        entry.attr = fileattr;
        entry.setData(content);
        if (!update)
          _zip.setEntry(entry);
        return entry;
      },
      getEntries: function(password) {
        _zip.password = password;
        return _zip ? _zip.entries : [];
      },
      getEntry: function(name) {
        return getEntry(name);
      },
      getEntryCount: function() {
        return _zip.getEntryCount();
      },
      forEach: function(callback) {
        return _zip.forEach(callback);
      },
      extractEntryTo: function(entry, targetPath, maintainEntryPath, overwrite, keepOriginalPermission, outFileName) {
        overwrite = get_Bool(false, overwrite);
        keepOriginalPermission = get_Bool(false, keepOriginalPermission);
        maintainEntryPath = get_Bool(true, maintainEntryPath);
        outFileName = get_Str(keepOriginalPermission, outFileName);
        var item = getEntry(entry);
        if (!item) {
          throw Utils.Errors.NO_ENTRY();
        }
        var entryName = canonical(item.entryName);
        var target = sanitize(targetPath, outFileName && !item.isDirectory ? canonical(outFileName) : maintainEntryPath ? entryName : pth.basename(entryName));
        if (item.isDirectory) {
          var children = _zip.getEntryChildren(item);
          children.forEach(function(child) {
            if (child.isDirectory)
              return;
            var content = child.getData();
            if (!content) {
              throw Utils.Errors.CANT_EXTRACT_FILE();
            }
            var name = canonical(maintainEntryPath ? child.entryName : child.entryName.substring(item.entryName.length));
            var childName = sanitize(targetPath, name);
            filetools.assertPathSafe(targetPath, childName);
            const fileAttr = keepOriginalPermission ? child.header.fileAttr : undefined;
            filetools.writeFileTo(childName, content, overwrite, fileAttr);
          });
          return true;
        }
        var content = item.getData(_zip.password);
        if (!content)
          throw Utils.Errors.CANT_EXTRACT_FILE();
        filetools.assertPathSafe(targetPath, target);
        if (filetools.fs.existsSync(target) && !overwrite) {
          throw Utils.Errors.CANT_OVERRIDE();
        }
        const fileAttr = keepOriginalPermission ? entry.header.fileAttr : undefined;
        filetools.writeFileTo(target, content, overwrite, fileAttr);
        return true;
      },
      test: function(pass) {
        if (!_zip) {
          return false;
        }
        for (var entry of _zip.entries) {
          try {
            if (entry.isDirectory) {
              continue;
            }
            var content = entry.getData(pass);
            if (!content) {
              return false;
            }
          } catch (err) {
            return false;
          }
        }
        return true;
      },
      extractAllTo: function(targetPath, overwrite, keepOriginalPermission, pass) {
        keepOriginalPermission = get_Bool(false, keepOriginalPermission);
        pass = get_Str(keepOriginalPermission, pass);
        overwrite = get_Bool(false, overwrite);
        if (!_zip)
          throw Utils.Errors.NO_ZIP();
        const dirEntries = [];
        _zip.entries.forEach(function(entry) {
          var entryName = sanitize(targetPath, canonical(entry.entryName));
          filetools.assertPathSafe(targetPath, entryName);
          if (entry.isDirectory) {
            filetools.makeDir(entryName);
            if (keepOriginalPermission)
              dirEntries.push({ path: entryName, attr: entry.header.fileAttr });
            return;
          }
          var content = entry.getData(pass);
          if (!content) {
            throw Utils.Errors.CANT_EXTRACT_FILE();
          }
          const fileAttr = keepOriginalPermission ? entry.header.fileAttr : undefined;
          filetools.writeFileTo(entryName, content, overwrite, fileAttr);
          try {
            filetools.fs.utimesSync(entryName, entry.header.time, entry.header.time);
          } catch (err) {}
        });
        applyDirAttributes(dirEntries);
      },
      extractAllToAsync: function(targetPath, overwrite, keepOriginalPermission, callback) {
        callback = get_Fun(overwrite, keepOriginalPermission, callback);
        keepOriginalPermission = get_Bool(false, keepOriginalPermission);
        overwrite = get_Bool(false, overwrite);
        if (!callback) {
          return new Promise((resolve, reject) => {
            this.extractAllToAsync(targetPath, overwrite, keepOriginalPermission, function(err) {
              if (err) {
                reject(err);
              } else {
                resolve(this);
              }
            });
          });
        }
        if (!_zip) {
          callback(Utils.Errors.NO_ZIP());
          return;
        }
        targetPath = pth.resolve(targetPath);
        const getPath = (entry) => sanitize(targetPath, pth.normalize(canonical(entry.entryName)));
        const getError = (msg, file) => new Error(msg + ': "' + file + '"');
        const dirEntries = [];
        const fileEntries = [];
        _zip.entries.forEach((e) => {
          if (e.isDirectory) {
            dirEntries.push(e);
          } else {
            fileEntries.push(e);
          }
        });
        const deferredDirAttr = [];
        for (const entry of dirEntries) {
          const dirPath = getPath(entry);
          const dirAttr = keepOriginalPermission ? entry.header.fileAttr : undefined;
          try {
            filetools.assertPathSafe(targetPath, dirPath);
            filetools.makeDir(dirPath);
          } catch (er) {
            callback(getError("Unable to create folder", dirPath));
            continue;
          }
          if (dirAttr)
            deferredDirAttr.push({ path: dirPath, attr: dirAttr });
          try {
            filetools.fs.utimesSync(dirPath, entry.header.time, entry.header.time);
          } catch (er) {}
        }
        const done = (err) => {
          if (!err) {
            try {
              applyDirAttributes(deferredDirAttr);
            } catch (er) {
              return callback(getError("Unable to set folder permissions", er.path || ""));
            }
          }
          callback(err);
        };
        fileEntries.reverse().reduce(function(next, entry) {
          return function(err) {
            if (err) {
              next(err);
            } else {
              const entryName = pth.normalize(canonical(entry.entryName));
              const filePath = sanitize(targetPath, entryName);
              try {
                filetools.assertPathSafe(targetPath, filePath);
              } catch (er) {
                return next(er);
              }
              entry.getDataAsync(function(content, err_1) {
                if (err_1) {
                  next(err_1);
                } else if (!content) {
                  next(Utils.Errors.CANT_EXTRACT_FILE());
                } else {
                  const fileAttr = keepOriginalPermission ? entry.header.fileAttr : undefined;
                  filetools.writeFileToAsync(filePath, content, overwrite, fileAttr, function(succ) {
                    if (!succ) {
                      return next(getError("Unable to write file", filePath));
                    }
                    filetools.fs.utimes(filePath, entry.header.time, entry.header.time, function() {
                      next();
                    });
                  });
                }
              });
            }
          };
        }, done)();
      },
      writeZip: function(targetFileName, callback) {
        if (arguments.length === 1) {
          if (typeof targetFileName === "function") {
            callback = targetFileName;
            targetFileName = "";
          }
        }
        if (!targetFileName && opts.filename) {
          targetFileName = opts.filename;
        }
        if (!targetFileName)
          return;
        var zipData = _zip.compressToBuffer();
        if (zipData) {
          var ok = filetools.writeFileTo(targetFileName, zipData, true);
          if (typeof callback === "function")
            callback(!ok ? new Error("failed") : null, "");
        }
      },
      writeZipPromise: function(targetFileName, props) {
        const { overwrite, perm } = Object.assign({ overwrite: true }, props);
        return new Promise((resolve, reject) => {
          if (!targetFileName && opts.filename)
            targetFileName = opts.filename;
          if (!targetFileName)
            reject("ADM-ZIP: ZIP File Name Missing");
          this.toBufferPromise().then((zipData) => {
            const ret = (done) => done ? resolve(done) : reject("ADM-ZIP: Wasn't able to write zip file");
            filetools.writeFileToAsync(targetFileName, zipData, overwrite, perm, ret);
          }, reject);
        });
      },
      toBufferPromise: function() {
        return new Promise((resolve, reject) => {
          _zip.toAsyncBuffer(resolve, reject);
        });
      },
      toBuffer: function(onSuccess, onFail, onItemStart, onItemEnd) {
        if (typeof onSuccess === "function") {
          _zip.toAsyncBuffer(onSuccess, onFail, onItemStart, onItemEnd);
          return null;
        }
        return _zip.compressToBuffer();
      }
    };
  };
});

// src/cli.ts
import readline from "node:readline";
import path24 from "node:path";
import fs19 from "node:fs";

// node_modules/chalk/source/vendor/ansi-styles/index.js
var ANSI_BACKGROUND_OFFSET = 10;
var wrapAnsi16 = (offset = 0) => (code) => `\x1B[${code + offset}m`;
var wrapAnsi256 = (offset = 0) => (code) => `\x1B[${38 + offset};5;${code}m`;
var wrapAnsi16m = (offset = 0) => (red, green, blue) => `\x1B[${38 + offset};2;${red};${green};${blue}m`;
var styles = {
  modifier: {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    overline: [53, 55],
    inverse: [7, 27],
    hidden: [8, 28],
    strikethrough: [9, 29]
  },
  color: {
    black: [30, 39],
    red: [31, 39],
    green: [32, 39],
    yellow: [33, 39],
    blue: [34, 39],
    magenta: [35, 39],
    cyan: [36, 39],
    white: [37, 39],
    blackBright: [90, 39],
    gray: [90, 39],
    grey: [90, 39],
    redBright: [91, 39],
    greenBright: [92, 39],
    yellowBright: [93, 39],
    blueBright: [94, 39],
    magentaBright: [95, 39],
    cyanBright: [96, 39],
    whiteBright: [97, 39]
  },
  bgColor: {
    bgBlack: [40, 49],
    bgRed: [41, 49],
    bgGreen: [42, 49],
    bgYellow: [43, 49],
    bgBlue: [44, 49],
    bgMagenta: [45, 49],
    bgCyan: [46, 49],
    bgWhite: [47, 49],
    bgBlackBright: [100, 49],
    bgGray: [100, 49],
    bgGrey: [100, 49],
    bgRedBright: [101, 49],
    bgGreenBright: [102, 49],
    bgYellowBright: [103, 49],
    bgBlueBright: [104, 49],
    bgMagentaBright: [105, 49],
    bgCyanBright: [106, 49],
    bgWhiteBright: [107, 49]
  }
};
var modifierNames = Object.keys(styles.modifier);
var foregroundColorNames = Object.keys(styles.color);
var backgroundColorNames = Object.keys(styles.bgColor);
var colorNames = [...foregroundColorNames, ...backgroundColorNames];
function assembleStyles() {
  const codes = new Map;
  for (const [groupName, group] of Object.entries(styles)) {
    for (const [styleName, style] of Object.entries(group)) {
      styles[styleName] = {
        open: `\x1B[${style[0]}m`,
        close: `\x1B[${style[1]}m`
      };
      group[styleName] = styles[styleName];
      codes.set(style[0], style[1]);
    }
    Object.defineProperty(styles, groupName, {
      value: group,
      enumerable: false
    });
  }
  Object.defineProperty(styles, "codes", {
    value: codes,
    enumerable: false
  });
  styles.color.close = "\x1B[39m";
  styles.bgColor.close = "\x1B[49m";
  styles.color.ansi = wrapAnsi16();
  styles.color.ansi256 = wrapAnsi256();
  styles.color.ansi16m = wrapAnsi16m();
  styles.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);
  Object.defineProperties(styles, {
    rgbToAnsi256: {
      value(red, green, blue) {
        if (red === green && green === blue) {
          if (red < 8) {
            return 16;
          }
          if (red > 248) {
            return 231;
          }
          return Math.round((red - 8) / 247 * 24) + 232;
        }
        return 16 + 36 * Math.round(red / 255 * 5) + 6 * Math.round(green / 255 * 5) + Math.round(blue / 255 * 5);
      },
      enumerable: false
    },
    hexToRgb: {
      value(hex) {
        const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
        if (!matches) {
          return [0, 0, 0];
        }
        let [colorString] = matches;
        if (colorString.length === 3) {
          colorString = [...colorString].map((character) => character + character).join("");
        }
        const integer = Number.parseInt(colorString, 16);
        return [
          integer >> 16 & 255,
          integer >> 8 & 255,
          integer & 255
        ];
      },
      enumerable: false
    },
    hexToAnsi256: {
      value: (hex) => styles.rgbToAnsi256(...styles.hexToRgb(hex)),
      enumerable: false
    },
    ansi256ToAnsi: {
      value(code) {
        if (code < 8) {
          return 30 + code;
        }
        if (code < 16) {
          return 90 + (code - 8);
        }
        let red;
        let green;
        let blue;
        if (code >= 232) {
          red = ((code - 232) * 10 + 8) / 255;
          green = red;
          blue = red;
        } else {
          code -= 16;
          const remainder = code % 36;
          red = Math.floor(code / 36) / 5;
          green = Math.floor(remainder / 6) / 5;
          blue = remainder % 6 / 5;
        }
        const value = Math.max(red, green, blue) * 2;
        if (value === 0) {
          return 30;
        }
        let result = 30 + (Math.round(blue) << 2 | Math.round(green) << 1 | Math.round(red));
        if (value === 2) {
          result += 60;
        }
        return result;
      },
      enumerable: false
    },
    rgbToAnsi: {
      value: (red, green, blue) => styles.ansi256ToAnsi(styles.rgbToAnsi256(red, green, blue)),
      enumerable: false
    },
    hexToAnsi: {
      value: (hex) => styles.ansi256ToAnsi(styles.hexToAnsi256(hex)),
      enumerable: false
    }
  });
  return styles;
}
var ansiStyles = assembleStyles();
var ansi_styles_default = ansiStyles;

// node_modules/chalk/source/vendor/supports-color/index.js
import process2 from "node:process";
import os2 from "node:os";
import tty from "node:tty";
function hasFlag(flag, argv = globalThis.Deno ? globalThis.Deno.args : process2.argv) {
  const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
  const position = argv.indexOf(prefix + flag);
  const terminatorPosition = argv.indexOf("--");
  return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
}
var { env } = process2;
var flagForceColor;
if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
  flagForceColor = 0;
} else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
  flagForceColor = 1;
}
function envForceColor() {
  if ("FORCE_COLOR" in env) {
    if (env.FORCE_COLOR === "true") {
      return 1;
    }
    if (env.FORCE_COLOR === "false") {
      return 0;
    }
    return env.FORCE_COLOR.length === 0 ? 1 : Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
  }
}
function translateLevel(level) {
  if (level === 0) {
    return false;
  }
  return {
    level,
    hasBasic: true,
    has256: level >= 2,
    has16m: level >= 3
  };
}
function _supportsColor(haveStream, { streamIsTTY, sniffFlags = true } = {}) {
  const noFlagForceColor = envForceColor();
  if (noFlagForceColor !== undefined) {
    flagForceColor = noFlagForceColor;
  }
  const forceColor = sniffFlags ? flagForceColor : noFlagForceColor;
  if (forceColor === 0) {
    return 0;
  }
  if (sniffFlags) {
    if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
      return 3;
    }
    if (hasFlag("color=256")) {
      return 2;
    }
  }
  if ("TF_BUILD" in env && "AGENT_NAME" in env) {
    return 1;
  }
  if (haveStream && !streamIsTTY && forceColor === undefined) {
    return 0;
  }
  const min = forceColor || 0;
  if (env.TERM === "dumb") {
    return min;
  }
  if (process2.platform === "win32") {
    const osRelease = os2.release().split(".");
    if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
      return Number(osRelease[2]) >= 14931 ? 3 : 2;
    }
    return 1;
  }
  if ("CI" in env) {
    if (["GITHUB_ACTIONS", "GITEA_ACTIONS", "CIRCLECI"].some((key) => (key in env))) {
      return 3;
    }
    if (["TRAVIS", "APPVEYOR", "GITLAB_CI", "BUILDKITE", "DRONE"].some((sign) => (sign in env)) || env.CI_NAME === "codeship") {
      return 1;
    }
    return min;
  }
  if ("TEAMCITY_VERSION" in env) {
    return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
  }
  if (env.COLORTERM === "truecolor") {
    return 3;
  }
  if (env.TERM === "xterm-kitty") {
    return 3;
  }
  if (env.TERM === "xterm-ghostty") {
    return 3;
  }
  if (env.TERM === "wezterm") {
    return 3;
  }
  if ("TERM_PROGRAM" in env) {
    const version = Number.parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
    switch (env.TERM_PROGRAM) {
      case "iTerm.app": {
        return version >= 3 ? 3 : 2;
      }
      case "Apple_Terminal": {
        return 2;
      }
    }
  }
  if (/-256(color)?$/i.test(env.TERM)) {
    return 2;
  }
  if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
    return 1;
  }
  if ("COLORTERM" in env) {
    return 1;
  }
  return min;
}
function createSupportsColor(stream, options = {}) {
  const level = _supportsColor(stream, {
    streamIsTTY: stream && stream.isTTY,
    ...options
  });
  return translateLevel(level);
}
var supportsColor = {
  stdout: createSupportsColor({ isTTY: tty.isatty(1) }),
  stderr: createSupportsColor({ isTTY: tty.isatty(2) })
};
var supports_color_default = supportsColor;

// node_modules/chalk/source/utilities.js
function stringReplaceAll(string, substring, replacer) {
  let index = string.indexOf(substring);
  if (index === -1) {
    return string;
  }
  const substringLength = substring.length;
  let endIndex = 0;
  let returnValue = "";
  do {
    returnValue += string.slice(endIndex, index) + substring + replacer;
    endIndex = index + substringLength;
    index = string.indexOf(substring, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}
function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
  let endIndex = 0;
  let returnValue = "";
  do {
    const gotCR = string[index - 1] === "\r";
    returnValue += string.slice(endIndex, gotCR ? index - 1 : index) + prefix + (gotCR ? `\r
` : `
`) + postfix;
    endIndex = index + 1;
    index = string.indexOf(`
`, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}

// node_modules/chalk/source/index.js
var { stdout: stdoutColor, stderr: stderrColor } = supports_color_default;
var GENERATOR = Symbol("GENERATOR");
var STYLER = Symbol("STYLER");
var IS_EMPTY = Symbol("IS_EMPTY");
var levelMapping = [
  "ansi",
  "ansi",
  "ansi256",
  "ansi16m"
];
var styles2 = Object.create(null);
var applyOptions = (object, options = {}) => {
  if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) {
    throw new Error("The `level` option should be an integer from 0 to 3");
  }
  const colorLevel = stdoutColor ? stdoutColor.level : 0;
  object.level = options.level === undefined ? colorLevel : options.level;
};

class Chalk {
  constructor(options) {
    return chalkFactory(options);
  }
}
var chalkFactory = (options) => {
  const chalk = (...strings) => strings.join(" ");
  applyOptions(chalk, options);
  Object.setPrototypeOf(chalk, createChalk.prototype);
  return chalk;
};
function createChalk(options) {
  return chalkFactory(options);
}
Object.setPrototypeOf(createChalk.prototype, Function.prototype);
for (const [styleName, style] of Object.entries(ansi_styles_default)) {
  styles2[styleName] = {
    get() {
      const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
      Object.defineProperty(this, styleName, { value: builder });
      return builder;
    }
  };
}
styles2.visible = {
  get() {
    const builder = createBuilder(this, this[STYLER], true);
    Object.defineProperty(this, "visible", { value: builder });
    return builder;
  }
};
var getModelAnsi = (model, level, type, ...arguments_) => {
  if (model === "rgb") {
    if (level === "ansi16m") {
      return ansi_styles_default[type].ansi16m(...arguments_);
    }
    if (level === "ansi256") {
      return ansi_styles_default[type].ansi256(ansi_styles_default.rgbToAnsi256(...arguments_));
    }
    return ansi_styles_default[type].ansi(ansi_styles_default.rgbToAnsi(...arguments_));
  }
  if (model === "hex") {
    return getModelAnsi("rgb", level, type, ...ansi_styles_default.hexToRgb(...arguments_));
  }
  return ansi_styles_default[type][model](...arguments_);
};
var usedModels = ["rgb", "hex", "ansi256"];
for (const model of usedModels) {
  styles2[model] = {
    get() {
      const { level } = this;
      return function(...arguments_) {
        const styler = createStyler(getModelAnsi(model, levelMapping[level], "color", ...arguments_), ansi_styles_default.color.close, this[STYLER]);
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    }
  };
  const bgModel = "bg" + model[0].toUpperCase() + model.slice(1);
  styles2[bgModel] = {
    get() {
      const { level } = this;
      return function(...arguments_) {
        const styler = createStyler(getModelAnsi(model, levelMapping[level], "bgColor", ...arguments_), ansi_styles_default.bgColor.close, this[STYLER]);
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    }
  };
}
var proto = Object.defineProperties(() => {}, {
  ...styles2,
  level: {
    enumerable: true,
    get() {
      return this[GENERATOR].level;
    },
    set(level) {
      this[GENERATOR].level = level;
    }
  }
});
var createStyler = (open, close, parent) => {
  let openAll;
  let closeAll;
  if (parent === undefined) {
    openAll = open;
    closeAll = close;
  } else {
    openAll = parent.openAll + open;
    closeAll = close + parent.closeAll;
  }
  return {
    open,
    close,
    openAll,
    closeAll,
    parent
  };
};
var createBuilder = (self, _styler, _isEmpty) => {
  const builder = (...arguments_) => applyStyle(builder, arguments_.length === 1 ? "" + arguments_[0] : arguments_.join(" "));
  Object.setPrototypeOf(builder, proto);
  builder[GENERATOR] = self;
  builder[STYLER] = _styler;
  builder[IS_EMPTY] = _isEmpty;
  return builder;
};
var applyStyle = (self, string) => {
  if (self.level <= 0 || !string) {
    return self[IS_EMPTY] ? "" : string;
  }
  let styler = self[STYLER];
  if (styler === undefined) {
    return string;
  }
  const { openAll, closeAll } = styler;
  if (string.includes("\x1B")) {
    while (styler !== undefined) {
      string = stringReplaceAll(string, styler.close, styler.open);
      styler = styler.parent;
    }
  }
  const lfIndex = string.indexOf(`
`);
  if (lfIndex !== -1) {
    string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
  }
  return openAll + string + closeAll;
};
Object.defineProperties(createChalk.prototype, styles2);
var chalk = createChalk();
var chalkStderr = createChalk({ level: stderrColor ? stderrColor.level : 0 });
var source_default = chalk;

// src/web/server.ts
import http from "node:http";
import path21 from "node:path";
import fs16 from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { exec } from "node:child_process";

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);

// src/web/static-handler.ts
import fs from "node:fs";
import path from "node:path";
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};
function serveStatic(req, res, distDir) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  if (!distDir || !fs.existsSync(distDir)) {
    return false;
  }
  let pathname = "/";
  try {
    const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    pathname = req.url || "/";
  }
  const relativePath = pathname.replace(/^\/+/, "");
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return true;
  }
  let targetFilePath = path.join(distDir, normalized);
  if (fs.existsSync(targetFilePath)) {
    try {
      const stat = fs.statSync(targetFilePath);
      if (stat.isDirectory()) {
        targetFilePath = path.join(targetFilePath, "index.html");
      }
    } catch {}
  }
  let isSpaFallback = false;
  if (!fs.existsSync(targetFilePath)) {
    isSpaFallback = true;
  } else {
    try {
      if (!fs.statSync(targetFilePath).isFile()) {
        isSpaFallback = true;
      }
    } catch {
      isSpaFallback = true;
    }
  }
  if (isSpaFallback) {
    targetFilePath = path.join(distDir, "index.html");
    if (!fs.existsSync(targetFilePath)) {
      return false;
    }
  }
  try {
    const ext = path.extname(targetFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const fileContent = fs.readFileSync(targetFilePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", Buffer.byteLength(fileContent));
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(fileContent);
    }
    return true;
  } catch {
    return false;
  }
}

// src/web/rpc-handler.ts
import fs15 from "node:fs";
import path20 from "node:path";
import os5 from "node:os";

// src/session/session-manager.ts
import fs2 from "node:fs";
import path2 from "node:path";

class SessionManager {
  workspaceRoot;
  sessionsDir;
  indexFile;
  constructor(workspaceRoot) {
    this.workspaceRoot = path2.resolve(workspaceRoot || process.cwd());
    this.sessionsDir = path2.join(this.workspaceRoot, ".cph", "sessions");
    this.indexFile = path2.join(this.sessionsDir, "index.json");
  }
  ensureSessionsDir() {
    if (!fs2.existsSync(this.sessionsDir)) {
      fs2.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }
  isValidSessionId(id) {
    if (!id || typeof id !== "string")
      return false;
    return /^[a-zA-Z0-9_\-]+$/.test(id);
  }
  generateSessionId() {
    const now = new Date;
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const rand = Math.random().toString(36).substring(2, 6);
    return `ses_${y}${m}${d}_${hh}${mm}_${rand}`;
  }
  readIndex() {
    this.ensureSessionsDir();
    if (!fs2.existsSync(this.indexFile)) {
      return this.rebuildIndex();
    }
    try {
      const raw = fs2.readFileSync(this.indexFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      }
      return this.rebuildIndex();
    } catch {
      return this.rebuildIndex();
    }
  }
  writeIndex(items) {
    this.ensureSessionsDir();
    const sorted = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    fs2.writeFileSync(this.indexFile, JSON.stringify(sorted, null, 2), "utf-8");
  }
  rebuildIndex() {
    this.ensureSessionsDir();
    const items = [];
    let files = [];
    try {
      files = fs2.readdirSync(this.sessionsDir);
    } catch {
      return [];
    }
    for (const file of files) {
      if (!file.endsWith(".json") || file === "index.json")
        continue;
      const fullPath = path2.join(this.sessionsDir, file);
      try {
        const raw = fs2.readFileSync(fullPath, "utf-8");
        const session = JSON.parse(raw);
        if (session && session.id && session.title) {
          items.push({
            id: session.id,
            title: session.title,
            createdAt: session.createdAt || new Date().toISOString(),
            updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
            turnCount: session.turnCount ?? (session.turns ? session.turns.length : 0),
            status: session.status || "active",
            currentAccount: session.currentAccount,
            workspaceRoot: session.workspaceRoot,
            modelTone: session.modelTone,
            handoffSnapshot: session.handoffSnapshot,
            handoffDocPath: session.handoffDocPath,
            disasterBlackbox: session.disasterBlackbox,
            generation: session.generation ?? 1,
            handoffCount: session.handoffCount ?? 0
          });
        }
      } catch {}
    }
    this.writeIndex(items);
    return items;
  }
  createSession(options = {}) {
    this.ensureSessionsDir();
    const id = options.id || this.generateSessionId();
    const now = new Date().toISOString();
    const session = {
      id,
      title: options.title || "新会话",
      workspaceRoot: options.workspaceRoot ? path2.resolve(options.workspaceRoot) : this.workspaceRoot,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      maxTurns: options.maxTurns ?? 25,
      modelTone: options.modelTone || "Creative",
      currentAccount: options.currentAccount,
      status: options.status || "active",
      turns: [],
      handoffSnapshot: options.handoffSnapshot,
      handoffDocPath: options.handoffDocPath,
      disasterBlackbox: options.disasterBlackbox
    };
    this.saveSession(session);
    return session;
  }
  saveSession(session) {
    if (!this.isValidSessionId(session.id)) {
      throw new Error(`Invalid session ID: ${session.id}`);
    }
    this.ensureSessionsDir();
    session.updatedAt = new Date().toISOString();
    session.turnCount = session.turns ? session.turns.length : session.turnCount;
    const sessionFile = path2.join(this.sessionsDir, `${session.id}.json`);
    fs2.writeFileSync(sessionFile, JSON.stringify(session, null, 2), "utf-8");
    const index = this.readIndex();
    const existingIdx = index.findIndex((item) => item.id === session.id);
    const indexEntry = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turnCount: session.turnCount,
      status: session.status,
      currentAccount: session.currentAccount,
      workspaceRoot: session.workspaceRoot,
      modelTone: session.modelTone,
      handoffSnapshot: session.handoffSnapshot,
      handoffDocPath: session.handoffDocPath,
      disasterBlackbox: session.disasterBlackbox,
      generation: session.generation,
      handoffCount: session.handoffCount
    };
    if (existingIdx >= 0) {
      index[existingIdx] = indexEntry;
    } else {
      index.push(indexEntry);
    }
    this.writeIndex(index);
  }
  loadSession(id) {
    if (!this.isValidSessionId(id))
      return null;
    const sessionFile = path2.join(this.sessionsDir, `${id}.json`);
    if (!fs2.existsSync(sessionFile))
      return null;
    try {
      const raw = fs2.readFileSync(sessionFile, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  listSessions() {
    return this.readIndex();
  }
  getLatestActiveSession() {
    const list = this.readIndex();
    for (const item of list) {
      if (item.status === "active") {
        const fullSession = this.loadSession(item.id);
        if (fullSession && fullSession.status === "active") {
          return fullSession;
        }
      }
    }
    return null;
  }
  deleteSession(id) {
    if (!this.isValidSessionId(id))
      return false;
    this.ensureSessionsDir();
    const sessionFile = path2.join(this.sessionsDir, `${id}.json`);
    let fileExisted = false;
    if (fs2.existsSync(sessionFile)) {
      try {
        fs2.unlinkSync(sessionFile);
        fileExisted = true;
      } catch {}
    }
    const index = this.readIndex();
    const filtered = index.filter((item) => item.id !== id);
    const indexChanged = filtered.length !== index.length;
    if (indexChanged) {
      this.writeIndex(filtered);
    }
    return fileExisted || indexChanged;
  }
}

// src/web/file-tree.ts
import fs3 from "node:fs";
import path3 from "node:path";
var IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cph",
  ".cache",
  ".turbo",
  ".next",
  "build",
  "coverage"
]);
function scanWorkspaceFiles(rootDir, currentRel = "", depth = 0, maxDepth = 3) {
  const currentAbs = currentRel ? path3.join(rootDir, currentRel) : rootDir;
  if (!fs3.existsSync(currentAbs)) {
    return [];
  }
  let entries = [];
  try {
    entries = fs3.readdirSync(currentAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory())
      return -1;
    if (!a.isDirectory() && b.isDirectory())
      return 1;
    return a.name.localeCompare(b.name);
  });
  const result = [];
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) {
      continue;
    }
    const relPath = currentRel ? path3.join(currentRel, entry.name).replace(/\\/g, "/") : entry.name;
    const isDir = entry.isDirectory();
    const id = `f-${relPath.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    if (isDir) {
      const children = depth < maxDepth ? scanWorkspaceFiles(rootDir, relPath, depth + 1, maxDepth) : undefined;
      result.push({
        id,
        name: entry.name,
        path: relPath,
        type: "directory",
        children
      });
    } else {
      result.push({
        id,
        name: entry.name,
        path: relPath,
        type: "file",
        status: "clean"
      });
    }
  }
  return result;
}

// src/auth/token-manager.ts
import fs4 from "fs";
import path4 from "path";
import os3 from "os";

// src/auth/crypto.ts
import crypto from "crypto";
var DEFAULT_PEPPER = "m365-copilot2api-fallback-pepper-v1-TODO-DPAPI-keyring";
var PEPPER_KEY = Buffer.from("m365-copilot2api-pepper-v1");
var ENC_PREFIX = "enc:v1:";
function deriveMasterKey(customMaster) {
  const rawMaster = customMaster || process.env.M365_MASTER_KEY || DEFAULT_PEPPER;
  return crypto.createHmac("sha256", PEPPER_KEY).update(rawMaster).digest();
}
function encryptToken(plain, customMaster) {
  if (!plain)
    return "";
  if (plain.startsWith(ENC_PREFIX))
    return plain;
  const key = deriveMasterKey(customMaster);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([nonce, ciphertext, tag]);
  return ENC_PREFIX + combined.toString("base64");
}
function decryptToken(enc, customMaster) {
  if (!enc || !enc.startsWith(ENC_PREFIX))
    return enc;
  const rawBase64 = enc.slice(ENC_PREFIX.length);
  const key = deriveMasterKey(customMaster);
  const buf = Buffer.from(rawBase64, "base64");
  if (buf.length < 28) {
    throw new Error("Ciphertext too short for AES-GCM");
  }
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// src/auth/token-manager.ts
var DEFAULT_CLIENT_ID = "c0ab8ce9-e9a0-42e7-b064-33d422df41f1";
var DEFAULT_SCOPE = "openid profile offline_access https://substrate.office.com/sydney/.default";
var GRAPH_SCOPE = "openid profile offline_access https://graph.microsoft.com/.default";
var IC3_SCOPE = "openid profile offline_access https://ic3.teams.office.com/.default";
var DEFAULT_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

class TokenManager {
  static GRAPH_SCOPE = GRAPH_SCOPE;
  static IC3_SCOPE = IC3_SCOPE;
  configPath;
  activeTokens = new Map;
  graphTokens = new Map;
  ic3Tokens = new Map;
  tokenEndpoint;
  fetchFn;
  constructor(customPath, options) {
    if (customPath) {
      this.configPath = customPath;
    } else {
      const home = os3.homedir();
      this.configPath = path4.join(home, ".config", "m365-copilot2api", "accounts.json");
    }
    this.tokenEndpoint = options?.tokenEndpoint || DEFAULT_TOKEN_ENDPOINT;
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }
  getConfigPath() {
    return this.configPath;
  }
  static validateAccount(account) {
    if (!account.email || typeof account.email !== "string") {
      return { valid: false, reason: "Missing or invalid email" };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(account.email)) {
      return { valid: false, reason: `Invalid email format: ${account.email}` };
    }
    if (!account.refreshToken || typeof account.refreshToken !== "string") {
      return { valid: false, reason: "Missing refreshToken" };
    }
    try {
      const decrypted = decryptToken(account.refreshToken);
      if (!decrypted || decrypted.trim().length === 0) {
        return { valid: false, reason: "Decrypted refresh token is empty" };
      }
    } catch (err) {
      return { valid: false, reason: `Failed to decrypt refreshToken: ${err.message}` };
    }
    return { valid: true };
  }
  static validateCookie(cookies) {
    if (!cookies || typeof cookies !== "string" || cookies.trim().length === 0) {
      return { valid: false, reason: "Empty cookie string" };
    }
    const pairs = cookies.split(";").map((p) => p.trim()).filter(Boolean);
    if (pairs.length === 0) {
      return { valid: false, reason: "No valid cookie pairs found" };
    }
    for (const pair of pairs) {
      if (!pair.includes("=")) {
        return { valid: false, reason: `Malformed cookie segment: ${pair}` };
      }
    }
    return { valid: true };
  }
  loadAccounts() {
    if (!fs4.existsSync(this.configPath)) {
      return [];
    }
    try {
      const raw = fs4.readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : parsed.accounts || [];
    } catch (err) {
      console.error(`[TokenManager] Failed to read ${this.configPath}:`, err);
      return [];
    }
  }
  saveAccounts(accounts) {
    const dir = path4.dirname(this.configPath);
    if (!fs4.existsSync(dir)) {
      fs4.mkdirSync(dir, { recursive: true });
    }
    const sanitized = accounts.map((acc) => ({
      ...acc,
      refreshToken: acc.refreshToken.startsWith("enc:v1:") ? acc.refreshToken : encryptToken(acc.refreshToken)
    }));
    fs4.writeFileSync(this.configPath, JSON.stringify({ accounts: sanitized }, null, 2), "utf8");
  }
  setCachedToken(email, token) {
    const key = email.toLowerCase();
    this.activeTokens.set(key, token);
    this.graphTokens.delete(key);
    this.ic3Tokens.delete(key);
  }
  upsertAccountFromPkce(email, refreshToken, oid, tid) {
    const accounts = this.loadAccounts();
    const key = email.toLowerCase();
    const existing = accounts.find((a) => a.email.toLowerCase() === key);
    let updatedAccount;
    if (existing) {
      existing.refreshToken = refreshToken;
      if (oid)
        existing.userId = oid;
      if (tid)
        existing.tenantId = tid;
      existing.lastRefresh = new Date().toISOString();
      updatedAccount = existing;
    } else {
      updatedAccount = {
        email,
        refreshToken,
        userId: oid,
        tenantId: tid,
        lastRefresh: new Date().toISOString()
      };
      accounts.push(updatedAccount);
    }
    this.saveAccounts(accounts);
    this.clearCache(email);
    return updatedAccount;
  }
  clearCache(email) {
    if (email) {
      const key = email.toLowerCase();
      this.activeTokens.delete(key);
      this.graphTokens.delete(key);
      this.ic3Tokens.delete(key);
    } else {
      this.activeTokens.clear();
      this.graphTokens.clear();
      this.ic3Tokens.clear();
    }
  }
  parseJwt(token) {
    const parts = token.split(".");
    if (parts.length < 2) {
      throw new Error("Invalid JWT token received from Azure AD");
    }
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  }
  async getActiveSessionToken(accountOrEmail, forceRefresh = false) {
    const email = typeof accountOrEmail === "string" ? accountOrEmail : accountOrEmail.email;
    return this.getAccessToken(email, forceRefresh);
  }
  async getAccessToken(email, forceRefresh = false) {
    const key = email.toLowerCase();
    const existing = this.activeTokens.get(key);
    const now = Date.now();
    if (!forceRefresh && existing && existing.expiresAt - now > 5 * 60 * 1000) {
      return existing;
    }
    const accounts = this.loadAccounts();
    const target = accounts.find((a) => a.email.toLowerCase() === key);
    if (!target) {
      throw new Error(`Account not found in accounts.json: ${email}`);
    }
    const validation = TokenManager.validateAccount(target);
    if (!validation.valid) {
      throw new Error(`Invalid credentials for ${email}: ${validation.reason}`);
    }
    const plainRt = decryptToken(target.refreshToken);
    if (!plainRt) {
      throw new Error(`Empty refresh token for account: ${email}`);
    }
    const params = new URLSearchParams({
      client_id: DEFAULT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: plainRt,
      scope: DEFAULT_SCOPE
    });
    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Azure AD token refresh failed (${res.status}): ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    const payload = this.parseJwt(data.access_token);
    const activeSession = {
      email: target.email,
      accessToken: data.access_token,
      refreshToken: plainRt,
      expiresAt: payload.exp ? payload.exp * 1000 : now + (data.expires_in || 3600) * 1000,
      oid: payload.oid || "",
      tid: payload.tid || ""
    };
    this.activeTokens.set(key, activeSession);
    if (data.refresh_token && data.refresh_token !== plainRt) {
      target.refreshToken = encryptToken(data.refresh_token);
      target.lastRefresh = new Date().toISOString();
      this.saveAccounts(accounts);
    }
    return activeSession;
  }
  async getGraphAccessToken(email, forceRefresh = false) {
    const key = email.toLowerCase();
    const existing = this.graphTokens.get(key);
    const now = Date.now();
    if (!forceRefresh && existing && existing.expiresAt - now > 5 * 60 * 1000) {
      return existing.token;
    }
    const accounts = this.loadAccounts();
    const target = accounts.find((a) => a.email.toLowerCase() === key);
    if (!target) {
      throw new Error(`Account not found in accounts.json: ${email}`);
    }
    const plainRt = decryptToken(target.refreshToken);
    if (!plainRt) {
      throw new Error(`Empty refresh token for account: ${email}`);
    }
    const params = new URLSearchParams({
      client_id: DEFAULT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: plainRt,
      scope: TokenManager.GRAPH_SCOPE
    });
    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Azure AD Graph token refresh failed (${res.status}): ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    const expiresAt = now + (data.expires_in || 3600) * 1000;
    this.graphTokens.set(key, { token: data.access_token, expiresAt });
    return data.access_token;
  }
  setCachedGraphToken(email, token, expiresAt) {
    this.graphTokens.set(email.toLowerCase(), {
      token,
      expiresAt: expiresAt ?? Date.now() + 3600000
    });
  }
  async getIc3AccessToken(email, forceRefresh = false) {
    const key = email.toLowerCase();
    const existing = this.ic3Tokens.get(key);
    const now = Date.now();
    if (!forceRefresh && existing && existing.expiresAt - now > 5 * 60 * 1000) {
      return existing.token;
    }
    const accounts = this.loadAccounts();
    const target = accounts.find((a) => a.email.toLowerCase() === key);
    if (!target) {
      throw new Error(`Account not found in accounts.json: ${email}`);
    }
    const plainRt = decryptToken(target.refreshToken);
    if (!plainRt) {
      throw new Error(`Empty refresh token for account: ${email}`);
    }
    const params = new URLSearchParams({
      client_id: DEFAULT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: plainRt,
      scope: TokenManager.IC3_SCOPE
    });
    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Azure AD IC3 token refresh failed (${res.status}): ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    const expiresAt = now + (data.expires_in || 3600) * 1000;
    this.ic3Tokens.set(key, { token: data.access_token, expiresAt });
    return data.access_token;
  }
  setCachedIc3Token(email, token, expiresAt) {
    this.ic3Tokens.set(email.toLowerCase(), {
      token,
      expiresAt: expiresAt ?? Date.now() + 3600000
    });
  }
}

// src/transport/chathub-client.ts
import crypto2 from "crypto";

// src/transport/types.ts
var RECORD_SEPARATOR = "\x1E";

// src/transport/chathub-client.ts
class ChatHubClient {
  token;
  options;
  constructor(token, options) {
    this.token = token;
    this.options = {
      modelTone: "Gpt_61_Sol_Reasoning",
      scenario: "OfficeWebIncludedCopilot",
      licenseType: "Starter",
      agentHost: "Bizchat.FullScreen",
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
      timeoutMs: options?.timeoutMs ?? 600000,
      idleTimeoutMs: options?.idleTimeoutMs ?? 90000,
      ...options
    };
  }
  static normalizeAgentId(input) {
    if (!input)
      return;
    const trimmed = input.trim();
    if (!trimmed)
      return;
    const match = trimmed.match(/\/chat\/agent\/([^?&#]+)/);
    if (match) {
      const decoded = decodeURIComponent(match[1]).trim();
      return decoded || undefined;
    }
    return trimmed;
  }
  updateToken(newToken) {
    this.token = newToken;
  }
  getToken() {
    return this.token;
  }
  static encodeSignalR(obj) {
    return JSON.stringify(obj) + RECORD_SEPARATOR;
  }
  static decodeSignalRFrames(raw) {
    const frames = raw.split(RECORD_SEPARATOR).filter(Boolean);
    const result = [];
    for (const frame of frames) {
      try {
        result.push(JSON.parse(frame));
      } catch {}
    }
    return result;
  }
  buildWsUrl(conversationId, sessionId, requestId) {
    const params = new URLSearchParams({
      chatsessionid: requestId,
      clientrequestid: requestId,
      "X-SessionId": sessionId,
      ConversationId: conversationId,
      access_token: this.token.accessToken,
      source: '"officeweb"',
      product: "Office",
      agentHost: this.options.agentHost || "Bizchat.FullScreen",
      licenseType: this.options.licenseType || "Starter",
      agent: this.options.customAgentId ? "Agent" : "web",
      scenario: this.options.scenario || "OfficeWebIncludedCopilot"
    });
    if (this.options.customAgentId) {
      params.set("gptId", `${this.options.customAgentId}@MOS3`);
      params.set("agent", "Agent");
      params.set("agentHost", "Bizchat.FullScreen");
    }
    if (this.options.wsBaseUrl) {
      const base = this.options.wsBaseUrl.replace(/\/+$/, "");
      return `${base}/${this.token.oid}@${this.token.tid}?${params.toString()}`;
    }
    return `wss://substrate.office.com/m365Copilot/Chathub/${this.token.oid}@${this.token.tid}?${params.toString()}`;
  }
  buildInvocationPayload(options) {
    return ChatHubClient.buildInvocationPayload(options, this.options);
  }
  static buildInvocationPayload(options, clientOptions) {
    const sessionId = options.sessionId || crypto2.randomUUID();
    const requestId = options.requestId || crypto2.randomUUID();
    const chatArguments = {
      source: "officeweb",
      clientCorrelationId: crypto2.randomUUID(),
      sessionId,
      optionsSets: options.optionsSets || [
        "search_result_progress_messages_with_search_queries",
        "update_textdoc_response_after_streaming",
        "cwc_flux_v3",
        "deepleo_networking_timeout_10minutes_canmore",
        "enable_search_result_progress_messages",
        "cwc_fileupload_odb",
        "enable_batch_token_processing",
        "flux_v3_references",
        "flux_v3_references_entities",
        "flux_v3_references_ci",
        "add_filestore_filetype",
        "rich_responses"
      ],
      allowedMessageTypes: [
        "Chat",
        "Suggestion",
        "Disengaged",
        "Progress",
        "EndOfRequest",
        "InternalLoaderMessage"
      ],
      conversationId: options.conversationId,
      traceId: crypto2.randomUUID(),
      isStartOfSession: options.isStartOfSession ?? false,
      productThreadType: "Office",
      clientInfo: { clientPlatform: "mcmcopilot-web", clientAppName: "Office" },
      tone: options.tone || clientOptions?.modelTone || "Gpt_61_Sol_Reasoning",
      streamingMode: "ConciseWithPadding",
      message: {
        author: "user",
        inputMethod: "Keyboard",
        text: options.text,
        requestId,
        locationInfo: {
          timeZoneOffset: 8,
          timeZone: clientOptions?.timeZone || "Asia/Shanghai"
        },
        locale: clientOptions?.locale || "zh-CN",
        messageType: "Chat",
        experienceType: "Default"
      },
      plugins: [{ Id: "BingWebSearch", Source: "BuiltIn" }]
    };
    if (clientOptions?.customAgentId) {
      chatArguments.threadLevelGptId = {
        id: clientOptions.customAgentId,
        source: "MOS3"
      };
      chatArguments.gpts = [
        {
          id: clientOptions.customAgentId,
          source: "MOS3",
          version: "1.0.0"
        }
      ];
    }
    if (options.annotations && options.annotations.length > 0) {
      chatArguments.message.entityAnnotationTypes = [
        "People",
        "File",
        "Event",
        "Email",
        "TeamsMessage"
      ];
      chatArguments.message.messageAnnotations = options.annotations;
    }
    return {
      arguments: [chatArguments],
      invocationId: "0",
      target: "chat",
      type: 4
    };
  }
  async sendMessage(payload, events) {
    const signal = payload.signal;
    if (signal?.aborted) {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    const sessionId = payload.sessionId || crypto2.randomUUID();
    const requestId = payload.requestId || crypto2.randomUUID();
    const invocationPayload = {
      ...payload,
      sessionId,
      requestId
    };
    const wsUrl = this.buildWsUrl(invocationPayload.conversationId, invocationPayload.sessionId, invocationPayload.requestId);
    return new Promise((resolve, reject) => {
      let isSettled = false;
      let hasSentChat = false;
      let fullText = "";
      let reasoningText = "";
      const rawMessages = [];
      const rawFrames = [];
      let timeoutTimer = null;
      let idleTimer = null;
      let ws;
      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
        try {
          if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.close();
          }
        } catch {}
      };
      const settleReject = (err) => {
        if (isSettled)
          return;
        isSettled = true;
        cleanup();
        reject(err);
      };
      const settleResolve = (response) => {
        if (isSettled)
          return;
        isSettled = true;
        cleanup();
        resolve(response);
      };
      const abortListener = () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        settleReject(err);
      };
      if (signal) {
        signal.addEventListener("abort", abortListener, { once: true });
      }
      const timeoutMs = this.options.timeoutMs ?? 600000;
      timeoutTimer = setTimeout(() => {
        settleReject(new Error(`ChatHub request timed out after ${Math.round(timeoutMs / 1000)}s without completion`));
      }, timeoutMs);
      const idleTimeoutMs = this.options.idleTimeoutMs ?? 90000;
      const resetIdleTimer = () => {
        if (idleTimer)
          clearTimeout(idleTimer);
        if (isSettled)
          return;
        idleTimer = setTimeout(() => {
          settleReject(new Error(`ChatHub connection idle timeout: no data received from server for ${Math.round(idleTimeoutMs / 1000)}s`));
        }, idleTimeoutMs);
      };
      resetIdleTimer();
      try {
        ws = new globalThis.WebSocket(wsUrl, {
          headers: {
            Origin: "https://m365.cloud.microsoft",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
          }
        });
      } catch (wsInitErr) {
        settleReject(new Error(`Failed to initialize WebSocket: ${wsInitErr.message}`));
        return;
      }
      if (typeof ws.on === "function") {
        ws.on("message", () => {
          resetIdleTimer();
        });
      }
      ws.onopen = () => {
        if (signal?.aborted) {
          abortListener();
          return;
        }
        resetIdleTimer();
        ws.send(ChatHubClient.encodeSignalR({ protocol: "json", version: 1 }));
      };
      ws.onmessage = async (event) => {
        if (isSettled)
          return;
        resetIdleTimer();
        const raw = typeof event.data === "string" ? event.data : event.data.toString();
        const frames = raw.split(RECORD_SEPARATOR).filter(Boolean);
        for (const frame of frames) {
          try {
            const msg = JSON.parse(frame);
            rawFrames.push(msg);
            events?.onRawFrame?.(msg);
            if (!hasSentChat && Object.keys(msg).length === 0) {
              hasSentChat = true;
              const chatFrame = this.buildInvocationPayload(invocationPayload);
              const metricsFrame = {
                arguments: [
                  {
                    Timestamps: {
                      ConnectionStart: "",
                      UserInputStart: "",
                      ConnectionEstablished: "",
                      UserInputSubmit: ""
                    }
                  }
                ],
                target: "Metrics",
                type: 1
              };
              ws.send(ChatHubClient.encodeSignalR(chatFrame) + ChatHubClient.encodeSignalR(metricsFrame));
              continue;
            }
            if (msg.type === 6) {
              resetIdleTimer();
              events?.onHeartbeat?.();
              ws.send(ChatHubClient.encodeSignalR({ type: 6 }));
              continue;
            }
            if (msg.type === 1 && msg.target === "update") {
              for (const arg of msg.arguments || []) {
                if (arg.writeAtCursor) {
                  fullText += arg.writeAtCursor;
                  resetIdleTimer();
                  if (events?.onDelta) {
                    await events.onDelta({ type: "text", content: arg.writeAtCursor, raw: arg });
                    resetIdleTimer();
                  }
                }
                for (const m of arg.messages || []) {
                  rawMessages.push(m);
                  if (m.messageType === "Progress" || m.messageType === "InternalLoaderMessage") {
                    const progressText = m.text || "";
                    if (progressText) {
                      reasoningText += progressText + `
`;
                      resetIdleTimer();
                      if (events?.onDelta) {
                        await events.onDelta({ type: "reasoning", content: progressText, raw: m });
                        resetIdleTimer();
                      }
                      if (events?.onReasoning) {
                        await events.onReasoning(progressText);
                        resetIdleTimer();
                      }
                    }
                  } else if (m.messageType === "Disengaged" || m.messageType === "OffTopic") {
                    fullText = m.text;
                    resetIdleTimer();
                  } else if (m.author === "bot" && m.text) {
                    if (/rate limit|too many requests|配额已达上限|请稍后再试/i.test(m.text)) {
                      events?.onRateLimitDetected?.(this.token.email);
                    }
                    fullText = m.text;
                    resetIdleTimer();
                  }
                }
              }
            }
            if (msg.type === 2) {
              const result = msg.result || msg.item?.result;
              const errorCode = result?.errorCode || result?.code || (typeof msg.error === "string" && msg.error.includes("GptNotAvailable") ? "GptNotAvailable" : undefined) || (typeof msg.error === "string" && msg.error.includes("GptAccessForbidden") ? "GptAccessForbidden" : undefined);
              if (errorCode === "GptNotAvailable" || errorCode === "GptAccessForbidden") {
                const agentId = this.options.customAgentId || "";
                const errorMsg = result?.message || result?.errorMessage || msg.error || `Agent access error: ${errorCode}`;
                events?.onAgentUnavailable?.(this.token.email, agentId, errorCode, errorMsg);
                const err = new Error(`[${errorCode}] ${errorMsg}`);
                err.errorCode = errorCode;
                err.agentId = agentId;
                settleReject(err);
                return;
              }
              settleResolve({
                text: fullText,
                reasoning: reasoningText,
                conversationId: invocationPayload.conversationId,
                sessionId: invocationPayload.sessionId,
                requestId: invocationPayload.requestId,
                rawMessages,
                rawFrames
              });
              return;
            }
            if (msg.type === 3) {
              settleResolve({
                text: fullText,
                reasoning: reasoningText,
                conversationId: invocationPayload.conversationId,
                sessionId: invocationPayload.sessionId,
                requestId: invocationPayload.requestId,
                rawMessages,
                rawFrames
              });
              return;
            }
          } catch {}
        }
      };
      ws.onerror = (err) => {
        settleReject(new Error(`WebSocket connection error: ${err?.message || String(err)}`));
      };
      ws.onclose = (ev) => {
        if (!hasSentChat) {
          if (ev.code === 1008) {
            events?.onRateLimitDetected?.(this.token.email);
          }
          settleReject(new Error(`WebSocket closed prematurely (${ev.code}): ${ev.reason || "unknown reason"}`));
        } else if (!isSettled) {
          settleResolve({
            text: fullText,
            reasoning: reasoningText,
            conversationId: invocationPayload.conversationId,
            sessionId: invocationPayload.sessionId,
            requestId: invocationPayload.requestId,
            rawMessages,
            rawFrames
          });
        }
      };
    });
  }
}

// src/auth/oauth-pkce-service.ts
import crypto3 from "node:crypto";
var PKCE_CLIENT_ID = "c0ab8ce9-e9a0-42e7-b064-33d422df41f1";
var PKCE_AUTHORITY = "https://login.microsoftonline.com/common";
var PKCE_REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient";
var PKCE_SCOPE = "openid profile offline_access https://substrate.office.com/sydney/.default";
var PKCE_AUTHORIZE_URL = `${PKCE_AUTHORITY}/oauth2/v2.0/authorize`;
var PKCE_TOKEN_URL = `${PKCE_AUTHORITY}/oauth2/v2.0/token`;
var PKCE_SESSION_TTL_MS = 10 * 60 * 1000;
function decodeJwtClaims(token) {
  if (!token || typeof token !== "string") {
    return {};
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return {};
  }
  try {
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return {};
  }
}
function extractClaims(accessToken, idToken) {
  const accessClaims = decodeJwtClaims(accessToken);
  const idClaims = idToken ? decodeJwtClaims(idToken) : {};
  const email = accessClaims.unique_name || accessClaims.upn || accessClaims.preferred_username || accessClaims.email || idClaims.preferred_username || idClaims.email || idClaims.upn || "";
  const oid = accessClaims.oid || accessClaims.sub || idClaims.oid || idClaims.sub || "";
  const tid = accessClaims.tid || idClaims.tid || "";
  return { email, oid, tid };
}

class OAuthPkceService {
  tokenManager;
  sessions = new Map;
  fetchFn;
  tokenEndpoint;
  authorizeEndpoint;
  sessionTtlMs;
  constructor(tokenManager, options) {
    this.tokenManager = tokenManager;
    this.fetchFn = options?.fetchFn || globalThis.fetch;
    this.tokenEndpoint = options?.tokenEndpoint || PKCE_TOKEN_URL;
    this.authorizeEndpoint = options?.authorizeEndpoint || PKCE_AUTHORIZE_URL;
    this.sessionTtlMs = options?.sessionTtlMs || PKCE_SESSION_TTL_MS;
  }
  startAuthSession(targetEmail) {
    this.cleanExpiredSessions();
    const codeVerifier = crypto3.randomBytes(32).toString("base64url");
    const codeChallenge = crypto3.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto3.randomBytes(16).toString("base64url");
    const authSessionId = crypto3.randomUUID();
    const params = new URLSearchParams({
      client_id: PKCE_CLIENT_ID,
      response_type: "code",
      redirect_uri: PKCE_REDIRECT_URI,
      response_mode: "query",
      scope: PKCE_SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account"
    });
    if (targetEmail && targetEmail.trim().length > 0) {
      params.set("login_hint", targetEmail.trim());
    }
    const authUrl = `${this.authorizeEndpoint}?${params.toString()}`;
    this.sessions.set(authSessionId, {
      authSessionId,
      authUrl,
      state,
      codeVerifier,
      createdAt: Date.now(),
      targetEmail: targetEmail?.trim()
    });
    return { authSessionId, authUrl, state };
  }
  extractCodeAndState(redirectUrlOrCode, expectedState) {
    const trimmed = redirectUrlOrCode.trim();
    let searchString = "";
    if (trimmed.includes("?")) {
      searchString = trimmed.substring(trimmed.indexOf("?") + 1);
    } else if (trimmed.includes("#")) {
      searchString = trimmed.substring(trimmed.indexOf("#") + 1);
    } else if (trimmed.includes("=") && trimmed.includes("&")) {
      searchString = trimmed;
    } else if (trimmed.startsWith("code=") || trimmed.startsWith("error=")) {
      searchString = trimmed;
    }
    if (searchString) {
      const hashIndex = searchString.indexOf("#");
      if (hashIndex !== -1) {
        searchString = searchString.substring(0, hashIndex);
      }
      const searchParams = new URLSearchParams(searchString);
      const error = searchParams.get("error");
      if (error) {
        const errorDescription = searchParams.get("error_description");
        const detail = errorDescription ? `: ${errorDescription}` : "";
        throw new Error(`Azure AD authorization failed (${error})${detail}`);
      }
      const code = searchParams.get("code");
      const state = searchParams.get("state") || undefined;
      if (code) {
        if (expectedState && state && state !== expectedState) {
          throw new Error("State mismatch");
        }
        return { code, state };
      }
    }
    return { code: trimmed, state: undefined };
  }
  async exchangeCode(authSessionId, redirectUrlOrCode, expectedEmail) {
    let session = this.sessions.get(authSessionId);
    if (!session) {
      session = Array.from(this.sessions.values()).find((s) => s.state === authSessionId);
    }
    if (!session) {
      throw new Error(`Authentication session not found or expired: ${authSessionId}`);
    }
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      this.sessions.delete(authSessionId);
      throw new Error(`Authentication session expired: ${authSessionId}`);
    }
    const { code } = this.extractCodeAndState(redirectUrlOrCode, session.state);
    const form = new URLSearchParams({
      client_id: PKCE_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: PKCE_REDIRECT_URI,
      code_verifier: session.codeVerifier
    });
    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    if (!res.ok) {
      const errText = await res.text();
      let errDetail = errText.slice(0, 300);
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error_description || parsed.error) {
          errDetail = `${parsed.error}: ${parsed.error_description || ""}`;
        }
      } catch {}
      throw new Error(`Azure AD token exchange failed (${res.status}): ${errDetail}`);
    }
    const data = await res.json();
    if (data.error) {
      throw new Error(`${data.error}: ${data.error_description || ""}`);
    }
    const claims = extractClaims(data.access_token, data.id_token);
    const actualEmail = claims.email || expectedEmail || session.targetEmail || "";
    const target = expectedEmail || session.targetEmail;
    const emailMismatch = Boolean(target && actualEmail && actualEmail.toLowerCase() !== target.toLowerCase());
    if (data.refresh_token && actualEmail) {
      this.tokenManager.upsertAccountFromPkce(actualEmail, data.refresh_token, claims.oid, claims.tid);
    }
    if (data.access_token && actualEmail) {
      const accessClaims = decodeJwtClaims(data.access_token);
      const expiresAt = accessClaims.exp ? accessClaims.exp * 1000 : Date.now() + (data.expires_in || 3600) * 1000;
      const activeToken = {
        email: actualEmail,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || "",
        expiresAt,
        oid: claims.oid,
        tid: claims.tid
      };
      this.tokenManager.setCachedToken(actualEmail, activeToken);
    }
    this.sessions.delete(authSessionId);
    return {
      success: true,
      email: actualEmail,
      expectedEmail: target,
      emailMismatch,
      userId: claims.oid,
      tenantId: claims.tid,
      accessToken: data.access_token
    };
  }
  getSession(authSessionIdOrState) {
    this.cleanExpiredSessions();
    let session = this.sessions.get(authSessionIdOrState);
    if (!session) {
      session = Array.from(this.sessions.values()).find((s) => s.state === authSessionIdOrState);
    }
    if (!session)
      return;
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      this.sessions.delete(session.authSessionId);
      return;
    }
    return session;
  }
  findSession(predicate) {
    this.cleanExpiredSessions();
    for (const session of this.sessions.values()) {
      if (predicate(session))
        return session;
    }
    return;
  }
  cleanExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.sessionTtlMs) {
        this.sessions.delete(id);
      }
    }
  }
}

// src/auth/account-pool.ts
function getNextUtcMidnight(floorMs = 15 * 60 * 1000) {
  const now = Date.now();
  const minTarget = now + floorMs;
  const d = new Date(now);
  let midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  while (midnight < minTarget) {
    midnight += 24 * 60 * 60 * 1000;
  }
  return midnight;
}

class AccountPool {
  manager;
  pkceService;
  pkceSessions = new Map;
  statuses = new Map;
  ineligibleAgents = new Map;
  allowedAccounts;
  originalAllowedCase = new Map;
  inFlightLeases = new Set;
  sessionLeases = new Map;
  currentIndex = 0;
  maxAccounts;
  defaultCooldownMs;
  constructor(manager, options) {
    this.manager = manager || new TokenManager;
    this.pkceService = options?.pkceService || new OAuthPkceService(this.manager);
    this.maxAccounts = options?.maxAccounts ?? 7;
    this.defaultCooldownMs = options?.defaultCooldownMs ?? 180000;
    if (options?.allowedAccounts) {
      this.setAllowedAccounts(options.allowedAccounts);
    }
    this.refreshAccountList();
  }
  getPkceService() {
    return this.pkceService;
  }
  getManager() {
    return this.manager;
  }
  getCurrentIndex() {
    return this.currentIndex;
  }
  setAllowedAccounts(emails) {
    if (emails && emails.length > 0) {
      this.allowedAccounts = new Set;
      this.originalAllowedCase.clear();
      for (const e of emails) {
        const trimmed = e.trim();
        if (trimmed) {
          const lower = trimmed.toLowerCase();
          this.allowedAccounts.add(lower);
          this.originalAllowedCase.set(lower, trimmed);
        }
      }
    } else {
      this.allowedAccounts = undefined;
      this.originalAllowedCase.clear();
    }
    this.refreshAccountList();
  }
  getAllowedAccounts() {
    if (!this.allowedAccounts)
      return;
    return Array.from(this.allowedAccounts).map((lower) => this.originalAllowedCase.get(lower) || lower);
  }
  isAccountAllowed(email) {
    if (!this.allowedAccounts || this.allowedAccounts.size === 0)
      return true;
    return this.allowedAccounts.has(email.trim().toLowerCase());
  }
  enableAccount(email) {
    const trimmed = email.trim();
    const lower = trimmed.toLowerCase();
    if (!this.allowedAccounts) {
      const all = this.manager.loadAccounts();
      this.allowedAccounts = new Set;
      this.originalAllowedCase.clear();
      for (const a of all) {
        const l = a.email.toLowerCase();
        this.allowedAccounts.add(l);
        this.originalAllowedCase.set(l, a.email);
      }
    }
    this.allowedAccounts.add(lower);
    this.originalAllowedCase.set(lower, trimmed);
    this.refreshAccountList();
  }
  disableAccount(email) {
    const trimmed = email.trim();
    const lower = trimmed.toLowerCase();
    if (!this.allowedAccounts) {
      const all = this.manager.loadAccounts();
      this.allowedAccounts = new Set;
      this.originalAllowedCase.clear();
      for (const a of all) {
        const l = a.email.toLowerCase();
        this.allowedAccounts.add(l);
        this.originalAllowedCase.set(l, a.email);
      }
    }
    this.allowedAccounts.delete(lower);
    this.originalAllowedCase.delete(lower);
    this.refreshAccountList();
  }
  refreshAccountList() {
    const rawAccounts = this.manager.loadAccounts();
    const hasAllowedFilter = this.allowedAccounts && this.allowedAccounts.size > 0;
    const targetAccounts = hasAllowedFilter ? rawAccounts.filter((acc) => this.isAccountAllowed(acc.email)) : rawAccounts.slice(0, this.maxAccounts);
    for (const acc of rawAccounts) {
      const key = acc.email.toLowerCase();
      const isAllowed = this.isAccountAllowed(acc.email);
      if (!this.statuses.has(key)) {
        this.statuses.set(key, {
          email: acc.email,
          isAvailable: true,
          isThrottled: false,
          isAllowed,
          authExpired: false,
          authErrorReason: undefined,
          cooldownUntil: 0,
          lastUsedAt: 0,
          totalRequests: 0,
          throttledCount: 0,
          throttleReason: undefined,
          consecutiveFailures: 0
        });
      } else {
        const st = this.statuses.get(key);
        st.isAllowed = isAllowed;
      }
    }
    return targetAccounts;
  }
  getPoolStatus() {
    this.refreshAccountList();
    const now = Date.now();
    const result = [];
    for (const st of this.statuses.values()) {
      if (st.isThrottled && now >= st.cooldownUntil) {
        st.isThrottled = false;
        st.cooldownUntil = 0;
        st.throttleReason = undefined;
        st.consecutiveFailures = 0;
      }
      st.isAllowed = this.isAccountAllowed(st.email);
      const lower = st.email.toLowerCase();
      const ineligibles = this.ineligibleAgents.get(lower);
      const isLeased = this.isAccountLeased(lower);
      let leasedBy;
      for (const [sId, lEmail] of this.sessionLeases.entries()) {
        if (lEmail === lower) {
          leasedBy = sId;
          break;
        }
      }
      result.push({
        ...st,
        isLeased,
        leasedBy,
        ineligibleAgents: ineligibles ? Array.from(ineligibles) : []
      });
    }
    return result;
  }
  isAccountLeased(email) {
    const lower = email.trim().toLowerCase();
    for (const leasedEmail of this.sessionLeases.values()) {
      if (leasedEmail === lower)
        return true;
    }
    return this.inFlightLeases.has(lower);
  }
  getAvailableCapacity(forAgentId) {
    const normAgentId = forAgentId?.trim().toLowerCase();
    const accounts = this.refreshAccountList();
    const now = Date.now();
    let capacity = 0;
    for (const acc of accounts) {
      const key = acc.email.toLowerCase();
      const status = this.statuses.get(key);
      if (!status)
        continue;
      if (status.authExpired || status.isAvailable === false)
        continue;
      if (normAgentId && !this.isAgentEligible(acc.email, normAgentId))
        continue;
      if (status.isThrottled && now >= status.cooldownUntil) {
        status.isThrottled = false;
        status.cooldownUntil = 0;
        status.throttleReason = undefined;
        status.consecutiveFailures = 0;
      }
      if (status.isThrottled)
        continue;
      if (this.isAccountLeased(key))
        continue;
      capacity++;
    }
    return capacity;
  }
  async acquireSessionLease(sessionId, options) {
    const normSessionId = sessionId.trim();
    if (!normSessionId) {
      throw new Error("sessionId is required to acquire a session lease");
    }
    const existingEmail = this.sessionLeases.get(normSessionId);
    if (existingEmail) {
      const status = this.statuses.get(existingEmail.toLowerCase());
      if (status && !status.authExpired && status.isAvailable !== false && !status.isThrottled) {
        try {
          const session = await this.manager.getAccessToken(existingEmail);
          status.lastUsedAt = Date.now();
          status.totalRequests++;
          return session;
        } catch (err) {
          this.sessionLeases.delete(normSessionId);
          if (this.isFatalAuthGrantError(err)) {
            this.markAuthExpired(existingEmail, String(err?.message || err));
          } else {
            status.isThrottled = true;
            status.cooldownUntil = Date.now() + 60 * 1000;
            status.throttledCount = (status.throttledCount || 0) + 1;
          }
        }
      } else {
        this.sessionLeases.delete(normSessionId);
      }
    }
    const accounts = this.refreshAccountList();
    const total = accounts.length;
    if (total === 0) {
      throw new Error(`No accounts configured in ${this.manager.getConfigPath()}`);
    }
    const rawAgentId = options?.forAgentId;
    const normAgentId = rawAgentId ? ChatHubClient.normalizeAgentId(rawAgentId) || rawAgentId.trim() : undefined;
    const now = Date.now();
    const startIndex = this.currentIndex;
    for (let i = 0;i < total; i++) {
      const idx = (startIndex + i) % total;
      const acc = accounts[idx];
      const key = acc.email.toLowerCase();
      const status = this.statuses.get(key);
      if (normAgentId && !this.isAgentEligible(acc.email, normAgentId)) {
        continue;
      }
      if (status.authExpired || status.isAvailable === false) {
        continue;
      }
      if (status.isThrottled && now >= status.cooldownUntil) {
        status.isThrottled = false;
        status.cooldownUntil = 0;
      }
      if (status.isThrottled) {
        continue;
      }
      if (this.isAccountLeased(key)) {
        continue;
      }
      this.sessionLeases.set(normSessionId, key);
      this.currentIndex = (idx + 1) % total;
      try {
        const session = await this.manager.getAccessToken(acc.email);
        status.lastUsedAt = Date.now();
        status.totalRequests++;
        return session;
      } catch (err) {
        this.sessionLeases.delete(normSessionId);
        if (this.isFatalAuthGrantError(err)) {
          this.markAuthExpired(acc.email, String(err?.message || err));
        } else {
          status.isThrottled = true;
          status.cooldownUntil = Date.now() + 60 * 1000;
          status.throttledCount = (status.throttledCount || 0) + 1;
        }
      }
    }
    const eligibleAccounts = accounts.filter((acc) => !normAgentId || this.isAgentEligible(acc.email, normAgentId));
    const unthrottledCount = eligibleAccounts.filter((acc) => !this.statuses.get(acc.email.toLowerCase())?.isThrottled).length;
    const error = new Error(`ALL_ACCOUNTS_LEASED: All ${unthrottledCount} available accounts in the pool are currently leased by active sessions.`);
    error.code = "ALL_ACCOUNTS_LEASED";
    throw error;
  }
  releaseSessionLease(sessionId) {
    const normSessionId = sessionId.trim();
    this.sessionLeases.delete(normSessionId);
  }
  getSessionLease(sessionId) {
    const normSessionId = sessionId.trim();
    const lower = this.sessionLeases.get(normSessionId);
    if (!lower)
      return;
    return this.originalAllowedCase.get(lower) || this.statuses.get(lower)?.email || lower;
  }
  getNextUtcMidnight(floorMs = 15 * 60 * 1000) {
    return getNextUtcMidnight(floorMs);
  }
  static getNextUtcMidnight(floorMs = 15 * 60 * 1000) {
    return getNextUtcMidnight(floorMs);
  }
  markThrottled(email, durationMs, reason = "burst") {
    const key = email.toLowerCase();
    let status = this.statuses.get(key);
    if (!status) {
      this.refreshAccountList();
      status = this.statuses.get(key);
    }
    if (status) {
      const defaultMs = reason === "daily" ? Math.max(getNextUtcMidnight() - Date.now(), 15 * 60 * 1000) : this.defaultCooldownMs;
      const cooldown = durationMs ?? defaultMs;
      const target = Date.now() + cooldown;
      status.isThrottled = true;
      status.cooldownUntil = Math.max(status.cooldownUntil ?? 0, target);
      status.throttleReason = status.throttleReason === "daily" ? "daily" : reason;
      status.throttledCount = (status.throttledCount || 0) + 1;
      status.consecutiveFailures = (status.consecutiveFailures || 0) + 1;
    }
  }
  markAccountThrottled(email, cooldownSeconds = 180, reason = "burst") {
    this.markThrottled(email, cooldownSeconds * 1000, reason);
  }
  unthrottle(email) {
    const key = email.toLowerCase();
    const status = this.statuses.get(key);
    if (status) {
      status.isThrottled = false;
      status.cooldownUntil = 0;
      status.throttleReason = undefined;
      status.consecutiveFailures = 0;
    }
  }
  resetCooldown(email) {
    const key = email.toLowerCase();
    const status = this.statuses.get(key);
    if (!status) {
      return false;
    }
    if (status.authExpired) {
      return false;
    }
    this.unthrottle(email);
    return true;
  }
  reportThrottle(email, durationMs, reason = "burst") {
    this.markThrottled(email, durationMs, reason);
  }
  static isFatalAuthGrantError(err) {
    if (!err)
      return false;
    let text = "";
    if (typeof err === "string") {
      text = err;
    } else if (err instanceof Error) {
      text = `${err.message} ${err.description || ""} ${err.code || ""}`;
    } else if (typeof err === "object") {
      text = `${err.message || ""} ${err.error || ""} ${err.error_description || ""} ${err.code || ""}`;
    }
    const lower = text.toLowerCase();
    if (lower.includes("invalid_grant") || lower.includes("interaction_required")) {
      return true;
    }
    const fatalCodes = [
      "aadsts700082",
      "aadsts70008",
      "aadsts50173",
      "aadsts50076",
      "aadsts50079",
      "aadsts50058",
      "aadsts70000"
    ];
    return fatalCodes.some((code) => lower.includes(code));
  }
  isFatalAuthGrantError(err) {
    return AccountPool.isFatalAuthGrantError(err);
  }
  markAuthExpired(email, reason) {
    const key = email.toLowerCase();
    let status = this.statuses.get(key);
    if (!status) {
      this.refreshAccountList();
      status = this.statuses.get(key);
    }
    if (status) {
      status.authExpired = true;
      status.authErrorReason = reason;
      status.isAvailable = false;
      status.isThrottled = false;
      status.cooldownUntil = 0;
      status.throttleReason = "auth_error";
    }
    for (const [sessionId, leasedEmail] of this.sessionLeases.entries()) {
      if (leasedEmail === key) {
        this.sessionLeases.delete(sessionId);
      }
    }
    this.inFlightLeases.delete(key);
  }
  markAgentIneligible(email, agentId, reason) {
    const key = email.toLowerCase();
    const normAgent = ChatHubClient.normalizeAgentId(agentId) || agentId.trim();
    if (!this.ineligibleAgents.has(key)) {
      this.ineligibleAgents.set(key, new Set);
    }
    this.ineligibleAgents.get(key).add(normAgent);
  }
  isAgentEligible(email, agentId) {
    if (!agentId)
      return true;
    const key = email.toLowerCase();
    const set = this.ineligibleAgents.get(key);
    if (!set)
      return true;
    const normAgent = ChatHubClient.normalizeAgentId(agentId) || agentId.trim();
    return !set.has(normAgent);
  }
  clearAgentIneligibility(email, agentId) {
    const normAgent = agentId ? ChatHubClient.normalizeAgentId(agentId) || agentId.trim() : undefined;
    if (!email && !normAgent) {
      this.ineligibleAgents.clear();
      return;
    }
    if (email && !normAgent) {
      this.ineligibleAgents.delete(email.toLowerCase());
      return;
    }
    if (email && normAgent) {
      const set = this.ineligibleAgents.get(email.toLowerCase());
      if (set) {
        set.delete(normAgent);
        if (set.size === 0) {
          this.ineligibleAgents.delete(email.toLowerCase());
        }
      }
      return;
    }
    if (!email && normAgent) {
      for (const [key, set] of this.ineligibleAgents.entries()) {
        set.delete(normAgent);
        if (set.size === 0) {
          this.ineligibleAgents.delete(key);
        }
      }
    }
  }
  async getNextAvailableToken(targetAgentOrOptions) {
    const accounts = this.refreshAccountList();
    if (accounts.length === 0) {
      throw new Error(`No accounts configured in ${this.manager.getConfigPath()}`);
    }
    if (typeof targetAgentOrOptions === "object" && targetAgentOrOptions?.sessionId) {
      return await this.acquireSessionLease(targetAgentOrOptions.sessionId, targetAgentOrOptions);
    }
    const rawAgentId = typeof targetAgentOrOptions === "string" ? targetAgentOrOptions : targetAgentOrOptions?.forAgentId;
    const normAgentId = rawAgentId ? ChatHubClient.normalizeAgentId(rawAgentId) || rawAgentId.trim() : undefined;
    const now = Date.now();
    const total = accounts.length;
    if (normAgentId) {
      const hasEligible = accounts.some((acc) => this.isAgentEligible(acc.email, normAgentId));
      if (!hasEligible) {
        throw new Error(`No eligible accounts found in pool for agent '${normAgentId}'`);
      }
    }
    for (const preferUnleased of [true, false]) {
      const startIndex = this.currentIndex;
      for (let i = 0;i < total; i++) {
        const idx = (startIndex + i) % total;
        const acc = accounts[idx];
        const key = acc.email.toLowerCase();
        const status = this.statuses.get(key);
        if (normAgentId && !this.isAgentEligible(acc.email, normAgentId)) {
          continue;
        }
        if (status.authExpired || status.isAvailable === false) {
          continue;
        }
        if (status.isThrottled && now >= status.cooldownUntil) {
          status.isThrottled = false;
          status.cooldownUntil = 0;
        }
        if (status.isThrottled) {
          continue;
        }
        const isLeased = this.inFlightLeases.has(key) || this.isAccountLeased(key);
        if (preferUnleased && isLeased) {
          continue;
        }
        this.inFlightLeases.add(key);
        this.currentIndex = (idx + 1) % total;
        try {
          const session = await this.manager.getAccessToken(acc.email);
          status.lastUsedAt = Date.now();
          status.totalRequests++;
          return session;
        } catch (err) {
          if (this.isFatalAuthGrantError(err)) {
            this.markAuthExpired(acc.email, String(err?.message || err));
          } else {
            status.isThrottled = true;
            status.cooldownUntil = Date.now() + 60 * 1000;
            status.throttledCount = (status.throttledCount || 0) + 1;
          }
        } finally {
          this.inFlightLeases.delete(key);
        }
      }
    }
    const eligibleAccounts = accounts.filter((acc) => !normAgentId || this.isAgentEligible(acc.email, normAgentId));
    let earliest = null;
    for (const acc of eligibleAccounts) {
      const st = this.statuses.get(acc.email.toLowerCase());
      if (st && st.isThrottled && st.cooldownUntil > 0 && (!earliest || st.cooldownUntil < earliest.cooldownUntil)) {
        earliest = st;
      }
    }
    const waitSeconds = earliest ? Math.max(1, Math.ceil((earliest.cooldownUntil - now) / 1000)) : 30;
    if (normAgentId) {
      throw new Error(`All ${eligibleAccounts.length} eligible account(s) for agent '${normAgentId}' in the pool are currently rate-limited. Earliest cooldown expires in ${waitSeconds}s`);
    } else if (this.allowedAccounts && this.allowedAccounts.size > 0) {
      throw new Error(`All ${total} allowed account(s) in the pool are currently rate-limited. Earliest cooldown expires in ${waitSeconds}s`);
    } else {
      throw new Error(`All ${total} accounts in the pool are currently rate-limited. Earliest cooldown expires in ${waitSeconds}s`);
    }
  }
  async executeWithRelay(fn, optionsOrMaxAttempts) {
    let forAgentId;
    let maxAttempts;
    if (typeof optionsOrMaxAttempts === "number") {
      maxAttempts = optionsOrMaxAttempts;
    } else if (typeof optionsOrMaxAttempts === "object" && optionsOrMaxAttempts !== null) {
      forAgentId = optionsOrMaxAttempts.forAgentId;
      maxAttempts = optionsOrMaxAttempts.maxAttempts;
    }
    const accounts = this.refreshAccountList();
    const attempts = maxAttempts ?? Math.max(1, accounts.length);
    let lastError;
    for (let attempt = 0;attempt < attempts; attempt++) {
      const token = await this.getNextAvailableToken(forAgentId ? { forAgentId } : undefined);
      try {
        return await fn(token);
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || err).toLowerCase();
        if (this.isFatalAuthGrantError(err)) {
          this.markAuthExpired(token.email, String(err?.message || err));
          continue;
        }
        const isRateLimited = msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("429") || msg.includes("throttled") || msg.includes("quota");
        if (isRateLimited) {
          this.markThrottled(token.email);
          continue;
        }
        const isGptForbidden = msg.includes("gptaccessforbidden") || err?.errorCode === "GptAccessForbidden";
        const isGptUnavailable = msg.includes("gptnotavailable") || err?.errorCode === "GptNotAvailable";
        if (isGptForbidden || isGptUnavailable) {
          const targetAgent = forAgentId || err?.agentId;
          const reason = isGptForbidden ? "GptAccessForbidden" : "GptNotAvailable";
          if (targetAgent) {
            this.markAgentIneligible(token.email, targetAgent, reason);
          }
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }
  async getGraphAccessToken(email) {
    if (email) {
      return this.manager.getGraphAccessToken(email);
    }
    const accounts = this.refreshAccountList();
    if (accounts.length === 0) {
      throw new Error(`No accounts configured in ${this.manager.getConfigPath()}`);
    }
    const now = Date.now();
    const total = accounts.length;
    const startIndex = this.currentIndex;
    for (let i = 0;i < total; i++) {
      const idx = (startIndex + i) % total;
      const acc = accounts[idx];
      const key = acc.email.toLowerCase();
      const status = this.statuses.get(key);
      if (!status)
        continue;
      if (status.authExpired || status.isAvailable === false) {
        continue;
      }
      if (status.isThrottled && now >= status.cooldownUntil) {
        status.isThrottled = false;
        status.cooldownUntil = 0;
      }
      if (status.isThrottled) {
        continue;
      }
      try {
        const token = await this.manager.getGraphAccessToken(acc.email);
        return token;
      } catch (err) {
        if (this.isFatalAuthGrantError(err)) {
          this.markAuthExpired(acc.email, String(err?.message || err));
        } else {
          this.markThrottled(acc.email, 60 * 1000, "burst");
        }
      }
    }
    throw new Error("No healthy accounts available in pool for Graph access token");
  }
  async getIc3AccessToken(email) {
    if (email) {
      try {
        return await this.manager.getIc3AccessToken(email);
      } catch (err) {
        if (this.isFatalAuthGrantError(err)) {
          this.markAuthExpired(email, String(err?.message || err));
        }
      }
    }
    const accounts = this.refreshAccountList();
    if (accounts.length === 0) {
      throw new Error(`No accounts configured in ${this.manager.getConfigPath()}`);
    }
    const now = Date.now();
    const total = accounts.length;
    const startIndex = this.currentIndex;
    for (let i = 0;i < total; i++) {
      const idx = (startIndex + i) % total;
      const acc = accounts[idx];
      const status = this.statuses.get(acc.email.toLowerCase());
      if (!status)
        continue;
      if (status.authExpired || status.isAvailable === false)
        continue;
      if (status.isThrottled && now >= status.cooldownUntil) {
        status.isThrottled = false;
        status.cooldownUntil = 0;
      }
      if (status.isThrottled)
        continue;
      try {
        return await this.manager.getIc3AccessToken(acc.email);
      } catch (err) {
        if (this.isFatalAuthGrantError(err)) {
          this.markAuthExpired(acc.email, String(err?.message || err));
        }
      }
    }
    throw new Error("No healthy accounts available in pool for IC3 access token");
  }
  startPkceAuth(targetEmail) {
    const session = this.pkceService.startAuthSession(targetEmail);
    this.pkceSessions.set(session.state, session.authSessionId);
    this.pkceSessions.set(session.authSessionId, session.authSessionId);
    if (targetEmail) {
      this.pkceSessions.set(targetEmail.trim().toLowerCase(), session.authSessionId);
    }
    return session;
  }
  async completePkceAuth(redirectUrlOrCode, state, expectedEmail) {
    let resolvedState = state;
    if (!resolvedState) {
      try {
        const extracted = this.pkceService.extractCodeAndState(redirectUrlOrCode);
        resolvedState = extracted.state;
      } catch {}
    }
    let targetSessionId = "";
    if (resolvedState && this.pkceSessions.has(resolvedState)) {
      targetSessionId = this.pkceSessions.get(resolvedState);
    } else if (resolvedState) {
      targetSessionId = resolvedState;
    } else if (expectedEmail && this.pkceSessions.has(expectedEmail.trim().toLowerCase())) {
      targetSessionId = this.pkceSessions.get(expectedEmail.trim().toLowerCase());
    } else if (this.pkceService.findSession) {
      const match = this.pkceService.findSession((s) => !expectedEmail || s.targetEmail?.toLowerCase() === expectedEmail.toLowerCase());
      if (match)
        targetSessionId = match.authSessionId;
    }
    const result = await this.pkceService.exchangeCode(targetSessionId, redirectUrlOrCode, expectedEmail);
    if (result.success && result.email) {
      const key = result.email.toLowerCase();
      let status = this.statuses.get(key);
      if (!status) {
        this.refreshAccountList();
        status = this.statuses.get(key);
      }
      if (status) {
        status.authExpired = false;
        status.authErrorReason = undefined;
        status.isAvailable = true;
        status.isThrottled = false;
        status.cooldownUntil = 0;
        status.throttleReason = undefined;
        status.consecutiveFailures = 0;
      }
    }
    return result;
  }
}

// src/skills/skill-loader.ts
import fs5 from "node:fs";
import path5 from "node:path";
import os4 from "node:os";
import { fileURLToPath } from "node:url";

class SkillLoader2 {
  workspaceRoot;
  customPaths;
  includeDefaults;
  constructor(options = {}) {
    if (typeof options === "string") {
      this.workspaceRoot = path5.resolve(options);
      this.customPaths = [];
      this.includeDefaults = true;
    } else {
      this.workspaceRoot = path5.resolve(options.workspaceRoot || process.cwd());
      this.customPaths = options.customPaths || [];
      this.includeDefaults = options.includeDefaults ?? true;
    }
  }
  getWorkspaceRoot() {
    return this.workspaceRoot;
  }
  getSearchPaths() {
    const paths = [];
    for (const p of this.customPaths) {
      paths.push(this.resolveHome(p));
    }
    if (this.includeDefaults) {
      const home = os4.homedir();
      paths.push(path5.join(this.workspaceRoot, ".skills"), path5.join(this.workspaceRoot, "skills"), path5.join(this.workspaceRoot, ".pi", "skills"));
      try {
        const here = path5.dirname(fileURLToPath(import.meta.url));
        const bundledDirs = [
          path5.resolve(here, "../../skills"),
          path5.resolve(here, "../skills"),
          path5.resolve(here, "../agent-bundle/skills"),
          path5.resolve(here, "../../package/agent-bundle/skills")
        ];
        for (const dir of bundledDirs) {
          if (fs5.existsSync(dir) && !paths.includes(dir)) {
            paths.push(dir);
          }
        }
      } catch {}
      paths.push(path5.join(home, ".gemini", "config", "skills"), path5.join(home, ".gemini", "antigravity", "builtin", "skills"), path5.join(home, ".pi", "agent", "skills"));
    }
    return paths;
  }
  resolveHome(p) {
    if (p.startsWith("~")) {
      return path5.join(os4.homedir(), p.slice(1).replace(/^[/\\]/, ""));
    }
    return path5.resolve(p);
  }
  discoverSkills() {
    const skillsMap = new Map;
    const searchPaths = this.getSearchPaths();
    for (const searchDir of searchPaths) {
      if (!fs5.existsSync(searchDir))
        continue;
      try {
        const stat = fs5.statSync(searchDir);
        if (!stat.isDirectory())
          continue;
        const entries = fs5.readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillPath = path5.join(searchDir, entry.name, "SKILL.md");
            const altSkillPath = path5.join(searchDir, entry.name, "skill.md");
            let targetFile = "";
            if (fs5.existsSync(skillPath)) {
              targetFile = skillPath;
            } else if (fs5.existsSync(altSkillPath)) {
              targetFile = altSkillPath;
            }
            if (targetFile) {
              const skill = this.loadSkillFromFile(targetFile, entry.name, searchDir);
              if (skill) {
                const key = skill.name.toLowerCase();
                if (!skillsMap.has(key)) {
                  skillsMap.set(key, skill);
                }
              }
            }
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            const fallbackName = entry.name.replace(/\.md$/i, "");
            const targetFile = path5.join(searchDir, entry.name);
            const skill = this.loadSkillFromFile(targetFile, fallbackName, searchDir);
            if (skill) {
              const key = skill.name.toLowerCase();
              if (!skillsMap.has(key)) {
                skillsMap.set(key, skill);
              }
            }
          }
        }
      } catch {}
    }
    return Array.from(skillsMap.values());
  }
  loadSkillFromFile(filePath, fallbackName, sourceDir) {
    try {
      const raw = fs5.readFileSync(filePath, "utf8");
      const parsed = SkillLoader2.parseSkillMarkdown(raw, fallbackName);
      const isWorkspace = filePath.startsWith(this.workspaceRoot);
      const source = isWorkspace ? "workspace" : sourceDir;
      return {
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        filePath,
        source,
        metadata: parsed.metadata
      };
    } catch {
      return null;
    }
  }
  static parseSkillMarkdown(content, fallbackName) {
    const trimmed = content.trim();
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = trimmed.match(frontmatterRegex);
    const metadata = {};
    let body = trimmed;
    if (match) {
      const yamlBlock = match[1];
      body = match[2].trim();
      const lines = yamlBlock.split(/\r?\n/);
      let currentKey = "";
      let currentValue = "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
          continue;
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0 && !rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
          if (currentKey) {
            metadata[currentKey] = SkillLoader2.cleanYamlValue(currentValue);
          }
          currentKey = line.slice(0, colonIdx).trim();
          currentValue = line.slice(colonIdx + 1).trim();
        } else if (currentKey) {
          currentValue += " " + line;
        }
      }
      if (currentKey) {
        metadata[currentKey] = SkillLoader2.cleanYamlValue(currentValue);
      }
    }
    const name = metadata.name || fallbackName;
    const description = metadata.description || "";
    return {
      name,
      description,
      content: body,
      metadata
    };
  }
  static cleanYamlValue(val) {
    let cleaned = val.trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"') || cleaned.startsWith("'") && cleaned.endsWith("'")) {
      cleaned = cleaned.slice(1, -1);
    }
    return cleaned.trim();
  }
}

// src/skills/skill-registry.ts
class SkillRegistry {
  loader;
  availableSkills = new Map;
  activeSkills = new Map;
  agentMountedSkills = new Set(["handoff", "subagent"]);
  constructor(loader, agentMountedSkills) {
    this.loader = loader || new SkillLoader2;
    if (agentMountedSkills && Array.isArray(agentMountedSkills)) {
      this.agentMountedSkills = new Set(agentMountedSkills.map((s) => s.toLowerCase().replace(/^\//, "").trim()));
    }
  }
  getAgentMountedSkills() {
    return Array.from(this.agentMountedSkills.values());
  }
  isAgentMounted(name) {
    const key = name.toLowerCase().replace(/^\//, "").trim();
    return this.agentMountedSkills.has(key);
  }
  setAgentMountedSkills(names) {
    this.agentMountedSkills = new Set(names.map((s) => s.toLowerCase().replace(/^\//, "").trim()));
  }
  toggleAgentMounted(name) {
    const key = name.toLowerCase().replace(/^\//, "").trim();
    if (this.agentMountedSkills.has(key)) {
      this.agentMountedSkills.delete(key);
      return false;
    } else {
      this.agentMountedSkills.add(key);
      return true;
    }
  }
  setAgentMounted(name, mounted) {
    const key = name.toLowerCase().replace(/^\//, "").trim();
    if (mounted) {
      this.agentMountedSkills.add(key);
    } else {
      this.agentMountedSkills.delete(key);
    }
  }
  getLoader() {
    return this.loader;
  }
  loadSkills() {
    const skills = this.loader.discoverSkills();
    this.availableSkills.clear();
    for (const skill of skills) {
      this.availableSkills.set(skill.name.toLowerCase(), skill);
    }
    return skills;
  }
  registerSkill(skill) {
    this.availableSkills.set(skill.name.toLowerCase(), skill);
  }
  getAvailableSkills() {
    return Array.from(this.availableSkills.values());
  }
  getActiveSkills() {
    return Array.from(this.activeSkills.values());
  }
  isSkillActive(name) {
    const key = name.toLowerCase().replace(/^\//, "").trim();
    return this.activeSkills.has(key);
  }
  activateSkill(name) {
    const skill = this.findSkill(name);
    if (!skill)
      return false;
    this.activeSkills.set(skill.name.toLowerCase(), skill);
    return true;
  }
  deactivateSkill(name) {
    const skill = this.findSkill(name);
    if (!skill)
      return false;
    return this.activeSkills.delete(skill.name.toLowerCase());
  }
  toggleSkill(name) {
    const skill = this.findSkill(name);
    if (!skill)
      return { active: false };
    const key = skill.name.toLowerCase();
    if (this.activeSkills.has(key)) {
      this.activeSkills.delete(key);
      return { active: false, skill };
    } else {
      this.activeSkills.set(key, skill);
      return { active: true, skill };
    }
  }
  clearActiveSkills() {
    this.activeSkills.clear();
  }
  findSkill(query) {
    const q = query.trim().toLowerCase().replace(/^\//, "");
    if (!q)
      return;
    const skills = Array.from(this.availableSkills.values());
    const exact = skills.find((s) => s.name.toLowerCase() === q);
    if (exact)
      return exact;
    const prefixMatches = skills.filter((s) => s.name.toLowerCase().startsWith(q));
    if (prefixMatches.length > 0) {
      prefixMatches.sort((a, b) => a.name.length - b.name.length);
      return prefixMatches[0];
    }
    const substringMatches = skills.filter((s) => s.name.toLowerCase().includes(q));
    if (substringMatches.length > 0) {
      substringMatches.sort((a, b) => a.name.length - b.name.length);
      return substringMatches[0];
    }
    return;
  }
  searchSkills(keyword) {
    const kw = keyword.trim().toLowerCase();
    if (!kw)
      return this.getAvailableSkills();
    return Array.from(this.availableSkills.values()).filter((s) => s.name.toLowerCase().includes(kw) || s.description && s.description.toLowerCase().includes(kw));
  }
  parseSlashCommand(input) {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return { task: input, isSlashCommand: false };
    }
    const spaceIdx = trimmed.indexOf(" ");
    let rawCmd;
    let task;
    if (spaceIdx === -1) {
      rawCmd = trimmed.slice(1).trim();
      task = "";
    } else {
      rawCmd = trimmed.slice(1, spaceIdx).trim();
      task = trimmed.slice(spaceIdx + 1).trim();
    }
    const matchedSkill = this.findSkill(rawCmd);
    return {
      skill: matchedSkill,
      task,
      isSlashCommand: true,
      rawCommand: rawCmd
    };
  }
  buildPromptSection(skills) {
    const targetSkills = skills ?? this.getActiveSkills();
    if (targetSkills.length === 0)
      return "";
    const mounted = [];
    const dynamic = [];
    for (const s of targetSkills) {
      if (this.isAgentMounted(s.name)) {
        mounted.push(s);
      } else {
        dynamic.push(s);
      }
    }
    const blocks = [];
    if (mounted.length > 0) {
      const mountedItems = mounted.map((s) => {
        const desc = s.description ? `: ${s.description}` : "";
        return `- **[${s.name}]**${desc}`;
      });
      blocks.push([
        "【已在 Agent 挂载的内置专业技能 (Agent Pre-mounted Skills)】",
        "当前任务已激活以下预置于你的专属知识库与系统指令中的工程技能。该技能规范已由你完全掌握，无需重复上传附件或倾倒正文，请直接唤醒并遵循你所持有的对应技能流程与阶段门禁执行：",
        ...mountedItems
      ].join(`
`));
    }
    if (dynamic.length > 0) {
      const dynamicSections = dynamic.map((s, idx) => {
        const header = `#### [技能 ${idx + 1}: ${s.name}]`;
        const desc = s.description ? `**说明**: ${s.description}` : "";
        const body = s.content ? `**指引与约束规范**:
${s.content}` : "";
        return [header, desc, body].filter(Boolean).join(`
`);
      });
      blocks.push([
        "【已激活专业工程技能手册 (Active Specialized Skills)】",
        "以下是你当前已激活的专属领域工程技能（动态全量挂载）。请在后续分析、计划与工具调用中严格遵守各技能的规范与铁律约束：",
        "",
        ...dynamicSections
      ].join(`
`));
    }
    return blocks.join(`

`);
  }
}

// src/agent/subagent-runner.ts
import fs14 from "node:fs";
import path19 from "node:path";
import crypto8 from "node:crypto";

// src/agent/orchestrator.ts
import crypto7 from "crypto";
import fs13 from "fs";
import path18 from "path";
import { execSync as execSync3 } from "child_process";

// src/transport/substrate-uploader.ts
class SubstrateUploader {
  static DEFAULT_UPLOAD_URL = "https://substrate.office.com/m365Copilot/UploadFile";
  static DEFAULT_GRAPH_URL = "https://graph.microsoft.com/v1.0/me/drive/special/copilotuploads";
  static CLIENT_SPLIT_THRESHOLD_HYPOTHESIS = 4 * 1024 * 1024;
  static CHUNK_SIZE = 8192000;
  static MAX_CHUNK_ATTEMPTS = 5;
  static MAX_SIMPLE_ATTEMPTS = 5;
  static spoBase64Cache = new Map;
  static sleepInterruptible(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error("Operation aborted");
        err.name = "AbortError";
        return reject(err);
      }
      let timer = null;
      const onAbort = () => {
        if (timer)
          clearTimeout(timer);
        if (signal)
          signal.removeEventListener("abort", onAbort);
        const err = new Error("Operation aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (signal) {
        signal.addEventListener("abort", onAbort);
      }
      timer = setTimeout(() => {
        if (signal)
          signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
    });
  }
  static async resolveSpoBase64(graphAccessToken, customBaseUrl) {
    if (this.spoBase64Cache.has(graphAccessToken)) {
      return this.spoBase64Cache.get(graphAccessToken);
    }
    try {
      const listUrl = customBaseUrl ? `${customBaseUrl}/list?$select=id,name,parentReference` : "https://graph.microsoft.com/v1.0/me/drive/list?$select=id,name,parentReference";
      const res = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${graphAccessToken}` },
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        const listData = await res.json();
        const listId = listData.id;
        const siteRef = listData.parentReference?.siteId || "";
        const parts = siteRef.split(",");
        const siteId = parts[1];
        const webId = parts[2];
        if (siteId && webId && listId) {
          const encoded = Buffer.from(`${siteId},${webId},${listId}`).toString("base64");
          this.spoBase64Cache.set(graphAccessToken, encoded);
          return encoded;
        }
      }
    } catch {}
    return "";
  }
  static async uploadImage(accessToken, imageBytes, options) {
    const mime = options.mimeType || "image/png";
    const dataUrl = `data:${mime};base64,${imageBytes.toString("base64")}`;
    const form = new URLSearchParams;
    form.set("scenario", "UploadImage");
    form.set("conversationId", options.conversationId);
    form.set("FileBase64", dataUrl);
    form.append("optionsSets", "cwcgptvsan");
    form.append("optionsSets", "flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch");
    const uploadUrl = options.uploadUrl || this.DEFAULT_UPLOAD_URL;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Variants": "feature.EnableClientFileURLSupportForOfficeWebPaidCopilot",
        "X-Scenario": "OfficeWebIncludedCopilot",
        Origin: "https://m365.cloud.microsoft",
        Referer: "https://m365.cloud.microsoft/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      },
      body: form.toString()
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Substrate upload failed (${res.status}): ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.docId || data.result?.value !== "Success") {
      throw new Error(`Substrate upload failed: docId missing or status not Success`);
    }
    return {
      id: data.docId,
      messageAnnotationMetadata: {
        "@type": "File",
        annotationType: "File",
        fileType: (data.fileType || "png").replace(/^\./, ""),
        fileName: data.fileName || options.fileName
      },
      messageAnnotationType: "ImageFile"
    };
  }
  static async assembleUploadResult(graphAccessToken, data, fileName, customBaseUrl) {
    const finalName = data.name || fileName;
    const driveId = data.parentReference?.driveId || "";
    const ext = finalName.split(".").pop() || "txt";
    const spoBase64 = await this.resolveSpoBase64(graphAccessToken, customBaseUrl);
    const annotationId = spoBase64 ? `SPO_${spoBase64}_${data.id}` : data.id;
    const annotation = {
      id: annotationId,
      text: finalName,
      url: data.webUrl,
      messageAnnotationType: "LocalFile",
      messageAnnotationMetadata: {
        "@type": "File",
        annotationType: "File",
        fileName: finalName,
        webUrl: data.webUrl,
        driveId,
        fileType: ext
      }
    };
    return {
      driveItemId: data.id,
      webUrl: data.webUrl,
      driveId,
      fileName: finalName,
      annotation
    };
  }
  static async uploadSimple(graphAccessToken, content, fileName, signal, customBaseUrl) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    const encodedName = encodeURIComponent(fileName);
    const rootUrl = customBaseUrl && customBaseUrl.startsWith("http") ? customBaseUrl : this.DEFAULT_GRAPH_URL;
    const url = customBaseUrl && customBaseUrl.startsWith("http") ? `${customBaseUrl}/${encodedName}:/content` : `${rootUrl}:/${encodedName}:/content`;
    let attempts = 0;
    while (true) {
      if (signal?.aborted) {
        const err = new Error("Upload aborted by caller");
        err.name = "AbortError";
        throw err;
      }
      attempts++;
      let res;
      try {
        res = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${graphAccessToken}`,
            "Content-Type": "text/plain; charset=utf-8",
            Prefer: "ExtractTextOnCommit, pacToken=N",
            SdkVersion: "graph-js/3.0.7 (featureUsage=7)"
          },
          body: buffer,
          signal
        });
      } catch (err) {
        if (signal?.aborted || err.name === "AbortError")
          throw err;
        if (attempts >= this.MAX_SIMPLE_ATTEMPTS)
          throw err;
        await this.sleepInterruptible(attempts * 2000, signal);
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        if (attempts >= this.MAX_SIMPLE_ATTEMPTS) {
          throw new Error(`Simple upload hit rate limit / service unavailable and exceeded max retry limit (${this.MAX_SIMPLE_ATTEMPTS})`);
        }
        let retrySec = 5;
        const headerVal = res.headers.get("Retry-After");
        if (headerVal) {
          const parsedInt = parseInt(headerVal, 10);
          if (!isNaN(parsedInt)) {
            retrySec = Math.max(parsedInt, 0);
          } else {
            const parsedDate = Date.parse(headerVal);
            if (!isNaN(parsedDate)) {
              retrySec = Math.max(Math.ceil((parsedDate - Date.now()) / 1000), 0);
            }
          }
        }
        await this.sleepInterruptible(Math.min(retrySec, 60) * 1000, signal);
        continue;
      }
      if (res.status >= 400 && res.status < 500) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Graph simple upload failed (${res.status}): ${errText.slice(0, 200)}`);
      }
      if (res.status >= 500) {
        if (attempts >= this.MAX_SIMPLE_ATTEMPTS) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Graph simple upload failed (${res.status}): ${errText.slice(0, 200)}`);
        }
        await this.sleepInterruptible(attempts * 2000, signal);
        continue;
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Graph simple upload failed (${res.status}): ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      return await this.assembleUploadResult(graphAccessToken, data, fileName, customBaseUrl);
    }
  }
  static async uploadResumable(graphAccessToken, buffer, fileName, signal, customBaseUrl) {
    const totalBytes = buffer.length;
    const encodedName = encodeURIComponent(fileName);
    const rootUrl = customBaseUrl && customBaseUrl.startsWith("http") ? customBaseUrl : this.DEFAULT_GRAPH_URL;
    const sessionUrl = customBaseUrl && customBaseUrl.startsWith("http") ? `${customBaseUrl}/${encodedName}:/createUploadSession` : `${rootUrl}:/${encodedName}:/createUploadSession`;
    let sessionRes;
    try {
      sessionRes = await fetch(sessionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${graphAccessToken}`,
          "Content-Type": "application/json",
          Prefer: "ExtractTextOnCommit, pacToken=N"
        },
        body: JSON.stringify({
          item: {
            "@microsoft.graph.conflictBehavior": "replace",
            name: fileName
          }
        }),
        signal
      });
    } catch (err) {
      if (signal?.aborted || err.name === "AbortError")
        throw err;
      throw err;
    }
    if (!sessionRes.ok) {
      const errText = await sessionRes.text().catch(() => "");
      throw new Error(`Create upload session failed (${sessionRes.status}): ${errText.slice(0, 200)}`);
    }
    const sessionData = await sessionRes.json();
    const uploadUrl = sessionData.uploadUrl;
    if (!uploadUrl) {
      throw new Error("Create upload session succeeded but no uploadUrl returned");
    }
    let nextRanges = sessionData.nextExpectedRanges || ["0-"];
    let driveItemData = null;
    while (nextRanges.length > 0 && !driveItemData) {
      if (signal?.aborted) {
        const err = new Error("Upload aborted by caller");
        err.name = "AbortError";
        throw err;
      }
      const match = nextRanges[0].match(/^(\d+)-/);
      if (!match) {
        throw new Error(`Invalid nextExpectedRanges format: ${JSON.stringify(nextRanges)}`);
      }
      const offset = parseInt(match[1], 10);
      if (offset >= totalBytes)
        break;
      const end = Math.min(offset + this.CHUNK_SIZE, totalBytes);
      const chunk = buffer.subarray(offset, end);
      let attempts = 0;
      let chunkSuccess = false;
      while (!chunkSuccess) {
        if (signal?.aborted) {
          const err = new Error("Upload aborted by caller");
          err.name = "AbortError";
          throw err;
        }
        attempts++;
        if (attempts > this.MAX_CHUNK_ATTEMPTS) {
          throw new Error(`Chunk PUT at offset ${offset} exceeded max retry limit (${this.MAX_CHUNK_ATTEMPTS})`);
        }
        let putRes;
        try {
          putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Range": `bytes ${offset}-${end - 1}/${totalBytes}`,
              "Content-Length": String(chunk.length),
              Prefer: "ExtractTextOnCommit",
              SdkVersion: "graph-js/3.0.7 (featureUsage=7)"
            },
            body: chunk,
            signal
          });
        } catch (err) {
          if (signal?.aborted || err.name === "AbortError")
            throw err;
          if (attempts >= this.MAX_CHUNK_ATTEMPTS)
            throw err;
          await this.sleepInterruptible(attempts * 2000, signal);
          continue;
        }
        if (putRes.status === 429 || putRes.status === 503) {
          let retrySec = 5;
          const headerVal = putRes.headers.get("Retry-After");
          if (headerVal) {
            const parsedInt = parseInt(headerVal, 10);
            if (!isNaN(parsedInt)) {
              retrySec = Math.max(parsedInt, 0);
            } else {
              const parsedDate = Date.parse(headerVal);
              if (!isNaN(parsedDate)) {
                retrySec = Math.max(Math.ceil((parsedDate - Date.now()) / 1000), 0);
              }
            }
          }
          await this.sleepInterruptible(Math.min(retrySec, 60) * 1000, signal);
          continue;
        }
        if (putRes.status >= 400 && putRes.status < 500) {
          const errText = await putRes.text().catch(() => "");
          throw new Error(`Chunk PUT failed with client error (${putRes.status}): ${errText.slice(0, 200)}`);
        }
        if (putRes.status >= 500) {
          if (attempts >= this.MAX_CHUNK_ATTEMPTS) {
            const errText = await putRes.text().catch(() => "");
            throw new Error(`Chunk PUT failed (${putRes.status}): ${errText.slice(0, 200)}`);
          }
          await this.sleepInterruptible(attempts * 2000, signal);
          continue;
        }
        if (putRes.status === 202) {
          const resJson = await putRes.json();
          nextRanges = resJson.nextExpectedRanges || [`${end}-`];
          chunkSuccess = true;
        } else if (putRes.status === 201 || putRes.status === 200) {
          driveItemData = await putRes.json();
          nextRanges = [];
          chunkSuccess = true;
        } else {
          const errText = await putRes.text().catch(() => "");
          throw new Error(`Chunk PUT failed (${putRes.status}): ${errText.slice(0, 200)}`);
        }
      }
    }
    if (!driveItemData || !driveItemData.id) {
      throw new Error("Resumable upload completed without DriveItem metadata returned.");
    }
    return await this.assembleUploadResult(graphAccessToken, driveItemData, fileName, customBaseUrl);
  }
  static async uploadDocumentAuto(graphAccessToken, content, fileName, signal, customBaseUrl) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    if (buffer.byteLength <= this.CLIENT_SPLIT_THRESHOLD_HYPOTHESIS) {
      return await this.uploadSimple(graphAccessToken, buffer, fileName, signal, customBaseUrl);
    }
    return await this.uploadResumable(graphAccessToken, buffer, fileName, signal, customBaseUrl);
  }
  static async uploadDocumentToOneDrive(graphAccessToken, content, fileName, customBaseUrlOrSignal) {
    let actualContent = content;
    let actualFileName = fileName;
    if (typeof content === "string" && (content.endsWith(".md") || content.endsWith(".txt") || content.startsWith("handoff-")) && !content.includes(`
`) && (fileName.includes(`
`) || fileName.length > 255)) {
      actualContent = fileName;
      actualFileName = content;
    }
    const signal = customBaseUrlOrSignal instanceof AbortSignal ? customBaseUrlOrSignal : undefined;
    const customBaseUrl = typeof customBaseUrlOrSignal === "string" ? customBaseUrlOrSignal : undefined;
    return await this.uploadDocumentAuto(graphAccessToken, actualContent, actualFileName, signal, customBaseUrl);
  }
}

// src/workspace/snapshot-generator.ts
import { execSync } from "node:child_process";
import fs6 from "node:fs";
import path6 from "node:path";
import crypto4 from "node:crypto";

class SnapshotGenerator {
  static MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
  static EXCLUDED_DIR_PREFIXES = [
    ".docs/",
    "package/",
    "dist/",
    ".cph/",
    "node_modules/",
    ".git/"
  ];
  static SENSITIVE_FILE_PATTERNS = [
    /^\.env/i,
    /token.*\.json$/i,
    /session.*\.json$/i,
    /\.(pem|key|pfx|pkcs12)$/i,
    /id_rsa/i
  ];
  static SENSITIVE_CONTENT_PATTERNS = [
    /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----/i,
    /ey[A-Za-z0-9-_]{20,}\.ey[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/
  ];
  static CRITICAL_CORE_FILES = [
    "src/session/session-manager.ts",
    "src/session/ledger/execution-ledger.ts",
    "src/session/lineage-tracker.ts",
    "src/auth/token-manager.ts",
    "scripts/lib/PnPSession.psm1",
    "cph-main-agent-prompt.txt",
    "cph-coder-agent-prompt.txt",
    "cph-dev-agent-prompt.txt"
  ];
  static ALLOWED_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".cs",
    ".py",
    ".ps1",
    ".psm1",
    ".psd1",
    ".json",
    ".md",
    ".sql",
    ".html",
    ".css",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
    ".txt"
  ]);
  static getTrackedSourceFiles(workspaceRoot) {
    let rawLines = [];
    try {
      const cmd = "git ls-files -z --cached --others --exclude-standard";
      const stdout = execSync(cmd, {
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"]
      });
      rawLines = stdout.toString("utf-8").split("\x00").filter(Boolean);
    } catch {
      rawLines = this.scanDirRecursive(workspaceRoot, workspaceRoot);
    }
    return rawLines.map((p) => p.replace(/\\/g, "/")).filter((relPath) => {
      if (this.EXCLUDED_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix) || relPath.startsWith("./" + prefix))) {
        return false;
      }
      const ext = path6.extname(relPath).toLowerCase();
      if (!this.ALLOWED_EXTENSIONS.has(ext)) {
        return false;
      }
      if (relPath.endsWith("package-lock.json") || relPath.endsWith("bun.lock") || relPath.endsWith("bun.lockb")) {
        return false;
      }
      const baseName = path6.basename(relPath);
      if (this.SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(baseName) || pattern.test(relPath))) {
        return false;
      }
      return true;
    });
  }
  static generateWorkspaceSnapshot(workspaceRoot, outputDir, generation = 1) {
    const targetOutputDir = outputDir || path6.join(workspaceRoot, ".cph", "snapshots");
    fs6.mkdirSync(targetOutputDir, { recursive: true });
    const files = this.getTrackedSourceFiles(workspaceRoot);
    const manifestLines = [];
    const contentBlocks = [];
    const writtenFiles = [];
    let totalContentBytes = 0;
    for (const relPath of files) {
      const absPath = path6.join(workspaceRoot, relPath);
      if (!fs6.existsSync(absPath))
        continue;
      const stat = fs6.lstatSync(absPath);
      if (stat.isDirectory() || stat.isSymbolicLink())
        continue;
      const rawBuffer = fs6.readFileSync(absPath);
      const rawStr = rawBuffer.toString("utf-8");
      if (this.SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(rawStr))) {
        throw new Error(`CRITICAL SECURITY ALERT: Secret token or private key detected in file ${relPath}. Snapshot generation aborted!`);
      }
      const fileHash = crypto4.createHash("sha256").update(rawBuffer).digest("hex").slice(0, 12);
      const lineCount = rawStr.split(`
`).length;
      manifestLines.push(`- ${relPath} (Lines: ${lineCount}, SHA: ${fileHash}, Bytes: ${stat.size})`);
      writtenFiles.push(relPath);
      const block = `================================================================================
` + `FILE: ${relPath}
` + `================================================================================
` + `${rawStr}
`;
      contentBlocks.push(block);
      totalContentBytes += Buffer.byteLength(block, "utf-8");
      if (totalContentBytes > this.MAX_SNAPSHOT_BYTES) {
        throw new Error(`Snapshot exceeded hard safety limit of ${this.MAX_SNAPSHOT_BYTES} bytes!`);
      }
    }
    const missingCore = this.CRITICAL_CORE_FILES.filter((cf) => {
      if (writtenFiles.includes(cf))
        return false;
      const base = path6.basename(cf);
      return !writtenFiles.some((w) => w.endsWith("/" + base) || w === base);
    });
    if (missingCore.length > 0) {
      throw new Error(`CRITICAL INTEGRITY FAULT: Snapshot dropped essential core files: ${missingCore.join(", ")}`);
    }
    const fullText = `// ================================================================================
` + `// WORKSPACE STRUCTURE & MANIFEST
` + `// ================================================================================
` + manifestLines.join(`
`) + `

` + `// ================================================================================
` + `// SOURCE FILE CONTENTS
` + `// ================================================================================

` + contentBlocks.join(`
`);
    const fullBuffer = Buffer.from(fullText, "utf-8");
    const snapshotHash = crypto4.createHash("sha256").update(fullBuffer).digest("hex").slice(0, 16);
    const snapshotPath = path6.join(targetOutputDir, `workspace-snapshot-${snapshotHash}.txt`);
    fs6.writeFileSync(snapshotPath, fullBuffer);
    return {
      snapshotPath,
      hash: snapshotHash,
      fileCount: writtenFiles.length,
      bytes: fullBuffer.length,
      files: writtenFiles,
      cloudFileName: `workspace-v${generation}.txt`
    };
  }
  static generateScopedSubagentSlice(workspaceRoot, targetFiles, prerequisiteReports, outputDir) {
    const targetOutputDir = outputDir || path6.join(workspaceRoot, ".cph", "slices");
    fs6.mkdirSync(targetOutputDir, { recursive: true });
    const includedFiles = [];
    const sections = [];
    const seenFiles = new Set;
    const targetList = targetFiles.map((f) => f.replace(/\\/g, "/"));
    const reportList = (prerequisiteReports || []).map((f) => f.replace(/\\/g, "/"));
    for (const reportRel of reportList) {
      const absReport = path6.join(workspaceRoot, reportRel);
      if (fs6.existsSync(absReport) && !seenFiles.has(reportRel)) {
        seenFiles.add(reportRel);
        includedFiles.push(reportRel);
        const reportContent = fs6.readFileSync(absReport, "utf-8");
        sections.push(`================================================================================
` + `PREREQUISITE REPORT: ${reportRel}
` + `================================================================================
` + `${reportContent}
`);
      }
    }
    const importedInterfaceSections = [];
    for (const targetRel of targetList) {
      const absTarget = path6.join(workspaceRoot, targetRel);
      if (!fs6.existsSync(absTarget) || seenFiles.has(targetRel))
        continue;
      seenFiles.add(targetRel);
      includedFiles.push(targetRel);
      const targetContent = fs6.readFileSync(absTarget, "utf-8");
      sections.push(`================================================================================
` + `FILE: ${targetRel}
` + `================================================================================
` + `${targetContent}
`);
      const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(targetContent)) !== null) {
        const importSpecifier = match[1];
        const resolvedAbs = this.resolveImportPath(path6.dirname(absTarget), importSpecifier);
        if (!resolvedAbs || !fs6.existsSync(resolvedAbs))
          continue;
        const depRelPath = path6.relative(workspaceRoot, resolvedAbs).replace(/\\/g, "/");
        if (seenFiles.has(depRelPath))
          continue;
        const depContent = fs6.readFileSync(resolvedAbs, "utf-8");
        const typeBlocks = this.extractExportedTypeDeclarations(depContent);
        if (typeBlocks.length > 0) {
          importedInterfaceSections.push(`================================================================================
` + `IMPORTED INTERFACE DEFINITIONS: ${depRelPath}
` + `================================================================================
` + typeBlocks.join(`

`) + `
`);
        }
      }
    }
    if (importedInterfaceSections.length > 0) {
      sections.push(...importedInterfaceSections);
    }
    const fullText = `// ================================================================================
` + `// SUBAGENT SCOPED WORKSPACE SLICE
` + `// TARGET FILES: ${targetList.join(", ")}
` + (reportList.length > 0 ? `// PREREQUISITE REPORTS: ${reportList.join(", ")}
` : "") + `// ================================================================================

` + sections.join(`
`);
    const fullBuffer = Buffer.from(fullText, "utf-8");
    const sliceHash = crypto4.createHash("sha256").update(fullBuffer).digest("hex").slice(0, 16);
    const slicePath = path6.join(targetOutputDir, `slice-${sliceHash}.txt`);
    fs6.writeFileSync(slicePath, fullBuffer);
    return {
      slicePath,
      bytes: fullBuffer.length,
      files: includedFiles
    };
  }
  static scanDirRecursive(currentDir, rootDir) {
    const results = [];
    if (!fs6.existsSync(currentDir))
      return results;
    const entries = fs6.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path6.join(currentDir, entry.name);
      const relPath = path6.relative(rootDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (this.EXCLUDED_DIR_PREFIXES.some((p) => (relPath + "/").startsWith(p) || relPath === p.replace(/\/$/, ""))) {
          continue;
        }
        results.push(...this.scanDirRecursive(fullPath, rootDir));
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
    return results;
  }
  static resolveImportPath(baseDir, specifier) {
    const candidateBase = path6.resolve(baseDir, specifier);
    const candidateExtensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"];
    for (const ext of candidateExtensions) {
      const candidate = candidateBase + ext;
      if (fs6.existsSync(candidate) && fs6.statSync(candidate).isFile()) {
        return candidate;
      }
    }
    return null;
  }
  static extractExportedTypeDeclarations(content) {
    const lines = content.split(`
`);
    const blocks = [];
    let inBlock = false;
    let currentBlock = [];
    let braceCount = 0;
    for (const line of lines) {
      if (!inBlock) {
        if (/^\s*export\s+(?:type|interface)\s+/.test(line)) {
          inBlock = true;
          currentBlock = [line];
          const openBraces = (line.match(/{/g) || []).length;
          const closeBraces = (line.match(/}/g) || []).length;
          braceCount = openBraces - closeBraces;
          if (braceCount <= 0 && (!line.includes("{") || line.trim().endsWith(";"))) {
            blocks.push(currentBlock.join(`
`));
            inBlock = false;
            currentBlock = [];
          }
        }
      } else {
        currentBlock.push(line);
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        braceCount += openBraces - closeBraces;
        if (braceCount <= 0) {
          blocks.push(currentBlock.join(`
`));
          inBlock = false;
          currentBlock = [];
        }
      }
    }
    return blocks;
  }
}

// src/workspace/pnp-sync-engine.ts
import fs7 from "node:fs";
import path7 from "node:path";
import crypto5 from "node:crypto";
import { execSync as execSync2, spawn } from "node:child_process";
var __dirname = "E:\\copilot-web proxy\\CPH-PI\\src\\workspace";
function encodeUrlPathSegments(relPath) {
  return relPath.replace(/\\/g, "/").split("/").filter((seg) => seg.length > 0).map((seg) => {
    try {
      return encodeURIComponent(decodeURIComponent(seg));
    } catch {
      return encodeURIComponent(seg);
    }
  }).join("/");
}
var NON_INDEXABLE_EXTENSIONS = new Set([
  ".dll",
  ".dylib",
  ".so",
  ".exe",
  ".pdb",
  ".lib",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".aar",
  ".jar",
  ".onnx",
  ".bin",
  ".cache",
  ".up2date",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".tif",
  ".tiff",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wav"
]);
function isNonIndexableBinary(filePath) {
  const lower = filePath.toLowerCase();
  for (const ext of NON_INDEXABLE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

class PnPWorkspaceSyncEngine {
  static DEFAULT_SITE_URL = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN";
  static DEFAULT_TARGET_FOLDER = "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test";
  scriptPath;
  constructor(customScriptPath) {
    if (customScriptPath) {
      this.scriptPath = customScriptPath;
    } else {
      this.scriptPath = path7.resolve(__dirname, "../../scripts/sp-sync-engine.ps1");
    }
  }
  static getFileSha256(filePath) {
    const hash = crypto5.createHash("sha256");
    const buffer = fs7.readFileSync(filePath);
    hash.update(buffer);
    return hash.digest("hex");
  }
  static loadManifest(manifestPath) {
    if (fs7.existsSync(manifestPath)) {
      try {
        let raw = fs7.readFileSync(manifestPath, "utf8");
        if (raw.charCodeAt(0) === 65279) {
          raw = raw.slice(1);
        }
        const parsed = JSON.parse(raw);
        if (parsed) {
          if (!parsed.version || parsed.version < 2) {
            parsed.version = 2;
          }
          if (!parsed.folders) {
            parsed.folders = {};
          }
          return parsed;
        }
        return null;
      } catch {
        return null;
      }
    }
    return null;
  }
  static saveManifest(manifestPath, manifest) {
    const dir = path7.dirname(manifestPath);
    if (!fs7.existsSync(dir)) {
      fs7.mkdirSync(dir, { recursive: true });
    }
    if (!manifest.version || manifest.version < 2) {
      manifest.version = 2;
    }
    manifest.folders = manifest.folders || {};
    fs7.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }
  async executePowerShell(args, signal) {
    return new Promise((resolve, reject) => {
      const psArgs = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.scriptPath,
        ...args
      ];
      const child = spawn("powershell.exe", psArgs, {
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      if (signal) {
        if (signal.aborted) {
          child.kill();
          return reject(new Error("Operation aborted"));
        }
        signal.addEventListener("abort", () => {
          child.kill();
          reject(new Error("Operation aborted"));
        });
      }
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        reject(new Error(`Failed to spawn powershell.exe: ${err.message}`));
      });
      child.on("close", (code) => {
        const startMarker = "###REPORT_JSON_START###";
        const endMarker = "###REPORT_JSON_END###";
        const startIndex = stdout.indexOf(startMarker);
        const endIndex = stdout.indexOf(endMarker);
        let report = null;
        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
          const jsonStr = stdout.substring(startIndex + startMarker.length, endIndex).trim();
          try {
            report = JSON.parse(jsonStr);
          } catch (e) {}
        }
        if (code !== 0) {
          return reject(new Error(`sp-sync-engine.ps1 exited with code ${code}.
STDERR: ${stderr.trim()}
STDOUT: ${stdout.trim()}`));
        }
        if (!report) {
          return reject(new Error(`Failed to parse report JSON from sp-sync-engine.ps1 output.
STDOUT: ${stdout.trim()}`));
        }
        resolve({ stdout, stderr, report });
      });
    });
  }
  async prewarm(options) {
    const siteUrl = options.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = options.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    const manifestPath = options.manifestPath || path7.join(options.workspaceRoot, ".cph", "state", "sync-manifest.json");
    const dirtyLogPath = options.dirtyLogPath || path7.join(options.workspaceRoot, ".cph", "state", "dirty-sync.jsonl");
    const args = [
      "-Action",
      "Prewarm",
      "-WorkspaceRoot",
      options.workspaceRoot,
      "-TargetFolder",
      targetFolder,
      "-SiteUrl",
      siteUrl,
      "-ManifestPath",
      manifestPath,
      "-DirtyLogPath",
      dirtyLogPath
    ];
    if (options.hardReset) {
      args.push("-HardReset");
    }
    if (options.mockTransport) {
      args.push("-MockTransport");
    }
    const { report } = await this.executePowerShell(args, options.signal);
    try {
      const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
      if (manifest) {
        const mapContent = PnPWorkspaceSyncEngine.generateVirtualRepoMap(manifest, siteUrl, targetFolder);
        const mapPath = path7.join(options.workspaceRoot, ".cph", "state", "virtual-repo-map.md");
        fs7.mkdirSync(path7.dirname(mapPath), { recursive: true });
        fs7.writeFileSync(mapPath, mapContent, "utf8");
      }
    } catch {}
    const folderResults = Array.isArray(report.folderResults) ? report.folderResults.map((f) => ({
      relativePath: f.relativePath || f.relativeFolder,
      status: f.status === "recycled" ? "pruned" : f.status,
      uniqueId: f.uniqueId,
      error: f.error
    })) : undefined;
    return {
      workspaceRoot: report.workspaceRoot,
      targetFolder: report.targetFolder,
      totalLocal: report.totalLocal,
      totalLocalFolders: report.totalLocalFolders,
      syncedCount: report.syncedCount,
      skippedCount: report.skippedCount,
      prunedCount: report.prunedCount,
      failedCount: report.failedCount,
      syncedFoldersCount: report.syncedFoldersCount,
      prunedFoldersCount: report.prunedFoldersCount,
      durationMs: report.durationMs,
      results: report.results || [],
      folderResults
    };
  }
  async syncFile(workspaceRoot, relativePath, targetFolder, options) {
    const siteUrl = options?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const folder = targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    const manifestPath = options?.manifestPath || path7.join(workspaceRoot, ".cph", "state", "sync-manifest.json");
    const dirtyLogPath = options?.dirtyLogPath || path7.join(workspaceRoot, ".cph", "state", "dirty-sync.jsonl");
    const args = [
      "-Action",
      "SyncSingleFile",
      "-WorkspaceRoot",
      workspaceRoot,
      "-FilePath",
      relativePath,
      "-TargetFolder",
      folder,
      "-SiteUrl",
      siteUrl,
      "-ManifestPath",
      manifestPath,
      "-DirtyLogPath",
      dirtyLogPath
    ];
    if (options?.mockTransport) {
      args.push("-MockTransport");
    }
    const { report } = await this.executePowerShell(args, options?.signal);
    const result = report.results?.[0] || {
      relativePath,
      status: "failed",
      error: "No result returned"
    };
    return result;
  }
  async syncFolder(workspaceRoot, relativeFolderPath, targetFolder, options) {
    const siteUrl = options?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const folder = targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    const manifestPath = options?.manifestPath || path7.join(workspaceRoot, ".cph", "state", "sync-manifest.json");
    const dirtyLogPath = options?.dirtyLogPath || path7.join(workspaceRoot, ".cph", "state", "dirty-sync.jsonl");
    const args = [
      "-Action",
      "EnsureFolder",
      "-WorkspaceRoot",
      workspaceRoot,
      "-SourceFolder",
      relativeFolderPath,
      "-TargetFolder",
      folder,
      "-SiteUrl",
      siteUrl,
      "-ManifestPath",
      manifestPath,
      "-DirtyLogPath",
      dirtyLogPath
    ];
    if (options?.mockTransport) {
      args.push("-MockTransport");
    }
    const { report } = await this.executePowerShell(args, options?.signal);
    const rawResult = report?.results?.[0];
    const result = rawResult ? {
      relativePath: rawResult.relativePath || rawResult.relativeFolder || relativeFolderPath,
      status: (rawResult.status === "recycled" ? "pruned" : rawResult.status) || "synced",
      uniqueId: rawResult.uniqueId,
      error: rawResult.error
    } : {
      relativePath: relativeFolderPath,
      status: "failed",
      error: "No result returned"
    };
    return result;
  }
  async pullFile(workspaceRoot, relativePath, targetFolder, options) {
    const siteUrl = options?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const folder = targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    const args = [
      "-Action",
      "PullFile",
      "-WorkspaceRoot",
      workspaceRoot,
      "-FilePath",
      relativePath,
      "-TargetFolder",
      folder,
      "-SiteUrl",
      siteUrl
    ];
    if (options?.mockTransport) {
      args.push("-MockTransport");
    }
    const { report } = await this.executePowerShell(args, options?.signal);
    const result = report.results?.[0] || {
      relativePath,
      status: "failed",
      error: "No result returned"
    };
    return result;
  }
  async verifyCloudMirror(options) {
    const siteUrl = options.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = options.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    const args = [
      "-Action",
      "VerifyMirror",
      "-WorkspaceRoot",
      options.workspaceRoot,
      "-TargetFolder",
      targetFolder,
      "-SiteUrl",
      siteUrl
    ];
    if (options.mockTransport) {
      args.push("-MockTransport");
    }
    const { report } = await this.executePowerShell(args, options.signal);
    return report;
  }
  async verifyMirror(options) {
    return this.verifyCloudMirror(options);
  }
  async syncCloudWorkspace(options) {
    if (!options.skipVerify) {
      const verifyResult = await this.verifyCloudMirror({
        workspaceRoot: options.workspaceRoot,
        targetFolder: options.targetFolder,
        siteUrl: options.siteUrl,
        mockTransport: options.mockTransport,
        signal: options.signal
      });
      if (!verifyResult.valid) {
        throw new Error(verifyResult.reason);
      }
    }
    return this.prewarm(options);
  }
  static readVirtualRepoMap(workspaceRoot) {
    if (!workspaceRoot) {
      return;
    }
    const mapPath = path7.join(workspaceRoot, ".cph", "state", "virtual-repo-map.md");
    if (!fs7.existsSync(mapPath)) {
      return;
    }
    try {
      const content = fs7.readFileSync(mapPath, "utf8").trim();
      return content.length > 0 ? content : undefined;
    } catch {
      return;
    }
  }
  static generateVirtualRepoMap(manifest, siteUrl, targetFolder) {
    let origin = "";
    try {
      origin = new URL(siteUrl).origin;
    } catch {
      origin = siteUrl.replace(/\/$/, "");
    }
    const folderClean = targetFolder.startsWith("/") ? targetFolder : `/${targetFolder}`;
    const encodedFolder = encodeUrlPathSegments(folderClean);
    const remoteRootUrl = folderClean.startsWith("/sites/") ? `${origin}${encodedFolder ? `/${encodedFolder}` : ""}` : `${siteUrl.replace(/\/$/, "")}${encodedFolder ? `/${encodedFolder}` : ""}`;
    const files = manifest.files || {};
    const allKeys = Object.keys(files).sort();
    const fileKeys = allKeys.filter((k) => !isNonIndexableBinary(k));
    const lines = [
      "[SHAREPOINT REMOTE WORKSPACE]",
      `Remote Root URL: ${remoteRootUrl}`,
      `Sync Status: Synchronized (Local SSOT) | Total Files: ${fileKeys.length}`,
      "",
      "Files Index:"
    ];
    const MAX_MAP_FILES = 120;
    if (fileKeys.length === 0) {
      lines.push("- (No files recorded in sync manifest)");
    } else {
      const displayKeys = fileKeys.slice(0, MAX_MAP_FILES);
      for (const k of displayKeys) {
        const item = files[k];
        const sizeKb = (item.size / 1024).toFixed(1);
        const guidStr = item.uniqueId ? ` | UniqueId: ${item.uniqueId}` : "";
        let fileWebUrl = "";
        if (item.serverRelativeUrl) {
          const encodedServerUrl = encodeUrlPathSegments(item.serverRelativeUrl);
          fileWebUrl = item.serverRelativeUrl.startsWith("/sites/") ? `${origin}${encodedServerUrl ? `/${encodedServerUrl}` : ""}` : `${siteUrl.replace(/\/$/, "")}${encodedServerUrl ? `/${encodedServerUrl}` : ""}`;
        } else {
          const encodedRelPath = encodeUrlPathSegments(k);
          fileWebUrl = `${remoteRootUrl}/${encodedRelPath}`;
        }
        let statusTag = "[CLOUD-READY]";
        if (item.firstCreatedAt !== undefined && item.firstCreatedAt !== null && item.lastSyncedAt !== undefined && item.lastSyncedAt !== null) {
          if (String(item.firstCreatedAt) === String(item.lastSyncedAt)) {
            const createdTime = typeof item.firstCreatedAt === "number" ? item.firstCreatedAt : !Number.isNaN(Number(item.firstCreatedAt)) ? Number(item.firstCreatedAt) : new Date(item.firstCreatedAt).getTime();
            if (!Number.isNaN(createdTime) && Date.now() - createdTime < 60000) {
              statusTag = "[LOCAL-NEW: use read_file]";
            }
          }
        }
        lines.push(`- ${k.replace(/\\/g, "/")} (Size: ${sizeKb}KB${guidStr} | Web: ${fileWebUrl} | Status: ${statusTag})`);
      }
      if (fileKeys.length > MAX_MAP_FILES) {
        lines.push(`- ... (${fileKeys.length - MAX_MAP_FILES} more files synchronized at ${remoteRootUrl})`);
      }
    }
    if (manifest.folders && Object.keys(manifest.folders).length > 0) {
      const folderKeys = Object.keys(manifest.folders).sort();
      lines.push("");
      lines.push("### [DIRECTORIES / EMPTY FOLDERS]");
      for (const fk of folderKeys) {
        const fEntry = manifest.folders[fk];
        const lastSyncedStr = fEntry?.lastSyncedAt ? ` (LastSynced: ${fEntry.lastSyncedAt})` : "";
        lines.push(`- ${fk.replace(/\\/g, "/")}${lastSyncedStr}`);
      }
    }
    lines.push("");
    lines.push("Guidance: All repository files are grounded at the SharePoint paths above. You may cite, inspect or trace them directly by relative path or URL.");
    return lines.join(`
`);
  }
  static generateCatalogMarkdown(workspaceRoot, opts) {
    const manifestPath = opts?.manifestPath || path7.join(workspaceRoot, ".cph", "state", "sync-manifest.json");
    const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
    const siteUrl = manifest?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = manifest?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    let origin = "";
    try {
      origin = new URL(siteUrl).origin;
    } catch {
      origin = siteUrl.replace(/\/$/, "");
    }
    let sitePath = "";
    try {
      sitePath = new URL(siteUrl).pathname.replace(/\/$/, "");
    } catch {
      sitePath = "";
    }
    const folderClean = targetFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const prefix = folderClean.startsWith("sites/") ? `/${folderClean}` : `${sitePath}/${folderClean}`;
    const normalizedPrefix = prefix.replace(/\/+/g, "/").replace(/\/$/, "");
    const encodedPrefix = encodeUrlPathSegments(normalizedPrefix);
    const remoteRootUrl = `${origin}${encodedPrefix ? `/${encodedPrefix}` : ""}`;
    const relativeFiles = PnPWorkspaceSyncEngine.listWorkspaceFilesForCatalog(workspaceRoot);
    const manifestFiles = manifest?.files || {};
    const rows = [];
    let syncedIndexable = 0;
    let localOnly = 0;
    let unindexable = 0;
    for (const rel of relativeFiles) {
      let size = 0;
      try {
        size = fs7.statSync(path7.join(workspaceRoot, rel)).size;
      } catch {}
      if (isNonIndexableBinary(rel)) {
        unindexable++;
        rows.push({ rel, size, status: "CLOUD-UNINDEXABLE", url: "" });
        continue;
      }
      const entry = manifestFiles[rel];
      if (entry) {
        const underCurrent = Boolean(entry.serverRelativeUrl && entry.serverRelativeUrl.replace(/\\/g, "/").startsWith(`${normalizedPrefix}/`));
        const url = `${remoteRootUrl}/${encodeUrlPathSegments(rel)}`;
        rows.push({ rel, size, status: underCurrent ? "CLOUD-READY" : "CLOUD-STALE", url });
        if (underCurrent)
          syncedIndexable++;
        else
          localOnly++;
      } else {
        rows.push({ rel, size, status: "LOCAL-ONLY", url: "" });
        localOnly++;
      }
    }
    const dirCounts = new Map;
    for (const rel of relativeFiles) {
      const parts = rel.split("/");
      if (parts.length > 1) {
        const top = parts[0];
        dirCounts.set(top, (dirCounts.get(top) || 0) + 1);
        if (parts.length > 2) {
          const second = `${parts[0]}/${parts[1]}`;
          dirCounts.set(second, (dirCounts.get(second) || 0) + 1);
        }
      }
    }
    const skeletonLines = [];
    const topDirs = [...dirCounts.keys()].filter((dir) => !dir.includes("/")).sort();
    for (const top of topDirs) {
      skeletonLines.push(`- ${top}/ (${dirCounts.get(top)} files)`);
      const children = [...dirCounts.keys()].filter((dir) => dir.startsWith(`${top}/`) && dir.split("/").length === 2).sort();
      for (const child of children) {
        skeletonLines.push(`  - ${child.slice(top.length + 1)}/ (${dirCounts.get(child)} files)`);
      }
    }
    if (skeletonLines.length === 0) {
      skeletonLines.push("- (workspace has no sub-directories; files sit at the root)");
    }
    const MAX_ROWS = 2000;
    const displayRows = rows.slice(0, MAX_ROWS);
    const rowLines = displayRows.map((row) => {
      const sizeKb = (row.size / 1024).toFixed(1);
      const urlPart = row.url ? ` | ${row.url}` : "";
      return `- \`${row.rel}\` (${sizeKb}KB | [${row.status}]${urlPart})`;
    });
    if (rows.length > MAX_ROWS) {
      rowLines.push(`- ...（其余 ${rows.length - MAX_ROWS} 个文件未内联，可通过本地 read_file 或同步状态台账查询）`);
    }
    const markdown = [
      "# Remote Workspace Catalog ([SHAREPOINT REMOTE WORKSPACE] 完整清单)",
      "",
      `- 工作区绝对路径: ${workspaceRoot.replace(/\\/g, "/")}`,
      `- 云端工作区根直链: ${remoteRootUrl}`,
      `- 统计: 工作区文件 ${rows.length} | 已同步可索引 ${syncedIndexable} | 本地独有 ${localOnly} | 不可索引 ${unindexable}`,
      `- 生成时间: ${new Date().toISOString()}`,
      "",
      "## 1. 工作区目录结构 (Directory Skeleton)",
      skeletonLines.join(`
`),
      "",
      "## 2. 文件映射清单 (File Mapping Index)",
      rowLines.join(`
`),
      "",
      "Guidance: CLOUD-READY 文件可通过其 WebUrl 直接云端检索；LOCAL-ONLY/CLOUD-UNINDEXABLE 文件按需用 read_file 读取。"
    ].join(`
`);
    return {
      markdown,
      stats: {
        totalFiles: rows.length,
        syncedIndexable,
        localOnly,
        unindexable
      }
    };
  }
  static buildBoundedRepoMap(opts) {
    const maxChars = opts.maxChars ?? (Number(process.env.CPH_TURN1_INDEX_MAX_CHARS) > 0 ? Number(process.env.CPH_TURN1_INDEX_MAX_CHARS) : 24000);
    const manifestPath = path7.join(opts.workspaceRoot, ".cph", "state", "sync-manifest.json");
    const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
    const siteUrl = manifest?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = manifest?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    let origin = "";
    try {
      origin = new URL(siteUrl).origin;
    } catch {
      origin = siteUrl.replace(/\/$/, "");
    }
    let sitePath = "";
    try {
      sitePath = new URL(siteUrl).pathname.replace(/\/$/, "");
    } catch {
      sitePath = "";
    }
    const folderClean = targetFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const prefix = folderClean.startsWith("sites/") ? `/${folderClean}` : `${sitePath}/${folderClean}`;
    const normalizedPrefix = prefix.replace(/\/+/g, "/").replace(/\/$/, "");
    const encodedPrefix = encodeUrlPathSegments(normalizedPrefix);
    const remoteRootUrl = `${origin}${encodedPrefix ? `/${encodedPrefix}` : ""}`;
    const files = PnPWorkspaceSyncEngine.listWorkspaceFilesForCatalog(opts.workspaceRoot);
    const manifestFiles = manifest?.files || {};
    const scopePrefix = PnPWorkspaceSyncEngine.deriveTaskScopePrefix(opts.task || "", targetFolder);
    const sourceExtensions = new Set([
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".ps1",
      ".psm1",
      ".psd1",
      ".cs",
      ".csproj",
      ".sln",
      ".go",
      ".rs",
      ".java",
      ".kt",
      ".sql",
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".sh",
      ".bat",
      ".md",
      ".html",
      ".css",
      ".vue",
      ".xml"
    ]);
    const rows = [];
    for (const rel of files) {
      let size = 0;
      let mtime = 0;
      try {
        const stat = fs7.statSync(path7.join(opts.workspaceRoot, rel));
        size = stat.size;
        mtime = stat.mtimeMs;
      } catch {}
      if (isNonIndexableBinary(rel)) {
        rows.push({ rel, size, status: "CLOUD-UNINDEXABLE", url: "", inScope: false, isSource: false, mtime });
        continue;
      }
      const entry = manifestFiles[rel];
      const underCurrent = Boolean(entry?.serverRelativeUrl && entry.serverRelativeUrl.replace(/\\/g, "/").startsWith(`${normalizedPrefix}/`));
      const status = entry ? underCurrent ? "CLOUD-READY" : "CLOUD-STALE" : "LOCAL-ONLY";
      const url = status === "CLOUD-READY" ? `${remoteRootUrl}/${encodeUrlPathSegments(rel)}` : "";
      const inScope = Boolean(scopePrefix && (rel === scopePrefix || rel.startsWith(`${scopePrefix}/`)));
      const ext = path7.extname(rel).toLowerCase();
      rows.push({ rel, size, status, url, inScope, isSource: sourceExtensions.has(ext), mtime });
    }
    rows.sort((a, b) => {
      if (a.inScope !== b.inScope)
        return a.inScope ? -1 : 1;
      const aUp = a.status === "CLOUD-READY" || a.status === "LOCAL-ONLY";
      const bUp = b.status === "CLOUD-READY" || b.status === "LOCAL-ONLY";
      if (aUp !== bUp)
        return aUp ? -1 : 1;
      if (a.isSource !== b.isSource)
        return a.isSource ? -1 : 1;
      if (a.mtime !== b.mtime)
        return b.mtime - a.mtime;
      return a.rel.localeCompare(b.rel);
    });
    const header = [
      "[SHAREPOINT REMOTE WORKSPACE]",
      `Remote Root URL: ${remoteRootUrl}`,
      `Files: ${rows.length} | Inline budget: ${maxChars} chars${scopePrefix ? ` | Task scope: ${scopePrefix}` : ""}`,
      "",
      "Files Index:"
    ].join(`
`);
    const lines = [];
    let used = header.length + 1;
    let inlineCount = 0;
    for (const row of rows) {
      const sizeKb = (row.size / 1024).toFixed(1);
      const urlPart = row.url ? ` | Web: ${row.url}` : "";
      const line = `- ${row.rel} (Size: ${sizeKb}KB | [${row.status}]${urlPart})`;
      if (used + line.length + 1 > maxChars)
        break;
      lines.push(line);
      used += line.length + 1;
      inlineCount++;
    }
    if (inlineCount < rows.length) {
      lines.push(`- ... (其余 ${rows.length - inlineCount} 个文件见附件 remote-workspace-catalog.md，或按需 read_file 读取)`);
    }
    return `${header}
${lines.join(`
`)}
`;
  }
  static deriveTaskScopePrefix(task, targetFolder) {
    if (!task)
      return;
    const folderName = targetFolder.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
    const urlMatch = task.match(/https?:\/\/[^\s)>"']+/i);
    if (urlMatch) {
      let decodedPath = "";
      try {
        const parsed = new URL(urlMatch[0]);
        const idParam = parsed.searchParams.get("id");
        decodedPath = decodeURIComponent(idParam || parsed.pathname);
      } catch {
        decodedPath = urlMatch[0];
      }
      const workSpaceIdx = decodedPath.toLowerCase().indexOf("/workspace/");
      if (workSpaceIdx >= 0) {
        const after = decodedPath.slice(workSpaceIdx + "/workspace/".length).split("/").filter(Boolean);
        const rest = folderName && after[0] === folderName ? after.slice(1) : after.slice(1);
        if (rest.length > 0)
          return rest.join("/");
      }
      const decodedParts = decodedPath.split("/").filter(Boolean);
      if (folderName) {
        const idx = decodedParts.indexOf(folderName);
        if (idx >= 0 && idx + 1 < decodedParts.length) {
          return decodedParts.slice(idx + 1).join("/");
        }
      }
    }
    const pathMatch = task.match(/(?:^|[\s`"'（(])([A-Za-z0-9_.\- ]+\/[A-Za-z0-9_.\-/ ]+)/);
    if (pathMatch) {
      const candidate = pathMatch[1].trim().replace(/\\/g, "/");
      return candidate.replace(/^\/+|\/+$/g, "");
    }
    return;
  }
  static listWorkspaceFilesForCatalog(workspaceRoot) {
    const files = new Set;
    let gitSucceeded = false;
    try {
      const gitOut = execSync2("git ls-files --cached --others --exclude-standard", {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      gitSucceeded = true;
      for (const line of gitOut.split(/\r?\n/)) {
        const rel = line.trim().replace(/\\/g, "/");
        if (rel)
          files.add(rel);
      }
    } catch {}
    const ignoredDirs = new Set([".git", ".cph", "node_modules", "dist", "package"]);
    const walk = (dir, relPrefix) => {
      let entries = [];
      try {
        entries = fs7.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink())
          continue;
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (ignoredDirs.has(entry.name))
            continue;
          walk(path7.join(dir, entry.name), rel);
        } else if (entry.isFile()) {
          files.add(rel.replace(/\\/g, "/"));
        }
      }
    };
    if (!gitSucceeded) {
      walk(workspaceRoot, "");
    }
    const libraryDir = path7.join(workspaceRoot, "Library");
    if (fs7.existsSync(libraryDir)) {
      walk(libraryDir, "Library");
    }
    return [...files].filter((rel) => {
      if (/(^|\/)(\.git|\.cph|node_modules|dist|package)(\/|$)/.test(rel))
        return false;
      try {
        return fs7.statSync(path7.join(workspaceRoot, rel)).isFile();
      } catch {
        return false;
      }
    }).sort();
  }
}

// src/protocol/tool-bridge.ts
import fs9 from "node:fs";
import path13 from "node:path";
import crypto6 from "node:crypto";
// src/tools/read.ts
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import { constants } from "node:fs";
import path8 from "node:path";
var defaultReadOperations = {
  readFile: (p) => fsReadFile(p),
  access: (p) => fsAccess(p, constants.R_OK)
};
function createReadTool(cwd, options) {
  const ops = options?.operations ?? defaultReadOperations;
  return {
    name: "read",
    description: "Read the contents of a file losslessly. Supports text files. Reads complete file content without arbitrary truncation (physical safety ceiling: 100MB). Use offset and limit when a partial line slice is requested.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read (relative or absolute)" },
        offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
        limit: { type: "number", description: "Maximum number of lines to read" }
      },
      required: ["path"]
    },
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      const filePath = params.path;
      if (!filePath) {
        throw new Error("path parameter is required for read tool");
      }
      const absolutePath = path8.isAbsolute(filePath) ? filePath : path8.resolve(cwd, filePath);
      await ops.access(absolutePath);
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      const buffer = await ops.readFile(absolutePath);
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      const textContent = buffer.toString("utf-8");
      const allLines = textContent.split(/\r?\n/);
      const totalFileLines = allLines.length;
      const offset = params.offset;
      const limit = params.limit;
      const startLine = offset ? Math.max(0, offset - 1) : 0;
      if (startLine >= totalFileLines && totalFileLines > 0 && offset && offset > 1) {
        throw new Error(`Offset ${offset} is beyond end of file (${totalFileLines} lines total)`);
      }
      let selectedLines;
      if (limit !== undefined && Number.isFinite(limit)) {
        const endLine = Math.min(startLine + limit, totalFileLines);
        selectedLines = allLines.slice(startLine, endLine);
      } else {
        selectedLines = allLines.slice(startLine);
      }
      const outputText = selectedLines.join(`
`);
      return {
        content: [{ type: "text", text: outputText }],
        structuredContent: {
          path: filePath,
          totalLines: totalFileLines,
          startLine: startLine + 1,
          lineCount: selectedLines.length,
          output: outputText
        }
      };
    }
  };
}
// src/tools/write.ts
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import path9 from "node:path";
var defaultWriteOperations = {
  writeFile: (p, content) => fsWriteFile(p, content, "utf-8"),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {})
};
function createWriteTool(cwd, options) {
  const ops = options?.operations ?? defaultWriteOperations;
  return {
    name: "write",
    description: "Write content to a file. Creates the file if it does not exist, overwrites if it does. Automatically creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write (relative or absolute)" },
        content: { type: "string", description: "Content to write to the file" }
      },
      required: ["path", "content"]
    },
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      const filePath = params.path;
      if (!filePath) {
        throw new Error("path parameter is required for write tool");
      }
      const absolutePath = path9.isAbsolute(filePath) ? filePath : path9.resolve(cwd, filePath);
      const parentDir = path9.dirname(absolutePath);
      await ops.mkdir(parentDir);
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      await ops.writeFile(absolutePath, params.content ?? "");
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      return {
        content: [{ type: "text", text: `Successfully wrote to ${filePath}` }],
        structuredContent: {
          path: filePath,
          bytesWritten: Buffer.byteLength(params.content ?? "", "utf-8")
        }
      };
    }
  };
}
// src/tools/edit.ts
var Diff = __toESM(require_lib(), 1);
import { access as fsAccess2, readFile as fsReadFile2, writeFile as fsWriteFile2 } from "node:fs/promises";
import { constants as constants2 } from "node:fs";
import path10 from "node:path";
var defaultEditOperations = {
  readFile: (p) => fsReadFile2(p),
  writeFile: (p, content) => fsWriteFile2(p, content, "utf-8"),
  access: (p) => fsAccess2(p, constants2.R_OK | constants2.W_OK)
};
function generateDiffString(oldContent, newContent, contextLines = 3) {
  const parts = Diff.diffLines(oldContent, newContent);
  const output = [];
  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;
  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine;
  for (let i = 0;i < parts.length; i++) {
    const part = parts[i];
    const raw = part.value.split(/\r?\n/);
    if (raw[raw.length - 1] === "") {
      raw.pop();
    }
    if (part.added || part.removed) {
      if (firstChangedLine === undefined && part.added) {
        firstChangedLine = newLineNum;
      }
      for (const line of raw) {
        if (part.added) {
          const num = String(newLineNum).padStart(lineNumWidth, " ");
          output.push(`+${num} ${line}`);
          newLineNum++;
        } else {
          const num = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(`-${num} ${line}`);
          oldLineNum++;
        }
      }
      lastWasChange = true;
    } else {
      const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
      if (lastWasChange && nextPartIsChange) {
        if (raw.length <= contextLines * 2) {
          for (const line of raw) {
            const num = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${num} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        } else {
          for (const line of raw.slice(0, contextLines)) {
            const num = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${num} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          const skipped = raw.length - contextLines * 2;
          oldLineNum += skipped;
          newLineNum += skipped;
          for (const line of raw.slice(raw.length - contextLines)) {
            const num = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${num} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        }
      } else if (lastWasChange) {
        const shown = raw.slice(0, contextLines);
        for (const line of shown) {
          const num = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${num} ${line}`);
          oldLineNum++;
          newLineNum++;
        }
        if (raw.length > contextLines) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          const skipped = raw.length - contextLines;
          oldLineNum += skipped;
          newLineNum += skipped;
        }
      } else if (nextPartIsChange) {
        const skipped = Math.max(0, raw.length - contextLines);
        if (skipped > 0) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skipped;
          newLineNum += skipped;
        }
        for (const line of raw.slice(skipped)) {
          const num = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${num} ${line}`);
          oldLineNum++;
          newLineNum++;
        }
      } else {
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }
      lastWasChange = false;
    }
  }
  return { diff: output.join(`
`), firstChangedLine };
}
function createEditTool(cwd, options) {
  const ops = options?.operations ?? defaultEditOperations;
  return {
    name: "edit",
    description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique region of the original file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" }
            },
            required: ["oldText", "newText"]
          }
        }
      },
      required: ["path", "edits"]
    },
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      const filePath = params.path;
      if (!filePath) {
        throw new Error("path parameter is required for edit tool");
      }
      const edits = params.edits || [];
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
      }
      const absolutePath = path10.isAbsolute(filePath) ? filePath : path10.resolve(cwd, filePath);
      try {
        await ops.access(absolutePath);
      } catch (err) {
        throw new Error(`Could not edit file: ${filePath}. File does not exist or is not accessible.`);
      }
      const buffer = await ops.readFile(absolutePath);
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      const originalRawContent = buffer.toString("utf-8");
      const isCrlf = originalRawContent.includes(`\r
`);
      let currentContent = originalRawContent.replace(/\r\n/g, `
`);
      for (let i = 0;i < edits.length; i++) {
        const edit = edits[i];
        const oldText = (edit.oldText ?? "").replace(/\r\n/g, `
`);
        if (!oldText) {
          throw new Error(edits.length === 1 ? `oldText must not be empty in ${filePath}.` : `edits[${i}].oldText must not be empty in ${filePath}.`);
        }
        const occurrences = currentContent.split(oldText).length - 1;
        if (occurrences === 0) {
          throw new Error(edits.length === 1 ? `Could not find the exact text in ${filePath}. The old text must match exactly including all whitespace and newlines.` : `Could not find edits[${i}] in ${filePath}. The oldText must match exactly including all whitespace and newlines.`);
        }
        if (occurrences > 1) {
          throw new Error(edits.length === 1 ? `Found ${occurrences} occurrences of the text in ${filePath}. The text must be unique. Please provide more context to make it unique.` : `Found ${occurrences} occurrences of edits[${i}] in ${filePath}. Each oldText must be unique. Please provide more context to make it unique.`);
        }
        currentContent = currentContent.replace(oldText, (edit.newText ?? "").replace(/\r\n/g, `
`));
      }
      const finalContent = isCrlf ? currentContent.replace(/\n/g, `\r
`) : currentContent;
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      await ops.writeFile(absolutePath, finalContent);
      const diffResult = generateDiffString(originalRawContent.replace(/\r\n/g, `
`), currentContent);
      const patch = Diff.createTwoFilesPatch(filePath, filePath, originalRawContent.replace(/\r\n/g, `
`), currentContent);
      return {
        content: [
          {
            type: "text",
            text: `Successfully replaced ${edits.length} block(s) in ${filePath}.`
          }
        ],
        details: {
          diff: diffResult.diff,
          patch,
          firstChangedLine: diffResult.firstChangedLine
        }
      };
    }
  };
}
// src/tools/bash.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync } from "node:fs";
import path11 from "node:path";
function resolveShellConfig(customShellPath) {
  if (customShellPath && existsSync(customShellPath)) {
    return { shell: customShellPath, args: ["-c"] };
  }
  if (process.platform === "win32") {
    const candidates = [
      process.env.ProgramFiles ? path11.join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : null,
      process.env["ProgramFiles(x86)"] ? path11.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : null,
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
    ].filter((p) => Boolean(p && existsSync(p)));
    if (candidates.length > 0) {
      return { shell: candidates[0], args: ["-c"] };
    }
    return {
      shell: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]
    };
  }
  if (existsSync("/bin/bash")) {
    return { shell: "/bin/bash", args: ["-c"] };
  }
  return { shell: "sh", args: ["-c"] };
}
function killProcess(child) {
  if (!child.pid)
    return;
  try {
    if (process.platform === "win32") {
      spawn2("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}
function createLocalBashOperations(options) {
  return {
    exec: async (command, cwd, execOptions) => {
      const shellCfg = resolveShellConfig(options?.shellPath);
      const timeoutMs = execOptions.timeout ? execOptions.timeout * 1000 : undefined;
      return new Promise((resolve, reject) => {
        if (execOptions.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        const child = spawn2(shellCfg.shell, [...shellCfg.args, command], {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: process.env
        });
        let timedOut = false;
        let timeoutHandle;
        if (timeoutMs && timeoutMs > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            killProcess(child);
          }, timeoutMs);
        }
        const onAbort = () => {
          killProcess(child);
        };
        if (execOptions.signal) {
          execOptions.signal.addEventListener("abort", onAbort, { once: true });
        }
        child.stdout?.on("data", (chunk) => {
          try {
            execOptions.onData(chunk);
          } catch {}
        });
        child.stderr?.on("data", (chunk) => {
          try {
            execOptions.onData(chunk);
          } catch {}
        });
        child.on("error", (err) => {
          if (timeoutHandle)
            clearTimeout(timeoutHandle);
          if (execOptions.signal) {
            execOptions.signal.removeEventListener("abort", onAbort);
          }
          reject(err);
        });
        child.on("close", (code) => {
          if (timeoutHandle)
            clearTimeout(timeoutHandle);
          if (execOptions.signal) {
            execOptions.signal.removeEventListener("abort", onAbort);
          }
          if (execOptions.signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          if (timedOut) {
            reject(new Error(`timeout:${execOptions.timeout || 30}`));
            return;
          }
          resolve({ exitCode: code ?? 0 });
        });
      });
    }
  };
}
function createBashTool(cwd, options) {
  const ops = options?.operations ?? createLocalBashOperations(options);
  return {
    name: "bash",
    description: "Execute bash or terminal commands (ls, grep, git, etc.) in the workspace.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in seconds (optional)" }
      },
      required: ["command"]
    },
    execute: async (_toolCallId, params, signal) => {
      const command = params.command;
      if (!command) {
        throw new Error("command parameter is required for bash tool");
      }
      const chunks = [];
      const handleData = (data) => {
        chunks.push(data);
      };
      const startTime = performance.now();
      try {
        const result = await ops.exec(command, cwd, {
          onData: handleData,
          signal,
          timeout: params.timeout
        });
        const outputText = Buffer.concat(chunks).toString("utf-8");
        const wallTimeSeconds = Math.round((performance.now() - startTime) / 100) / 10;
        const exitCode = result.exitCode;
        if (exitCode !== 0) {
          const errMsg = outputText ? `${outputText}

Command exited with code ${exitCode}` : `Command exited with code ${exitCode}`;
          return {
            content: [{ type: "text", text: errMsg }],
            isError: true,
            structuredContent: {
              output: outputText,
              exit_code: exitCode,
              wall_time_seconds: wallTimeSeconds
            }
          };
        }
        return {
          content: [{ type: "text", text: outputText || "(no output)" }],
          structuredContent: {
            output: outputText,
            exit_code: 0,
            wall_time_seconds: wallTimeSeconds
          }
        };
      } catch (err) {
        const outputText = Buffer.concat(chunks).toString("utf-8");
        if (err?.message === "aborted") {
          const msg = outputText ? `${outputText}

Command aborted` : "Command aborted";
          throw new Error(msg);
        }
        if (err?.message?.startsWith("timeout:")) {
          const timeoutSec = err.message.split(":")[1];
          const msg = outputText ? `${outputText}

Command timed out after ${timeoutSec} seconds` : `Command timed out after ${timeoutSec} seconds`;
          throw new Error(msg);
        }
        throw err;
      }
    }
  };
}
// src/tools/index.ts
function createCodingTools(cwd, options) {
  return [
    createReadTool(cwd, options?.read),
    createBashTool(cwd, options?.bash),
    createEditTool(cwd, options?.edit),
    createWriteTool(cwd, options?.write)
  ];
}

// src/transport/file-porter.ts
var import_adm_zip = __toESM(require_adm_zip(), 1);
import fs8 from "node:fs";
import path12 from "node:path";
import { spawn as spawn3 } from "node:child_process";

class FilePorter {
  cwd;
  scratchDir;
  cdpClient;
  timeoutMs;
  ic3TokenProvider;
  graphTokenProvider;
  fetchFn;
  constructor(options) {
    this.cwd = options.cwd;
    this.scratchDir = options.scratchDir || path12.join(this.cwd, ".cph", "scratch");
    this.cdpClient = options.cdpClient;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.ic3TokenProvider = options.ic3TokenProvider;
    this.graphTokenProvider = options.graphTokenProvider;
    this.fetchFn = options.fetchFn;
  }
  static normalizeAsyncGwUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const host = u.hostname.toLowerCase();
      if (host === "asyncgw.teams.microsoft.com" || host.endsWith(".asyncgw.teams.microsoft.com")) {
        const match = u.pathname.match(/^(\/v1\/objects\/[^/]+\/views\/[^/]+)(?:\/([^/]+))?$/i);
        if (match) {
          const fileNameFromUrl = match[2] ? decodeURIComponent(match[2]) : undefined;
          u.pathname = match[1];
          return { fetchUrl: u.toString(), fileNameFromUrl };
        }
      }
      const base = path12.posix.basename(u.pathname);
      return {
        fetchUrl: rawUrl,
        fileNameFromUrl: base && base !== "/" ? decodeURIComponent(base) : undefined
      };
    } catch {
      return { fetchUrl: rawUrl };
    }
  }
  static assertAllowedDownloadUrl(rawUrl) {
    let u;
    try {
      u = new URL(rawUrl);
    } catch {
      throw new Error(`Disallowed download host: invalid URL "${rawUrl}"`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`Disallowed download host: unsupported protocol "${u.protocol}"`);
    }
    const host = u.hostname.toLowerCase();
    const allowed = host === "graph.microsoft.com" || host === "asyncgw.teams.microsoft.com" || host.endsWith(".asyncgw.teams.microsoft.com") || host === "sharepoint.com" || host.endsWith(".sharepoint.com") || host === "1drv.com" || host.endsWith(".1drv.com") || host === "office.com" || host.endsWith(".office.com") || host === "cloud.microsoft" || host.endsWith(".cloud.microsoft");
    if (!allowed) {
      throw new Error(`Disallowed download host "${u.hostname}" for URL: ${rawUrl}`);
    }
    return u;
  }
  async downloadBinary(rawUrl) {
    FilePorter.assertAllowedDownloadUrl(rawUrl);
    const norm = FilePorter.normalizeAsyncGwUrl(rawUrl);
    const parsed = new URL(norm.fetchUrl);
    const host = parsed.hostname.toLowerCase();
    const isAsyncGw = host === "asyncgw.teams.microsoft.com" || host.endsWith(".asyncgw.teams.microsoft.com");
    const headers = {};
    if (isAsyncGw && this.ic3TokenProvider) {
      const token = await this.ic3TokenProvider();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
    const fetcher = this.fetchFn || fetch;
    let res = await fetcher(norm.fetchUrl, { headers });
    if ((res.status === 401 || res.status === 403) && isAsyncGw && this.graphTokenProvider) {
      const graphToken = await this.graphTokenProvider();
      if (graphToken) {
        const retryHeaders = { ...headers, Authorization: `Bearer ${graphToken}` };
        res = await fetcher(norm.fetchUrl, { headers: retryHeaders });
      }
    }
    if (!res.ok) {
      throw new Error(`Failed to download binary from ${norm.fetchUrl} (${res.status} ${res.statusText})`);
    }
    const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024;
    const clHeader = res.headers.get("content-length");
    if (clHeader) {
      const cl = parseInt(clHeader, 10);
      if (!isNaN(cl) && cl > MAX_DOWNLOAD_SIZE) {
        throw new Error(`Download payload exceeds 100MB limit: ${cl} bytes`);
      }
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_SIZE) {
      throw new Error(`Download payload exceeds 100MB limit: ${arrayBuffer.byteLength} bytes`);
    }
    return {
      buffer: Buffer.from(arrayBuffer),
      fileNameFromUrl: norm.fileNameFromUrl
    };
  }
  static CRITICAL_DENY_PATTERNS = [
    /^cph-[^/]*-agent-prompt\.txt$/i,
    /^AGENTS\.md$/i,
    /^package\.json$/i,
    /^bun\.lock$/i,
    /^scripts\/sp-sync-engine\.ps1$/i,
    /^src\/auth\//i,
    /^src\/protocol\//i,
    /^\.git\//i,
    /^\.cph\/state\/[^/]+\.json$/i
  ];
  static assertSafeLandingPath(workspaceRoot, absolutePath) {
    const rel = path12.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
    if (rel.startsWith("..") || path12.isAbsolute(rel) || rel === "") {
      throw new Error(`Destination path resolves outside workspace: ${absolutePath}`);
    }
    if (FilePorter.CRITICAL_DENY_PATTERNS.some((re) => re.test(rel))) {
      throw new Error(`Refusing to auto-land over critical harness file: ${rel}. Use write_file/edit for deliberate changes.`);
    }
  }
  async deliverToWorkspace(params) {
    const resolvedDest = path12.resolve(this.cwd, params.destinationPath);
    const relToCwd = path12.relative(this.cwd, resolvedDest);
    if (relToCwd.startsWith("..") || path12.isAbsolute(relToCwd)) {
      throw new Error(`Destination path "${params.destinationPath}" resolves outside workspace cwd: ${this.cwd}`);
    }
    const isDirTarget = Boolean(params.isDirectory || /[\\/]$/.test(params.destinationPath) || fs8.existsSync(resolvedDest) && fs8.statSync(resolvedDest).isDirectory());
    const isExplicitZipFile = params.destinationPath.toLowerCase().endsWith(".zip");
    FilePorter.assertSafeLandingPath(this.cwd, resolvedDest);
    const overwrite = params.overwrite === true;
    const { buffer, fileNameFromUrl } = await this.downloadBinary(params.downloadUrl);
    const isZipPayload = Boolean(params.isZip || fileNameFromUrl?.toLowerCase().endsWith(".zip") || isExplicitZipFile);
    if (isZipPayload && !isExplicitZipFile) {
      const targetDir = resolvedDest;
      const zip = new import_adm_zip.default(buffer);
      const entries = zip.getEntries();
      if (entries.length > 2000) {
        throw new Error(`Zip archive exceeds maximum allowed entry count (found ${entries.length}, max 2000)`);
      }
      let totalUncompressedBytes = 0;
      for (const entry of entries) {
        totalUncompressedBytes += entry.header.size;
        if (entry.header.size > 50 * 1024 * 1024) {
          throw new Error(`Zip entry "${entry.entryName}" exceeds 50MB limit: ${entry.header.size} bytes`);
        }
      }
      if (totalUncompressedBytes > 200 * 1024 * 1024) {
        throw new Error(`Zip archive uncompressed size exceeds 200MB limit: ${totalUncompressedBytes} bytes`);
      }
      const targetBase = path12.basename(targetDir);
      const landedFiles = [];
      for (const entry of entries) {
        const rawName = entry.entryName;
        if (rawName.includes("..") || path12.isAbsolute(rawName) || /^[a-zA-Z]:/.test(rawName)) {
          throw new Error(`Disallowed zip entry path (Zip-Slip detected): "${rawName}"`);
        }
        const normalizedEntry = path12.posix.normalize(rawName.replace(/\\/g, "/"));
        if (normalizedEntry.startsWith("..") || path12.isAbsolute(normalizedEntry)) {
          throw new Error(`Disallowed zip entry path (Zip-Slip detected): "${rawName}"`);
        }
        const rawParts = normalizedEntry.split("/").filter(Boolean);
        if (rawParts.length === 0)
          continue;
        let effectiveParts = rawParts;
        if (targetBase && (effectiveParts[0] === targetBase || effectiveParts[0].toLowerCase() === targetBase.toLowerCase())) {
          if (effectiveParts.length === 1 && entry.isDirectory) {
            fs8.mkdirSync(targetDir, { recursive: true });
            continue;
          }
          if (effectiveParts.length > 1) {
            effectiveParts = effectiveParts.slice(1);
          }
        }
        const relativeEntryPath = effectiveParts.join("/");
        const outPath = path12.resolve(targetDir, relativeEntryPath);
        const relToTarget = path12.relative(targetDir, outPath);
        if (relToTarget.startsWith("..") || path12.isAbsolute(relToTarget)) {
          throw new Error(`Zip entry "${rawName}" would extract outside target directory`);
        }
        if (entry.isDirectory) {
          fs8.mkdirSync(outPath, { recursive: true });
        } else {
          FilePorter.assertSafeLandingPath(this.cwd, outPath);
          if (fs8.existsSync(outPath) && !overwrite) {
            throw new Error(`Refusing to overwrite existing file "${path12.relative(this.cwd, outPath)}": set overwrite=true explicitly`);
          }
          fs8.mkdirSync(path12.dirname(outPath), { recursive: true });
          fs8.writeFileSync(outPath, entry.getData());
          const relToWorkspace = path12.relative(this.cwd, outPath).replace(/\\/g, "/");
          landedFiles.push(relToWorkspace);
        }
      }
      return {
        landedFiles,
        extractedFromZip: true
      };
    }
    let targetFilePath;
    if (isDirTarget) {
      let finalName = path12.posix.basename((fileNameFromUrl || params.fileName || "downloaded_file").replace(/\\/g, "/")) || "downloaded_file";
      if (finalName === "." || finalName === "..") {
        finalName = "downloaded_file";
      }
      targetFilePath = path12.resolve(resolvedDest, finalName);
    } else {
      targetFilePath = resolvedDest;
    }
    const relCheck = path12.relative(this.cwd, targetFilePath);
    if (relCheck.startsWith("..") || path12.isAbsolute(relCheck)) {
      throw new Error(`Target file path "${targetFilePath}" resolves outside workspace cwd: ${this.cwd}`);
    }
    fs8.mkdirSync(path12.dirname(targetFilePath), { recursive: true });
    FilePorter.assertSafeLandingPath(this.cwd, targetFilePath);
    if (fs8.existsSync(targetFilePath) && !overwrite) {
      throw new Error(`Refusing to overwrite existing file "${path12.relative(this.cwd, targetFilePath)}": set overwrite=true explicitly`);
    }
    fs8.writeFileSync(targetFilePath, buffer);
    const relPath = path12.relative(this.cwd, targetFilePath).replace(/\\/g, "/");
    return {
      landedFiles: [relPath],
      extractedFromZip: false
    };
  }
  detectRuntime(fileName) {
    const ext = path12.extname(fileName).toLowerCase();
    switch (ext) {
      case ".py":
        return "python";
      case ".js":
      case ".mjs":
      case ".cjs":
        return "node";
      case ".ts":
      case ".mts":
        return "bun";
      case ".ps1":
        return "powershell";
      case ".sh":
      case ".bash":
        return "bash";
      default:
        return;
    }
  }
  resolveDestination(fileName, customPath) {
    const dest = customPath ? path12.isAbsolute(customPath) ? customPath : path12.join(this.cwd, customPath) : path12.join(this.scratchDir, fileName);
    const dir = path12.dirname(dest);
    if (!fs8.existsSync(dir)) {
      fs8.mkdirSync(dir, { recursive: true });
    }
    return dest;
  }
  async saveAndExecute(params) {
    const fileName = path12.basename(params.fileName || "downloaded_file.txt");
    const filePath = this.resolveDestination(fileName, params.destinationPath);
    let content = params.content;
    if (content === undefined && params.downloadUrl) {
      if (params.downloadUrl.startsWith("blob:") && this.cdpClient) {
        const evalRes = await this.cdpClient.evaluate(`(async () => { const r = await fetch("${params.downloadUrl}"); return await r.text(); })()`);
        content = typeof evalRes === "string" ? evalRes : String(evalRes?.result?.value ?? evalRes?.value ?? "");
      } else {
        const { buffer } = await this.downloadBinary(params.downloadUrl);
        content = buffer.toString("utf-8");
      }
    }
    if (content === undefined) {
      content = "";
    }
    fs8.writeFileSync(filePath, content, "utf-8");
    const runtime = this.detectRuntime(fileName);
    const shouldExecute = params.autoExecute === true;
    if (!shouldExecute || !runtime) {
      return {
        fileName,
        filePath,
        downloaded: true,
        executed: false,
        formattedOutput: `【TOOL_RESULT: file_porter (${fileName}) - SUCCESS】
文件已通过 File Porter 成功搬运并落盘至：${path12.relative(this.cwd, filePath) || filePath}
【END_TOOL_RESULT】`
      };
    }
    try {
      const execRes = await this.runScript(filePath, runtime);
      const isSuccess = execRes.exitCode === 0;
      const statusText = isSuccess ? "SUCCESS" : "FAILED";
      let output = `文件已搬运落盘至：${path12.relative(this.cwd, filePath) || filePath}
宿主执行环境: ${runtime}
`;
      if (execRes.stdout) {
        output += `
[stdout]
${execRes.stdout.trim()}`;
      }
      if (execRes.stderr) {
        output += `
[stderr]
${execRes.stderr.trim()}`;
      }
      if (!execRes.stdout && !execRes.stderr) {
        output += `
(进程执行完毕，无输出)`;
      }
      return {
        fileName,
        filePath,
        downloaded: true,
        executed: true,
        runtime,
        exitCode: execRes.exitCode,
        stdout: execRes.stdout,
        stderr: execRes.stderr,
        formattedOutput: `【TOOL_RESULT: file_porter (${fileName}) - ${statusText}】
${output.trim()}
【END_TOOL_RESULT】`
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        fileName,
        filePath,
        downloaded: true,
        executed: true,
        runtime,
        exitCode: 1,
        error: errMsg,
        formattedOutput: `【TOOL_RESULT: file_porter (${fileName}) - FAILED】
执行失败: ${errMsg}
【END_TOOL_RESULT】`
      };
    }
  }
  runScript(filePath, runtime) {
    return new Promise((resolve, reject) => {
      let command = runtime;
      let args = [filePath];
      if (runtime === "powershell") {
        command = "powershell.exe";
        args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filePath];
      } else if (runtime === "python") {
        command = process.platform === "win32" ? "python.exe" : "python3";
        args = [filePath];
      } else if (runtime === "node") {
        command = "node";
        args = [filePath];
      } else if (runtime === "bun") {
        command = process.platform === "win32" ? "bun.exe" : "bun";
        args = ["run", filePath];
      }
      const proc = spawn3(command, args, {
        cwd: this.cwd,
        env: process.env,
        shell: false
      });
      let stdout = "";
      let stderr = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        proc.kill();
        reject(new Error(`Script execution timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        if (runtime === "python" && command === "python.exe") {
          const fallback = spawn3("python", [filePath], { cwd: this.cwd });
          let fbOut = "";
          let fbErr = "";
          fallback.stdout.on("data", (c) => fbOut += c.toString());
          fallback.stderr.on("data", (c) => fbErr += c.toString());
          fallback.on("close", (code) => {
            resolve({ exitCode: code ?? 0, stdout: fbOut, stderr: fbErr });
          });
          fallback.on("error", (e) => reject(e));
          return;
        }
        reject(err);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({ exitCode: code ?? 0, stdout, stderr });
        }
      });
    });
  }
}

// src/protocol/tool-bridge.ts
var MAX_READ_FILE_BYTES_CIRCUIT_BREAKER = 1024 * 1024;
var MAX_INLINE_OUTPUT_CHARS = 3000;
var MAX_INLINE_OUTPUT_LINES = 50;
function persistLargeOutputIfNeeded(output, workspaceRoot, toolName = "tool") {
  if (!output) {
    return { displayOutput: "" };
  }
  const lines = output.split(/\r?\n/);
  const isOverChars = output.length > MAX_INLINE_OUTPUT_CHARS;
  const isOverLines = lines.length > MAX_INLINE_OUTPUT_LINES;
  if (!isOverChars && !isOverLines) {
    return { displayOutput: output };
  }
  let relPath = undefined;
  try {
    const artifactsDir = path13.join(workspaceRoot, ".cph", "artifacts");
    fs9.mkdirSync(artifactsDir, { recursive: true });
    const timestamp = Date.now();
    const hash = crypto6.createHash("sha256").update(output).digest("hex").slice(0, 8);
    const fileName = `tool-output-${timestamp}-${hash}.log`;
    const absolutePath = path13.join(artifactsDir, fileName);
    fs9.writeFileSync(absolutePath, output, "utf-8");
    relPath = path13.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
  } catch {}
  return {
    displayOutput: output,
    persistedFile: relPath
  };
}
function smartDecodeBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    return "";
  }
  try {
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    return utf8Decoder.decode(buffer);
  } catch {
    try {
      const gbkDecoder = new TextDecoder("gbk");
      const decoded = gbkDecoder.decode(buffer);
      return decoded.replace(/\uFFFD/g, "");
    } catch {
      return buffer.toString("utf-8").replace(/\uFFFD/g, "");
    }
  }
}
function sanitizeOutput(text) {
  if (!text)
    return "";
  return text.replace(/\uFFFD/g, "");
}
function decodeStreamChunk(buffer) {
  if (!buffer || buffer.length === 0) {
    return { text: "", remainder: buffer };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, remainder: Buffer.alloc(0) };
  } catch {}
  for (let t = 1;t <= Math.min(3, buffer.length); t++) {
    const leadCandidate = buffer[buffer.length - t];
    let expectedBytes = 0;
    if (leadCandidate >= 194 && leadCandidate <= 223)
      expectedBytes = 2;
    else if (leadCandidate >= 224 && leadCandidate <= 239)
      expectedBytes = 3;
    else if (leadCandidate >= 240 && leadCandidate <= 244)
      expectedBytes = 4;
    if (expectedBytes > t) {
      const prefix = buffer.subarray(0, buffer.length - t);
      if (prefix.length === 0) {
        return { text: "", remainder: buffer };
      }
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(prefix);
        return { text, remainder: Buffer.from(buffer.subarray(buffer.length - t)) };
      } catch {
        break;
      }
    }
  }
  let highCount = 0;
  for (let i = buffer.length - 1;i >= 0 && buffer[i] >= 129; i--) {
    highCount++;
  }
  if (highCount % 2 === 1) {
    const prefix = buffer.subarray(0, buffer.length - 1);
    const remainder = Buffer.from(buffer.subarray(buffer.length - 1));
    const text = prefix.length > 0 ? smartDecodeBuffer(prefix) : "";
    return { text, remainder };
  } else {
    const text = smartDecodeBuffer(buffer);
    return { text, remainder: Buffer.alloc(0) };
  }
}
function createEncodingSelfHealingBashOperations(options, baseOps) {
  const underlyingOps = baseOps ?? createLocalBashOperations({ shellPath: options?.shellPath });
  const ops = {
    isEncodingSelfHealing: true,
    exec: async (command, cwd, execOptions) => {
      const isWindows = process.platform === "win32";
      if (!isWindows && !baseOps) {
        return underlyingOps.exec(command, cwd, execOptions);
      }
      let leftover = Buffer.alloc(0);
      const originalOnData = execOptions.onData;
      const healingOnData = (chunk) => {
        const combined = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
        const { text, remainder } = decodeStreamChunk(combined);
        leftover = remainder;
        if (text.length > 0) {
          originalOnData(Buffer.from(text, "utf-8"));
        }
      };
      const result = await underlyingOps.exec(command, cwd, {
        ...execOptions,
        onData: healingOnData
      });
      if (leftover.length > 0) {
        const text = smartDecodeBuffer(leftover);
        if (text.length > 0) {
          originalOnData(Buffer.from(text, "utf-8"));
        }
        leftover = Buffer.alloc(0);
      }
      return result;
    }
  };
  return ops;
}

class ToolBridge {
  cwd;
  tools = new Map;
  onQuestion;
  ledger;
  defaultContext;
  bashOperations;
  constructor(options) {
    if (typeof options === "string") {
      this.cwd = options;
    } else {
      this.cwd = options?.cwd ?? process.cwd();
      this.onQuestion = options?.onQuestion;
      this.ledger = options?.ledger;
      this.defaultContext = options?.context;
    }
    const customTools = typeof options === "object" ? options?.tools : undefined;
    if (customTools) {
      if (Array.isArray(customTools)) {
        for (const t of customTools) {
          this.tools.set(t.name, t);
        }
      } else {
        for (const [name, t] of Object.entries(customTools)) {
          this.tools.set(name, t);
        }
      }
    } else {
      const bashOps = createEncodingSelfHealingBashOperations();
      this.bashOperations = bashOps;
      const piTools = createCodingTools(this.cwd, {
        bash: { operations: bashOps }
      });
      for (const t of piTools) {
        this.tools.set(t.name, t);
      }
    }
  }
  getBashOperations() {
    return this.bashOperations;
  }
  getCwd() {
    return this.cwd;
  }
  setCwd(newCwd, ledger) {
    this.cwd = path13.resolve(newCwd);
    if (ledger !== undefined) {
      this.ledger = ledger;
    }
    const bashOps = createEncodingSelfHealingBashOperations();
    this.bashOperations = bashOps;
    const piTools = createCodingTools(this.cwd, {
      bash: { operations: bashOps }
    });
    this.tools.clear();
    for (const t of piTools) {
      this.tools.set(t.name, t);
    }
  }
  getTool(name) {
    return this.tools.get(name);
  }
  getAllTools() {
    return new Map(this.tools);
  }
  getLedger() {
    return this.ledger;
  }
  setLedger(ledger) {
    this.ledger = ledger;
  }
  recordToLedger(toolName, target, canonicalTool, success, output, context) {
    if (!this.ledger || typeof this.ledger.recordStep !== "function")
      return;
    try {
      const modifiedFiles = canonicalTool === "edit" || canonicalTool === "write" ? [target] : undefined;
      let statusBadge = undefined;
      if (canonicalTool === "bash" && /(?:test|spec|jest|vitest|pytest|bun\s+test|npm\s+test|cargo\s+test|go\s+test)\b/i.test(target)) {
        const match = output.match(/\b(PASS|FAIL)\b[^\n\r]*/) || output.match(/\b(\d+\s*pass(?:ing|ed)?|\d+\s*fail(?:ing|ed|ures)?)\b[^\n\r]*/i);
        if (match) {
          statusBadge = match[0].trim().slice(0, 30);
        }
      }
      this.ledger.recordStep({
        role: context?.role || this.defaultContext?.role || "main",
        sessionId: context?.sessionId || this.defaultContext?.sessionId || "main",
        tool: toolName,
        target,
        status: success ? "SUCCESS" : "FAILURE",
        modifiedFiles,
        statusBadge,
        briefSummary: output.slice(0, 200)
      });
    } catch {}
  }
  mapAction(action) {
    const rawToolName = (action.tool ?? action.action ?? action.name ?? "").trim();
    if (!rawToolName) {
      throw new Error("Action is missing tool name");
    }
    const toolName = rawToolName.toLowerCase();
    if (toolName === "read_file" || toolName === "read" || toolName === "cat") {
      const path = action.path ?? action.filePath ?? action.file ?? "";
      const rawStart = action.start_line ?? action.offset ?? action.startLine ?? 1;
      const offset = Math.max(1, Number(rawStart) || 1);
      let limit = undefined;
      const rawEnd = action.end_line ?? action.endLine;
      if (rawEnd !== undefined) {
        const endLine = Number(rawEnd);
        limit = endLine >= offset ? endLine - offset + 1 : 1;
      } else if (action.limit !== undefined || action.lines !== undefined) {
        const rawLimit = Number(action.limit ?? action.lines);
        if (rawLimit > 0) {
          limit = rawLimit;
        }
      }
      const args = {
        path,
        offset,
        ...limit !== undefined ? { limit } : {}
      };
      return {
        canonicalTool: "read",
        target: path,
        args,
        originalAction: action
      };
    }
    if (toolName === "patch_file" || toolName === "edit" || toolName === "edit_file") {
      const path = action.path ?? action.filePath ?? action.file ?? "";
      let edits = [];
      if (Array.isArray(action.edits) && action.edits.length > 0) {
        edits = action.edits.map((e) => ({
          oldText: e.oldText ?? e.old_string ?? e.old_text ?? "",
          newText: e.newText ?? e.new_string ?? e.new_text ?? ""
        }));
      } else {
        const oldText = action.old_string ?? action.oldText ?? action.old_text ?? "";
        const newText = action.new_string ?? action.newText ?? action.new_text ?? "";
        edits = [{ oldText, newText }];
      }
      const args = {
        path,
        edits
      };
      return {
        canonicalTool: "edit",
        target: path,
        args,
        originalAction: action
      };
    }
    if (toolName === "write_file" || toolName === "write") {
      const path = action.path ?? action.filePath ?? action.file ?? "";
      const content = action.content ?? "";
      const args = {
        path,
        content
      };
      return {
        canonicalTool: "write",
        target: path,
        args,
        originalAction: action
      };
    }
    if (toolName === "run_command" || toolName === "bash" || toolName === "exec") {
      let command = action.command ?? action.cmd ?? "";
      const timeout = action.timeout !== undefined ? Number(action.timeout) : 30;
      if (typeof command === "string" && command.includes("\\]")) {
        command = command.replace(/([a-zA-Z0-9_.]+)\\\]/g, "$1]");
      }
      if (typeof command === "string" && command.includes("\\[")) {
        command = command.replace(/\\\[([a-zA-Z0-9_.]+)/g, "[$1");
      }
      const args = {
        command,
        timeout
      };
      return {
        canonicalTool: "bash",
        target: command,
        args,
        originalAction: action
      };
    }
    if (toolName === "ask_question" || toolName === "question") {
      const question = action.question ?? action.prompt ?? "";
      const options = Array.isArray(action.options) ? action.options : undefined;
      const args = {
        question,
        options
      };
      return {
        canonicalTool: "question",
        target: question,
        args,
        originalAction: action
      };
    }
    if (toolName === "file_porter" || toolName === "execute_file" || toolName === "porter") {
      const fileName = action.fileName ?? action.file ?? action.name ?? action.path ?? "downloaded_file";
      const downloadUrl = action.downloadUrl ?? action.url ?? action.href;
      const autoExecute = action.autoExecute ?? /\.(py|ts|js|mjs|ps1|sh|bat)$/i.test(fileName);
      const args = {
        fileName,
        downloadUrl,
        autoExecute
      };
      return {
        canonicalTool: "file_porter",
        target: fileName,
        args,
        originalAction: action
      };
    }
    throw new Error(`Unsupported Copilot action: ${rawToolName}`);
  }
  persistLargeOutputIfNeeded(output, toolName) {
    return persistLargeOutputIfNeeded(output, this.cwd, toolName);
  }
  async executeAction(action, signal, context) {
    const rawActionName = action.tool ?? action.action ?? action.name ?? "unknown";
    let mapped;
    try {
      mapped = this.mapAction(action);
    } catch (err) {
      let output = err instanceof Error ? err.message : String(err);
      output = sanitizeOutput(output);
      const target = action.path ?? action.command ?? action.question ?? "unknown";
      const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
      const formatted = this.formatResult({
        toolName: rawActionName,
        target,
        success: false,
        output: persisted.displayOutput
      });
      return {
        actionName: rawActionName,
        piToolName: "unknown",
        target,
        success: false,
        output: persisted.displayOutput,
        rawOutput: output,
        formatted,
        persistedFile: persisted.persistedFile
      };
    }
    if (mapped.canonicalTool === "question") {
      const qArgs = mapped.args;
      try {
        let output = "";
        if (this.onQuestion) {
          const userAns = await this.onQuestion(qArgs);
          output = typeof userAns === "string" ? userAns : String(userAns ?? "");
        } else {
          output = `[Question prompted]: ${qArgs.question}` + (qArgs.options?.length ? `
Options: ${qArgs.options.join(", ")}` : "");
        }
        output = sanitizeOutput(output);
        const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
        const formatted = this.formatResult({
          toolName: rawActionName,
          target: mapped.target,
          success: true,
          output: persisted.displayOutput
        });
        return {
          actionName: rawActionName,
          piToolName: "question",
          target: mapped.target,
          success: true,
          output: persisted.displayOutput,
          rawOutput: output,
          formatted,
          mappedArgs: mapped.args,
          persistedFile: persisted.persistedFile
        };
      } catch (err) {
        let output = err instanceof Error ? err.message : String(err);
        output = sanitizeOutput(output);
        const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
        const formatted = this.formatResult({
          toolName: rawActionName,
          target: mapped.target,
          success: false,
          output: persisted.displayOutput
        });
        return {
          actionName: rawActionName,
          piToolName: "question",
          target: mapped.target,
          success: false,
          output: persisted.displayOutput,
          rawOutput: output,
          formatted,
          mappedArgs: mapped.args,
          persistedFile: persisted.persistedFile
        };
      }
    }
    if (mapped.canonicalTool === "file_porter") {
      const porterArgs = mapped.args;
      try {
        const porter = new FilePorter({ cwd: this.cwd });
        const res = await porter.saveAndExecute({
          fileName: porterArgs.fileName,
          downloadUrl: porterArgs.downloadUrl,
          content: action.content,
          autoExecute: porterArgs.autoExecute
        });
        const success = res.exitCode === undefined || res.exitCode === 0;
        const output = sanitizeOutput(res.formattedOutput);
        this.recordToLedger(rawActionName, mapped.target, "file_porter", success, output, context);
        return {
          actionName: rawActionName,
          piToolName: "file_porter",
          target: mapped.target,
          success,
          output,
          rawOutput: res.stdout || res.stderr || "",
          formatted: output,
          mappedArgs: mapped.args
        };
      } catch (err) {
        let output = err instanceof Error ? err.message : String(err);
        output = sanitizeOutput(output);
        const formatted = `【TOOL_RESULT: file_porter (${mapped.target}) - FAILED】
搬运失败: ${output}
【END_TOOL_RESULT】`;
        this.recordToLedger(rawActionName, mapped.target, "file_porter", false, output, context);
        return {
          actionName: rawActionName,
          piToolName: "file_porter",
          target: mapped.target,
          success: false,
          output: formatted,
          rawOutput: output,
          formatted,
          mappedArgs: mapped.args
        };
      }
    }
    if (mapped.canonicalTool === "read") {
      const readArgs = mapped.args;
      const rawPath = readArgs.path;
      const hasSlice = readArgs.limit !== undefined || action.start_line !== undefined || action.startLine !== undefined || action.end_line !== undefined || action.endLine !== undefined || action.limit !== undefined || action.lines !== undefined;
      if (!hasSlice && rawPath) {
        try {
          const fullPath = path13.isAbsolute(rawPath) ? rawPath : path13.resolve(this.cwd, rawPath);
          if (fs9.existsSync(fullPath)) {
            const stat = fs9.statSync(fullPath);
            if (stat.isFile() && stat.size > MAX_READ_FILE_BYTES_CIRCUIT_BREAKER) {
              const fileSize = stat.size;
              const output = `[ToolBridge Error] File "${rawPath}" (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds the 1MB safety threshold. Please specify start_line and end_line to inspect a targeted slice, or use run_command with head/tail.`;
              this.recordToLedger(rawActionName, mapped.target, "read", false, output, context);
              const formatted = this.formatResult({
                toolName: rawActionName,
                target: mapped.target,
                success: false,
                output
              });
              return {
                actionName: rawActionName,
                piToolName: "read",
                target: mapped.target,
                success: false,
                output,
                rawOutput: output,
                formatted,
                mappedArgs: mapped.args
              };
            }
          }
        } catch {}
      }
    }
    const tool = this.tools.get(mapped.canonicalTool);
    if (!tool) {
      let output = `Native Pi tool not available for action: ${mapped.canonicalTool}`;
      output = sanitizeOutput(output);
      const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
      const formatted = this.formatResult({
        toolName: rawActionName,
        target: mapped.target,
        success: false,
        output: persisted.displayOutput
      });
      return {
        actionName: rawActionName,
        piToolName: mapped.canonicalTool,
        target: mapped.target,
        success: false,
        output: persisted.displayOutput,
        rawOutput: output,
        formatted,
        mappedArgs: mapped.args,
        persistedFile: persisted.persistedFile
      };
    }
    const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const rawResult = await tool.execute(toolCallId, mapped.args, signal);
      const isError = Boolean(rawResult.isError);
      let output = "";
      if (rawResult.content && Array.isArray(rawResult.content)) {
        output = rawResult.content.map((c) => c.type === "text" ? c.text : "[image]").join(`
`);
      } else if (typeof rawResult.structuredContent === "string") {
        output = rawResult.structuredContent;
      } else if (rawResult.structuredContent && typeof rawResult.structuredContent === "object" && "output" in rawResult.structuredContent) {
        output = String(rawResult.structuredContent.output);
      }
      if (mapped.canonicalTool === "edit" && rawResult.details?.diff && !output.includes(rawResult.details.diff)) {
        output += `

Diff:
${rawResult.details.diff}`;
      }
      output = sanitizeOutput(output);
      const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
      const success = !isError;
      this.recordToLedger(rawActionName, mapped.target, mapped.canonicalTool, success, output, context);
      const formatted = this.formatResult({
        toolName: rawActionName,
        target: mapped.target,
        success,
        output: persisted.displayOutput
      });
      return {
        actionName: rawActionName,
        piToolName: mapped.canonicalTool,
        target: mapped.target,
        success,
        output: persisted.displayOutput,
        rawOutput: output,
        formatted,
        rawResult,
        mappedArgs: mapped.args,
        persistedFile: persisted.persistedFile
      };
    } catch (err) {
      let output = err instanceof Error ? err.message : String(err);
      output = sanitizeOutput(output);
      const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
      this.recordToLedger(rawActionName, mapped?.target || "unknown", mapped?.canonicalTool || "unknown", false, output, context);
      const formatted = this.formatResult({
        toolName: rawActionName,
        target: mapped.target,
        success: false,
        output: persisted.displayOutput
      });
      return {
        actionName: rawActionName,
        piToolName: mapped.canonicalTool,
        target: mapped.target,
        success: false,
        output: persisted.displayOutput,
        rawOutput: output,
        formatted,
        mappedArgs: mapped.args,
        persistedFile: persisted.persistedFile
      };
    }
  }
  formatResult(params) {
    const toolName = "actionName" in params ? params.actionName : params.toolName;
    const target = params.target || "unknown";
    const status = params.success ? "SUCCESS" : "FAILED";
    let output = params.output ?? "";
    if ((output.length > MAX_INLINE_OUTPUT_CHARS || output.split(/\r?\n/).length > MAX_INLINE_OUTPUT_LINES) && !output.includes(".cph/artifacts/tool-output-")) {
      output = this.persistLargeOutputIfNeeded(output, toolName).displayOutput;
    }
    return `【TOOL_RESULT: ${toolName} (${target}) - ${status}】
${output}
【END_TOOL_RESULT】`;
  }
  static formatUserResponse(answer) {
    if (!answer)
      return "[USER_RESPONSE for ask_question]:";
    return answer.startsWith("[USER_RESPONSE for ask_question]:") ? answer : `[USER_RESPONSE for ask_question]: ${answer}`;
  }
  formatUserResponse(answer) {
    return ToolBridge.formatUserResponse(answer);
  }
}

// src/protocol/prompt-builder.ts
class PromptBuilder {
  static PROTOCOL_REMINDER = `【交接协议规范 (Turn Protocol Contract)】
1. 若需继续执行，必须且仅输出一个 \`\`\`action 块：
   - 读取文件: tool: read_file \\n path: <path>
   - 局部修改: tool: edit \\n path: <path> \\n old_string: <old> \\n new_string: <new>
   - 写入文件: tool: write_file \\n path: <path> \\n content: <content>
   - 运行命令: tool: run_command \\n command: <cmd>
   - 提问用户: tool: ask_question \\n question: <question>
   - 调派子代理: tool: invoke_subagent \\n subagents: [{"role": "researcher"|"coder", "prompt": "<具体独立切片任务>"}]
2. 当所有目标已达成且验证充分时，直接在独立一行输出最终交付总结：
   FINAL_ANSWER: <任务交付总结说明>`;
  static buildTurn1Prompt(options) {
    const wsNorm = options.workspaceRoot.replace(/\\/g, "/");
    const gitStatus = options.gitFacts || "Git: 未初始化或无未提交变更 (clean)";
    const treePreview = options.dirTree ? `
【核心目录结构预览】
${options.dirTree}
` : "";
    const repoMap = PnPWorkspaceSyncEngine.buildBoundedRepoMap({
      workspaceRoot: options.workspaceRoot,
      task: options.task
    });
    const repoMapSection = repoMap ? `
${repoMap}
` : "";
    const catalogLine = options.catalogAttached ? "完整清单见随本轮消息挂载的附件 remote-workspace-catalog.md（含 2 层目录树与逐文件直链）；下方为任务范围内精简索引" : "见下方精简索引（未列出的文件按需 read_file 读取）";
    return `你是一个专业的自主式编程与架构智能体（Coding Agent）。你直接运行在用户本地宿主机的 CPH-PI 运行环境中，具备真实物理磁盘读写与终端命令执行工具（Tool Calling）。

【本地宿主机与工作区事实 (Grounding Facts)】
- 工作区绝对路径: ${wsNorm}
- 工作区目录与云端文件索引: ${catalogLine}
- 本地 Git 仓库状态:
${gitStatus}
${treePreview}${repoMapSection}
【可用工具格式 (Tool Calling)】
当你需要读取文件、修改代码、创建文件、运行测试命令、调派子代理或向用户提问时，请输出 \`\`\`action 块：
1. 读取文件内容：
\`\`\`action
tool: read_file
path: <文件路径>
\`\`\`
2. 局部精准编辑文件（推荐！仅替换指定代码段，避免全量覆写导致大文件截断）：
\`\`\`action
tool: edit
path: <文件路径>
old_string: <要替换的原代码段>
new_string: <替换后的新代码段>
\`\`\`
3. 写入或新建文件：
\`\`\`action
tool: write_file
path: <文件路径>
content: <文件完整内容>
\`\`\`
4. 运行终端命令：
\`\`\`action
tool: run_command
command: <命令字符串>
\`\`\`
5. 向用户提问或选项确认：
\`\`\`action
tool: ask_question
question: <问题内容>
options: 选项A | 选项B (可选)
\`\`\`
6. 调派子代理并发执行独立切片审查或研发任务：
\`\`\`action
tool: invoke_subagent
subagents: [{"role": "researcher"|"coder", "prompt": "<具体独立切片任务>"}]
\`\`\`

${options.skillsSection ? `【当前已激活的专业技能 (Skill)】
${options.skillsSection}

` : ""}${options.task ? `【当前用户任务】
${options.task}

` : ""}${this.PROTOCOL_REMINDER}`;
  }
  static buildDirectAgentPrompt(workspaceRoot, task, activeSkillsSection = "", dirSkeleton = "", concurrencyWorkers, virtualRepoMap, catalogAttached = false) {
    const wsNorm = workspaceRoot.replace(/\\/g, "/");
    const catalogLine = catalogAttached ? "完整清单见随本轮消息挂载的附件 remote-workspace-catalog.md（含 2 层目录树与逐文件直链）；下方为任务范围内精简索引" : "见下方精简索引（未列出的文件按需 read_file 读取）";
    let prompt = `【本地宿主机工作区事实】
- 工作区绝对路径: ${wsNorm}
- 工作区目录与云端文件索引: ${catalogLine}`;
    if (concurrencyWorkers !== undefined && concurrencyWorkers > 0) {
      prompt += `
- 并发集群容量: ${concurrencyWorkers} 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)`;
    }
    if (dirSkeleton && dirSkeleton.trim() !== "") {
      prompt += `

【工作区受控目录骨架 (2-Level Skeleton)】
${dirSkeleton.trim()}`;
    }
    const effectiveRepoMap = virtualRepoMap ?? PnPWorkspaceSyncEngine.buildBoundedRepoMap({ workspaceRoot, task });
    if (effectiveRepoMap && effectiveRepoMap.trim() !== "") {
      prompt += `

${effectiveRepoMap.trim()}`;
    }
    if (activeSkillsSection && activeSkillsSection.trim() !== "") {
      prompt += `

【当前已激活的专业技能 (Skill)】
${activeSkillsSection.trim()}`;
    }
    prompt += `

【用户正式需求】
${task}`;
    return prompt;
  }
  static buildHandshakePrompt(workspaceRoot, gitFacts, dirTree) {
    const wsNorm = workspaceRoot.replace(/\\/g, "/");
    const treePreview = dirTree ? `
【当前工作区精简目录树】
${dirTree}
` : "";
    return `你是一个运行在本地宿主机的 CPH-PI 自主编程智能体。你的工具链路已直接接入物理操作系统。

【本地宿主机工作区事实】
- 工作区绝对路径: ${wsNorm}
- Git 仓库客观状态:
${gitFacts}
${treePreview}
【第一轮基准探测握手 (Turn 1 Grounding Handshake)】
这是新会话的第一轮交互。为验证本地真实工具调用链路与工作区文件系统连接，请第一步务必输出 action 块检查工作区状态（例如读取目标文件或执行探测命令）：
\`\`\`action
tool: run_command
command: git status
\`\`\`

在本地完成初次探测并反馈 [TOOL_RESULT] 后，系统将在第二轮注入用户的正式业务需求与全量流程！`;
  }
  static buildTurn2TaskPrompt(optionsOrTask, toolResult, skillsSection = "", toolName, concurrencyWorkers) {
    let finalTask = "";
    let finalToolResult = "";
    let finalSkillsSection = "";
    let finalToolName;
    let finalConcurrencyWorkers;
    if (typeof optionsOrTask === "object" && optionsOrTask !== null) {
      finalTask = optionsOrTask.task;
      finalToolResult = optionsOrTask.toolResult;
      finalSkillsSection = optionsOrTask.skillsSection || "";
      finalToolName = optionsOrTask.toolName;
      finalConcurrencyWorkers = optionsOrTask.concurrencyWorkers;
    } else {
      finalTask = optionsOrTask;
      finalToolResult = toolResult ?? "";
      finalSkillsSection = skillsSection ?? "";
      finalToolName = toolName;
      finalConcurrencyWorkers = concurrencyWorkers;
    }
    const toolHeader = finalToolName ? `[TOOL_RESULT for ${finalToolName} - SUCCESS]:` : `[TOOL_RESULT - SUCCESS]:`;
    const clusterFact = finalConcurrencyWorkers !== undefined && finalConcurrencyWorkers > 0 ? `
- 并发集群容量: ${finalConcurrencyWorkers} 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)` : "";
    return `${toolHeader}
${finalToolResult}

【环境握手完成：本地工具与工作区已就绪】${clusterFact}
${finalSkillsSection ? `【当前已激活的专业技能 (Skill)】
${finalSkillsSection}

` : ""}
【用户正式需求】
${finalTask}

【执行规则与推进要求】
1. 深入分析工作区现状，按需使用 read_file、edit、write_file、run_command 开展工作；
2. 若需运行测试，输出 tool: run_command 调用对应测试命令；
3. 任务全部落盘完成并验证后，方可输出 FINAL_ANSWER。

${this.PROTOCOL_REMINDER}`;
  }
  static buildToolResultPrompt(toolName, success, output, error, taskInvariant) {
    const invariantBlock = taskInvariant && taskInvariant.trim() !== "" ? `
【当前推进战役北极星 (Task Invariant)】:
${taskInvariant.trim()}
` : "";
    if (success) {
      return `[TOOL_RESULT for ${toolName} - SUCCESS]:
${output}
source: local | status: success | freshness: unknown
${invariantBlock}
${this.PROTOCOL_REMINDER}`;
    } else {
      return `[TOOL_RESULT for ${toolName} - FAILED]:
Error: ${error || "Execution failed"}
Output: ${output}
source: local | status: failed | freshness: unknown
${invariantBlock}
${this.PROTOCOL_REMINDER}`;
    }
  }
  static generateHeadTailExcerpt(rawContent, maxHeadLines = 25, maxTailLines = 25) {
    const lines = rawContent.split(/\r?\n/);
    const threshold = maxHeadLines + maxTailLines;
    if (lines.length <= threshold) {
      return rawContent;
    }
    const omittedCount = lines.length - maxHeadLines - maxTailLines;
    const head = lines.slice(0, maxHeadLines).join(`
`);
    const tail = lines.slice(lines.length - maxTailLines).join(`
`);
    return `${head}
... (省略 ${omittedCount} 行) ...
${tail}`;
  }
  static buildAttachedToolResultPrompt(toolName, fileName, summary, excerpt, taskInvariant) {
    const fingerprintBlock = excerpt ? `

【物理执行指纹摘要 (Head-Tail Fingerprint)】:
${excerpt}` : "";
    const invariantBlock = taskInvariant && taskInvariant.trim() !== "" ? `

【当前推进战役北极星 (Task Invariant)】:
${taskInvariant.trim()}` : "";
    return `[TOOL_RESULT for ${toolName} - SUCCESS (ATTACHED)]:
✔ ${toolName} 执行成功 (共 ${summary.lineCount} 行 / ${summary.charCount} 字符)。
完整执行结果已作为文件附件【${fileName}】挂载送达。
source: cloud-attachment | status: attached | freshness: unknown
【无损附件感知指引】：云端文档引擎已对该附件进行全量原生解析，请直接基于该附件已解析的全部数据推进后续技术推演与操作。${fingerprintBlock}${invariantBlock}

${this.PROTOCOL_REMINDER}`;
  }
  static buildTurn2TaskPromptWithAttachment(task, skillsSection, toolName, fileName, summary, excerpt, concurrencyWorkers) {
    const fingerprintBlock = excerpt ? `

【物理执行指纹摘要 (Head-Tail Fingerprint)】:
${excerpt}` : "";
    const clusterFact = concurrencyWorkers !== undefined && concurrencyWorkers > 0 ? `
- 并发集群容量: ${concurrencyWorkers} 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)` : "";
    return `[TOOL_RESULT for ${toolName} - SUCCESS (ATTACHED)]:
✔ 探测握手执行完成 (共 ${summary.lineCount} 行 / ${summary.charCount} 字符)，完整输出已作为文件附件【${fileName}】挂载送达。
【无损附件感知指引】：云端文档引擎已对该附件进行全量原生解析，请直接基于该附件分析推进。${fingerprintBlock}

【环境握手完成：本地工具与工作区已就绪】${clusterFact}
${skillsSection ? `【当前已激活的专业技能 (Skill)】
${skillsSection}

` : ""}
【用户正式需求】
${task}

【执行规则与推进要求】
1. 深入分析工作区现状，按需使用 read_file、patch_file、write_file、run_command 开展工作；
2. 任务全部落盘完成并验证后，方可输出 FINAL_ANSWER。

${this.PROTOCOL_REMINDER}`;
  }
  static buildUserResponsePrompt(userResponse, taskInvariant) {
    const invariantBlock = taskInvariant && taskInvariant.trim() !== "" ? `
【当前推进战役北极星 (Task Invariant)】:
${taskInvariant.trim()}
` : "";
    return `[USER_RESPONSE for ask_question]:
用户已回复确认：
${userResponse}
${invariantBlock}
请根据用户输入继续推进执行下一步任务：
${this.PROTOCOL_REMINDER}`;
  }
  static buildReGroundingPrompt(options) {
    const wsNorm = options.workspaceRoot.replace(/\\/g, "/");
    const gitFacts = options.gitFacts || "Git status: clean";
    const history = options.historySummary || "前序历史操作已成功同步。";
    const repoMap = PnPWorkspaceSyncEngine.buildBoundedRepoMap({
      workspaceRoot: options.workspaceRoot,
      task: options.currentTask
    });
    const repoMapSection = repoMap ? `

${repoMap.trim()}` : "";
    const catalogLine = options.catalogAttached ? "完整清单见随本轮消息挂载的附件 remote-workspace-catalog.md（含 2 层目录树与逐文件直链）；下方为任务范围内精简索引" : "见下方精简索引（未列出的文件按需 read_file 读取）";
    return `你是一个专业的自主式编程与架构智能体（Coding Agent）。本地物理环境已连接。

【本地宿主机与工作区事实 (Session Re-grounding)】
- 工作区绝对路径: ${wsNorm}
- 工作区目录与云端文件索引: ${catalogLine}
- 最新 Git 仓库状态:
${gitFacts}${repoMapSection}

【前序轮次执行摘要 (Context Transfer)】
${history}

${options.skillsSection ? `【当前已激活的技能】
${options.skillsSection}

` : ""}
${options.currentTask ? `【当前推进中的任务】
${options.currentTask}

` : ""}
${this.PROTOCOL_REMINDER}`;
  }
  static buildFileSavedAndSyncedReceipt(params) {
    const lines = params.landedFiles.map((item) => item.cloudWebUrl ? `✔ 文件已落盘至本地: ${item.relPath}
✔ 已同步至云端工作区: ${item.cloudWebUrl}` : `✔ 文件已落盘至本地: ${item.relPath}`);
    const invariantBlock = params.taskInvariant && params.taskInvariant.trim() !== "" ? `
【当前推进战役北极星 (Task Invariant)】:
${params.taskInvariant.trim()}
` : "";
    return `[TOOL_RESULT for ${params.toolName} - SUCCESS]:
${lines.join(`
`)}
source: local+cloud | status: success | freshness: synced
${invariantBlock}
${this.PROTOCOL_REMINDER}`;
  }
  static buildHandoffPreparationPrompt(task, sessionId) {
    return `[SYSTEM NOTICE: 当前会话即将在下一轮达到推理上限]:
当前长耗时任务即将进入跨会话接力期。

【原生交接文档格式指南】
当前阶段的核心目标是完成接力移交，确保后续智能体能够无缝接续。
请在当前轮次直接输出 \`\`\`handoff ... \`\`\` 代码块提供你的【深度技术总结与接力备忘录 (HANDOFF_MEMO:)】：
\`\`\`handoff
# 跨会话自主任务交接文档
1. 【任务目标与交付边界】原始任务核心目标与约束
2. 【阶段性技术审计发现与架构核心见解】对已读源码与模块架构的深度研判及重构建议
3. 【已验证客观事实与物理基线】已读取的项目模块与已执行验证的基准命令
4. 【反模式与关键卡点】代码坏味道与阻碍推进的报错/依赖问题
5. 【已修改/生成文件清单】变更文件路径及当前状态
6. 【接力第一优先级待办事项】明确指示下任接力者的具体切入点，直接推进后续工作
\`\`\`

系统将自动提取该代码块并持久化归档，接力智能体将直接据此继续攻坚！
原始任务需求：${task}`;
  }
}

// src/protocol/resilient-parser.ts
class ResilientParser {
  static parse(text) {
    const trimmed = (text || "").trim();
    if (!trimmed || trimmed.length === 0) {
      return {
        type: "empty_response",
        thought: ""
      };
    }
    const handoffMatch = trimmed.match(/```handoff\s*([\s\S]*?)```/i);
    if (handoffMatch) {
      const handoffDoc = handoffMatch[1].trim();
      const thoughtMatch = trimmed.match(/(?:THOUGHT:|^)([\s\S]*?)```handoff/i);
      const thought = thoughtMatch ? thoughtMatch[1].replace(/^THOUGHT:\s*/i, "").trim() : "";
      return {
        type: "handoff",
        thought,
        handoffDoc
      };
    }
    const fencedMatch = trimmed.match(/```(?:action|json)?\s*([\s\S]*?)```/i);
    let actionContent = null;
    let thought = "";
    if (fencedMatch) {
      actionContent = fencedMatch[1].trim();
      const thoughtMatch = trimmed.match(/(?:THOUGHT:|^)([\s\S]*?)```/i);
      thought = thoughtMatch ? thoughtMatch[1].replace(/^THOUGHT:\s*/i, "").trim() : "";
    } else {
      const unfencedMatch = trimmed.match(/(?:^|[^\w])(?:action\s*\n\s*)?(tool\s*:\s*[a-zA-Z_]+[\s\S]*?)(?:```|$|\n\n(?=[A-Z_]+:))/i) || trimmed.match(/(?:^|[^\w])(?:ACTION|tool_call>)\s*:?\s*([\s\S]*?)(?:```|$|\n\n(?=[A-Z_]+:))/i);
      if (unfencedMatch) {
        actionContent = unfencedMatch[1].trim();
        const beforeAction = trimmed.slice(0, unfencedMatch.index).trim();
        thought = beforeAction.replace(/^THOUGHT:\s*/i, "").trim();
      }
    }
    if (actionContent) {
      const parsedAction = this.extractActionFields(actionContent);
      if (parsedAction) {
        return {
          type: "action",
          thought,
          action: parsedAction
        };
      }
    }
    const finalAnswerMatch = trimmed.match(/(?:FINAL_?ANSWER\b:?|_ANSWER\b:?|ALL_TASKS_COMPLETED|【已完成交付】)([\s\S]*)$/i);
    if (finalAnswerMatch) {
      const summary = finalAnswerMatch[1].trim();
      const markerIndex = finalAnswerMatch.index ?? -1;
      const parsedThought = markerIndex > 0 ? trimmed.slice(0, markerIndex).replace(/^THOUGHT:\s*/i, "").trim() : "";
      return {
        type: "final_answer",
        thought: parsedThought,
        answer: {
          summary: summary || trimmed,
          raw: trimmed
        }
      };
    }
    if (trimmed.includes("ALL_TASKS_COMPLETED") || trimmed.includes("【已完成交付】")) {
      return {
        type: "final_answer",
        thought: "",
        answer: { summary: trimmed, raw: trimmed }
      };
    }
    const anchorMatch = trimmed.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*download=["']([^"']+)["'][^>]*>/i) || trimmed.match(/<a\s+[^>]*download=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*>/i);
    let detectedFileName = null;
    let detectedUrl = null;
    if (anchorMatch) {
      const p1 = anchorMatch[1];
      const p2 = anchorMatch[2];
      if (p1.startsWith("blob:") || p1.startsWith("http")) {
        detectedUrl = p1;
        detectedFileName = p2;
      } else if (p2.startsWith("blob:") || p2.startsWith("http")) {
        detectedUrl = p2;
        detectedFileName = p1;
      }
    } else {
      const mdLinkMatch = trimmed.match(/\[(?:下载\s*)?([a-zA-Z0-9_\-.]+\.[a-zA-Z0-9_]+)\]\((blob:[^\)\s]+|https?:\/\/[^\)\s]+)\)/i);
      if (mdLinkMatch) {
        detectedFileName = mdLinkMatch[1];
        detectedUrl = mdLinkMatch[2];
      }
    }
    if (detectedFileName && detectedUrl) {
      const isExecutable = /\.(py|ts|js|mjs|ps1|sh|bat)$/i.test(detectedFileName);
      const thought = trimmed.split(/<a|\[(?:下载\s*)?[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9_]+\]/i)[0].replace(/^THOUGHT:\s*/i, "").trim();
      return {
        type: "action",
        thought,
        action: {
          tool: "file_porter",
          fileName: detectedFileName,
          downloadUrl: detectedUrl,
          autoExecute: isExecutable,
          raw: trimmed
        }
      };
    }
    return {
      type: "invalid_chatter",
      thought: trimmed,
      warning: "[Harness 纠偏提示: 请按协议约定操作：若需继续执行，请在 ```action ... ``` 块中调用工具；若已完成所有工作，请直接输出 FINAL_ANSWER: 交付总结。]"
    };
  }
  static extractActionFields(content) {
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed);
        if (typeof obj === "object" && obj !== null) {
          const rawTool = (obj.tool || obj.action || obj.name || "").toString();
          if (rawTool) {
            const tool = this.normalizeToolName(rawTool) || rawTool;
            let subagents = obj.subagents;
            if (tool === "invoke_subagent" && Array.isArray(subagents)) {
              subagents = subagents.map((s) => {
                let rawRole = s.role ? String(s.role).trim().toLowerCase() : "researcher";
                if (rawRole === "searcher")
                  rawRole = "researcher";
                const role = rawRole === "coder" ? "coder" : "researcher";
                return {
                  ...s,
                  role,
                  stage: Number(s.stage) || 1
                };
              });
            }
            const fileName = obj.fileName || obj.filename || obj.file || (tool === "file_porter" ? obj.name || obj.path : undefined);
            const downloadUrl = obj.downloadUrl || obj.download_url || obj.url || obj.href;
            const autoExecute = obj.autoExecute ?? obj.auto_execute ?? (fileName && typeof fileName === "string" ? /\.(py|ts|js|mjs|ps1|sh|bat)$/i.test(fileName) : undefined);
            return {
              ...obj,
              tool,
              ...fileName ? { fileName } : {},
              ...downloadUrl ? { downloadUrl } : {},
              ...autoExecute !== undefined ? { autoExecute } : {},
              ...subagents ? { subagents } : {}
            };
          }
        }
      } catch {}
    }
    let tool = null;
    let contentToScan = trimmed;
    const toolMatch = trimmed.match(/tool\s*:\s*([a-zA-Z_]+)/i) || trimmed.match(/action\s*:\s*([a-zA-Z_]+)/i);
    if (toolMatch) {
      const rawTool = toolMatch[1].toLowerCase();
      tool = this.normalizeToolName(rawTool) || rawTool;
    } else {
      const firstLine = trimmed.split(`
`)[0].trim();
      const directTool = this.normalizeToolName(firstLine);
      if (directTool) {
        tool = directTool;
      }
    }
    if (tool) {
      if (tool === "invoke_subagent") {
        const subagents = this.parseSubagentsBlock(contentToScan);
        return {
          tool: "invoke_subagent",
          subagents,
          raw: trimmed
        };
      }
      const pathMatch = contentToScan.match(/(?:path|filePath|file)\s*:\s*([^\r\n]+)/i);
      const fileNameMatch = contentToScan.match(/(?:fileName|filename|file|name)\s*:\s*([^\r\n]+)/i);
      const urlMatch = contentToScan.match(/(?:downloadUrl|download_url|url|href)\s*:\s*([^\r\n]+)/i);
      const autoExecMatch = contentToScan.match(/(?:autoExecute|auto_execute)\s*:\s*(true|false)/i);
      const startLineMatch = contentToScan.match(/(?:start_line|startLine|offset)\s*:\s*(\d+)/i);
      const endLineMatch = contentToScan.match(/(?:end_line|endLine)\s*:\s*(\d+)/i);
      const limitMatch = contentToScan.match(/(?:limit|lines)\s*:\s*(\d+)/i);
      const cmdMatch = contentToScan.match(/(?:command|cmd)\s*:\s*([^\r\n]+)/i);
      const timeoutMatch = contentToScan.match(/timeout\s*:\s*(\d+)/i);
      const patternMatch = contentToScan.match(/pattern\s*:\s*([^\r\n]+)/i);
      const contentMatch = contentToScan.match(/content\s*:\s*([\s\S]*?)(?=\r?\n\s*(?:path|tool|file|action)\s*:|$)/i);
      const oldStrMatch = contentToScan.match(/(?:old_string|oldstring|old_text|oldText)\s*:\s*([\s\S]*?)(?=\n(?:new_string|newstring|new_text|newText|tool|path)\s*:|$)/i);
      const newStrMatch = contentToScan.match(/(?:new_string|newstring|new_text|newText)\s*:\s*([\s\S]*?)(?=\n(?:tool|path|old_string)\s*:|$)/i);
      const questionMatch = contentToScan.match(/(?:question|prompt|message)\s*:\s*([^\r\n]+)/i);
      const optionsMatch = contentToScan.match(/options?\s*:\s*([^\r\n]+)/i);
      let question = questionMatch ? questionMatch[1].trim() : undefined;
      const options = optionsMatch ? optionsMatch[1].trim() : undefined;
      if ((tool === "ask_question" || tool === "question") && !question) {
        const withoutTool = contentToScan.replace(/(?:tool|action)\s*:\s*[a-zA-Z_]+/i, "").trim();
        const cleanQuestion = withoutTool.replace(/options?\s*:\s*[^\r\n]+/i, "").trim();
        if (cleanQuestion) {
          question = cleanQuestion;
        }
      }
      const extractedFileName = fileNameMatch ? fileNameMatch[1].trim().replace(/^['"]|['"]$/g, "") : undefined;
      const extractedUrl = urlMatch ? urlMatch[1].trim().replace(/^['"]|['"]$/g, "") : undefined;
      const extractedAutoExec = autoExecMatch ? autoExecMatch[1].toLowerCase() === "true" : extractedFileName ? /\.(py|ts|js|mjs|ps1|sh|bat)$/i.test(extractedFileName) : undefined;
      const hasFields = pathMatch || fileNameMatch || urlMatch || startLineMatch || cmdMatch || contentMatch || oldStrMatch || newStrMatch || question;
      if (hasFields) {
        return {
          tool,
          path: pathMatch ? pathMatch[1].trim().replace(/^['"]|['"]$/g, "") : undefined,
          fileName: extractedFileName,
          downloadUrl: extractedUrl,
          autoExecute: extractedAutoExec,
          start_line: startLineMatch ? parseInt(startLineMatch[1], 10) : undefined,
          end_line: endLineMatch ? parseInt(endLineMatch[1], 10) : undefined,
          limit: limitMatch ? parseInt(limitMatch[1], 10) : undefined,
          command: cmdMatch ? cmdMatch[1].trim() : undefined,
          timeout: timeoutMatch ? parseInt(timeoutMatch[1], 10) : undefined,
          pattern: patternMatch ? patternMatch[1].trim() : undefined,
          content: contentMatch ? contentMatch[1].trim() : undefined,
          old_string: oldStrMatch ? oldStrMatch[1].trim() : undefined,
          new_string: newStrMatch ? newStrMatch[1].trim() : undefined,
          question,
          options,
          raw: trimmed
        };
      }
    }
    const firstLine = trimmed.split(`
`)[0].trim();
    const parts = firstLine.split(/\s+/);
    const candidateTool = this.normalizeToolName(parts[0].toLowerCase());
    if (candidateTool) {
      const remainder = trimmed.slice(parts[0].length).trim();
      switch (candidateTool) {
        case "read_file":
          return { tool: "read_file", path: parts[1], raw: trimmed };
        case "write_file": {
          const lines = trimmed.split(`
`);
          const targetPath = lines[0].replace(/^[a-zA-Z_]+\s+/, "").trim();
          const fileContent = lines.slice(1).join(`
`);
          return {
            tool: "write_file",
            path: targetPath,
            content: fileContent,
            raw: trimmed
          };
        }
        case "run_command":
          return { tool: "run_command", command: remainder, raw: trimmed };
        case "ask_question":
          return { tool: "ask_question", question: remainder, raw: trimmed };
      }
    }
    return null;
  }
  static parseSubagentsBlock(content) {
    const normalized = content.replace(/\r\n/g, `
`);
    const jsonArrayMatch = normalized.match(/subagents\s*:\s*(\[[\s\S]*\])/i);
    if (jsonArrayMatch) {
      try {
        const arr = JSON.parse(jsonArrayMatch[1]);
        if (Array.isArray(arr)) {
          return arr.map((s) => {
            let rawRole = s.role ? String(s.role).trim().toLowerCase() : "researcher";
            if (rawRole === "searcher")
              rawRole = "researcher";
            const role = rawRole === "coder" ? "coder" : "researcher";
            return {
              role,
              description: s.description ? String(s.description).trim() : "",
              prompt: s.prompt ? String(s.prompt).trim() : "",
              maxTurns: typeof s.maxTurns === "number" ? s.maxTurns : undefined,
              stage: Number(s.stage) || 1
            };
          });
        }
      } catch {}
    }
    const subagents = [];
    const blocks = (`
` + normalized).split(/\n\s*-\s+/);
    for (let i = 1;i < blocks.length; i++) {
      const block = blocks[i];
      const roleMatch = block.match(/role\s*:\s*([a-zA-Z_]+)/i);
      const descMatch = block.match(/description\s*:\s*([^\r\n]+)/i);
      const promptMatch = block.match(/prompt\s*:\s*([\s\S]*?)(?=\n\s*[a-zA-Z_]+\s*:|$)/i);
      const maxTurnsMatch = block.match(/maxTurns\s*:\s*(\d+)/i);
      const stageMatch = block.match(/(?:^|\n)\s*stage\s*:\s*(\d+)/i);
      if (roleMatch || promptMatch) {
        let rawRole = roleMatch ? roleMatch[1].trim().toLowerCase() : "researcher";
        if (rawRole === "searcher")
          rawRole = "researcher";
        const role = rawRole === "coder" ? "coder" : "researcher";
        subagents.push({
          role,
          description: descMatch ? descMatch[1].trim() : "",
          prompt: promptMatch ? promptMatch[1].trim() : "",
          maxTurns: maxTurnsMatch ? parseInt(maxTurnsMatch[1], 10) : undefined,
          stage: stageMatch ? parseInt(stageMatch[1], 10) : 1
        });
      }
    }
    return subagents;
  }
  static normalizeToolName(name) {
    switch (name.toLowerCase()) {
      case "read_file":
      case "read":
      case "cat":
        return "read_file";
      case "edit":
      case "edit_file":
      case "patch":
      case "patch_file":
        return "edit";
      case "write_file":
      case "write":
        return "write_file";
      case "run_command":
      case "bash":
      case "exec":
      case "sh":
        return "run_command";
      case "ask_question":
      case "ask_user":
      case "question":
        return "ask_question";
      case "invoke_subagent":
      case "subagent":
        return "invoke_subagent";
      case "file_porter":
      case "execute_file":
      case "porter":
        return "file_porter";
      default:
        return null;
    }
  }
}

// src/protocol/deliverables-parser.ts
import path14 from "node:path";
var SECTION_RE = /【交付文件与落盘指引\s*\/\s*Deliverables】|^#{1,3}\s*Deliverables\b/im;
var LINE_RE = /^\s*[-*]\s*`([^`]+)`\s*(?:<-|->|←|→|<=|=>|=>|:)\s*\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

class DeliverablesParser {
  static parse(raw) {
    if (!raw || !SECTION_RE.test(raw))
      return [];
    const items = [];
    const seen = new Set;
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(LINE_RE);
      if (!match)
        continue;
      const destination = match[1].trim().replace(/\\/g, "/");
      const url = match[3].trim();
      if (!/^https?:\/\//i.test(url))
        continue;
      if (!destination)
        continue;
      const normalized = path14.posix.normalize(destination);
      if (normalized.startsWith(".."))
        continue;
      if (path14.posix.isAbsolute(normalized))
        continue;
      if (normalized === ".")
        continue;
      const key = `${normalized}|${url}`;
      if (seen.has(key))
        continue;
      seen.add(key);
      let fallbackName = "download.bin";
      try {
        const lastSegment = new URL(url).pathname.split("/").filter(Boolean).pop();
        if (lastSegment)
          fallbackName = decodeURIComponent(lastSegment);
      } catch {}
      items.push({
        destinationPath: normalized,
        fileName: match[2].trim() || fallbackName,
        url,
        isZipTarget: normalized.toLowerCase().endsWith(".zip")
      });
    }
    return items;
  }
}

// src/delivery/landing-service.ts
class LandingService {
  workspaceRoot;
  filePorter;
  syncFile;
  constructor(opts) {
    this.workspaceRoot = opts.workspaceRoot;
    this.filePorter = opts.filePorter;
    this.syncFile = opts.syncFile;
  }
  async landDeliverables(items) {
    const landed = [];
    for (const item of items) {
      try {
        const isDirectory = item.destinationPath.endsWith("/");
        const result = await this.filePorter.deliverToWorkspace({
          downloadUrl: item.url,
          destinationPath: item.destinationPath,
          isDirectory,
          isZip: item.isZipTarget || isDirectory,
          fileName: item.fileName
        });
        for (const rel of result.landedFiles) {
          let cloudUrl;
          try {
            const sync = await this.syncFile(rel);
            cloudUrl = sync?.serverRelativeUrl;
          } catch {}
          landed.push({ relPath: rel, cloudUrl, status: "landed" });
        }
      } catch (err) {
        landed.push({
          relPath: item.destinationPath,
          status: "failed",
          error: String(err?.message || err)
        });
      }
    }
    const failed = landed.filter((item) => item.status === "failed").length;
    const status = landed.length === 0 || failed === 0 ? "ok" : failed === landed.length ? "failed" : "partial";
    return { landed, status };
  }
  static formatReceipt(result) {
    const ok = result.landed.filter((item) => item.status === "landed");
    const failed = result.landed.filter((item) => item.status === "failed");
    const lines = [];
    if (ok.length > 0) {
      lines.push(`已落盘 ${ok.length} 个交付文件` + (ok.some((item) => item.cloudUrl) ? `（其中 ${ok.filter((item) => item.cloudUrl).length} 个已同步云端）` : ""));
      for (const item of ok) {
        lines.push(item.cloudUrl ? `✔ 文件已落盘至本地: ${item.relPath}
✔ 已同步至云端工作区: ${item.cloudUrl}` : `✔ 文件已落盘至本地: ${item.relPath}`);
      }
    }
    if (failed.length > 0) {
      lines.push(`有 ${failed.length} 个交付文件落盘失败`);
      for (const item of failed) {
        lines.push(`✘ ${item.relPath}: ${item.error || "unknown error"}`);
      }
    }
    return lines.join(`
`);
  }
}

// src/agent/blackbox-compactor.ts
class BlackboxCompactor {
  static DEFAULT_PRESERVE_RECENT_TURNS = 2;
  static DEFAULT_MIN_SNAPSHOT_CHARS = 5000;
  static DEFAULT_MAX_SNAPSHOT_CHARS = 8000;
  static extractDisasterBlackbox(history, lastError, options = {}) {
    const preserveRecent = options.preserveRecentTurns ?? this.DEFAULT_PRESERVE_RECENT_TURNS;
    const minChars = options.minSnapshotChars ?? this.DEFAULT_MIN_SNAPSHOT_CHARS;
    const maxChars = options.maxSnapshotChars ?? this.DEFAULT_MAX_SNAPSHOT_CHARS;
    const isSkip = options.skipCompaction ?? false;
    const incidentTimeStr = options.incidentTime ? typeof options.incidentTime === "string" ? options.incidentTime : options.incidentTime.toISOString() : new Date().toISOString();
    const totalTurns = history.length;
    const cutoffIndex = isSkip ? 0 : Math.max(0, totalTurns - preserveRecent);
    const historicalTurns = isSkip ? [] : history.slice(0, cutoffIndex);
    const sceneTurns = isSkip ? history : history.slice(cutoffIndex);
    const totalRawChars = history.reduce((acc, t) => acc + (t.userInput?.length || 0) + (t.thought?.length || 0) + (t.toolOutput?.length || 0) + (typeof t.action === "string" ? t.action.length : JSON.stringify(t.action || "").length), 0);
    const diagnostic = this.analyzeIncident(lastError, history);
    const crashSceneSection = this.renderCrashScene(sceneTurns, isSkip);
    const rootPrompt = (options.rootUserPrompt ?? history[0]?.userInput ?? "").trim();
    const rootGoalSection = [
      "## 0. 战役终极北极星 (Root User Goal)",
      rootPrompt || "None (无原始用户输入记录)"
    ].join(`
`);
    let compactionStatusText = "";
    if (isSkip) {
      compactionStatusText = "未折叠 (免裁剪模式生效，保留完整自然历史)";
    } else if (totalTurns <= preserveRecent) {
      compactionStatusText = `无需折叠 (总轮数 ${totalTurns} <= ${preserveRecent} 轮，全保真展现)`;
    } else {
      compactionStatusText = `已折叠历史轮次 (前 ${historicalTurns.length} 轮已精炼压缩，保留末期 ${sceneTurns.length} 轮完整现场)`;
    }
    const headerTitle = "# \uD83D\uDEA8 事故现场黑匣子快照 (Disaster Recovery Blackbox Snapshot)";
    const metadataSection = [
      "## 1. 事故基础元数据 (Incident Metadata)",
      `- **触发时间 (Timestamp)**: ${incidentTimeStr}`,
      `- **总执行轮数 (Total Turns)**: ${totalTurns} 轮`,
      `- **最后异常信息 (Last Error)**: ${lastError ? lastError.trim() : "None (未捕获到显式异常)"}`,
      `- **折叠压缩状态 (Compaction Status)**: ${compactionStatusText}`
    ].join(`
`);
    const diagnosticSection = [
      "## 2. 事故特征诊断 (Incident Diagnostics)",
      `- **诊断分类 (Category)**: ${diagnostic.category}`,
      `- **特征研判 (Signature)**: ${diagnostic.signature}`,
      `- **建议处置 (Remediation)**: ${diagnostic.remediation}`
    ].join(`
`);
    const fixedDocWithoutTimeline = [
      headerTitle,
      rootGoalSection,
      metadataSection,
      diagnosticSection,
      crashSceneSection
    ].join(`

`);
    const fixedLength = fixedDocWithoutTimeline.length;
    const timelineSection = this.buildAdaptiveTimeline({
      historicalTurns,
      isSkip,
      totalTurns,
      preserveRecent,
      fixedLength,
      minChars,
      maxChars,
      totalRawChars
    });
    const finalDoc = [
      headerTitle,
      rootGoalSection,
      metadataSection,
      diagnosticSection,
      timelineSection,
      crashSceneSection
    ].join(`

`);
    return finalDoc.trim();
  }
  static extractSnapshot(history, options = {}) {
    return this.extractDisasterBlackbox(history, undefined, options);
  }
  static analyzeIncident(lastError, history) {
    const errText = (lastError || "").trim();
    const lastTurn = history && history.length > 0 ? history[history.length - 1] : undefined;
    const lastTurnErr = (lastTurn?.error || "").trim();
    const combined = `${errText} ${lastTurnErr}`.toLowerCase();
    const sanitized = combined.replace(/https?:\/\/[^\s]+|wss?:\/\/[^\s]+/g, "");
    if (/\b429\b|rate[- ]?limit|throttl|\bquota\s*(?:exceeded|reached|limit)\b|too many requests|配额已达上限|请求过于频繁/.test(sanitized)) {
      return {
        category: "429_RATE_LIMIT (上游频控限流)",
        signature: "检测到 Sydney 上游 429 频控限流或请求阈值溢出，会话被迫异常终止。",
        remediation: "当前账号立即进入 3 分钟冷却，自动轮换账号池下一健康账号，并通过 Handoff 仲裁者微会话完成交接接力。"
      };
    }
    if (/disconnect|connection closed|econnreset|broken pipe|socket hang up|timeout|abort|network/.test(combined)) {
      return {
        category: "CONNECTION_ABORTED (网络中断或连接重置)",
        signature: "检测到传输层 WebSocket / SignalR 双工连接非预期断开或超时中断。",
        remediation: "检查网络直连链路或刷新 Session/Token，准备无缝容灾重试。"
      };
    }
    if (/forbidden|unauthorized|gptaccessforbidden|gptnotavailable|access denied|permission/.test(combined)) {
      return {
        category: "ACCESS_RESTRICTED (智能体访问权限受限)",
        signature: "当前账号无权访问指定的专属 Agent (如 CPH-Dev) 或该智能体权限未激活。",
        remediation: "标记当前账号对该 Agent 不可用，自动轮换具有合法访问权限的已授权账号。"
      };
    }
    if (!errText && !lastTurnErr) {
      return {
        category: "NO_EXPLICIT_ERROR (无显式报错或优雅停机)",
        signature: "未捕获到显式异常调用栈，可能为主动中断或平稳交接场景。",
        remediation: "按标准交接流程读取末期案发现场，直接推进下一步行动。"
      };
    }
    return {
      category: "UNHANDLED_EXCEPTION (运行时未分类异常)",
      signature: `运行时捕获到未分类异常: ${errText || lastTurnErr}`,
      remediation: "审查末期案发现场中保留的完整错误堆栈并进行容灾仲裁。"
    };
  }
  static renderCrashScene(sceneTurns, isSkip) {
    const title = isSkip ? "## 4. 全量案发现场记录 (Full Scene Record: All Turns)" : `## 4. 末期案发现场 (Immediate Crash Scene: Recent ${sceneTurns.length} Turns)`;
    if (sceneTurns.length === 0) {
      return `${title}
*(无轮次记录)*`;
    }
    const renderedTurns = sceneTurns.map((t) => this.renderTurnDetail(t));
    return `${title}

${renderedTurns.join(`

`)}`;
  }
  static renderTurnDetail(t) {
    const lines = [`### Turn ${t.turn}`];
    if (t.userInput) {
      lines.push(`- **User**: ${t.userInput}`);
    } else {
      lines.push(`- **User**: (无输入)`);
    }
    if (t.thought) {
      lines.push(`- **Thought**: ${t.thought}`);
    } else {
      lines.push(`- **Thought**: (无思考链)`);
    }
    if (t.action) {
      const actionContent = typeof t.action === "string" ? t.action : JSON.stringify(t.action, null, 2);
      lines.push(`- **Action**:
\`\`\`json
${actionContent}
\`\`\``);
    } else if (t.toolName) {
      lines.push(`- **Tool**: \`${t.toolName}\``);
    } else {
      lines.push(`- **Tool**: (纯对话，无工具调用)`);
    }
    if (t.toolOutput !== undefined) {
      lines.push(`- **Tool Output**:
\`\`\`
${t.toolOutput}
\`\`\``);
    } else {
      lines.push(`- **Tool Output**: (无)`);
    }
    lines.push(`- **Status**: ${t.success !== false ? "SUCCESS" : "FAILED"}`);
    if (t.error) {
      lines.push(`- **Error**: ${t.error}`);
    }
    return lines.join(`
`);
  }
  static buildAdaptiveTimeline(params) {
    const {
      historicalTurns,
      isSkip,
      totalTurns,
      preserveRecent,
      fixedLength,
      minChars,
      maxChars,
      totalRawChars
    } = params;
    const header = historicalTurns.length > 0 ? `## 3. 历史轮次时间线摘要 (Historical Timeline Summary: Turns 1 ~ ${historicalTurns.length})` : "## 3. 历史轮次时间线摘要 (Historical Timeline Summary)";
    if (isSkip) {
      return `${header}
*免裁剪模式生效：历史记录未作折叠。*`;
    }
    if (totalTurns <= preserveRecent || historicalTurns.length === 0) {
      return `${header}
*无需折叠历史：当前总轮数 <= ${preserveRecent} 轮，所有轮次均在末期案发现场完整呈现。*`;
    }
    const candidateExcerptLengths = [300, 200, 150, 100, 60, 30, 0, -1];
    let bestLines = [];
    let bestTotalLen = Infinity;
    for (const excerptLen of candidateExcerptLengths) {
      const lines = historicalTurns.map((t) => this.formatTimelineItem(t, excerptLen));
      const timelineText = `${header}

${lines.join(`
`)}`;
      const totalEstimated = fixedLength + timelineText.length + 4;
      if (totalEstimated <= maxChars) {
        if (totalEstimated >= minChars || totalRawChars < minChars) {
          return timelineText;
        }
        if (bestLines.length === 0 || totalEstimated > bestTotalLen) {
          bestLines = lines;
          bestTotalLen = totalEstimated;
        }
      }
    }
    const ultraCompactLines = historicalTurns.map((t) => this.formatTimelineItem(t, -1));
    const rawTimelineText = `${header}

${ultraCompactLines.join(`
`)}`;
    const rawTotalEstimated = fixedLength + rawTimelineText.length + 4;
    if (rawTotalEstimated > maxChars) {
      const overflow = rawTotalEstimated - maxChars + 60;
      const avgLineLen = 48;
      const foldCount = Math.min(historicalTurns.length - 2, Math.max(1, Math.ceil(overflow / avgLineLen)));
      const foldedBlock = this.buildFoldedBlock(historicalTurns.slice(0, foldCount));
      const remainingLines = historicalTurns.slice(foldCount).map((t) => this.formatTimelineItem(t, -1));
      const adjustedLines = [foldedBlock, ...remainingLines];
      return `${header}

${adjustedLines.join(`
`)}`;
    }
    if (bestLines.length > 0) {
      return `${header}

${bestLines.join(`
`)}`;
    }
    return `${header}

${ultraCompactLines.join(`
`)}`;
  }
  static formatTimelineItem(t, excerptLen) {
    const tool = t.toolName || (typeof t.action === "object" && t.action?.tool ? t.action.tool : "conversation");
    const target = t.action?.path || t.action?.command || t.action?.query || t.action?.file || "";
    const status = t.success !== false ? "SUCCESS" : "FAILED";
    if (excerptLen < 0) {
      return `- Turn ${t.turn}: [${tool}]${target ? ` (${target})` : ""} -> ${status}`;
    }
    const parts = [
      `- Turn ${t.turn}: [${tool}]${target ? ` (${target})` : ""} -> ${status}`
    ];
    if (t.userInput) {
      const userPreview = t.userInput.length > 50 ? `${t.userInput.slice(0, 47)}...` : t.userInput;
      parts.push(`User: "${userPreview.replace(/\n/g, " ")}"`);
    }
    if (t.thought && excerptLen > 0) {
      const thoughtLimit = Math.min(excerptLen, 50);
      const thoughtPreview = t.thought.length > thoughtLimit ? `${t.thought.slice(0, thoughtLimit - 3)}...` : t.thought;
      parts.push(`Thought: "${thoughtPreview.replace(/\n/g, " ")}"`);
    }
    if (t.toolOutput && excerptLen > 0) {
      const lines = t.toolOutput.split(`
`).length;
      const totalChars = t.toolOutput.length;
      const preview = t.toolOutput.slice(0, excerptLen).replace(/\n/g, " ").trim();
      parts.push(`Output [~${lines}L/${totalChars}c]: ${preview}...`);
    } else if (t.toolOutput) {
      const lines = t.toolOutput.split(`
`).length;
      const totalChars = t.toolOutput.length;
      parts.push(`Output: [~${lines}L/${totalChars}c 折叠]`);
    }
    return parts.join(" | ");
  }
  static buildFoldedBlock(turns) {
    if (turns.length === 0)
      return "";
    const firstTurn = turns[0].turn;
    const lastTurn = turns[turns.length - 1].turn;
    const toolCounts = {};
    let successCount = 0;
    for (const t of turns) {
      const tool = t.toolName || (typeof t.action === "object" && t.action?.tool ? t.action.tool : "task");
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      if (t.success !== false)
        successCount++;
    }
    const toolsSummary = Object.entries(toolCounts).map(([name, count]) => `${name} x${count}`).join(", ");
    return `- Turns ${firstTurn} ~ ${lastTurn}: ${turns.length} 轮历史步骤已聚合折叠 (${toolsSummary}, 成功率: ${successCount}/${turns.length})`;
  }
}

// src/agent/compaction.ts
class CompactionService {
  static DEFAULT_PRESERVE_RECENT_TURNS = 2;
  static DEFAULT_MAX_CHARS = 500;
  static compactTurns(turns, options = {}) {
    const preserveRecent = options.preserveRecentTurns ?? this.DEFAULT_PRESERVE_RECENT_TURNS;
    const maxChars = options.maxToolResultChars ?? this.DEFAULT_MAX_CHARS;
    const totalTurns = turns.length;
    const cutoffIndex = Math.max(0, totalTurns - preserveRecent);
    let clearedCharsCount = 0;
    let totalOriginalHistoricalOutput = 0;
    const compactedTurns = turns.map((turn, index) => {
      if (index >= cutoffIndex) {
        return { ...turn };
      }
      if (turn.toolOutput) {
        const originalLen = turn.toolOutput.length;
        totalOriginalHistoricalOutput += originalLen;
        if (originalLen > maxChars) {
          const lineCount = turn.toolOutput.split(`
`).length;
          const summaryTag = `[Historical output cleared to preserve context budget (~${lineCount} lines / ${originalLen} chars)]`;
          const saved = originalLen - summaryTag.length;
          clearedCharsCount += saved;
          return {
            ...turn,
            toolOutput: summaryTag,
            isCompacted: true
          };
        }
      }
      return { ...turn };
    });
    const compressionRatio = totalOriginalHistoricalOutput > 0 ? clearedCharsCount / totalOriginalHistoricalOutput : 0;
    return {
      compactedTurns,
      clearedCharsCount,
      compressionRatio
    };
  }
  static compactToolResultString(toolName, output, isHistorical, maxChars = 500) {
    if (!isHistorical)
      return output;
    if (output.length <= maxChars)
      return output;
    const lineCount = output.split(`
`).length;
    return `[Historical output for ${toolName} cleared to preserve context budget (~${lineCount} lines / ${output.length} chars)]`;
  }
  static buildCompactedHistorySummary(turns, preserveRecent = 2) {
    const { compactedTurns } = this.compactTurns(turns, {
      preserveRecentTurns: preserveRecent
    });
    const lines = [];
    for (const t of compactedTurns) {
      lines.push(`### Turn ${t.turn}:`);
      if (t.userInput) {
        lines.push(`- **User**: ${t.userInput}`);
      }
      if (t.thought) {
        lines.push(`- **Thought**: ${t.thought}`);
      }
      if (t.toolName) {
        lines.push(`- **Tool**: \`${t.toolName}\` (${t.success ? "SUCCESS" : "FAILED"})`);
      }
      if (t.toolOutput) {
        lines.push(`- **Result**: ${t.toolOutput}`);
      }
      lines.push("");
    }
    return lines.join(`
`).trim();
  }
}

// src/agent/refusal-guard.ts
class RefusalGuard {
  static REFUSAL_PATTERNS = [
    /\/mnt\/data/i,
    /无法直接访问.*本地/i,
    /无法直接访问你.*盘/i,
    /无法直接访问.*盘/i,
    /无法访问.*本地/i,
    /看不到.*盘/i,
    /看不到该项目目录/i,
    /未发现项目目录/i,
    /上传.*(zip|压缩包|项目压缩包)/i,
    /请上传.*项目/i,
    /只能访问当前容器/i,
    /当前容器可见的文件系统/i,
    /缺少待审计项目源码/i,
    /无法读取你电脑上的/i,
    /请上传.*后再/i,
    /并未连接到.*Harness/i,
    /不能输出你要求的.*action/i,
    /并不存在.*Harness/i,
    /伪造.*文件读取/i,
    /无法按你(?:要求|提供)的.*(?:自定义)?(?:工具)?协议执行/i,
    /并非当前会话可调用的实际工具/i,
    /并非.*可调用的实际工具/i,
    /无法使用.*自定义工具/i,
    /工具并非当前会话/i,
    /并不存在用户所定义的/i,
    /并不存在.*TOOL_RESULT/i,
    /作为\s*AI[，,]\s*我无法/i,
    /我无法直接在你的计算机上运行/i,
    /我没有权限访问你的本地文件/i,
    /无法执行系统命令/i,
    /我无法访问本地文件系统/i,
    /I cannot (?:directly )?access (?:your )?local/i,
    /I don't have access to (?:your )?local/i,
    /cannot access.*drive/i,
    /cannot directly access.*file/i,
    /please upload (?:a )?(?:zip|file|archive|project)/i,
    /I am unable to run commands on your (?:machine|computer)/i,
    /I do not have access to your (?:file system|computer|machine)/i,
    /tools? (?:is|are) not (?:available|supported|valid)/i,
    /no such tool exists/i,
    /not a valid tool available/i,
    /I cannot execute bash commands/i,
    /as an ai(?: language model)?[,.] I cannot/i,
    /I cannot interact with your local environment/i
  ];
  static detectRefusal(text) {
    const trimmed = (text || "").trim();
    if (/```(?:action|json)?[\s\S]*?```/i.test(trimmed) || /tool\s*:\s*[a-zA-Z_]+/i.test(trimmed) || /"(?:tool|action)"\s*:\s*"[a-zA-Z_]+"/i.test(trimmed)) {
      return false;
    }
    if (/FINAL_?ANSWER\b:?/i.test(trimmed) || trimmed.includes("ALL_TASKS_COMPLETED") || trimmed.includes("【已完成交付】")) {
      return false;
    }
    return this.REFUSAL_PATTERNS.some((pattern) => pattern.test(trimmed));
  }
  static buildCorrectionPrompt(options = {}) {
    const candidateFile = options.candidateFile || "package.json";
    const tool = options.toolName || (options.candidateFile ? "read_file" : "run_command");
    let actionBlock;
    if (tool === "read_file") {
      actionBlock = `\`\`\`action
tool: read_file
path: ${candidateFile}
start_line: 1
end_line: 50
\`\`\``;
    } else {
      actionBlock = `\`\`\`action
tool: run_command
command: git status
\`\`\``;
    }
    return `【本地执行环境纠偏指令】
本地宿主机已完全接入 CPH-PI 真实物理执行通道，你拥有完全合法的本地物理磁盘读取与命令执行权限。
无需用户上传压缩包，也无需询问容器沙盒限制。
请立即输出标准 \`\`\`action 块执行下一步：
${actionBlock}
本地执行结果将即刻回填反馈给你。`;
  }
  static shouldRetry(attempt, maxRetries = 3) {
    return attempt < maxRetries;
  }
  static getRetryStrategy(attempt, options = {}) {
    const shouldSwitchAccount = attempt >= 3;
    const rewrittenPrompt = this.buildCorrectionPrompt(options);
    return {
      shouldSwitchAccount,
      rewrittenPrompt
    };
  }
}

// src/ui/terminal-logger.ts
import fs10 from "node:fs";
import path15 from "node:path";
function stripAnsi(str) {
  if (!str)
    return "";
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

class TerminalLogger {
  static instance;
  logFilePath;
  stream;
  originalStdoutWrite;
  originalStderrWrite;
  isHooked = false;
  lastMatrixSummary;
  static isTuiMatrixRedrawFrame(text) {
    if (!text)
      return false;
    return text.includes("多会话子代理协同看板") || text.includes("Sub-Agent Matrix");
  }
  static getInstance() {
    if (!TerminalLogger.instance) {
      TerminalLogger.instance = new TerminalLogger;
    }
    return TerminalLogger.instance;
  }
  initSessionTree(sessionId, workspaceRoot) {
    const root = workspaceRoot || process.cwd();
    const cleanSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sessionDir = path15.join(root, ".cph", "logs", cleanSessionId);
    const subagentsDir = path15.join(sessionDir, "subagents");
    fs10.mkdirSync(subagentsDir, { recursive: true });
    const mainLogPath = path15.join(sessionDir, "main.log");
    if (!fs10.existsSync(mainLogPath)) {
      fs10.writeFileSync(mainLogPath, `=== [CPH-PI Main Session Log: ${sessionId}] ===
`, "utf8");
    }
    const timelineLogPath = path15.join(sessionDir, "timeline.jsonl");
    return {
      sessionDir,
      mainLogPath,
      timelineLogPath,
      createSubagentLogStream: (subagentId, role) => {
        const cleanId = subagentId.replace(/[^a-zA-Z0-9_-]/g, "_");
        const cleanRole = role.replace(/[^a-zA-Z0-9_-]/g, "_");
        const subLogPath = path15.join(subagentsDir, `${cleanId}-${cleanRole}.log`);
        const stream = fs10.createWriteStream(subLogPath, { flags: "a", encoding: "utf8" });
        stream.write(`=== [CPH-PI Subagent Log: ${subagentId} (${role})] ===
`);
        return stream;
      },
      logTimelineEvent: (event) => {
        const line = JSON.stringify({ ...event, timestamp: event.timestamp || Date.now() }) + `
`;
        try {
          fs10.appendFileSync(timelineLogPath, line, "utf8");
        } catch {}
      }
    };
  }
  resolveDefaultLogPath(workspaceRoot) {
    const root = workspaceRoot || process.cwd();
    const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const logDir = path15.join(root, ".cph", "logs");
    try {
      fs10.mkdirSync(logDir, { recursive: true });
    } catch {}
    return path15.join(logDir, `cph-terminal-${dateStr}.log`);
  }
  start(options = {}) {
    if (this.isHooked && this.logFilePath) {
      return this.logFilePath;
    }
    const targetPath = options.logFilePath || this.resolveDefaultLogPath(options.workspaceRoot);
    const resolvedPath = path15.resolve(targetPath);
    try {
      const parentDir = path15.dirname(resolvedPath);
      fs10.mkdirSync(parentDir, { recursive: true });
      this.stream = fs10.createWriteStream(resolvedPath, {
        flags: "a",
        encoding: "utf8"
      });
    } catch (err) {
      process.stderr.write(`[TerminalLogger Error] 无法创建日志文件: ${err.message}
`);
      return resolvedPath;
    }
    this.logFilePath = resolvedPath;
    this.lastMatrixSummary = undefined;
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk, encodingOrCb, cb) => {
      const ret = this.originalStdoutWrite(chunk, encodingOrCb, cb);
      this.writeToLog(chunk);
      return ret;
    };
    process.stderr.write = (chunk, encodingOrCb, cb) => {
      const ret = this.originalStderrWrite(chunk, encodingOrCb, cb);
      this.writeToLog(chunk);
      return ret;
    };
    this.isHooked = true;
    this.stream.write(`
=== [CPH-PI Terminal Log Started at ${new Date().toISOString()}] ===
`);
    return resolvedPath;
  }
  stop() {
    if (!this.isHooked)
      return;
    if (this.originalStdoutWrite) {
      process.stdout.write = this.originalStdoutWrite;
      this.originalStdoutWrite = undefined;
    }
    if (this.originalStderrWrite) {
      process.stderr.write = this.originalStderrWrite;
      this.originalStderrWrite = undefined;
    }
    if (this.stream) {
      try {
        this.stream.write(`=== [CPH-PI Terminal Log Closed at ${new Date().toISOString()}] ===

`);
        this.stream.end();
      } catch {}
      this.stream = undefined;
    }
    this.isHooked = false;
    this.logFilePath = undefined;
    this.lastMatrixSummary = undefined;
  }
  isEnabled() {
    return this.isHooked;
  }
  getLogFilePath() {
    return this.logFilePath;
  }
  writeToLog(chunk) {
    if (!this.stream || !this.isHooked)
      return;
    try {
      const text = typeof chunk === "string" ? chunk : chunk?.toString("utf8") || "";
      const cleaned = stripAnsi(text);
      if (!cleaned)
        return;
      if (TerminalLogger.isTuiMatrixRedrawFrame(cleaned)) {
        this.writeCompressedMatrixFrame(cleaned);
        return;
      }
      this.stream.write(cleaned);
    } catch {}
  }
  writeCompressedMatrixFrame(cleaned) {
    if (!this.stream)
      return;
    const lines = cleaned.split(/\r?\n/);
    const subagentEvents = [];
    for (let i = 0;i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("│ [Sub-") || line.startsWith("│ [sub-")) {
        let entry = line.replace(/^│\s*/, "");
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.startsWith("│") && (nextLine.includes("最新动作") || nextLine.includes("└─"))) {
            const actionText = nextLine.replace(/^│\s*(?:└─\s*)?/, "");
            entry += ` | ${actionText}`;
            i++;
          }
        }
        subagentEvents.push(entry);
      }
    }
    const summary = subagentEvents.length > 0 ? `[Subagent Matrix Sync] ${subagentEvents.join(" ; ")}` : `[Subagent Matrix Sync] 协同看板状态刷新`;
    if (this.lastMatrixSummary === summary) {
      return;
    }
    this.lastMatrixSummary = summary;
    this.stream.write(`${summary}
`);
  }
}

// src/session/lineage-tracker.ts
class SessionLineageTracker {
  registry = new Map;
  register(lineage) {
    const existing = this.registry.get(lineage.sessionId);
    this.registry.set(lineage.sessionId, {
      ...existing,
      ...lineage,
      subagentSessionIds: lineage.subagentSessionIds || existing?.subagentSessionIds || []
    });
  }
  linkSuccessor(predecessorId, successorId) {
    const pred = this.registry.get(predecessorId);
    if (pred) {
      pred.successorId = successorId;
      pred.status = "handed_off";
    }
    const succ = this.registry.get(successorId);
    if (succ) {
      succ.predecessorId = predecessorId;
    }
  }
  linkSubagent(mainSessionId, subagentSessionId) {
    const main = this.registry.get(mainSessionId);
    if (main) {
      if (!main.subagentSessionIds)
        main.subagentSessionIds = [];
      if (!main.subagentSessionIds.includes(subagentSessionId)) {
        main.subagentSessionIds.push(subagentSessionId);
      }
    }
    const sub = this.registry.get(subagentSessionId);
    if (sub) {
      sub.parentSessionId = mainSessionId;
    }
  }
  getLineage(sessionId) {
    return this.registry.get(sessionId);
  }
  getGenerationInfo(sessionId) {
    let generation = 1;
    const predecessorIds = [];
    const visited = new Set;
    let currentId = sessionId;
    visited.add(currentId);
    while (currentId) {
      const lineage = this.registry.get(currentId);
      if (!lineage || !lineage.predecessorId)
        break;
      if (visited.has(lineage.predecessorId))
        break;
      predecessorIds.push(lineage.predecessorId);
      visited.add(lineage.predecessorId);
      generation++;
      currentId = lineage.predecessorId;
    }
    const genMatch = sessionId.match(/_gen(\d+)$/);
    if (genMatch) {
      const parsedGen = parseInt(genMatch[1], 10);
      if (!isNaN(parsedGen) && parsedGen > generation) {
        generation = parsedGen;
      }
    }
    const hopMatch = sessionId.match(/_hop(\d+)$/);
    if (hopMatch) {
      const parsedHop = parseInt(hopMatch[1], 10);
      if (!isNaN(parsedHop) && parsedHop > generation) {
        generation = parsedHop;
      }
    }
    return {
      generation,
      handoffCount: Math.max(0, generation - 1),
      predecessorIds
    };
  }
  getHandoffCount(sessionId) {
    return this.getGenerationInfo(sessionId).handoffCount;
  }
  resolveActiveHead(startSessionId) {
    let currentId = startSessionId;
    const visited = new Set;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const lineage = this.registry.get(currentId);
      if (!lineage)
        break;
      if (lineage.successorId && lineage.status === "handed_off") {
        currentId = lineage.successorId;
      } else {
        break;
      }
    }
    return currentId;
  }
}

// src/session/main-plan-snapshot.ts
import fs12 from "node:fs";
import path17 from "node:path";

// src/session/ledger/execution-ledger.ts
import fs11 from "node:fs";
import path16 from "node:path";

class ExecutionLedger {
  workspaceRoot;
  stateDir;
  jsonlPath;
  mdPath;
  currentStepIndex = 0;
  cachedEntries = [];
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.stateDir = path16.join(this.workspaceRoot, ".cph", "state");
    this.jsonlPath = path16.join(this.stateDir, "execution-ledger.jsonl");
    this.mdPath = path16.join(this.stateDir, "execution-ledger.md");
    this.initFromDisk();
  }
  getPaths() {
    return {
      jsonlPath: this.jsonlPath,
      mdPath: this.mdPath
    };
  }
  initFromDisk() {
    try {
      if (!fs11.existsSync(this.stateDir)) {
        fs11.mkdirSync(this.stateDir, { recursive: true });
      }
      if (fs11.existsSync(this.jsonlPath)) {
        const lines = fs11.readFileSync(this.jsonlPath, "utf8").split(`
`).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            this.cachedEntries.push(entry);
            if (entry.stepIndex > this.currentStepIndex) {
              this.currentStepIndex = entry.stepIndex;
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error(`[ExecutionLedger] 初始化读取异常:`, err);
    }
  }
  recordStep(input) {
    this.currentStepIndex += 1;
    const entry = {
      ...input,
      stepIndex: this.currentStepIndex,
      timestamp: Date.now(),
      briefSummary: (input.briefSummary || "").slice(0, 300)
    };
    this.cachedEntries.push(entry);
    try {
      if (!fs11.existsSync(this.stateDir)) {
        fs11.mkdirSync(this.stateDir, { recursive: true });
      }
      fs11.appendFileSync(this.jsonlPath, JSON.stringify(entry) + `
`, "utf8");
      this.writeMarkdownView();
    } catch (err) {
      console.error(`[ExecutionLedger] 账本落盘告警:`, err);
    }
    return entry;
  }
  getLatestEntries(limit) {
    if (limit && limit > 0) {
      return this.cachedEntries.slice(-limit);
    }
    return [...this.cachedEntries];
  }
  formatMountHeader() {
    const totalSteps = this.currentStepIndex;
    const modifiedFiles = new Set;
    let latestBadge = "NONE";
    for (const e of this.cachedEntries) {
      if (e.modifiedFiles && Array.isArray(e.modifiedFiles)) {
        for (const f of e.modifiedFiles) {
          modifiedFiles.add(f);
        }
      }
      if (e.statusBadge) {
        latestBadge = e.statusBadge;
      }
    }
    const filesSummary = modifiedFiles.size > 0 ? `[${Array.from(modifiedFiles).slice(0, 5).join(", ")}${modifiedFiles.size > 5 ? `, ...+${modifiedFiles.size - 5}` : ""}]` : "无";
    const relativeMdPath = path16.relative(this.workspaceRoot, this.mdPath).replace(/\\/g, "/");
    return [
      `【系统物理执行账本已挂载】`,
      `- 账本路径: ${relativeMdPath || ".cph/state/execution-ledger.md"}`,
      `- 累计物理操作: ${totalSteps} 步 | 核心变更文件: ${filesSummary}`,
      `- 最新验证状态: ${latestBadge}`,
      `- 查阅契约: 上述客观事实已由系统物理验证。如需回溯某一步的详细改动或命令输出，请使用 read_file / view_file 工具定向查看账本文件，通过调阅物理账本或关键指纹获取执行事实。`
    ].join(`
`);
  }
  writeMarkdownView() {
    const header = [
      `# CPH 物理执行账本 (Execution Ledger)`,
      `- 更新时间: ${new Date().toISOString()}`,
      `- 累计物理步骤: ${this.currentStepIndex} 步`,
      ``,
      `| 步数 | 角色 | 工具 | 目标/动作 | 状态 | 关键指标/结果 |`,
      `|---|---|---|---|---|---|`
    ];
    const rows = this.cachedEntries.map((e) => {
      const cleanTarget = (e.target || "-").replace(/\|/g, "\\|").slice(0, 50);
      const cleanBadge = (e.statusBadge || e.briefSummary || "-").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 60);
      return `| ${e.stepIndex} | ${e.role} | ${e.tool} | ${cleanTarget} | ${e.status} | ${cleanBadge} |`;
    });
    const content = header.concat(rows).join(`
`) + `
`;
    fs11.writeFileSync(this.mdPath, content, "utf8");
  }
}

// src/session/main-plan-snapshot.ts
function createMainPlanSnapshot(params) {
  return {
    snapshotId: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    originalSessionId: params.originalSessionId,
    originalTask: params.originalTask,
    thought: params.thought || "",
    workspaceRoot: params.workspaceRoot,
    gitBaseline: params.gitBaseline || "HEAD",
    plannedSubagents: params.plannedSubagents || [],
    createdAt: Date.now()
  };
}
function saveMainPlanSnapshot(snapshot, workspaceRoot) {
  const handoffsDir = path17.join(workspaceRoot, ".cph", "handoffs");
  fs12.mkdirSync(handoffsDir, { recursive: true });
  const cleanId = snapshot.originalSessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const jsonPath = path17.join(handoffsDir, `main-plan-${cleanId}.json`);
  const mdPath = path17.join(handoffsDir, `main-plan-${cleanId}.md`);
  fs12.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), "utf8");
  const mdContent = `# 主控规划快照: ${snapshot.snapshotId}

- **前序会话**: ${snapshot.originalSessionId}
- **生成时间**: ${new Date(snapshot.createdAt).toISOString()}
- **Git 基准**: ${snapshot.gitBaseline}

## 1. 原始工程任务
${snapshot.originalTask}

## 2. 前序主控推演与架构思考
${snapshot.thought || "（无额外思考推演）"}

## 3. 本次派发的专项子任务 (${snapshot.plannedSubagents.length} 个)
${snapshot.plannedSubagents.map((sub, idx) => `### 子任务 ${idx + 1}: [${sub.role || "unknown"}] ${sub.description || ""}
- **Prompt**:
\`\`\`text
${sub.prompt || ""}
\`\`\`
`).join(`
`)}
`;
  fs12.writeFileSync(mdPath, mdContent, "utf8");
  return { jsonPath, mdPath };
}
function formatSuccessorTurn1Prompt(snapshot, reportsSummary, customLedgerMountHeader, concurrencyWorkers, dirSkeleton) {
  let mountHeader = customLedgerMountHeader;
  if (!mountHeader && snapshot.workspaceRoot) {
    try {
      const ledger = new ExecutionLedger(snapshot.workspaceRoot);
      mountHeader = ledger.formatMountHeader();
    } catch {}
  }
  const mountSection = mountHeader ? `
### 2. 物理执行账本挂载 (Pass-by-Reference)
${mountHeader}
` : "";
  const clusterFact = concurrencyWorkers !== undefined && concurrencyWorkers > 0 ? `
- **并发集群容量**: ${concurrencyWorkers} 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)` : "";
  const wsNorm = snapshot.workspaceRoot ? snapshot.workspaceRoot.replace(/\\/g, "/") : "";
  const workspaceFact = wsNorm ? `
- **工作区绝对路径**: ${wsNorm}` : "";
  const skeletonFact = dirSkeleton && dirSkeleton.trim() !== "" ? `

【工作区受控目录骨架 (2-Level Skeleton)】
${dirSkeleton.trim()}` : "";
  const virtualRepoMap = snapshot.workspaceRoot ? PnPWorkspaceSyncEngine.readVirtualRepoMap(snapshot.workspaceRoot) : undefined;
  const repoMapFact = virtualRepoMap && virtualRepoMap.trim() !== "" ? `

${virtualRepoMap.trim()}` : "";
  return `【主控接力与成果审阅】
前序主控会话已完成工程规划并调度专项子代理完成了攻坚。系统已在本地持久化前序规划快照。

【本地宿主机工作区事实】${workspaceFact}${clusterFact}${skeletonFact}${repoMapFact}

### 1. 原始工程目标与规划思路
- **原始目标**:
${snapshot.originalTask}

- **前序推演与架构思绪**:
${snapshot.thought || "按既定规范开展模块化调研与修改。"}${mountSection}
### 3. 子任务攻坚结题成果
${reportsSummary}

---
请你作为后继主控智能体，以当前全新满额的推理配额，推进工程对账与收敛：
1. 【对账打勾】：根据上述各子任务结题成果，使用 patch_file 立即将 plan.md 中已成功的任务项更新打勾为 - [x] 步骤描述；
2. 【成果引用】：完整调研报告与证据链已由底层自动落盘至物理报告文件（.cph/reports/），若需回溯执行细节可按需调阅已挂载的物理账本或使用 read_file 调阅；
3. 【局部补缺】：若存在未成功的子任务，仅对该失败项进行单点定向重试或补充派发，保护已完成的规划与成果；
4. 【自闭环攻坚心智】：你正处于既定工程战役的收敛攻坚阶段，工作区已具备明确的战役目标与 plan.md 待办项。请直接基于上述成果与物理事实推进对账或补缺派发，优先基于受控目录骨架定位真实文件路径展开工作，无需中断执行向用户重问初始需求；
5. 【终局结题】：只有当 plan.md 中所有规划项均已达成 (- [x]) 且全部验证通过时，输出 FINAL_ANSWER 完成结题。`;
}

// src/agent/orchestrator.ts
function isInlineScoutTask(subagents) {
  if (!Array.isArray(subagents) || subagents.length !== 1) {
    return false;
  }
  const task = subagents[0];
  if (!task || typeof task !== "object") {
    return false;
  }
  const role = String(task.role || "").trim().toLowerCase();
  if (role !== "researcher" && role !== "searcher") {
    return false;
  }
  if (task.isScout === true || task.isScout === "true") {
    return true;
  }
  const scoutRegex = /scout|斥候|大纲|架构探查|结构梳理/i;
  const desc = typeof task.description === "string" ? task.description : "";
  const prompt = typeof task.prompt === "string" ? task.prompt : "";
  const title = typeof task.title === "string" ? task.title : "";
  const extraTask = typeof task.task === "string" ? task.task : "";
  return scoutRegex.test(desc) || scoutRegex.test(prompt) || scoutRegex.test(title) || scoutRegex.test(extraTask);
}

class Orchestrator {
  workspaceRoot;
  maxTurns;
  maxRefusalRetries;
  modelTone;
  pool;
  bridge;
  chatClient;
  arbitratorChatClient;
  chatClientFactory;
  activeSkills;
  skillRegistry;
  customAgentId;
  coderAgentId;
  researcherAgentId;
  subagentRunner;
  enableInSessionCompaction = false;
  graphTokenProvider;
  enableCloudAttachment = true;
  cloudAttachmentThresholdChars = 12000;
  cloudAttachmentThresholdLines = 200;
  lineageTracker;
  generation = 1;
  maxGenerations;
  enableWorkspaceSnapshot;
  enableWorkspaceCatalog;
  enableAutoLanding;
  autoLandingService;
  lastNextSnapshotMeta;
  lastModifiedFile;
  activeAccountEmail = "";
  isHandshakePending = true;
  pendingTask = "";
  pendingSkills = "";
  conversationId = crypto7.randomUUID();
  sessionId;
  lastHandoffDocPath;
  constructor(options = {}) {
    this.workspaceRoot = path18.resolve(options.workspaceRoot || process.cwd());
    this.maxTurns = options.maxTurns ?? 30;
    this.maxGenerations = options.maxGenerations ?? 50;
    this.maxRefusalRetries = options.maxRefusalRetries ?? 3;
    this.modelTone = options.modelTone ?? "Gpt_61_Sol_Reasoning";
    this.pool = options.pool;
    this.bridge = options.bridge || new ToolBridge(this.workspaceRoot);
    this.chatClient = options.chatClient || options.client;
    this.arbitratorChatClient = options.arbitratorChatClient;
    this.chatClientFactory = options.chatClientFactory;
    this.activeSkills = options.activeSkills;
    this.skillRegistry = options.skillRegistry;
    this.customAgentId = options.customAgentId;
    this.coderAgentId = options.coderAgentId;
    this.researcherAgentId = options.researcherAgentId;
    this.subagentRunner = options.subagentRunner;
    this.sessionId = options.sessionId || crypto7.randomUUID();
    this.enableInSessionCompaction = options.enableInSessionCompaction ?? false;
    this.graphTokenProvider = options.graphTokenProvider;
    this.enableCloudAttachment = options.enableCloudAttachment ?? true;
    this.cloudAttachmentThresholdChars = options.cloudAttachmentThresholdChars !== undefined ? options.cloudAttachmentThresholdChars : 12000;
    this.cloudAttachmentThresholdLines = options.cloudAttachmentThresholdLines !== undefined ? options.cloudAttachmentThresholdLines : 200;
    this.lineageTracker = options.lineageTracker || new SessionLineageTracker;
    this.enableWorkspaceSnapshot = options.enableWorkspaceSnapshot ?? false;
    this.enableWorkspaceCatalog = options.enableWorkspaceCatalog ?? true;
    this.enableAutoLanding = options.enableAutoLanding ?? true;
    this.autoLandingService = options.autoLandingService;
    this.isHandshakePending = options.isHandshakePending !== undefined ? options.isHandshakePending : !this.customAgentId;
  }
  getLastNextSnapshotMeta() {
    return this.lastNextSnapshotMeta;
  }
  getCurrentGitBranch() {
    if (!this.workspaceRoot)
      return "main";
    try {
      return execSync3("git rev-parse --abbrev-ref HEAD", {
        cwd: this.workspaceRoot,
        stdio: ["ignore", "pipe", "ignore"]
      }).toString("utf-8").trim();
    } catch {
      return "main";
    }
  }
  getCloudAttachmentThresholds() {
    return {
      chars: this.cloudAttachmentThresholdChars,
      lines: this.cloudAttachmentThresholdLines
    };
  }
  getLineageTracker() {
    return this.lineageTracker;
  }
  getGeneration() {
    return this.generation;
  }
  getHandoffCount() {
    return Math.max(0, this.generation - 1);
  }
  getConcurrencyWorkerCount() {
    if (!this.pool)
      return;
    try {
      const statuses = this.pool.getPoolStatus();
      const allowed = this.pool.getAllowedAccounts();
      const allowedStatuses = allowed !== undefined && allowed.length > 0 ? statuses.filter((s) => s.isAllowed !== false) : statuses;
      return allowedStatuses.length > 0 ? allowedStatuses.length : undefined;
    } catch {
      return;
    }
  }
  linkSuccessor(oldId, newId) {
    this.lineageTracker.register({
      sessionId: newId,
      role: "main",
      status: "active",
      predecessorId: oldId
    });
    this.lineageTracker.linkSuccessor(oldId, newId);
  }
  async acquireGraphToken() {
    if (this.graphTokenProvider) {
      try {
        return await this.graphTokenProvider();
      } catch {
        return;
      }
    }
    if (this.pool && typeof this.pool.getGraphAccessToken === "function") {
      try {
        return await this.pool.getGraphAccessToken();
      } catch {
        return;
      }
    }
    return;
  }
  getWorkspaceRoot() {
    return this.workspaceRoot;
  }
  async acquireIc3Token(email) {
    if (this.pool && typeof this.pool.getIc3AccessToken === "function") {
      try {
        return await this.pool.getIc3AccessToken(email);
      } catch {
        return;
      }
    }
    return;
  }
  resolveCloudTarget() {
    const manifestPath = path18.join(this.workspaceRoot, ".cph", "state", "sync-manifest.json");
    const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
    return {
      siteUrl: manifest?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL,
      targetFolder: manifest?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER
    };
  }
  buildLandingService(accountEmail) {
    if (this.autoLandingService)
      return this.autoLandingService;
    const target = this.resolveCloudTarget();
    return new LandingService({
      workspaceRoot: this.workspaceRoot,
      filePorter: new FilePorter({
        cwd: this.workspaceRoot,
        ic3TokenProvider: () => this.acquireIc3Token(accountEmail)
      }),
      syncFile: async (rel) => {
        const result = await new PnPWorkspaceSyncEngine().syncFile(this.workspaceRoot, rel, target.targetFolder, { siteUrl: target.siteUrl });
        return { status: result.status, serverRelativeUrl: result.serverRelativeUrl };
      }
    });
  }
  async ensureWorkspaceCatalogAttachment(accountEmail) {
    if (!this.workspaceRoot)
      return null;
    const { markdown } = PnPWorkspaceSyncEngine.generateCatalogMarkdown(this.workspaceRoot);
    const catalogPath = path18.join(this.workspaceRoot, ".cph", "state", "remote-workspace-catalog.md");
    fs13.mkdirSync(path18.dirname(catalogPath), { recursive: true });
    fs13.writeFileSync(catalogPath, markdown, "utf8");
    const hash = crypto7.createHash("sha256").update(markdown.replace(/^- 生成时间: .*$/m, "")).digest("hex");
    const cacheFile = path18.join(this.workspaceRoot, ".cph", "state", "workspace-catalog-cache.json");
    let cache = { entries: {} };
    if (fs13.existsSync(cacheFile)) {
      try {
        const parsed = JSON.parse(fs13.readFileSync(cacheFile, "utf-8"));
        if (parsed && typeof parsed === "object")
          cache = parsed;
      } catch {
        cache = { entries: {} };
      }
    }
    if (!cache.entries || typeof cache.entries !== "object")
      cache.entries = {};
    const key = (accountEmail || "default").toLowerCase();
    const cached = cache.entries[key];
    if (cached && cached.hash === hash && cached.uploadResult?.annotation) {
      return cached.uploadResult;
    }
    const graphToken = await this.acquireGraphToken();
    if (!graphToken) {
      throw new Error("No Graph access token available for workspace catalog upload");
    }
    const uploadResult = await SubstrateUploader.uploadDocumentToOneDrive(graphToken, markdown, "remote-workspace-catalog.md");
    cache.entries[key] = {
      hash,
      uploadResult,
      updatedAt: new Date().toISOString()
    };
    fs13.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf8");
    return uploadResult;
  }
  writeDeliveryReport(result, source) {
    try {
      const stateDir = path18.join(this.workspaceRoot, ".cph", "state");
      fs13.mkdirSync(stateDir, { recursive: true });
      fs13.writeFileSync(path18.join(stateDir, "delivery-report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), source, ...result }, null, 2), "utf8");
    } catch {}
  }
  async deliverWriteFileFromUrl(action) {
    const targetPath = action.path || action.filePath || action.file || action.targetPath;
    const url = action.url || action.downloadUrl;
    if (!targetPath || !url) {
      return {
        actionName: "write_file",
        piToolName: "write",
        target: String(targetPath || ""),
        success: false,
        output: "write_file 需要同时提供 path 与 url。",
        formatted: "write_file 需要同时提供 path 与 url。"
      };
    }
    try {
      const accountEmail = this.activeAccountEmail;
      const landing = this.buildLandingService(accountEmail);
      const result = await landing.landDeliverables([
        {
          destinationPath: String(targetPath).replace(/\\/g, "/"),
          fileName: path18.basename(String(targetPath)),
          url: String(url),
          isZipTarget: String(targetPath).toLowerCase().endsWith(".zip")
        }
      ]);
      this.writeDeliveryReport(result, `write_file:${targetPath}`);
      const receipt = LandingService.formatReceipt(result);
      return {
        actionName: "write_file",
        piToolName: "write",
        target: String(targetPath),
        success: result.status !== "failed",
        output: receipt,
        formatted: receipt
      };
    } catch (err) {
      const message = `文件链接落盘失败: ${String(err?.message || err)}`;
      return {
        actionName: "write_file",
        piToolName: "write",
        target: String(targetPath),
        success: false,
        output: message,
        formatted: message
      };
    }
  }
  setWorkspaceRoot(newRoot, skillRegistry) {
    this.workspaceRoot = path18.resolve(newRoot);
    if (this.bridge && typeof this.bridge.setCwd === "function") {
      this.bridge.setCwd(this.workspaceRoot);
    } else {
      this.bridge = new ToolBridge(this.workspaceRoot);
    }
    if (skillRegistry) {
      this.skillRegistry = skillRegistry;
    } else {
      this.skillRegistry = new SkillRegistry(new SkillLoader(this.workspaceRoot));
      try {
        this.skillRegistry.loadSkills();
      } catch {}
    }
    this.activeSkills = this.skillRegistry.getActiveSkills();
  }
  getSessionId() {
    return this.sessionId;
  }
  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }
  getLastHandoffDocPath() {
    return this.lastHandoffDocPath;
  }
  getBridge() {
    return this.bridge;
  }
  getActiveSkills() {
    return this.activeSkills;
  }
  setActiveSkills(skills) {
    this.activeSkills = skills;
  }
  getIsHandshakePending() {
    return this.isHandshakePending;
  }
  completeHandshake() {
    this.isHandshakePending = false;
  }
  setHandshakePending(pending) {
    this.isHandshakePending = pending;
  }
  getCustomAgentId() {
    return this.customAgentId;
  }
  setCustomAgentId(agentId) {
    this.customAgentId = agentId;
    this.isHandshakePending = !agentId;
  }
  resetHandshake() {
    this.isHandshakePending = !this.customAgentId;
    this.pendingTask = "";
    this.pendingSkills = "";
    this.conversationId = crypto7.randomUUID();
    this.sessionId = crypto7.randomUUID();
    this.generation = 1;
    this.lastHandoffDocPath = undefined;
  }
  formatSkillsSection(skills) {
    if (!skills)
      return "";
    if (typeof skills === "string")
      return skills;
    if (Array.isArray(skills)) {
      if (skills.length === 0)
        return "";
      const registry = this.skillRegistry || new SkillRegistry;
      return registry.buildPromptSection(skills);
    }
    return "";
  }
  async run(options) {
    try {
      const { task, signal, events } = options;
      const rootUserPrompt = options.rootUserPrompt || options.task;
      if (signal?.aborted) {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      let sessionId = options.sessionId || this.sessionId;
      this.sessionId = sessionId;
      let conversationId = this.conversationId;
      this.lineageTracker.register({
        sessionId: this.sessionId,
        role: "main",
        status: "active"
      });
      let client = this.chatClient;
      if (!client) {
        const pool = this.pool || new AccountPool;
        this.pool = pool;
        try {
          const token = await pool.getNextAvailableToken({
            forAgentId: this.customAgentId,
            sessionId: this.sessionId
          });
          client = this.chatClientFactory ? this.chatClientFactory(token, {
            modelTone: this.modelTone,
            customAgentId: this.customAgentId
          }) : new ChatHubClient(token, {
            modelTone: this.modelTone,
            customAgentId: this.customAgentId
          });
        } catch (err) {
          if (this.isRateLimitError(err)) {
            return await this.executeDisasterRecoveryArbitration({
              task,
              history: [],
              client,
              lastError: String(err?.message || err),
              signal,
              events,
              sessionId,
              arbitratorChatClient: options.arbitratorChatClient,
              rootUserPrompt
            });
          }
          throw err;
        }
      }
      this.activeAccountEmail = client?.token?.email || this.activeAccountEmail || "";
      const isWorkspaceCatalogEnabled = options.enableWorkspaceCatalog !== undefined ? options.enableWorkspaceCatalog : this.enableWorkspaceCatalog;
      const gitFacts = this.collectGitFacts();
      const dirTree = this.collectDirTreePreview();
      const skillsToUse = options.activeSkills !== undefined ? options.activeSkills : this.activeSkills;
      const skillsSection = this.formatSkillsSection(skillsToUse);
      let currentPrompt;
      if (this.customAgentId) {
        const workerCount = this.getConcurrencyWorkerCount();
        currentPrompt = PromptBuilder.buildDirectAgentPrompt(this.workspaceRoot, task, skillsSection, dirTree, workerCount, undefined, isWorkspaceCatalogEnabled);
      } else if (this.isHandshakePending) {
        this.pendingTask = task;
        this.pendingSkills = skillsSection;
        currentPrompt = PromptBuilder.buildHandshakePrompt(this.workspaceRoot, gitFacts, dirTree);
      } else {
        currentPrompt = PromptBuilder.buildTurn1Prompt({
          workspaceRoot: this.workspaceRoot,
          gitFacts,
          dirTree,
          task,
          skillsSection,
          catalogAttached: isWorkspaceCatalogEnabled
        });
      }
      const history = [];
      let refusalRetries = 0;
      let emptyResponseRetries = 0;
      const maxEmptyResponseRetries = 2;
      let turn = 1;
      let lastFailedActionFp = "";
      let repeatedFailureCount = 0;
      let currentAnnotations = options.initialAnnotations ? [...options.initialAnnotations] : [];
      if (isWorkspaceCatalogEnabled && this.workspaceRoot) {
        try {
          const catalogResult = await this.ensureWorkspaceCatalogAttachment(client?.token?.email || this.activeAccountEmail);
          if (catalogResult?.annotation) {
            currentAnnotations.push(catalogResult.annotation);
            events?.onAttachmentUploaded?.(catalogResult, "workspace_catalog");
          }
        } catch (err) {
          try {
            const errLogPath = path18.join(this.workspaceRoot, ".cph", "state", "upload-error.log");
            fs13.mkdirSync(path18.dirname(errLogPath), { recursive: true });
            fs13.appendFileSync(errLogPath, `[${new Date().toISOString()}] workspace catalog upload failed:
${err?.stack || err?.message || String(err)}

`, "utf-8");
          } catch {}
          currentPrompt = `[WORKSPACE NOTICE: 完整目录附件本轮暂未就绪，以下精简索引可按需用 read_file 补读]
` + currentPrompt;
        }
      }
      const isWorkspaceSnapshotEnabled = options.enableWorkspaceSnapshot !== undefined ? options.enableWorkspaceSnapshot : this.enableWorkspaceSnapshot;
      if (isWorkspaceSnapshotEnabled && this.workspaceRoot) {
        try {
          const generation = this.generation || 1;
          const snap = SnapshotGenerator.generateWorkspaceSnapshot(this.workspaceRoot, undefined, generation);
          const cacheFile = path18.join(this.workspaceRoot, ".cph", "state", "workspace-snapshot-cache.json");
          let cached = null;
          if (fs13.existsSync(cacheFile)) {
            try {
              cached = JSON.parse(fs13.readFileSync(cacheFile, "utf-8"));
            } catch {
              cached = null;
            }
          }
          if (cached && cached.snapshotHash === snap.hash && cached.uploadResult?.annotation) {
            currentAnnotations.unshift(cached.uploadResult.annotation);
            events?.onAttachmentUploaded?.(cached.uploadResult, "workspace_snapshot");
          } else {
            const graphToken = await this.acquireGraphToken();
            if (!graphToken) {
              throw new Error("No Graph access token available for workspace snapshot upload");
            }
            const snapshotBuffer = fs13.readFileSync(snap.snapshotPath);
            const uploadResult = await SubstrateUploader.uploadDocumentAuto(graphToken, snapshotBuffer, snap.cloudFileName, signal);
            const cacheData = {
              snapshotHash: snap.hash,
              uploadResult,
              updatedAt: new Date().toISOString()
            };
            fs13.mkdirSync(path18.dirname(cacheFile), { recursive: true });
            fs13.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2), "utf-8");
            currentAnnotations.unshift(uploadResult.annotation);
            events?.onAttachmentUploaded?.(uploadResult, "workspace_snapshot");
          }
        } catch (err) {
          try {
            const errLogPath = path18.join(this.workspaceRoot, ".cph", "state", "upload-error.log");
            fs13.mkdirSync(path18.dirname(errLogPath), { recursive: true });
            const errContent = `[${new Date().toISOString()}] Turn 1 workspace snapshot upload failed:
${err?.stack || err?.message || String(err)}

`;
            fs13.appendFileSync(errLogPath, errContent, "utf-8");
          } catch {}
          const warnMsg = "[WARN: Turn 1 workspace snapshot upload failed]";
          if (this.tuiRenderer?.c?.yellow) {
            console.warn(this.tuiRenderer.c.yellow(warnMsg));
          } else {
            console.warn(warnMsg);
          }
          const degradationNotice = `
[WORKSPACE NOTICE: 全景代码快照上传暂未就绪，当前进入增量探查降级模式，请按需调用 read_file 探查所需文件]
`;
          currentPrompt = degradationNotice + currentPrompt;
        }
      }
      while (turn <= this.maxTurns) {
        if (signal?.aborted) {
          const abortError = new Error("The operation was aborted");
          abortError.name = "AbortError";
          throw abortError;
        }
        if (turn === this.maxTurns - 1 && !this.isHandshakePending && refusalRetries === 0) {
          currentPrompt = PromptBuilder.buildHandoffPreparationPrompt(this.pendingTask || task, options.sessionId || this.sessionId);
        }
        events?.onTurnStart?.(turn);
        if (process.env.CPH_DEBUG === "1" || this.debug) {
          const promptHash = crypto7.createHash("sha256").update(currentPrompt).digest("hex").slice(0, 12);
          const attachmentNames = currentAnnotations.map((annotation) => annotation?.messageAnnotationMetadata?.fileName || annotation?.text || "").filter(Boolean).join(",");
          console.debug(`[CPH-FINGERPRINT] turn=${turn} agentId=${this.customAgentId || "web"} promptHash=${promptHash} attachments=[${attachmentNames}]`);
        }
        const turnIndex = turn;
        const turnInputPrompt = currentPrompt;
        const requestId = crypto7.randomUUID();
        let turnResponseText = "";
        let turnReasoningText = "";
        try {
          const res = await client.sendMessage({
            text: currentPrompt,
            conversationId,
            sessionId,
            requestId,
            isStartOfSession: turn === 1,
            signal,
            annotations: currentAnnotations.length > 0 ? currentAnnotations : undefined
          }, {
            onDelta: (delta) => {
              if (delta.type === "reasoning") {
                turnReasoningText += delta.content;
                events?.onReasoning?.(delta.content);
              } else if (delta.type === "text") {
                turnResponseText += delta.content;
                events?.onDelta?.(delta.content);
              }
            },
            onRateLimitDetected: async (email) => {
              if (this.pool) {
                this.pool.markThrottled(email);
                const nextToken = await this.pool.getNextAvailableToken();
                events?.onAccountSwitched?.(email, nextToken.email);
                client = new ChatHubClient(nextToken, {
                  modelTone: this.modelTone,
                  customAgentId: this.customAgentId
                });
                this.activeAccountEmail = client?.token?.email || nextToken.email || "";
                if (isWorkspaceCatalogEnabled && this.workspaceRoot) {
                  try {
                    const nextCatalog = await this.ensureWorkspaceCatalogAttachment(this.activeAccountEmail);
                    if (nextCatalog?.annotation) {
                      currentAnnotations = currentAnnotations.filter((anno) => anno.messageAnnotationMetadata?.fileName !== "remote-workspace-catalog.md");
                      currentAnnotations.push(nextCatalog.annotation);
                      events?.onAttachmentUploaded?.(nextCatalog, "workspace_catalog");
                    }
                  } catch {}
                }
              }
            }
          });
          turnResponseText = res.text;
          currentAnnotations = [];
        } catch (err) {
          if (signal?.aborted || err?.name === "AbortError" || err?.message?.includes("aborted")) {
            const abortError = new Error("The operation was aborted");
            abortError.name = "AbortError";
            throw abortError;
          }
          if (this.isRecoverableTransportError(err)) {
            if (turnReasoningText || turnResponseText) {
              history.push({
                turn,
                userInput: currentPrompt,
                thought: turnReasoningText,
                response: turnResponseText,
                error: String(err?.message || err)
              });
            }
            return await this.executeDisasterRecoveryArbitration({
              task,
              history,
              client,
              lastError: String(err?.message || err),
              signal,
              events,
              sessionId,
              arbitratorChatClient: options.arbitratorChatClient,
              rootUserPrompt,
              lastPartialOutput: turnReasoningText || turnResponseText ? {
                reasoning: turnReasoningText,
                response: turnResponseText
              } : undefined
            });
          }
          events?.onError?.(err);
          throw err;
        }
        if (this.isRateLimitResponseText(turnResponseText)) {
          return await this.executeDisasterRecoveryArbitration({
            task,
            history,
            client,
            lastError: turnResponseText,
            signal,
            events,
            sessionId,
            arbitratorChatClient: options.arbitratorChatClient,
            rootUserPrompt
          });
        }
        if (RefusalGuard.detectRefusal(turnResponseText)) {
          events?.onRefusalIntercepted?.(turnResponseText, refusalRetries + 1);
          if (RefusalGuard.shouldRetry(refusalRetries, this.maxRefusalRetries)) {
            refusalRetries++;
            const strategy = RefusalGuard.getRetryStrategy(refusalRetries, {
              workspaceRoot: this.workspaceRoot,
              candidateFile: "package.json"
            });
            if (strategy.shouldSwitchAccount && this.pool) {
              try {
                const currentEmail = client?.token?.email || "";
                if (currentEmail)
                  this.pool.markThrottled(currentEmail);
                const nextToken = await this.pool.getNextAvailableToken();
                events?.onAccountSwitched?.(currentEmail, nextToken.email);
                client = new ChatHubClient(nextToken, {
                  modelTone: this.modelTone,
                  customAgentId: this.customAgentId
                });
              } catch {}
            }
            currentPrompt = strategy.rewrittenPrompt;
            continue;
          }
        }
        refusalRetries = 0;
        const parsed = ResilientParser.parse(turnResponseText);
        if (parsed.type === "empty_response") {
          if (emptyResponseRetries < maxEmptyResponseRetries) {
            emptyResponseRetries++;
            continue;
          }
          if (this.pool) {
            try {
              const currentEmail = client?.token?.email || "";
              const nextToken = await this.pool.getNextAvailableToken();
              events?.onAccountSwitched?.(currentEmail, nextToken.email);
              client = new ChatHubClient(nextToken, {
                modelTone: this.modelTone,
                customAgentId: this.customAgentId
              });
              emptyResponseRetries = 0;
              continue;
            } catch {}
          }
          throw new Error("EMPTY_RESPONSE_LIMIT_EXCEEDED: 上游模型持续返回空载荷");
        }
        emptyResponseRetries = 0;
        if (parsed.type === "final_answer") {
          if (this.isHandshakePending) {
            history.push({
              turn,
              userInput: currentPrompt,
              thought: parsed.thought || turnReasoningText,
              response: turnResponseText
            });
            currentPrompt = `[请先输出 action 块执行 git status 以验证本地物理工具连接]

${PromptBuilder.PROTOCOL_REMINDER}`;
            events?.onTurnEnd?.(turn, turnResponseText);
            turn++;
            continue;
          }
          const rawFinalAnswer = parsed.answer.raw || parsed.answer.summary || "";
          let deliveryReceipt = "";
          if (this.enableAutoLanding) {
            try {
              const items = DeliverablesParser.parse(rawFinalAnswer);
              if (items.length > 0) {
                const landing = this.buildLandingService(client?.token?.email || this.activeAccountEmail);
                const result = await landing.landDeliverables(items);
                deliveryReceipt = LandingService.formatReceipt(result);
                this.writeDeliveryReport(result, "final_answer");
              }
            } catch (err) {
              deliveryReceipt = `交付文件落盘异常: ${String(err?.message || err)}`;
            }
          }
          const finalAnswer = deliveryReceipt ? `${deliveryReceipt}

${parsed.answer.summary || rawFinalAnswer}` : parsed.answer.summary || rawFinalAnswer;
          history.push({
            turn,
            userInput: currentPrompt,
            thought: parsed.thought || turnReasoningText,
            response: turnResponseText
          });
          events?.onTurnEnd?.(turn, turnResponseText);
          events?.onCompleted?.(finalAnswer);
          return {
            finalAnswer,
            turnsCount: turn,
            completed: true,
            history,
            handedOff: false
          };
        }
        if (parsed.type === "handoff") {
          const targetSessionId = options.sessionId || this.sessionId;
          let docPath;
          let finalHandoffDoc = (parsed.handoffDoc || "").trim();
          if (this.workspaceRoot) {
            const handoffsDir = path18.join(this.workspaceRoot, ".cph", "handoffs");
            fs13.mkdirSync(handoffsDir, { recursive: true });
            docPath = path18.join(handoffsDir, `handoff-${targetSessionId}.md`);
            if (finalHandoffDoc.length >= 50) {
              fs13.writeFileSync(docPath, finalHandoffDoc, "utf8");
              this.lastHandoffDocPath = docPath;
            } else {
              if (fs13.existsSync(docPath)) {
                try {
                  fs13.unlinkSync(docPath);
                } catch {}
              }
              finalHandoffDoc = this.generateHandoffSnapshot(task, history, targetSessionId);
              docPath = this.lastHandoffDocPath;
            }
          } else {
            if (finalHandoffDoc.length < 50) {
              finalHandoffDoc = this.generateHandoffSnapshot(task, history, targetSessionId);
            }
          }
          history.push({
            turn,
            userInput: currentPrompt,
            thought: parsed.thought || turnReasoningText,
            response: turnResponseText
          });
          events?.onTurnEnd?.(turn, turnResponseText);
          events?.onHandoff?.(finalHandoffDoc, docPath);
          return {
            finalAnswer: "Session handed off with native handoff document.",
            turnsCount: turn,
            completed: false,
            history,
            handedOff: true,
            handoffSnapshot: finalHandoffDoc,
            handoffDocPath: docPath
          };
        }
        if (parsed.type === "action") {
          events?.onToolStart?.(parsed.action);
          const actionFp = JSON.stringify({
            tool: parsed.action.tool,
            command: parsed.action.command,
            path: parsed.action.path || parsed.action.filePath,
            question: parsed.action.question
          });
          const isKnownRepeat = parsed.action.tool !== "invoke_subagent" && actionFp === lastFailedActionFp && repeatedFailureCount >= 2;
          let toolResult;
          let isInlineScout = false;
          if (parsed.action.tool === "invoke_subagent") {
            const thought = parsed.thought || parsed.action?.thought || "";
            const subagents = parsed.action.subagents || [];
            isInlineScout = isInlineScoutTask(subagents);
            let snapshot = null;
            if (!isInlineScout) {
              snapshot = createMainPlanSnapshot({
                originalSessionId: this.sessionId,
                originalTask: this.pendingTask || task,
                thought,
                workspaceRoot: this.workspaceRoot,
                plannedSubagents: subagents
              });
              const { mdPath } = saveMainPlanSnapshot(snapshot, this.workspaceRoot);
              events?.onMainSessionVirtualized?.(snapshot, mdPath);
              try {
                client?.close?.();
              } catch {}
              this.pool?.releaseSessionLease?.(this.sessionId);
            }
            const runner = this.subagentRunner || new SubagentRunner({
              workspaceRoot: this.workspaceRoot,
              mainSessionId: this.sessionId,
              coderAgentId: this.coderAgentId,
              researcherAgentId: this.researcherAgentId,
              pool: this.pool,
              chatClientFactory: this.chatClientFactory,
              modelTone: this.modelTone,
              loggerTree: TerminalLogger.getInstance().initSessionTree(this.sessionId, this.workspaceRoot),
              lineageTracker: this.lineageTracker
            });
            const reports = await runner.executeBatch(subagents, signal, {
              onSubagentStart: events?.onSubagentStart,
              onSubagentEnd: events?.onSubagentEnd,
              onSubagentProgress: events?.onSubagentProgress
            });
            const summaryOutput = runner.formatReportSummary(reports);
            const successCount = reports.filter((r) => r.success).length;
            const isAllSuccess = successCount === reports.length;
            const isPartialSuccess = successCount > 0 && !isAllSuccess;
            toolResult = {
              actionName: "invoke_subagent",
              piToolName: "subagent",
              target: `${reports.length} subagents (${successCount}/${reports.length} 成功)`,
              success: successCount > 0,
              output: summaryOutput,
              formatted: summaryOutput
            };
            if (!isInlineScout) {
              const prevSessionId = this.sessionId;
              if (this.pool && prevSessionId && typeof this.pool.releaseSessionLease === "function") {
                try {
                  this.pool.releaseSessionLease(prevSessionId);
                } catch {}
              }
              this.generation++;
              const nextSessionId = `${this.sessionId.replace(/_gen\d+$/, "")}_gen${this.generation}`;
              this.sessionId = nextSessionId;
              sessionId = nextSessionId;
              this.conversationId = crypto7.randomUUID();
              conversationId = this.conversationId;
              this.lineageTracker?.register({
                sessionId: nextSessionId,
                role: "main",
                status: "active",
                predecessorId: prevSessionId
              });
              this.lineageTracker?.linkSuccessor(prevSessionId, nextSessionId);
              events?.onSuccessorAwakened?.(nextSessionId, this.generation);
              if (!this.chatClient && this.pool) {
                try {
                  const token = await this.pool.getNextAvailableToken({
                    sessionId: nextSessionId,
                    ...this.customAgentId ? { forAgentId: this.customAgentId } : {}
                  });
                  client = this.chatClientFactory ? this.chatClientFactory(token, {
                    modelTone: this.modelTone,
                    customAgentId: this.customAgentId
                  }) : new ChatHubClient(token, {
                    modelTone: this.modelTone,
                    customAgentId: this.customAgentId
                  });
                } catch {}
              }
              const workerCount = this.getConcurrencyWorkerCount();
              const dirTree = this.collectDirTreePreview();
              this.pendingTask = snapshot.originalTask || this.pendingTask || task;
              currentPrompt = formatSuccessorTurn1Prompt(snapshot, summaryOutput, undefined, workerCount, dirTree);
              this.completeHandshake();
              refusalRetries = 0;
              turn = 0;
            }
          } else if (["write", "write_file"].includes(parsed.action.tool) && Boolean(parsed.action.url || parsed.action.downloadUrl)) {
            toolResult = await this.deliverWriteFileFromUrl(parsed.action);
          } else if (isKnownRepeat) {
            toolResult = {
              actionName: parsed.action.tool,
              piToolName: parsed.action.tool,
              target: "",
              success: false,
              output: "[SYSTEM NOTICE: 该动作已连续失败，已跳过重复执行。请改用其他路径/工具，或输出 FINAL_ANSWER 说明阻塞点。]",
              formatted: "skipped repeated failing action"
            };
          } else {
            toolResult = await this.bridge.executeAction(parsed.action, signal);
          }
          events?.onToolEnd?.(toolResult);
          if (toolResult.success) {
            lastFailedActionFp = "";
            repeatedFailureCount = 0;
          } else if (actionFp === lastFailedActionFp) {
            repeatedFailureCount += 1;
          } else {
            lastFailedActionFp = actionFp;
            repeatedFailureCount = 1;
          }
          if (!toolResult.success && repeatedFailureCount >= 2) {
            const notice = `
[SYSTEM NOTICE: 该动作已连续失败；请改用其他路径/工具，或输出 FINAL_ANSWER 说明阻塞点]`;
            toolResult.output = (toolResult.output || "") + notice;
          }
          if (toolResult.success && (parsed.action.tool === "edit" || parsed.action.tool === "patch_file" || parsed.action.tool === "write_file")) {
            const modFile = parsed.action.path || parsed.action.file || parsed.action.filePath || parsed.action.targetPath;
            if (modFile && typeof modFile === "string") {
              this.lastModifiedFile = modFile;
              const relMod = path18.isAbsolute(modFile) ? path18.relative(this.workspaceRoot, modFile).replace(/\\/g, "/") : modFile.replace(/\\/g, "/");
              const cleanRel = relMod.replace(/^\.\//, "");
              if (cleanRel && !cleanRel.startsWith(".cph/") && !cleanRel.startsWith(".git/") && !cleanRel.startsWith("../") && !path18.isAbsolute(cleanRel)) {
                const manifestPath = path18.join(this.workspaceRoot, ".cph", "state", "sync-manifest.json");
                if (fs13.existsSync(manifestPath)) {
                  const syncStart = Date.now();
                  const syncAbort = new AbortController;
                  let syncTimer;
                  try {
                    const engine = new PnPWorkspaceSyncEngine;
                    const existingManifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
                    const siteUrl = existingManifest?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
                    const targetFolder = existingManifest?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
                    const mockTransport = Boolean(existingManifest?.mockTransport || process.env.CPH_MOCK_TRANSPORT === "1");
                    await Promise.race([
                      engine.syncFile(this.workspaceRoot, cleanRel, targetFolder, {
                        siteUrl,
                        mockTransport,
                        signal: syncAbort.signal
                      }),
                      new Promise((_, reject) => {
                        syncTimer = setTimeout(() => {
                          syncAbort.abort();
                          reject(new Error("SYNC_TIMEOUT"));
                        }, 15000);
                        syncTimer?.unref?.();
                      })
                    ]);
                    const updatedManifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
                    if (updatedManifest) {
                      const mapMd = PnPWorkspaceSyncEngine.generateVirtualRepoMap(updatedManifest, siteUrl, targetFolder);
                      fs13.writeFileSync(path18.join(this.workspaceRoot, ".cph", "state", "virtual-repo-map.md"), mapMd, "utf8");
                    }
                    const elapsedMs = Date.now() - syncStart;
                    const syncNote = `
[Cloud Mirror: Synced ${cleanRel} to SharePoint (${elapsedMs}ms)]`;
                    toolResult.output = (toolResult.output || "") + syncNote;
                    if (toolResult.rawOutput)
                      toolResult.rawOutput += syncNote;
                  } catch {
                    const pendingNote = `
[Cloud Mirror: PENDING (local file updated; use read_file if re-reading)]`;
                    toolResult.output = (toolResult.output || "") + pendingNote;
                    if (toolResult.rawOutput)
                      toolResult.rawOutput += pendingNote;
                  } finally {
                    if (syncTimer)
                      clearTimeout(syncTimer);
                  }
                }
              }
            }
          }
          let isGreenTestResult = false;
          if (toolResult.success) {
            const rawOut = toolResult.rawOutput || toolResult.output || "";
            const isTestCommand = (parsed.action.tool === "run_command" || toolResult.actionName === "run_command") && parsed.action.command && /(?:test|vitest|jest|pytest|cargo\s+test)/i.test(parsed.action.command);
            const hasGreenPattern = /(?:pass(?:ed)?|绿灯|\b\d+\s+pass(?:ed)?\b|status:\s*green|all\s+tests\s+pass(?:ed)?)/i.test(rawOut);
            if (isTestCommand && hasGreenPattern || hasGreenPattern && /(?:pass|0 fail|passed)/i.test(rawOut)) {
              isGreenTestResult = true;
            }
          }
          let fingerprintHeader = "";
          if (isGreenTestResult) {
            const branch = this.getCurrentGitBranch() || "main";
            const targetFile = this.lastModifiedFile || parsed.action?.path || parsed.action?.file || "workspace";
            fingerprintHeader = [
              "[WORKSPACE STATE UPDATE]",
              `Branch: ${branch}`,
              `Status: Green`,
              `Target: ${targetFile} (Verified: Tests passed on disk)`,
              `Cloud Mirror: Synced to SharePoint`
            ].join(`
`);
          }
          let uploadedAttachment = null;
          const rawContent = toolResult.rawOutput || toolResult.output || "";
          const lineCount = rawContent.split(/\r?\n/).length;
          const charCount = rawContent.length;
          const isFileReadAction = (parsed.action.tool || toolResult.actionName || "").toLowerCase().includes("read") || (parsed.action.tool || toolResult.actionName || "").toLowerCase().includes("cat");
          const shouldUpload = this.enableCloudAttachment && !isGreenTestResult && toolResult.success && charCount > 0 && (isFileReadAction || (this.cloudAttachmentThresholdChars === 0 && this.cloudAttachmentThresholdLines === 0 ? true : charCount > this.cloudAttachmentThresholdChars || lineCount > this.cloudAttachmentThresholdLines));
          if (shouldUpload) {
            try {
              const graphToken = await this.acquireGraphToken();
              if (graphToken) {
                const actionTag = (parsed.action.tool || toolResult.actionName || "tool").replace(/[^a-zA-Z0-9_-]/g, "_");
                let uploadFileName = `tool-result-${actionTag}-${Date.now()}.txt`;
                if (isFileReadAction && (parsed.action?.path || parsed.action?.file || parsed.action?.filePath)) {
                  const targetPath = parsed.action?.path || parsed.action?.file || parsed.action?.filePath || "";
                  const cleanBase = path18.basename(targetPath).replace(/[^a-zA-Z0-9_.-]/g, "_");
                  uploadFileName = `read-${cleanBase}-${Date.now()}.txt`;
                }
                uploadedAttachment = await SubstrateUploader.uploadDocumentToOneDrive(graphToken, rawContent, uploadFileName);
                currentAnnotations = [uploadedAttachment.annotation];
                events?.onAttachmentUploaded?.(uploadedAttachment, parsed.action.tool || toolResult.actionName);
              }
            } catch (uploadErr) {}
          }
          const currentTurnRecord = {
            turn: turnIndex,
            userInput: turnInputPrompt,
            thought: parsed.thought || turnReasoningText,
            response: turnResponseText,
            action: parsed.action,
            toolName: toolResult.actionName || parsed.action.tool,
            toolOutput: rawContent,
            success: toolResult.success
          };
          history.push(currentTurnRecord);
          if (this.enableInSessionCompaction && history.length > 2) {
            const compaction = CompactionService.compactTurns(history, {
              preserveRecentTurns: 2
            });
            if (compaction.clearedCharsCount > 0) {
              history.splice(0, history.length, ...compaction.compactedTurns);
              events?.onCompacted?.(compaction.clearedCharsCount, compaction.compressionRatio);
            }
          }
          if (parsed.action.tool === "invoke_subagent" && !isInlineScout) {} else if (this.isHandshakePending) {
            this.completeHandshake();
            if (uploadedAttachment) {
              const excerpt = PromptBuilder.generateHeadTailExcerpt(rawContent);
              const workerCount = this.getConcurrencyWorkerCount();
              currentPrompt = PromptBuilder.buildTurn2TaskPromptWithAttachment(this.pendingTask, this.pendingSkills, parsed.action.tool || toolResult.actionName, uploadedAttachment.fileName, { lineCount, charCount }, excerpt, workerCount);
            } else {
              const workerCount = this.getConcurrencyWorkerCount();
              currentPrompt = PromptBuilder.buildTurn2TaskPrompt({
                task: this.pendingTask,
                toolResult: toolResult.output,
                skillsSection: this.pendingSkills,
                toolName: parsed.action.tool || toolResult.actionName,
                concurrencyWorkers: workerCount
              });
            }
          } else {
            const currentTask = this.pendingTask || task || "";
            if (uploadedAttachment) {
              const excerpt = PromptBuilder.generateHeadTailExcerpt(rawContent);
              currentPrompt = PromptBuilder.buildAttachedToolResultPrompt(parsed.action.tool || toolResult.actionName, uploadedAttachment.fileName, { lineCount, charCount }, excerpt, currentTask);
            } else {
              currentPrompt = PromptBuilder.buildToolResultPrompt(parsed.action.tool || toolResult.actionName, toolResult.success, toolResult.output, toolResult.success ? undefined : toolResult.output, currentTask);
            }
          }
          if (fingerprintHeader) {
            currentPrompt = `${fingerprintHeader}

${currentPrompt}`;
          }
          events?.onTurnEnd?.(turnIndex, turnResponseText);
          if (parsed.action.tool === "invoke_subagent" && !isInlineScout && this.generation > this.maxGenerations) {
            const targetSessionId = options.sessionId || this.sessionId;
            const handoffSnapshot = this.generateHandoffSnapshot(task, history, targetSessionId);
            const handoffDocPath = this.lastHandoffDocPath;
            events?.onHandoff?.(handoffSnapshot, handoffDocPath);
            return {
              finalAnswer: `Max generations reached (${this.maxGenerations}) without completion. Triggered autonomous session handoff.`,
              turnsCount: turnIndex,
              completed: false,
              history,
              handedOff: true,
              handoffSnapshot,
              handoffDocPath
            };
          }
          turn++;
          continue;
        }
        history.push({
          turn,
          userInput: currentPrompt,
          thought: parsed.thought || turnReasoningText,
          response: turnResponseText
        });
        if (this.isHandshakePending) {
          currentPrompt = `[请先输出 action 块执行 git status 以验证本地物理工具连接]

${PromptBuilder.PROTOCOL_REMINDER}`;
        } else {
          currentPrompt = `${parsed.warning}
${PromptBuilder.PROTOCOL_REMINDER}`;
        }
        events?.onTurnEnd?.(turn, turnResponseText);
        turn++;
      }
      const targetSessionId = options.sessionId || this.sessionId;
      const handoffSnapshot = this.generateHandoffSnapshot(task, history, targetSessionId);
      const handoffDocPath = this.lastHandoffDocPath;
      events?.onHandoff?.(handoffSnapshot, handoffDocPath);
      return {
        finalAnswer: "Max turns reached without final answer.",
        turnsCount: turn - 1,
        completed: false,
        history,
        handedOff: true,
        handoffSnapshot,
        handoffDocPath
      };
    } finally {
      if (this.pool && this.sessionId) {
        try {
          if (typeof this.pool.releaseSessionLease === "function") {
            this.pool.releaseSessionLease(this.sessionId);
          }
        } catch {}
      }
    }
  }
  extractKeyError(output) {
    if (!output)
      return "（无错误输出）";
    const lines = output.split(/\r?\n/);
    const keyLines = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line)
        continue;
      if (/error|exception|failed|fatal|cannot find|not found|denied|未找到|失败|TypeNotFound|CommandNotFound|InvalidOperation|ExitCode|No \.NET/i.test(line)) {
        keyLines.push(line.length > 200 ? `${line.slice(0, 197)}...` : line);
        if (keyLines.length >= 4)
          break;
      }
    }
    if (keyLines.length > 0) {
      return keyLines.join(`
`);
    }
    const cleanOutput = output.trim().replace(/\r?\n/g, " ");
    return cleanOutput.length > 200 ? `${cleanOutput.slice(0, 197)}...` : cleanOutput;
  }
  generateHandoffSnapshot(task, history, sessionId) {
    const effectiveSessionId = sessionId || this.sessionId;
    const cleanTask = task || this.pendingTask || (history[0]?.userInput ? history[0].userInput : "未指定任务需求");
    let nextSnapshotMeta;
    if (this.enableWorkspaceSnapshot && this.workspaceRoot) {
      try {
        const nextGen = (this.generation || 1) + 1;
        nextSnapshotMeta = SnapshotGenerator.generateWorkspaceSnapshot(this.workspaceRoot, undefined, nextGen);
        this.lastNextSnapshotMeta = nextSnapshotMeta;
      } catch {}
    }
    if (effectiveSessionId && this.workspaceRoot) {
      try {
        const docPath = path18.join(this.workspaceRoot, ".cph", "handoffs", `handoff-${effectiveSessionId}.md`);
        if (fs13.existsSync(docPath)) {
          const existingDoc = fs13.readFileSync(docPath, "utf8").trim();
          if (existingDoc.length > 50) {
            this.lastHandoffDocPath = docPath;
            return existingDoc;
          }
        }
      } catch {}
    }
    const nextSnapshotFact = nextSnapshotMeta ? `- **下一代工作区全景快照**: \`${nextSnapshotMeta.cloudFileName}\` (SHA: \`${nextSnapshotMeta.hash}\`, Files: ${nextSnapshotMeta.fileCount})` : "";
    const taskSection = [
      `- **原始任务**: ${cleanTask}`,
      `- **工作区根目录**: \`${this.workspaceRoot}\``,
      effectiveSessionId ? `- **会话标识**: \`${effectiveSessionId}\`` : "",
      nextSnapshotFact
    ].filter(Boolean).join(`
`);
    const executedActions = [];
    const recentFindings = [];
    const successfulRecords = history.filter((h) => h.toolName && h.success !== false);
    const readFiles = new Set;
    const executedCmds = [];
    let editWriteCount = 0;
    for (const record of history) {
      if (record.toolName) {
        let details = "";
        if (record.action?.command) {
          details = ` \`${record.action.command.length > 80 ? `${record.action.command.slice(0, 77)}...` : record.action.command}\``;
        } else if (record.action?.path || record.action?.filePath) {
          details = ` \`${record.action.path || record.action.filePath}\``;
        }
        const status = record.success !== false ? "成功" : "失败";
        executedActions.push(`- Turn ${record.turn}: [${status}] ${record.toolName}${details}`);
      }
      if (record.toolOutput) {
        const cleanOutput = record.toolOutput.trim().replace(/\r?\n/g, " ");
        const preview = cleanOutput.length > 120 ? `${cleanOutput.slice(0, 117)}...` : cleanOutput;
        recentFindings.push(`- Turn ${record.turn} (${record.toolName || "tool"}): ${preview}`);
      }
    }
    for (const r of successfulRecords) {
      const tool = (r.toolName || r.action?.tool || "").toLowerCase();
      const filePath = r.action?.path || r.action?.filePath || r.action?.file;
      if (["read_file", "read", "cat"].includes(tool) && filePath) {
        readFiles.add(filePath);
      } else if (["edit", "edit_file", "patch_file", "write", "write_file"].includes(tool)) {
        editWriteCount++;
      } else if (["run_command", "bash", "exec"].includes(tool)) {
        if (r.action?.command) {
          executedCmds.push(r.action.command);
        }
      }
    }
    let verifiedFactsSection = "";
    let diskLedgerEntries = [];
    if (this.workspaceRoot) {
      try {
        const ledgerJsonlPath = path18.join(this.workspaceRoot, ".cph", "state", "execution-ledger.jsonl");
        if (fs13.existsSync(ledgerJsonlPath)) {
          const lines = fs13.readFileSync(ledgerJsonlPath, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          for (const line of lines) {
            try {
              diskLedgerEntries.push(JSON.parse(line));
            } catch {}
          }
        }
      } catch {}
    }
    if (history.length === 0) {
      if (diskLedgerEntries.length > 0) {
        const parts = [
          `- **物理工具执行汇总 (来自磁盘总账 \`.cph/state/execution-ledger.jsonl\` 共 ${diskLedgerEntries.length} 项记录)**:`
        ];
        const actions = [];
        const findings = [];
        for (const entry of diskLedgerEntries) {
          const status = entry.success !== false ? "成功" : "失败";
          const tool = entry.canonicalTool || entry.tool || "tool";
          const target = entry.actionTarget ? ` (${entry.actionTarget})` : "";
          actions.push(`- Step ${entry.stepIndex ?? "?"}: [${status}] ${tool}${target}`);
          if (entry.outputSummary) {
            findings.push(`- Step ${entry.stepIndex ?? "?"} (${tool}): ${entry.outputSummary}`);
          }
        }
        parts.push(``);
        parts.push(`**已执行动作清单**:`);
        parts.push(actions.join(`
`));
        parts.push(``);
        parts.push(`**最近工具发现与上下文**:`);
        parts.push(findings.length > 0 ? findings.slice(-5).join(`
`) : "- 暂无显著工具发现");
        verifiedFactsSection = parts.join(`
`);
      } else {
        verifiedFactsSection = `- （暂无已执行的物理动作成果）

**已执行动作清单**:
- 无已执行的物理工具调用

**最近工具发现与上下文**:
- 暂无显著工具发现`;
      }
    } else {
      const parts = [];
      if (successfulRecords.length > 0) {
        parts.push(`- **物理工具执行汇总**: 共成功执行 ${successfulRecords.length} 项动作（读取 ${readFiles.size} 处、修改/创建 ${editWriteCount} 处、运行命令 ${executedCmds.length} 次）`);
        if (readFiles.size > 0) {
          parts.push(`- **已成功读取/探测的项目模块**:`);
          for (const file of Array.from(readFiles).slice(0, 15)) {
            parts.push(`  - \`${file}\``);
          }
        }
        if (executedCmds.length > 0) {
          parts.push(`- **已验证执行的基准命令**:`);
          for (const cmd of executedCmds.slice(0, 8)) {
            const preview = cmd.length > 100 ? `${cmd.slice(0, 97)}...` : cmd;
            parts.push(`  - \`${preview}\``);
          }
        }
        const insightfulThoughts = history.filter((h) => h.thought && /(盘点|验证|确认|发现|成功|完成)/.test(h.thought)).map((h) => h.thought.trim());
        if (insightfulThoughts.length > 0) {
          parts.push(`- **关键阶段性结论与发现**:`);
          for (const thought of insightfulThoughts.slice(-3)) {
            const preview = thought.length > 120 ? `${thought.slice(0, 117)}...` : thought;
            parts.push(`  - ${preview}`);
          }
        }
      } else if (executedActions.length === 0) {
        parts.push(`- （暂无已执行的物理动作成果；已完成 ${history.length} 轮对话探索研讨）`);
      }
      parts.push(``);
      parts.push(`**已执行动作清单**:`);
      parts.push(executedActions.length > 0 ? executedActions.join(`
`) : "- 无已执行的物理工具调用");
      parts.push(``);
      parts.push(`**最近工具发现与上下文**:`);
      parts.push(recentFindings.length > 0 ? recentFindings.slice(-5).join(`
`) : "- 暂无显著工具发现");
      verifiedFactsSection = parts.join(`
`);
    }
    const failedRecords = history.filter((h) => h.toolName && h.success === false);
    let blockersSection = "";
    if (failedRecords.length === 0) {
      blockersSection = `- （当前会话运行健康，无关键错误卡点与失败调用）`;
    } else {
      const parts = [
        `- **卡点与失败动作清单** (共 ${failedRecords.length} 次执行失败):`
      ];
      for (const h of failedRecords.slice(-5)) {
        const target = h.action?.command ? `\`${h.action.command.length > 80 ? `${h.action.command.slice(0, 77)}...` : h.action.command}\`` : h.action?.path ? `\`${h.action.path}\`` : "";
        parts.push(`  - **Turn ${h.turn} [${h.toolName || "tool"}]** ${target}:`);
        const keyErr = this.extractKeyError(h.toolOutput || "");
        for (const errLine of keyErr.split(`
`)) {
          parts.push(`    > ${errLine}`);
        }
      }
      const diagnosticThoughts = history.filter((h) => h.thought && /(提权|缺失|无法|失败|原因|由于|检测到|卡点)/.test(h.thought)).map((h) => h.thought.trim());
      if (diagnosticThoughts.length > 0) {
        parts.push(`- **模型最新诊断原因分析**:`);
        for (const d of diagnosticThoughts.slice(-3)) {
          const preview = d.length > 140 ? `${d.slice(0, 137)}...` : d;
          parts.push(`  - ${preview}`);
        }
      }
      blockersSection = parts.join(`
`);
    }
    const modifiedFiles = new Map;
    for (const h of history) {
      const tool = (h.toolName || h.action?.tool || "").toLowerCase();
      const filePath = h.action?.path || h.action?.filePath || h.action?.file;
      if (["edit", "edit_file", "patch_file"].includes(tool) && filePath) {
        modifiedFiles.set(filePath, "已修改 (edit)");
      } else if (["write", "write_file"].includes(tool) && filePath) {
        modifiedFiles.set(filePath, "已创建 (write_file)");
      } else if (["run_command", "bash"].includes(tool) && h.action?.command) {
        const cmd = h.action.command;
        const redirMatch = cmd.match(/>\s*['"]?([^'">\s|&;]+\.[a-zA-Z0-9]+)['"]?/);
        if (redirMatch && redirMatch[1]) {
          modifiedFiles.set(redirMatch[1], "重定向输出生成");
        }
      }
    }
    let modifiedFilesSection = "";
    if (modifiedFiles.size === 0) {
      modifiedFilesSection = `- （会话期间未修改或新建文件，主要为只读探测）`;
    } else {
      const parts = [];
      for (const [p, status] of modifiedFiles.entries()) {
        parts.push(`- \`${p}\` (${status})`);
      }
      modifiedFilesSection = parts.join(`
`);
    }
    let nextStepsSection = "";
    const nextSteps = [];
    if (failedRecords.length > 0) {
      const lastFailed = failedRecords[failedRecords.length - 1];
      const lastCmd = lastFailed.action?.command || lastFailed.action?.path || lastFailed.toolName || "未知动作";
      const shortCmd = lastCmd.length > 60 ? `${lastCmd.slice(0, 57)}...` : lastCmd;
      nextSteps.push(`1. **第一优先级 (立即执行/优先处理)**: 针对 Turn ${lastFailed.turn} 的关键卡点（\`${shortCmd}\`），优先解决依赖或报错。`);
      nextSteps.push(`2. **接力执行剩余需求**: 依赖或卡点解除后，接续完成未完成的原始需求：${cleanTask}`);
    } else {
      const lastRecord = history[history.length - 1];
      nextSteps.push(`1. **第一优先级 (立即执行)**: 当前所有前序动作均已验证成功，无关键卡点，直接推进下一阶段核心交付。`);
      if (lastRecord?.thought) {
        const shortThought = lastRecord.thought.length > 80 ? `${lastRecord.thought.slice(0, 77)}...` : lastRecord.thought;
        nextSteps.push(`   - 接续最新思绪进度: "${shortThought}"`);
      }
      nextSteps.push(`2. **接续完成目标**: 围绕原始任务目标【${cleanTask}】继续执行。`);
    }
    nextSteps.push(`- **推进提示**: 请直接基于上述已验证客观事实推进，复用前序已验证成功的步骤与文件探测成果。`);
    nextStepsSection = [
      `**接力建议**: 请接续上方成果与状态，避免重复执行已验证步骤，继续完成剩余需求。`,
      ``,
      ...nextSteps
    ].join(`
`);
    let reviewDraftContent = "";
    if (this.workspaceRoot) {
      try {
        const reviewDraftPath = path18.join(this.workspaceRoot, ".cph", "review_draft.md");
        if (fs13.existsSync(reviewDraftPath)) {
          reviewDraftContent = fs13.readFileSync(reviewDraftPath, "utf8").trim();
        }
      } catch {}
    }
    let handoffMemoContent = "";
    for (let i = history.length - 1;i >= 0; i--) {
      const resp = history[i]?.response || "";
      const idx = resp.indexOf("HANDOFF_MEMO:");
      if (idx !== -1) {
        let memo = resp.slice(idx + "HANDOFF_MEMO:".length).trim();
        const actionIdx = memo.indexOf("```action");
        if (actionIdx !== -1) {
          memo = memo.slice(0, actionIdx).trim();
        }
        if (memo) {
          handoffMemoContent = memo;
          break;
        }
      }
    }
    const docParts = [
      `### [阶段性成果快照 (Auto-Handoff Snapshot)]`,
      `# \uD83D\uDD04 CPH-PI 会话高保真接力交接文档 (Autonomous Handoff Document)`,
      ``,
      `## 1. 【任务目标与原始需求】`,
      taskSection,
      ``
    ];
    if (reviewDraftContent) {
      docParts.push(`## 2. 【阶段性技术审计发现与核心见解 (Review Draft)】`, reviewDraftContent, ``);
    }
    if (handoffMemoContent) {
      docParts.push(`## 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】`, handoffMemoContent, ``);
    }
    docParts.push(`## ${reviewDraftContent ? "3" : "2"}. 【已验证客观事实与阶段性成果】`, verifiedFactsSection, ``, `## ${reviewDraftContent ? "4" : "3"}. 【关键卡点、报错与最新诊断】`, blockersSection, ``, `## ${reviewDraftContent ? "5" : "4"}. 【已修改/生成文件清单】`, modifiedFilesSection, ``, `## ${reviewDraftContent ? "6" : "5"}. 【接力第一优先级待办事项 (Actionable Next Steps)】`, nextStepsSection, ``, `---`, `*注: 本文档由 CPH-PI Orchestrator 自动生成并持久化归档于 \`.cph/handoffs/\`。接力会话将自动注入此背景。*`);
    const doc = docParts.join(`
`);
    if (effectiveSessionId && this.workspaceRoot) {
      try {
        const handoffsDir = path18.join(this.workspaceRoot, ".cph", "handoffs");
        fs13.mkdirSync(handoffsDir, { recursive: true });
        const docPath = path18.join(handoffsDir, `handoff-${effectiveSessionId}.md`);
        fs13.writeFileSync(docPath, doc, "utf8");
        this.lastHandoffDocPath = docPath;
      } catch {}
    }
    return doc;
  }
  generateHandoffMarkdown(task, history, sessionId) {
    return this.generateHandoffSnapshot(task, history, sessionId);
  }
  collectGitFacts() {
    try {
      const branch = execSync3("git branch --show-current", {
        cwd: this.workspaceRoot,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8"
      }).trim();
      const status = execSync3("git status -s", {
        cwd: this.workspaceRoot,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8"
      }).trim();
      return `Branch: ${branch || "main"}
Status: ${status ? `
${status}` : "clean (无未提交变更)"}`;
    } catch {
      return "Git: 未初始化或非 Git 仓库 (clean)";
    }
  }
  collectDirTreePreview() {
    try {
      const ignored = new Set([
        "node_modules",
        "dist",
        ".git",
        ".cph",
        ".gemini",
        "coverage",
        ".cache",
        "build"
      ]);
      const entries = fs13.readdirSync(this.workspaceRoot, { withFileTypes: true });
      const lines = [];
      const topEntries = entries.filter((e) => !e.name.startsWith(".") && !ignored.has(e.name)).slice(0, 20);
      for (const entry of topEntries) {
        if (entry.isDirectory()) {
          lines.push(`- ${entry.name}/`);
          try {
            const subPath = path18.join(this.workspaceRoot, entry.name);
            const subEntries = fs13.readdirSync(subPath, { withFileTypes: true }).filter((se) => !se.name.startsWith(".") && !ignored.has(se.name)).slice(0, 10);
            for (const sub of subEntries) {
              lines.push(`  - ${sub.name}${sub.isDirectory() ? "/" : ""}`);
            }
          } catch {}
        } else {
          lines.push(`- ${entry.name}`);
        }
      }
      return lines.join(`
`);
    } catch {
      return "";
    }
  }
  classifyRateLimitError(err) {
    if (!err)
      return { isRateLimit: false, kind: "none" };
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      return { isRateLimit: false, kind: "none" };
    }
    const rawMsg = String(err?.message || err || "");
    const textClass = Orchestrator.classifyRateLimitText(rawMsg);
    if (textClass.isRateLimit) {
      return textClass;
    }
    const cleanMsg = rawMsg.replace(/https?:\/\/[^\s]+|wss?:\/\/[^\s]+/g, "").toLowerCase();
    const code = String(err?.code || err?.statusCode || err?.status || err?.errorCode || "").toLowerCase();
    const isDaily = cleanMsg.includes("daily limit") || cleanMsg.includes("daily message limit") || cleanMsg.includes("今日上限") || cleanMsg.includes("今天的消息上限") || cleanMsg.includes("每日消息上限") || cleanMsg.includes("今日消息上限");
    if (isDaily) {
      return { isRateLimit: true, kind: "daily" };
    }
    const isBurst = code === "429" || code === "ratelimit" || /\b429\b/.test(cleanMsg) || cleanMsg.includes("throttled") || cleanMsg.includes("rate limit") || cleanMsg.includes("too many requests") || /\bquota\s*(?:exceeded|reached|limit)\b/i.test(cleanMsg) || cleanMsg.includes("配额已达上限") || cleanMsg.includes("请求过于频繁") || cleanMsg.includes("暂时无法响应这么多请求");
    if (isBurst) {
      return { isRateLimit: true, kind: "burst" };
    }
    return { isRateLimit: false, kind: "none" };
  }
  isExplicitRateLimitError(err) {
    return this.classifyRateLimitError(err).isRateLimit;
  }
  isRecoverableTransportError(err) {
    if (!err)
      return false;
    if (err.name === "AbortError" || err.message?.includes("aborted"))
      return false;
    const msg = String(err?.message || err || "").toLowerCase();
    const code = String(err?.code || err?.statusCode || err?.status || err?.errorCode || "").toLowerCase();
    const isRateLimit = this.isExplicitRateLimitError(err);
    const isTimeout = code === "etimedout" || msg.includes("timed out") || msg.includes("timeout") || msg.includes("idle timeout");
    const isNetBreak = code === "econnreset" || code === "epipe" || code === "econnrefused" || code === "enotfound" || code === "ehostunreach" || code === "enetunreach" || msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("epipe") || msg.includes("closed before") || msg.includes("premature close") || msg.includes("socket hang up") || msg.includes("failed to connect") || msg.includes("connection error") || msg.includes("connection ended") || msg.includes("fetch failed");
    return isRateLimit || isTimeout || isNetBreak;
  }
  isRateLimitError(err) {
    return this.isExplicitRateLimitError(err);
  }
  static classifyRateLimitText(text) {
    if (!text)
      return { isRateLimit: false, kind: "none" };
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 300) {
      return { isRateLimit: false, kind: "none" };
    }
    if (trimmed.includes("```action") || trimmed.includes("FINAL_ANSWER")) {
      return { isRateLimit: false, kind: "none" };
    }
    const isDaily = /reached\s+(?:your\s+)?daily\s+(?:message\s+)?limit/i.test(trimmed) || /daily\s+(?:message\s+)?limit(?:\s+(?:reached|exceeded))?/i.test(trimmed) || /daily\s+quota\s+(?:exceeded|reached)/i.test(trimmed) || /daily\s+limit\s+reached/i.test(trimmed) || trimmed.includes("已达到今天的消息上限") || trimmed.includes("达到今天的消息上限") || trimmed.includes("今日消息上限") || trimmed.includes("今日上限") || trimmed.includes("每日消息上限") || trimmed.includes("每日请求上限") || trimmed.includes("每日配额已达上限") || /今天(?:的)?(?:消息|请求)?(?:已达|达到)?上限/.test(trimmed);
    if (isDaily) {
      return { isRateLimit: true, kind: "daily" };
    }
    const isExplicit429 = /(?:^|\n|\bstatus\s*code\s*:?\s*|\berror\s*:?\s*)429(?:\s+too\s+many\s+requests|\b)/i.test(trimmed);
    const isRateLimitPhrase = /(?:^|\n|\berror\s*:?\s*)too\s+many\s+requests\b/i.test(trimmed) || /\brate[_\s-]?limit[_\s-]?exceeded\b/i.test(trimmed) || /\b(?:account|request|client|user)\s+(?:has\s+been|was|is)\s+throttled\b/i.test(trimmed) || /(?:^|\n|\berror\s*:?\s*)throttled\b/i.test(trimmed) || trimmed.includes("配额已达上限") || trimmed.includes("请求过于频繁") || trimmed.includes("暂时无法响应这么多请求") || trimmed.includes("暂时无法处理这么多请求");
    if (isExplicit429 || isRateLimitPhrase) {
      return { isRateLimit: true, kind: "burst" };
    }
    return { isRateLimit: false, kind: "none" };
  }
  classifyRateLimitText(text) {
    return Orchestrator.classifyRateLimitText(text);
  }
  static isRateLimitResponseText(text) {
    return Orchestrator.classifyRateLimitText(text).isRateLimit;
  }
  isRateLimitResponseText(text) {
    return Orchestrator.isRateLimitResponseText(text);
  }
  async executeDisasterRecoveryArbitration(params) {
    const { task, history, client, lastError, signal, events, sessionId } = params;
    if (signal?.aborted) {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    let disasterBlackbox = BlackboxCompactor.extractDisasterBlackbox(history, lastError, {
      rootUserPrompt: params.rootUserPrompt || params.task
    });
    if (params.lastPartialOutput && (params.lastPartialOutput.reasoning || params.lastPartialOutput.response)) {
      if (!disasterBlackbox.includes(params.lastPartialOutput.response || "___nonexistent___") && !disasterBlackbox.includes(params.lastPartialOutput.reasoning || "___nonexistent___")) {
        disasterBlackbox += `

### [中断前未完结部分输出 (Partial Output Before Crash)]
` + (params.lastPartialOutput.reasoning ? `- **Reasoning**: ${params.lastPartialOutput.reasoning}
` : "") + (params.lastPartialOutput.response ? `- **Response**: ${params.lastPartialOutput.response}
` : "");
      }
    }
    if (events?.onDisasterOccurred) {
      await Promise.resolve(events.onDisasterOccurred(disasterBlackbox, lastError));
    }
    const errClassification = this.classifyRateLimitError(lastError);
    const textClassification = this.classifyRateLimitText(lastError);
    const isDaily = errClassification.kind === "daily" || textClassification.kind === "daily";
    const isBurst = errClassification.kind === "burst" || textClassification.kind === "burst" || this.isExplicitRateLimitError(lastError) || this.isRateLimitResponseText(lastError);
    const isRateLimitIncident = isDaily || isBurst;
    const throttleReason = isDaily ? "daily" : "burst";
    let victimEmail = client?.token?.email || client?.email || "";
    if (!victimEmail && this.pool?.refreshAccountList) {
      const accounts = this.pool.refreshAccountList();
      if (accounts && accounts.length > 0) {
        victimEmail = accounts[0].email;
      }
    }
    if (isRateLimitIncident && victimEmail && this.pool) {
      const durationMs = throttleReason === "daily" ? Math.max(getNextUtcMidnight() - Date.now(), 15 * 60 * 1000) : undefined;
      this.pool.markThrottled(victimEmail, durationMs, throttleReason);
    }
    const targetHandoffRelativePath = `.cph/handoffs/handoff-${sessionId}.md`;
    const handoffsDir = path18.join(this.workspaceRoot, ".cph", "handoffs");
    const targetHandoffAbsolutePath = path18.join(handoffsDir, `handoff-${sessionId}.md`);
    if (!this.pool && !params.arbitratorChatClient && !this.arbitratorChatClient) {
      fs13.mkdirSync(handoffsDir, { recursive: true });
      const localHandoffDoc = this.generateHandoffSnapshot(params.rootUserPrompt || task, history, sessionId);
      fs13.writeFileSync(targetHandoffAbsolutePath, localHandoffDoc, "utf8");
      this.lastHandoffDocPath = targetHandoffAbsolutePath;
      if (events?.onHandoff) {
        events.onHandoff(localHandoffDoc, targetHandoffAbsolutePath);
      }
      return {
        finalAnswer: `Transport error recovered via local handoff snapshot. Handoff document generated.`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: true,
        disasterBlackbox,
        handoffSnapshot: localHandoffDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId: undefined,
        lastPartialOutput: params.lastPartialOutput
      };
    }
    let nextToken;
    try {
      if (!this.pool) {
        if (params.arbitratorChatClient || this.arbitratorChatClient) {
          nextToken = { email: "arbitrator@example.com" };
        } else {
          throw new Error("No account pool configured for disaster recovery");
        }
      } else {
        nextToken = await this.pool.getNextAvailableToken(this.customAgentId ? { forAgentId: this.customAgentId } : undefined);
      }
    } catch (poolErr) {
      fs13.mkdirSync(handoffsDir, { recursive: true });
      const fallbackDoc = [
        `# \uD83D\uDD04 CPH-PI 容灾降级交接文档 (All Accounts Throttled)`,
        `> ⚠️ 账号池所有可用账号均已耗尽频控 (${poolErr.message || String(poolErr)})，本地保障黑匣子生成与落盘。`,
        ``,
        disasterBlackbox
      ].join(`
`);
      fs13.writeFileSync(targetHandoffAbsolutePath, fallbackDoc, "utf8");
      this.lastHandoffDocPath = targetHandoffAbsolutePath;
      if (events?.onHandoff) {
        events.onHandoff(fallbackDoc, targetHandoffAbsolutePath);
      }
      return {
        finalAnswer: `429 Rate limit encountered. All accounts in pool throttled: ${poolErr.message || String(poolErr)}`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: false,
        disasterBlackbox,
        handoffSnapshot: fallbackDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId: undefined,
        lastPartialOutput: params.lastPartialOutput
      };
    }
    const arbitratorSessionId = `ses_arb_${crypto7.randomUUID()}`;
    const nextEmail = nextToken?.email || "next-account";
    this.lineageTracker.register({
      sessionId: arbitratorSessionId,
      role: "main",
      status: "active",
      predecessorId: sessionId
    });
    this.lineageTracker.linkSuccessor(sessionId, arbitratorSessionId);
    if (victimEmail && nextEmail && events?.onAccountSwitched) {
      events.onAccountSwitched(victimEmail, nextEmail);
    }
    if (events?.onArbitratorHandoffStart) {
      await Promise.resolve(events.onArbitratorHandoffStart(arbitratorSessionId, nextEmail));
    }
    let arbitratorClient;
    if (params.arbitratorChatClient) {
      arbitratorClient = params.arbitratorChatClient;
    } else if (this.arbitratorChatClient) {
      arbitratorClient = this.arbitratorChatClient;
    } else if (this.chatClientFactory) {
      arbitratorClient = this.chatClientFactory(nextToken, {
        modelTone: this.modelTone,
        customAgentId: this.customAgentId
      });
    } else {
      arbitratorClient = new ChatHubClient(nextToken, {
        modelTone: this.modelTone,
        customAgentId: this.customAgentId
      });
    }
    const arbitratorPrompt = [
      `【前序会话事故黑匣子快照 (Disaster Recovery Blackbox)】`,
      disasterBlackbox,
      ``,
      `【交接仲裁任务】`,
      `前序会话因突发 429 频控/断连异常中断。你是交接仲裁者 (Handoff Arbitrator)。`,
      `你的职责是提炼高保真阶段性交接文档，确保战役终极目标与未完成业务切片无缝接力：`,
      `1. 【任务目标与原始需求】（必须清晰继承战役终极北极星目标）`,
      `2. 【已验证客观事实与阶段性成果】（提炼前序已确认事实与已生成资产）`,
      `3. 【关键卡点、报错与最新诊断】（客观记录中断原因与现场状态）`,
      `4. 【已修改/生成文件清单】（记录已落盘与已修改的文件）`,
      `5. 【接力第一优先级待办事项 (Actionable Next Steps)】（必须梳理未完成切片并设为最高优先级待办，请明确未完成切片的具体行动路径，引导后继会话优先推进核心业务交付）`,
      ``,
      `【行动交付要求】`,
      `请必须使用 action: write_file 将交接文档写入 \`${targetHandoffRelativePath}\`。`,
      `如果直接返回 Markdown 正文，也请确保内容严格包含上述完整 5 维交接结构，且聚焦指导后继会话继续推进未完成核心业务。`
    ].join(`
`);
    let arbitratorResponseText = "";
    try {
      const arbRes = await arbitratorClient.sendMessage({
        text: arbitratorPrompt,
        conversationId: crypto7.randomUUID(),
        sessionId: arbitratorSessionId,
        requestId: crypto7.randomUUID(),
        signal
      });
      arbitratorResponseText = arbRes.text;
    } catch (arbErr) {
      if (signal?.aborted || arbErr?.name === "AbortError" || arbErr?.message?.includes("aborted")) {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      fs13.mkdirSync(handoffsDir, { recursive: true });
      const fallbackDoc = [
        `# \uD83D\uDD04 CPH-PI 容灾降级交接文档 (Arbitrator Session Failed)`,
        `> ⚠️ 仲裁会话执行异常 (${arbErr.message || String(arbErr)})，本地保障黑匣子生成与落盘。`,
        ``,
        disasterBlackbox
      ].join(`
`);
      fs13.writeFileSync(targetHandoffAbsolutePath, fallbackDoc, "utf8");
      this.lastHandoffDocPath = targetHandoffAbsolutePath;
      if (events?.onHandoff) {
        events.onHandoff(fallbackDoc, targetHandoffAbsolutePath);
      }
      return {
        finalAnswer: `429 Disaster recovery partial: arbitrator session failed (${arbErr.message || String(arbErr)}), blackbox persisted locally.`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: false,
        disasterBlackbox,
        handoffSnapshot: fallbackDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId,
        lastPartialOutput: params.lastPartialOutput
      };
    }
    fs13.mkdirSync(handoffsDir, { recursive: true });
    const parsed = ResilientParser.parse(arbitratorResponseText);
    if (parsed.type === "action") {
      events?.onToolStart?.(parsed.action);
      const toolResult = await this.bridge.executeAction(parsed.action, signal);
      events?.onToolEnd?.(toolResult);
    }
    const existingArbitrationDoc = fs13.existsSync(targetHandoffAbsolutePath) ? fs13.readFileSync(targetHandoffAbsolutePath, "utf8").trim() : "";
    if (existingArbitrationDoc.length < 50) {
      const candidateContent = (parsed.type === "handoff" ? parsed.handoffDoc || "" : parsed.type === "final_answer" ? parsed.answer.summary || parsed.answer.raw || arbitratorResponseText : parsed.type === "action" && parsed.action?.content ? parsed.action.content : arbitratorResponseText).trim();
      const contentToPersist = candidateContent.length >= 50 ? candidateContent : disasterBlackbox;
      fs13.writeFileSync(targetHandoffAbsolutePath, contentToPersist, "utf8");
    }
    this.lastHandoffDocPath = targetHandoffAbsolutePath;
    const finalDocContent = fs13.existsSync(targetHandoffAbsolutePath) ? fs13.readFileSync(targetHandoffAbsolutePath, "utf8") : disasterBlackbox;
    if (events?.onArbitratorHandoffComplete) {
      await Promise.resolve(events.onArbitratorHandoffComplete(targetHandoffAbsolutePath, arbitratorSessionId));
    }
    if (events?.onHandoff) {
      events.onHandoff(finalDocContent, targetHandoffAbsolutePath);
    }
    return {
      finalAnswer: `429 Disaster recovered via arbitrator session ${arbitratorSessionId}. Handoff document generated.`,
      turnsCount: history.length,
      completed: false,
      history,
      handedOff: true,
      disasterRecovered: true,
      disasterBlackbox,
      handoffSnapshot: finalDocContent,
      handoffDocPath: targetHandoffAbsolutePath,
      arbitratorSessionId,
      lastPartialOutput: params.lastPartialOutput
    };
  }
}

// src/agent/subagent-runner.ts
function cleanCandidatePath(raw) {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^[`'"]+|[`'"]+$/g, "");
  cleaned = cleaned.replace(/[,.;:!?`'"’”’\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F\uFF09\u3011\u300B\)>\]}]+$/, "");
  cleaned = cleaned.replace(/^[,\.;:!?`'"’”’\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F\uFF08\u3010\u300A\(<\[{]+/, "");
  return cleaned.trim();
}
function resolveExistingFilePath(candidate, workspaceRoot) {
  if (!candidate || typeof candidate !== "string")
    return null;
  const cleaned = cleanCandidatePath(candidate);
  if (!cleaned)
    return null;
  const tryCandidates = [cleaned];
  const cjkPunctIdx = cleaned.search(/[\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F]/);
  if (cjkPunctIdx !== -1) {
    const beforePunct = cleanCandidatePath(cleaned.substring(0, cjkPunctIdx));
    if (beforePunct && beforePunct !== cleaned) {
      tryCandidates.push(beforePunct);
    }
  }
  for (const item of tryCandidates) {
    try {
      const absPath = path19.isAbsolute(item) ? item : path19.resolve(workspaceRoot, item);
      if (fs14.existsSync(absPath) && fs14.statSync(absPath).isFile()) {
        return absPath;
      }
    } catch {}
  }
  return null;
}
function extractTargetFilePath(taskSpec, workspaceRoot) {
  if (!taskSpec)
    return null;
  const explicit = taskSpec.targetPath || taskSpec.file || taskSpec.filePath;
  if (typeof explicit === "string" && explicit.trim()) {
    return resolveExistingFilePath(explicit, workspaceRoot);
  }
  const texts = [taskSpec.prompt, taskSpec.description].filter((t) => typeof t === "string" && t.trim().length > 0);
  const quotedPrefixRegex = /(?:目标文件|针对文件|分析文件|读取文件|探查文件|target\s*file|file)[:：\s]+["'`]([^"'`\r\n]+)["'`]/gi;
  for (const text of texts) {
    quotedPrefixRegex.lastIndex = 0;
    let match;
    while ((match = quotedPrefixRegex.exec(text)) !== null) {
      const resolved = resolveExistingFilePath(match[1], workspaceRoot);
      if (resolved) {
        return resolved;
      }
    }
  }
  const unquotedPrefixRegex = /(?:目标文件|针对文件|分析文件|读取文件|探查文件|target\s*file|file)[:：\s]+([^\s\r\n`'"]+)/gi;
  for (const text of texts) {
    unquotedPrefixRegex.lastIndex = 0;
    let match;
    while ((match = unquotedPrefixRegex.exec(text)) !== null) {
      const resolved = resolveExistingFilePath(match[1], workspaceRoot);
      if (resolved) {
        return resolved;
      }
    }
  }
  const backtickRegex = /`([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9_]{1,10})`/g;
  for (const text of texts) {
    backtickRegex.lastIndex = 0;
    let match;
    while ((match = backtickRegex.exec(text)) !== null) {
      const resolved = resolveExistingFilePath(match[1], workspaceRoot);
      if (resolved) {
        return resolved;
      }
    }
  }
  return null;
}
var DEFAULT_MAIN_AGENT_ID = "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852";
var DEFAULT_CODER_AGENT_ID = "T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296";
var DEFAULT_RESEARCHER_AGENT_ID = "T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c";

class SubagentRunner {
  workspaceRoot;
  mainSessionId;
  coderAgentId;
  researcherAgentId;
  pool;
  chatClientFactory;
  loggerTree;
  modelTone;
  createOrchestratorFn;
  lineageTracker;
  maxAutonomousHops;
  staggerIntervalMs;
  constructor(options) {
    this.workspaceRoot = options.workspaceRoot;
    this.mainSessionId = options.mainSessionId;
    this.coderAgentId = options.coderAgentId || DEFAULT_CODER_AGENT_ID;
    this.researcherAgentId = options.researcherAgentId || DEFAULT_RESEARCHER_AGENT_ID;
    this.pool = options.pool;
    this.chatClientFactory = options.chatClientFactory;
    this.loggerTree = options.loggerTree || TerminalLogger.getInstance().initSessionTree(this.mainSessionId, this.workspaceRoot);
    this.modelTone = options.modelTone || "Gpt_61_Sol_Reasoning";
    this.createOrchestratorFn = options.createOrchestratorFn;
    this.lineageTracker = options.lineageTracker;
    this.maxAutonomousHops = options.maxAutonomousHops || 5;
    this.staggerIntervalMs = options.staggerIntervalMs ?? (process.argv.some((a) => a.includes("test")) ? 0 : 1500);
  }
  async executeBatch(tasks, signal, events) {
    const poolStatus = this.pool?.getPoolStatus?.() || [];
    const activeAllowedAccounts = poolStatus.filter((acc) => acc.isAllowed !== false && !acc.isThrottled && !acc.isLeased && !acc.authExpired && acc.isAvailable !== false);
    const effectiveCapacity = activeAllowedAccounts.length > 0 ? activeAllowedAccounts.length : poolStatus.length > 0 && poolStatus.every((a) => a.isThrottled) ? 1 : Math.max(1, poolStatus.length);
    const maxConcurrency = Math.max(1, Math.min(effectiveCapacity, tasks.length));
    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_QUEUE_SCHEDULED",
      totalTasks: tasks.length,
      maxConcurrency,
      poolSize: poolStatus.length,
      timestamp: Date.now()
    });
    const settled = new Array(tasks.length);
    const taskStageMap = tasks.map((t, idx) => ({
      index: idx,
      task: t,
      stage: Math.max(1, Math.floor(t.stage ?? 1))
    }));
    const uniqueStages = Array.from(new Set(taskStageMap.map((t) => t.stage))).sort((a, b) => a - b);
    let circuitBreakerTriggered = false;
    for (const stage of uniqueStages) {
      const stageTasks = taskStageMap.filter((t) => t.stage === stage);
      if (circuitBreakerTriggered) {
        for (const item of stageTasks) {
          settled[item.index] = {
            status: "rejected",
            reason: new Error(`STAGE_CIRCUIT_BREAKER: 阶段 ${stage} 因前序阶段任务失败被自动熔断阻断`)
          };
        }
        continue;
      }
      if (maxConcurrency <= 1) {
        for (const item of stageTasks) {
          if (circuitBreakerTriggered) {
            settled[item.index] = {
              status: "rejected",
              reason: new Error(`STAGE_CIRCUIT_BREAKER: 阶段 ${stage} 任务因前序任务失败被自动熔断阻断`)
            };
            continue;
          }
          if (signal?.aborted) {
            settled[item.index] = {
              status: "rejected",
              reason: new Error("Subagent execution aborted")
            };
            continue;
          }
          const taskSpec = item.task;
          const subId = `sub-${item.index + 1}-${crypto8.randomBytes(3).toString("hex")}`;
          const role = taskSpec.role === "researcher" ? "researcher" : "coder";
          try {
            const report = await this.runSingleSubagent(subId, role, taskSpec, signal, events);
            settled[item.index] = { status: "fulfilled", value: report };
          } catch (err) {
            settled[item.index] = { status: "rejected", reason: err };
          }
        }
      } else {
        let stageCursor = 0;
        const stageWorker = async () => {
          while (stageCursor < stageTasks.length) {
            if (signal?.aborted)
              return;
            const itemIndex = stageCursor++;
            const item = stageTasks[itemIndex];
            const taskSpec = item.task;
            const subId = `sub-${item.index + 1}-${crypto8.randomBytes(3).toString("hex")}`;
            const role = taskSpec.role === "researcher" ? "researcher" : "coder";
            try {
              const report = await this.runSingleSubagent(subId, role, taskSpec, signal, events);
              settled[item.index] = { status: "fulfilled", value: report };
            } catch (err) {
              settled[item.index] = { status: "rejected", reason: err };
            }
          }
        };
        const workers = Array.from({ length: Math.min(maxConcurrency, stageTasks.length) }, (_, workerIdx) => {
          if (workerIdx === 0 || this.staggerIntervalMs <= 0)
            return stageWorker();
          return new Promise((resolve) => {
            setTimeout(() => {
              stageWorker().then(resolve, resolve);
            }, workerIdx * this.staggerIntervalMs);
          });
        });
        await Promise.all(workers);
      }
      for (const item of stageTasks) {
        if (!settled[item.index]) {
          const reason = signal?.aborted ? new Error("Subagent execution aborted") : new Error(`STAGE_CIRCUIT_BREAKER: 阶段 ${stage} 任务因熔断或中断未执行`);
          settled[item.index] = {
            status: "rejected",
            reason
          };
        }
      }
      for (const item of stageTasks) {
        const res = settled[item.index];
        if (res?.status === "rejected" || res?.status === "fulfilled" && !res.value.success) {
          circuitBreakerTriggered = true;
          break;
        }
      }
    }
    for (let idx = 0;idx < tasks.length; idx++) {
      if (!settled[idx]) {
        settled[idx] = {
          status: "rejected",
          reason: new Error("STAGE_CIRCUIT_BREAKER: 任务未执行或被熔断阻断")
        };
      }
    }
    const activeMainSessionId = this.lineageTracker ? this.lineageTracker.resolveActiveHead(this.mainSessionId) : this.mainSessionId;
    if (activeMainSessionId !== this.mainSessionId) {
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_REROUTED_TO_SUCCESSOR",
        originalMainSessionId: this.mainSessionId,
        activeMainSessionId,
        subagentCount: tasks.length,
        timestamp: Date.now()
      });
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_DELIVERABLE_ROUTED",
        originalMainSessionId: this.mainSessionId,
        activeMainSessionId,
        timestamp: Date.now()
      });
    }
    return settled.map((result, idx) => {
      const task = tasks[idx] || {};
      const role = task.role === "researcher" ? "researcher" : "coder";
      const description = task.description || `Task ${idx + 1}`;
      if (result?.status === "fulfilled" && result.value) {
        return {
          ...result.value,
          targetSessionId: activeMainSessionId
        };
      }
      const reason = result?.reason;
      const isThrottled = reason?.code === "ALL_ACCOUNTS_THROTTLED" || /all accounts.*(?:throttled|rate limit|429)|429.*throttled/i.test(reason?.message || String(reason || ""));
      const isStageBreaker = String(reason?.message || reason || "").includes("STAGE_CIRCUIT_BREAKER");
      let errorMsg = String(reason?.message || reason || "STAGE_CIRCUIT_BREAKER");
      let finalAnswer = `子代理执行异常中断: ${errorMsg}`;
      if (isThrottled) {
        errorMsg = "ALL_ACCOUNTS_THROTTLED";
        finalAnswer = "❌ 子任务因全局账号池限流 (429) 中断，账号池枯竭。已保存现场断点，建议主会话等待冷却或通知用户介入。";
        this.loggerTree?.logTimelineEvent({
          type: "SUBAGENT_POOL_THROTTLED",
          subagentId: `sub-${idx + 1}`,
          role,
          targetSessionId: activeMainSessionId,
          timestamp: Date.now()
        });
      } else if (isStageBreaker) {
        errorMsg = "STAGE_CIRCUIT_BREAKER";
        finalAnswer = "⚠️ 该任务因前序阶段执行失败触发阶段屏障熔断，已自动跳过执行以保护工作区。";
      }
      return {
        id: `sub-${idx + 1}`,
        role,
        description,
        success: false,
        finalAnswer,
        turnsCount: 0,
        durationMs: 0,
        error: errorMsg,
        targetSessionId: activeMainSessionId
      };
    });
  }
  async runSingleSubagent(subId, role, spec, signal, events) {
    const startTime = Date.now();
    const customAgentId = role === "coder" ? this.coderAgentId : this.researcherAgentId;
    let currentSessionId = `${this.mainSessionId}_${subId}_${role}`;
    let subagentAccount = "";
    try {
      const leaseRes = await this.pool?.acquireSessionLease?.(currentSessionId, { forAgentId: customAgentId });
      subagentAccount = leaseRes?.email || "";
    } catch {}
    if (!subagentAccount && this.pool?.getSessionLease) {
      subagentAccount = this.pool.getSessionLease(currentSessionId) || "";
    }
    events?.onSubagentStart?.(subId, role, spec, 1, subagentAccount);
    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_STARTED",
      subagentId: subId,
      role,
      description: spec.description,
      account: subagentAccount || undefined,
      timestamp: startTime
    });
    const logStream = this.loggerTree?.createSubagentLogStream(subId, role);
    logStream?.write(`
=== 任务目标与初始提示词 (执行账号: ${subagentAccount || "默认"}) ===
${spec.prompt}
============================

`);
    let hopCount = 0;
    let currentTaskPrompt = spec.prompt;
    let previousSessionId = undefined;
    let totalTurns = 0;
    let lastFinalAnswer = "";
    let completed = false;
    let initialAnnotations = undefined;
    const targetFilePath = extractTargetFilePath(spec, this.workspaceRoot);
    const specTargetFiles = Array.isArray(spec.targetFiles) ? spec.targetFiles : [];
    const prerequisiteReports = Array.isArray(spec.prerequisiteReports) ? spec.prerequisiteReports : [];
    if (specTargetFiles.length > 0) {
      try {
        let graphToken;
        if (this.pool && typeof this.pool.getGraphAccessToken === "function") {
          graphToken = await this.pool.getGraphAccessToken();
        }
        if (graphToken) {
          const sliceResult = SnapshotGenerator.generateScopedSubagentSlice(this.workspaceRoot, specTargetFiles, prerequisiteReports);
          if (sliceResult && fs14.existsSync(sliceResult.slicePath)) {
            const sliceBuffer = fs14.readFileSync(sliceResult.slicePath);
            const sliceName = `subagent-slice-${subId}-${path19.basename(sliceResult.slicePath)}`;
            const uploaded = await SubstrateUploader.uploadDocumentAuto(graphToken, sliceBuffer, sliceName);
            if (uploaded && uploaded.annotation) {
              initialAnnotations = [uploaded.annotation];
              logStream?.write(`
☁️ [开局局部微切片已直传挂载] ${sliceResult.slicePath} (${sliceName}, ${sliceResult.bytes} bytes)
`);
            }
          }
        }
      } catch (err) {
        logStream?.write(`
⚠️ [开局局部微切片直传失败，降级本地工具读取] ${err?.message || err}
`);
      }
    } else if (targetFilePath && fs14.existsSync(targetFilePath)) {
      try {
        let graphToken;
        if (this.pool && typeof this.pool.getGraphAccessToken === "function") {
          graphToken = await this.pool.getGraphAccessToken();
        }
        if (graphToken) {
          const fileContent = fs14.readFileSync(targetFilePath, "utf8");
          const fileName = path19.basename(targetFilePath);
          const uploaded = await SubstrateUploader.uploadDocumentToOneDrive(graphToken, fileContent, fileName);
          if (uploaded && uploaded.annotation) {
            initialAnnotations = [uploaded.annotation];
            logStream?.write(`
☁️ [开局附件已直传挂载] ${targetFilePath} (${fileName})
`);
          }
        }
      } catch (err) {
        logStream?.write(`
⚠️ [开局附件直传失败，降级本地工具读取] ${err?.message || err}
`);
      }
    }
    let handoffSkills = [];
    try {
      const loader = new SkillLoader2(this.workspaceRoot);
      const discovered = loader.discoverSkills();
      const handoff = discovered.find((s) => s.name.toLowerCase() === "handoff");
      if (handoff) {
        handoffSkills = [handoff];
      }
    } catch {}
    try {
      while (hopCount < this.maxAutonomousHops) {
        hopCount++;
        if (this.lineageTracker) {
          this.lineageTracker.register({
            sessionId: currentSessionId,
            role,
            status: "active",
            parentSessionId: this.mainSessionId,
            predecessorId: previousSessionId
          });
          this.lineageTracker.linkSubagent(this.mainSessionId, currentSessionId);
          if (previousSessionId) {
            this.lineageTracker.linkSuccessor(previousSessionId, currentSessionId);
          }
        }
        const orchestrator = this.createOrchestratorFn ? this.createOrchestratorFn({
          workspaceRoot: this.workspaceRoot,
          customAgentId,
          subagentRole: role,
          sessionId: currentSessionId,
          pool: this.pool,
          chatClientFactory: this.chatClientFactory,
          modelTone: this.modelTone,
          skills: ["handoff"],
          activeSkills: handoffSkills,
          task: currentTaskPrompt
        }) : new Orchestrator({
          workspaceRoot: this.workspaceRoot,
          customAgentId,
          sessionId: currentSessionId,
          pool: this.pool,
          chatClientFactory: this.chatClientFactory,
          modelTone: this.modelTone,
          maxTurns: spec.maxTurns || 30,
          activeSkills: handoffSkills
        });
        const res = await orchestrator.run({
          task: currentTaskPrompt,
          initialAnnotations,
          signal,
          events: {
            onDelta: (delta) => {
              logStream?.write(delta);
              events?.onSubagentProgress?.(subId, -1, delta, undefined, hopCount, subagentAccount);
            },
            onTurnStart: (turn) => {
              if (this.pool?.getSessionLease) {
                const latest = this.pool.getSessionLease(currentSessionId);
                if (latest)
                  subagentAccount = latest;
              }
              logStream?.write(`
--- [Hop ${hopCount}] Turn ${turn} (账号: ${subagentAccount || "默认"}) ---
`);
              events?.onSubagentProgress?.(subId, turn, undefined, undefined, hopCount, subagentAccount);
            },
            onToolStart: (action) => {
              const actName = action?.tool || action?.action || "tool";
              const target = action?.path || action?.filePath || action?.command || "";
              logStream?.write(`
[Tool Start] ${actName} ${target}
`);
              events?.onSubagentProgress?.(subId, -1, undefined, action, hopCount, subagentAccount);
            },
            onToolEnd: (toolRes) => {
              logStream?.write(`
[Tool End] ${toolRes?.toolName || toolRes?.actionName} (success: ${toolRes?.success})
`);
            }
          }
        });
        totalTurns += res.turnsCount || 0;
        lastFinalAnswer = res.finalAnswer || "";
        if (res.completed) {
          completed = true;
          if (this.lineageTracker) {
            this.lineageTracker.register({
              sessionId: currentSessionId,
              role,
              status: "completed",
              parentSessionId: this.mainSessionId,
              predecessorId: previousSessionId
            });
          }
          break;
        }
        if (res.handedOff && res.handoffDocPath) {
          const docPath = res.handoffDocPath;
          const resolvedPath = path19.isAbsolute(docPath) ? docPath : path19.join(this.workspaceRoot, docPath);
          let docContent = "";
          if (fs14.existsSync(resolvedPath)) {
            docContent = fs14.readFileSync(resolvedPath, "utf8");
          } else {
            docContent = `（交接文档路径：${docPath}，前序总结：${res.finalAnswer || "无"}）`;
          }
          currentTaskPrompt = `【跨会话自主接力任务】前序子代理已达到 30 轮推理上限并输出交接文档。请根据下方交接文档中的【接力第一优先级待办事项】与【任务目标】，无缝接续攻坚并最终输出 FINAL_ANSWER：

` + docContent;
          previousSessionId = currentSessionId;
          this.pool?.releaseSessionLease?.(previousSessionId);
          const nextSessionId = `${this.mainSessionId}_${subId}_${role}_hop${hopCount + 1}`;
          if (this.lineageTracker) {
            this.lineageTracker.register({
              sessionId: nextSessionId,
              role,
              status: "active",
              parentSessionId: this.mainSessionId,
              predecessorId: previousSessionId
            });
            this.lineageTracker.linkSuccessor(previousSessionId, nextSessionId);
            this.lineageTracker.linkSubagent(this.mainSessionId, nextSessionId);
          }
          currentSessionId = nextSessionId;
          try {
            const nextLease = await this.pool?.acquireSessionLease?.(currentSessionId, { forAgentId: customAgentId });
            if (nextLease?.email) {
              subagentAccount = nextLease.email;
            }
          } catch {}
          if (!subagentAccount && this.pool?.getSessionLease) {
            subagentAccount = this.pool.getSessionLease(currentSessionId) || subagentAccount;
          }
          logStream?.write(`
========================================
` + `>>> [跨会话自主接力 Hop ${hopCount} -> ${hopCount + 1}] 新会话: ${nextSessionId} (账号: ${subagentAccount || "默认"}) <<<
` + `========================================

`);
          this.loggerTree?.logTimelineEvent({
            type: "SUBAGENT_CONTINUED",
            subagentId: subId,
            role,
            hop: hopCount,
            nextHop: hopCount + 1,
            handoffDocPath: docPath,
            account: subagentAccount || undefined,
            timestamp: Date.now()
          });
          continue;
        }
        break;
      }
      const durationMs = Date.now() - startTime;
      const success = completed;
      let finalAnswer = lastFinalAnswer;
      if (!success) {
        if (hopCount >= this.maxAutonomousHops) {
          finalAnswer = `子代理已达到最大自主接力代数上限 (${this.maxAutonomousHops} 代, 共 ${totalTurns} 轮)，任务尚未完全交付。` + (lastFinalAnswer ? ` 最后输出: ${lastFinalAnswer}` : "");
        } else if (!finalAnswer) {
          finalAnswer = `子代理执行结束，但未产生最终结论 (共 ${totalTurns} 轮)。`;
        }
      } else if (!finalAnswer) {
        finalAnswer = "子代理已完成，未提供详细文字总结。";
      }
      const targetSessionId = this.lineageTracker ? this.lineageTracker.resolveActiveHead(this.mainSessionId) : this.mainSessionId;
      const subHandoffCount = Math.max(0, hopCount - 1);
      logStream?.write(`
=== [Subagent ${subId} Finished: ${success ? "SUCCESS" : "FAILED"}] ` + `(Total Turns: ${totalTurns}, Hops: ${hopCount}, 接手: ${subHandoffCount} 次, 账号: ${subagentAccount || "默认"}) ===
`);
      let deliverablePath;
      try {
        const reportsDir = path19.join(this.workspaceRoot, ".cph", "reports");
        fs14.mkdirSync(reportsDir, { recursive: true });
        const reportFileName = `report-${role}-${subId}.md`;
        const absReportPath = path19.join(reportsDir, reportFileName);
        const header = [
          `# 专项任务交付报告: ${spec.description}`,
          ``,
          `- **子任务 ID**: ${subId}`,
          `- **执行角色**: ${role}`,
          `- **最终状态**: ${success ? "SUCCESS (已完成)" : "FAILED (未达成)"}`,
          `- **执行耗时**: ${(durationMs / 1000).toFixed(1)}s (共 ${totalTurns} 轮, ${hopCount} 代)`,
          `- **物理落盘时间**: ${new Date().toISOString()}`,
          ``,
          `## 原始需求要求`,
          `\`\`\`text`,
          spec.prompt,
          `\`\`\``,
          ``,
          `## 交付结题内容`,
          ``
        ].join(`
`);
        fs14.writeFileSync(absReportPath, header + finalAnswer + `
`, "utf8");
        deliverablePath = `.cph/reports/${reportFileName}`;
      } catch (saveErr) {}
      const report = {
        id: subId,
        role,
        description: spec.description,
        success,
        finalAnswer,
        deliverablePath,
        turnsCount: totalTurns,
        durationMs,
        targetSessionId,
        hopCount,
        handoffCount: subHandoffCount,
        account: subagentAccount || undefined
      };
      events?.onSubagentEnd?.(report);
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_FINISHED",
        subagentId: subId,
        role,
        account: subagentAccount || undefined,
        success: report.success,
        turnsCount: report.turnsCount,
        durationMs,
        targetSessionId,
        hopCount,
        handoffCount: subHandoffCount,
        timestamp: Date.now()
      });
      return report;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const targetSessionId = this.lineageTracker ? this.lineageTracker.resolveActiveHead(this.mainSessionId) : this.mainSessionId;
      const isThrottled = err?.code === "ALL_ACCOUNTS_THROTTLED" || /all accounts.*(?:throttled|rate limit|429)|429.*throttled/i.test(err?.message || "");
      let errorMsg = err?.message || String(err);
      let finalAnswer = `子任务执行失败: ${errorMsg}`;
      if (isThrottled) {
        errorMsg = "ALL_ACCOUNTS_THROTTLED";
        finalAnswer = "❌ 子任务因全局账号池限流 (429) 中断，账号池枯竭。已保存现场断点，建议主会话等待冷却或通知用户介入。";
        this.loggerTree?.logTimelineEvent({
          type: "SUBAGENT_POOL_THROTTLED",
          subagentId: subId,
          role,
          targetSessionId,
          timestamp: Date.now()
        });
      }
      const subHandoffCount = Math.max(0, hopCount - 1);
      logStream?.write(`
=== [Subagent ${subId} Error: ${errorMsg}] ` + `(Hops: ${Math.max(1, hopCount)}, 接手: ${subHandoffCount} 次, 账号: ${subagentAccount || "默认"}) ===
`);
      const report = {
        id: subId,
        role,
        description: spec.description,
        success: false,
        finalAnswer,
        turnsCount: totalTurns,
        durationMs,
        error: errorMsg,
        targetSessionId,
        hopCount: Math.max(1, hopCount),
        handoffCount: subHandoffCount,
        account: subagentAccount || undefined
      };
      events?.onSubagentEnd?.(report);
      return report;
    } finally {
      this.pool?.releaseSessionLease?.(currentSessionId);
      if (previousSessionId) {
        this.pool?.releaseSessionLease?.(previousSessionId);
      }
      if (logStream) {
        try {
          if (typeof logStream.end === "function") {
            await new Promise((resolve) => {
              let finished = false;
              const timer = setTimeout(() => {
                if (!finished) {
                  finished = true;
                  resolve();
                }
              }, 100);
              logStream.end(() => {
                if (!finished) {
                  finished = true;
                  clearTimeout(timer);
                  resolve();
                }
              });
            });
          }
        } catch {}
      }
    }
  }
  formatReportSummary(reports) {
    if (!reports || !Array.isArray(reports)) {
      return `### \uD83C\uDFAF 子代理多会话并发执行报告 (共 0 个子任务)
`;
    }
    const successCount = reports.filter((r) => r && r.success).length;
    const failedCount = reports.length - successCount;
    const isAllSuccess = successCount === reports.length;
    const isPartialSuccess = successCount > 0 && !isAllSuccess;
    const parts = [
      `### \uD83C\uDFAF 子代理多会话并发执行报告 (共 ${reports.length} 个子任务 | ${successCount} 成功, ${failedCount} 失败)`,
      `**执行判定**: ${isAllSuccess ? "✅ 全量成功" : isPartialSuccess ? "\uD83D\uDFE1 部分成功 (Partial Success)" : "❌ 全部失败"}`,
      `**成果物理落盘说明**: 所有子任务的完整结题报告与证据链已由 Harness 底层自动落盘为物理报告文件（\`.cph/reports/\`）。主控会话只收取结构化目录索引（TOC），零 Token 额外开销。`,
      ``
    ];
    for (let i = 0;i < reports.length; i++) {
      const r = reports[i];
      if (!r)
        continue;
      const statusIcon = r.success ? "✅ 成功" : "❌ 失败";
      const durationSec = ((r.durationMs ?? 0) / 1000).toFixed(1);
      const handoffs = r.handoffCount ?? Math.max(0, (r.hopCount || 1) - 1);
      const handoffLabel = handoffs > 0 ? ` (经 ${handoffs} 次接力)` : ` (接手 0 次)`;
      const accountBadge = r.account ? ` [账号: ${r.account}]` : "";
      const accountStatus = r.account ? `, 账号: ${r.account}` : "";
      const reportFile = r.deliverablePath || `.cph/reports/report-${r.role || "sub"}-${r.id}.md`;
      const rawAnswer = (r.finalAnswer || "").trim();
      const answerLines = rawAnswer.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const summarySnippet = answerLines.slice(0, 3).join(`
`).slice(0, 300) || "（无详细文字摘要）";
      parts.push(`#### [Sub-${i + 1}] [${r.role || "unknown"}]${accountBadge} ${r.description || ""}${handoffLabel}`);
      parts.push(`- **状态**: ${statusIcon} (耗时 ${durationSec}s, 共 ${r.turnsCount ?? 0} 轮, 接手 ${handoffs} 次${accountStatus})`);
      parts.push(`- **物理报告文件**: \`${reportFile}\``);
      parts.push(`- **核心交付摘要**:`);
      parts.push(summarySnippet);
      parts.push(``);
    }
    parts.push(`---`);
    parts.push(`【主控对账与推进指引 (Plan Convergence Guidance)】:`);
    parts.push(`1. 对于状态为【✅ 成功】的子任务，其完整交付报告已落盘至对应物理文件，请立即使用 patch_file 将 plan.md 对应项更新打勾为 \`- [x] ...\`；`);
    if (failedCount > 0) {
      parts.push(`2. 对于状态为【❌ 失败】的 ${failedCount} 项子任务，仅对其发起针对性的单点重试或补充调研，请保护并复用已成功编写的计划，针对失败项进行定向补充！`);
    } else {
      parts.push(`2. 所有规划子任务均已圆满交付，若无后续 Stage，即可验证后收敛输出 FINAL_ANSWER。`);
    }
    return parts.join(`
`);
  }
}

// src/web/rpc-handler.ts
class RpcHandler {
  ws;
  options;
  sessionManager;
  activeSessionId = null;
  inMemorySessions = [];
  turns = [];
  running = false;
  isInterrupted = false;
  workspaceRoot = null;
  cloudWorkspace = null;
  recentWorkspaces = [];
  pool;
  agentConfig;
  skillRegistry;
  activeAbortController;
  debug = false;
  debugLogPath;
  activeSubagentToolId = null;
  pendingHandoffSnapshot = null;
  maxAutonomousHandoffHops = 3;
  graphTokenProvider;
  get orchestrator() {
    return this.options.orchestrator;
  }
  static getGlobalConfigPath() {
    if (process.env.CPH_GLOBAL_CONFIG_PATH) {
      return process.env.CPH_GLOBAL_CONFIG_PATH;
    }
    return path20.join(os5.homedir(), ".cph", "global-config.json");
  }
  getGlobalConfigPath() {
    return RpcHandler.getGlobalConfigPath();
  }
  saveGlobalConfig(updates) {
    try {
      const globalConfigPath = this.getGlobalConfigPath();
      const dir = path20.dirname(globalConfigPath);
      if (!fs15.existsSync(dir)) {
        fs15.mkdirSync(dir, { recursive: true });
      }
      let current = {};
      if (fs15.existsSync(globalConfigPath)) {
        try {
          current = JSON.parse(fs15.readFileSync(globalConfigPath, "utf-8"));
        } catch {
          current = {};
        }
      }
      Object.assign(current, updates);
      fs15.writeFileSync(globalConfigPath, JSON.stringify(current, null, 2), "utf-8");
    } catch (err) {
      console.warn("[RpcHandler] Failed to save global config:", err.message);
    }
  }
  constructor(ws, options = {}) {
    this.ws = ws;
    this.options = options;
    this.debug = options.debug ?? options.cliApp?.isDebugModeEnabled?.() ?? false;
    this.debugLogPath = options.debugLogPath ?? options.cliApp?.getDebugLogPath?.();
    this.maxAutonomousHandoffHops = options.maxAutonomousHandoffHops ?? options.cliApp?.maxAutonomousHandoffHops ?? 3;
    this.graphTokenProvider = options.graphTokenProvider ?? options.cliApp?.graphTokenProvider;
    if (typeof options.workspaceRoot === "string") {
      this.workspaceRoot = path20.resolve(options.workspaceRoot);
    } else if (options.workspaceRoot === null) {
      this.workspaceRoot = null;
    } else {
      try {
        const globalConfigPath = this.getGlobalConfigPath();
        if (fs15.existsSync(globalConfigPath)) {
          const raw = JSON.parse(fs15.readFileSync(globalConfigPath, "utf-8"));
          if (raw.lastWorkspace && typeof raw.lastWorkspace === "string" && fs15.existsSync(raw.lastWorkspace)) {
            this.workspaceRoot = path20.resolve(raw.lastWorkspace);
          } else {
            this.workspaceRoot = null;
          }
        } else {
          this.workspaceRoot = null;
        }
      } catch {
        this.workspaceRoot = null;
      }
    }
    if (this.workspaceRoot) {
      this.recentWorkspaces = [this.workspaceRoot];
      try {
        const configPath = path20.join(this.workspaceRoot, ".cph", "config.json");
        if (fs15.existsSync(configPath)) {
          const raw = JSON.parse(fs15.readFileSync(configPath, "utf-8"));
          if (raw.cloudWorkspace) {
            this.cloudWorkspace = raw.cloudWorkspace;
          }
        }
      } catch {}
    } else {
      this.recentWorkspaces = [];
      this.cloudWorkspace = null;
    }
    this.pool = options.pool || new AccountPool;
    this.skillRegistry = options.skillRegistry || (options.cliApp && typeof options.cliApp.getSkillRegistry === "function" ? options.cliApp.getSkillRegistry() : new SkillRegistry(options.skillLoader || new SkillLoader2(this.workspaceRoot || process.cwd())));
    try {
      this.skillRegistry.loadSkills();
    } catch {}
    this.agentConfig = this.loadAgentConfig();
    if (this.workspaceRoot) {
      if (this.options.cliApp && typeof this.options.cliApp.setWorkspaceRoot === "function") {
        this.options.cliApp.setWorkspaceRoot(this.workspaceRoot);
      }
      if (this.options.orchestrator) {
        if (typeof this.options.orchestrator.setWorkspaceRoot === "function") {
          this.options.orchestrator.setWorkspaceRoot(this.workspaceRoot, this.skillRegistry);
        } else {
          this.options.orchestrator.workspaceRoot = this.workspaceRoot;
          if (this.options.orchestrator.bridge && typeof this.options.orchestrator.bridge.setCwd === "function") {
            this.options.orchestrator.bridge.setCwd(this.workspaceRoot);
          }
        }
      }
      try {
        this.sessionManager = options.sessionManager || new SessionManager(this.workspaceRoot);
      } catch {}
    } else {
      this.sessionManager = undefined;
    }
    if (this.ws && typeof this.ws.on === "function") {
      this.ws.on("message", (data) => {
        this.handleMessage(data);
      });
      this.ws.on("error", (err) => {
        console.warn("[RpcHandler] WebSocket error:", err.message);
      });
    }
    this.sendSnapshot();
  }
  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === import_websocket.default.OPEN) {
      try {
        if (this.debug) {
          if (type === "terminal:chunk" && payload && typeof payload.content === "string") {
            process.stdout.write(payload.content);
          } else if (type !== "assistant:chunk") {
            const timeStr = new Date().toISOString().slice(11, 19);
            const preview = payload ? JSON.stringify(payload).slice(0, 120) : "";
            process.stdout.write(`[${timeStr}] [Web RPC ==> ${type}] ${preview}
`);
          }
        }
        this.ws.send(JSON.stringify({ type, payload, data: payload }));
      } catch (err) {
        console.warn(`[RpcHandler] Failed to send packet ${type}:`, err.message);
      }
    }
  }
  async handleMessage(data) {
    try {
      const rawStr = typeof data === "string" ? data : data.toString("utf-8");
      const packet = JSON.parse(rawStr);
      if (!packet || typeof packet.type !== "string")
        return;
      const rawPayload = packet.payload !== undefined ? packet.payload : packet.data;
      if (this.debug) {
        const timeStr = new Date().toISOString().slice(11, 19);
        const preview = rawPayload ? JSON.stringify(rawPayload).slice(0, 120) : "";
        process.stdout.write(`[${timeStr}] [Web RPC <== ${packet.type}] ${preview}
`);
      }
      switch (packet.type) {
        case "session:new":
          this.handleSessionNew(rawPayload);
          break;
        case "session:select":
          this.handleSessionSelect(rawPayload);
          break;
        case "workspace:set":
          this.handleWorkspaceSet(rawPayload);
          break;
        case "workspace:verify-cloud":
          this.handleWorkspaceVerifyCloud(rawPayload);
          break;
        case "workspace:sync-cloud":
          this.handleWorkspaceSyncCloud(rawPayload);
          break;
        case "accounts:list":
          this.send("accounts:update", this.getAccountsPayload());
          break;
        case "accounts:toggle":
          this.handleAccountToggle(rawPayload);
          break;
        case "accounts:whitelist":
          this.handleAccountWhitelist(rawPayload);
          break;
        case "accounts:reset-cooldown":
        case "account:reset-cooldown":
        case "account:reset_cooldown":
          this.handleAccountResetCooldown(rawPayload);
          break;
        case "account:pkce_start":
        case "auth:start-pkce":
          this.handlePkceStart(rawPayload);
          break;
        case "account:pkce_complete":
        case "auth:exchange-code":
          await this.handlePkceComplete(rawPayload);
          break;
        case "agent:get":
          this.send("agent:update", this.getAgentConfigPayload());
          break;
        case "agent:set":
          this.handleAgentSet(rawPayload);
          break;
        case "agent:reset":
          this.handleAgentReset(rawPayload);
          break;
        case "agent:add-custom":
          this.handleAgentAddCustom(rawPayload);
          break;
        case "agent:remove-custom":
          this.handleAgentRemoveCustom(rawPayload);
          break;
        case "user:submit":
          this.handleUserSubmit(rawPayload);
          break;
        case "user:interrupt":
          this.handleUserInterrupt();
          break;
        case "skills:list":
          this.send("skills:update", {
            availableSkills: this.getAvailableSkillsPayload(),
            activeSkills: this.skillRegistry.getActiveSkills().map((s) => s.name),
            agentMountedSkills: Array.from(this.skillRegistry.getAgentMountedSkills())
          });
          break;
        case "skills:activate":
          if (packet.payload?.name) {
            this.skillRegistry.activateSkill(packet.payload.name);
            const active = this.skillRegistry.getActiveSkills().map((s) => s.name);
            this.send("context:update", { activeSkills: active });
            this.send("skills:update", {
              availableSkills: this.getAvailableSkillsPayload(),
              activeSkills: active,
              agentMountedSkills: Array.from(this.skillRegistry.getAgentMountedSkills())
            });
          }
          break;
        case "skills:deactivate":
          if (packet.payload?.name) {
            this.skillRegistry.deactivateSkill(packet.payload.name);
            const active = this.skillRegistry.getActiveSkills().map((s) => s.name);
            this.send("context:update", { activeSkills: active });
            this.send("skills:update", {
              availableSkills: this.getAvailableSkillsPayload(),
              activeSkills: active,
              agentMountedSkills: Array.from(this.skillRegistry.getAgentMountedSkills())
            });
          }
          break;
        case "skills:toggle-mounted":
          if (packet.payload?.name) {
            const isMounted = this.skillRegistry.toggleAgentMounted(packet.payload.name);
            const mountedArr = Array.from(this.skillRegistry.getAgentMountedSkills());
            this.saveWorkspaceConfig({ agentMountedSkills: mountedArr });
            this.send("skills:update", {
              availableSkills: this.getAvailableSkillsPayload(),
              activeSkills: this.skillRegistry.getActiveSkills().map((s) => s.name),
              agentMountedSkills: mountedArr
            });
            this.send("terminal:chunk", {
              stream: "system",
              content: `[Skill Registry] 技能 [${packet.payload.name}] 挂载模式已切换为: ${isMounted ? "Agent 内置已挂载 (免附件)" : "动态随任务挂载 (全量附件)"}
`
            });
          }
          break;
        case "skills:set-mounted":
          if (Array.isArray(packet.payload?.names)) {
            this.skillRegistry.setAgentMountedSkills(packet.payload.names);
            const mountedArr = Array.from(this.skillRegistry.getAgentMountedSkills());
            this.saveWorkspaceConfig({ agentMountedSkills: mountedArr });
            this.send("skills:update", {
              availableSkills: this.getAvailableSkillsPayload(),
              activeSkills: this.skillRegistry.getActiveSkills().map((s) => s.name),
              agentMountedSkills: mountedArr
            });
            this.send("terminal:chunk", {
              stream: "system",
              content: `[Skill Registry] 已同步更新 Agent 内置挂载技能清单 (共 ${mountedArr.length} 项)
`
            });
          }
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn("[RpcHandler] Failed to parse message:", err.message);
    }
  }
  getSessionsList() {
    if (this.sessionManager) {
      try {
        const list = this.sessionManager.listSessions();
        if (list && list.length > 0) {
          return list.map((item) => ({
            id: item.id,
            title: item.title,
            createdAt: new Date(item.createdAt).getTime(),
            updatedAt: new Date(item.updatedAt).getTime(),
            messageCount: item.turnCount || 0,
            cwd: item.workspaceRoot || this.options.workspaceRoot || process.cwd()
          }));
        }
      } catch {}
    }
    if (this.inMemorySessions.length === 0) {
      const defaultId = this.activeSessionId || `ses_${Date.now()}`;
      this.inMemorySessions.push({
        id: defaultId,
        title: "默认会话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        cwd: this.options.workspaceRoot || process.cwd()
      });
      if (!this.activeSessionId) {
        this.activeSessionId = defaultId;
      }
    }
    return this.inMemorySessions;
  }
  loadSessionTurns(sessionId) {
    if (!this.sessionManager)
      return;
    try {
      const record = this.sessionManager.loadSession(sessionId);
      if (record && Array.isArray(record.turns)) {
        this.turns = record.turns.map((t, idx) => ({
          id: `turn-${idx + 1}`,
          turnNumber: t.turnNumber || idx + 1,
          userMessage: { text: t.userInput || "" },
          reasoning: t.modelReasoning ? { text: t.modelReasoning, isStreaming: false } : undefined,
          assistantText: t.modelResponse || "",
          tools: (t.toolCalls || []).map((tc, tcIdx) => ({
            id: `tool-${idx}-${tcIdx}`,
            name: tc.tool,
            args: tc.args || {},
            status: tc.success === false ? "failed" : "completed",
            output: tc.output
          })),
          status: "completed"
        }));
      } else {
        this.turns = [];
      }
    } catch {
      this.turns = [];
    }
  }
  async persistActiveSession() {
    if (!this.sessionManager || !this.activeSessionId)
      return;
    try {
      const modelTone = this.options.cliApp?.getModelTone?.() || this.options.orchestrator?.modelTone || this.agentConfig?.modelTone || "Gpt_61_Sol_Reasoning";
      const maxTurns = this.options.cliApp?.getMaxTurns?.() || this.options.orchestrator?.maxTurns || 30;
      const record = this.sessionManager.loadSession(this.activeSessionId) || {
        id: this.activeSessionId,
        title: "当前会话",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        workspaceRoot: this.workspaceRoot || process.cwd(),
        status: "active",
        maxTurns,
        modelTone,
        turnCount: 0,
        turns: []
      };
      if (this.options.cliApp?.getModelTone?.()) {
        record.modelTone = this.options.cliApp.getModelTone();
      }
      if (this.options.cliApp?.getMaxTurns?.()) {
        record.maxTurns = this.options.cliApp.getMaxTurns();
      }
      record.turns = this.turns.map((t) => ({
        turnNumber: t.turnNumber,
        userInput: t.userMessage?.text || "",
        modelReasoning: t.reasoning?.text,
        modelResponse: t.assistantText || "",
        toolCalls: (t.tools || []).map((tc) => ({
          tool: tc.name,
          args: tc.args,
          output: tc.output,
          success: tc.status !== "failed"
        })),
        timestamp: Date.now(),
        durationMs: t.metrics?.durationMs
      }));
      record.turnCount = record.turns.length;
      this.sessionManager.saveSession(record);
    } catch (err) {
      console.warn("[RpcHandler] Failed to persist active session:", err.message);
    }
  }
  persistSubagentRecord(subagentId, data) {
    if (!subagentId || !this.workspaceRoot || !this.activeSessionId)
      return;
    try {
      const cleanMain = this.activeSessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const cleanSub = subagentId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const subDir = path20.join(this.workspaceRoot, ".cph", "subagents", cleanMain);
      fs15.mkdirSync(subDir, { recursive: true });
      fs15.writeFileSync(path20.join(subDir, `${cleanSub}.json`), JSON.stringify({ ...data, parentSessionId: this.activeSessionId, updatedAt: Date.now() }, null, 2), "utf-8");
    } catch (err) {
      console.warn("[RpcHandler] Failed to persist subagent record:", err.message);
    }
  }
  handleSubagentStart(id, role, spec, hop, account) {
    this.send("subagent:start", {
      toolId: this.activeSubagentToolId,
      subagentId: id,
      role,
      spec,
      hopCount: hop ?? 0,
      account
    });
  }
  handleSubagentProgress(id, turn, delta, action, hopCount, account) {
    this.send("subagent:progress", {
      subagentId: id,
      turn,
      delta,
      action,
      hopCount: hopCount ?? 0,
      account
    });
  }
  handleSubagentEnd(report) {
    this.persistSubagentRecord(report?.id, report);
    this.send("subagent:end", {
      subagentId: report?.id,
      report
    });
  }
  handleHandoffOccurred(snapshot, docPath) {
    const memoSnippet = snapshot ? snapshot.slice(0, 300) : "";
    const genMatch = this.activeSessionId ? this.activeSessionId.match(/_gen(\d+)/) : null;
    const currentGen = genMatch ? parseInt(genMatch[1], 10) : 1;
    this.pendingHandoffSnapshot = snapshot;
    this.send("session:handoff", {
      predecessorSessionId: this.activeSessionId,
      successorSessionId: this.activeSessionId,
      handoffDocPath: docPath,
      memoSnippet,
      generation: currentGen
    });
  }
  handleSuccessorAwakened(newSessionId, generation) {
    const prevId = this.activeSessionId;
    this.activeSessionId = newSessionId;
    const existing = this.inMemorySessions.find((s) => s.id === prevId);
    if (existing) {
      existing.id = newSessionId;
      existing.title = `会话 Gen ${generation}`;
      existing.updatedAt = Date.now();
    }
    this.send("session:handoff", {
      predecessorSessionId: prevId,
      successorSessionId: newSessionId,
      generation,
      handoffDocPath: undefined,
      memoSnippet: this.pendingHandoffSnapshot ? this.pendingHandoffSnapshot.slice(0, 300) : ""
    });
    this.sendSnapshot();
  }
  getAvailableSkillsPayload() {
    return this.skillRegistry.getAvailableSkills().map((s) => ({
      name: s.name,
      description: s.description || "",
      source: s.source || "user",
      isAgentMounted: this.skillRegistry.isAgentMounted(s.name)
    }));
  }
  sendSnapshot() {
    const sessions = this.getSessionsList();
    if (!this.activeSessionId && sessions.length > 0) {
      this.activeSessionId = sessions[0].id;
    }
    const activeSkillNames = this.skillRegistry.getActiveSkills().map((s) => s.name);
    const contextMetrics = {
      usedTokens: 18420,
      maxTokens: 128000,
      workingMemoryPercent: 14.4,
      activeSkills: activeSkillNames.length > 0 ? activeSkillNames : ["handoff", "tdd", "systematic-debugging"],
      fingerprintTOC: [
        "CPH-PI/src/cli.ts",
        "CPH-PI/src/web/server.ts",
        "CPH-PI/src/session/session-manager.ts"
      ],
      activeAgent: this.agentConfig.customAgentId ? "专属智能体直连" : "cph-dev-agent"
    };
    const workspaceFiles = this.workspaceRoot ? scanWorkspaceFiles(this.workspaceRoot) : [];
    const accountsPayload = this.getAccountsPayload();
    this.send("session:snapshot", {
      sessions,
      activeSessionId: this.activeSessionId,
      turns: this.turns,
      ledgerEntries: [],
      contextMetrics,
      running: this.running,
      workspaceRoot: this.workspaceRoot,
      cloudWorkspace: this.cloudWorkspace,
      recentWorkspaces: this.recentWorkspaces,
      workspaceFiles,
      accounts: accountsPayload.accounts,
      allowedAccounts: accountsPayload.allowedAccounts,
      agentConfig: this.getAgentConfigPayload(),
      availableSkills: this.getAvailableSkillsPayload(),
      agentMountedSkills: Array.from(this.skillRegistry.getAgentMountedSkills())
    });
  }
  handleWorkspaceSet(payload) {
    if (!payload?.path && !this.workspaceRoot) {
      this.send("workspace:error", { message: "工作区路径不能为空" });
      return;
    }
    if (payload?.path) {
      const targetPath = path20.resolve(payload.path);
      try {
        if (!fs15.existsSync(targetPath)) {
          this.send("workspace:error", { message: `工作区路径不存在: ${targetPath}` });
          return;
        }
        const stat = fs15.statSync(targetPath);
        if (!stat.isDirectory()) {
          this.send("workspace:error", { message: `指定路径不是有效文件夹: ${targetPath}` });
          return;
        }
        this.workspaceRoot = targetPath;
        this.options.workspaceRoot = targetPath;
        if (payload.cloudWorkspace !== undefined) {
          this.cloudWorkspace = payload.cloudWorkspace;
        }
        this.recentWorkspaces = [
          targetPath,
          ...this.recentWorkspaces.filter((p) => p !== targetPath)
        ].slice(0, 5);
        this.skillRegistry = new SkillRegistry(new SkillLoader2(this.workspaceRoot));
        try {
          const configPath = path20.join(this.workspaceRoot, ".cph", "config.json");
          if (fs15.existsSync(configPath)) {
            const raw = JSON.parse(fs15.readFileSync(configPath, "utf-8"));
            if (Array.isArray(raw.agentMountedSkills)) {
              this.skillRegistry.setAgentMountedSkills(raw.agentMountedSkills);
            }
            if (raw.cloudWorkspace && payload.cloudWorkspace === undefined) {
              this.cloudWorkspace = raw.cloudWorkspace;
            }
          }
          this.skillRegistry.loadSkills();
        } catch {}
        if (this.options.cliApp && typeof this.options.cliApp.setWorkspaceRoot === "function") {
          this.options.cliApp.setWorkspaceRoot(this.workspaceRoot);
        }
        if (this.options.orchestrator) {
          if (typeof this.options.orchestrator.setWorkspaceRoot === "function") {
            this.options.orchestrator.setWorkspaceRoot(this.workspaceRoot, this.skillRegistry);
          } else {
            this.options.orchestrator.workspaceRoot = this.workspaceRoot;
            if (this.options.orchestrator.bridge && typeof this.options.orchestrator.bridge.setCwd === "function") {
              this.options.orchestrator.bridge.setCwd(this.workspaceRoot);
            }
          }
        } else if (this.options.cliApp && typeof this.options.cliApp.getOrchestrator === "function") {
          this.options.orchestrator = this.options.cliApp.getOrchestrator();
        }
        try {
          this.sessionManager = new SessionManager(this.workspaceRoot);
        } catch {}
        this.saveWorkspaceConfig({
          workspaceRoot: this.workspaceRoot,
          cloudWorkspace: this.cloudWorkspace
        });
        this.saveGlobalConfig({ lastWorkspace: this.workspaceRoot });
        const workspaceFiles = scanWorkspaceFiles(this.workspaceRoot);
        this.send("workspace:update", {
          workspaceRoot: this.workspaceRoot,
          cloudWorkspace: this.cloudWorkspace,
          recentWorkspaces: this.recentWorkspaces,
          workspaceFiles
        });
        this.sendSnapshot();
      } catch (err) {
        this.send("workspace:error", { message: `切换工作区失败: ${err.message}` });
      }
      return;
    }
    if (payload?.cloudWorkspace !== undefined) {
      this.cloudWorkspace = payload.cloudWorkspace;
      this.saveWorkspaceConfig({
        workspaceRoot: this.workspaceRoot,
        cloudWorkspace: this.cloudWorkspace
      });
      const workspaceFiles = this.workspaceRoot ? scanWorkspaceFiles(this.workspaceRoot) : [];
      this.send("workspace:update", {
        workspaceRoot: this.workspaceRoot,
        cloudWorkspace: this.cloudWorkspace,
        recentWorkspaces: this.recentWorkspaces,
        workspaceFiles
      });
      this.sendSnapshot();
    }
  }
  async handleWorkspaceVerifyCloud(payload) {
    const wsRoot = payload?.workspaceRoot || this.workspaceRoot;
    if (!wsRoot) {
      this.send("workspace:verify-result", {
        valid: false,
        reason: "未指定工作区路径 (No workspace root specified)",
        details: null
      });
      return;
    }
    try {
      const engine = new PnPWorkspaceSyncEngine;
      const siteUrl = payload?.siteUrl || this.cloudWorkspace?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
      const targetFolder = payload?.targetFolder || this.cloudWorkspace?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
      const res = await engine.verifyCloudMirror({
        workspaceRoot: wsRoot,
        siteUrl,
        targetFolder,
        mockTransport: payload?.mockTransport
      });
      this.send("workspace:verify-result", {
        valid: res.valid,
        reason: res.reason,
        details: res
      });
    } catch (err) {
      this.send("workspace:verify-result", {
        valid: false,
        reason: err.message || "Cloud workspace verification failed",
        details: null
      });
    }
  }
  async handleWorkspaceSyncCloud(payload) {
    const wsRoot = payload?.workspaceRoot || this.workspaceRoot;
    if (!wsRoot) {
      this.send("workspace:sync-report", {
        status: "failed",
        error: "未指定工作区路径 (No workspace root specified)"
      });
      return;
    }
    const siteUrl = payload?.siteUrl || this.cloudWorkspace?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = payload?.targetFolder || this.cloudWorkspace?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    this.send("terminal:chunk", {
      stream: "system",
      content: `[SharePoint Sync] 开始云端对账: ${targetFolder}
`
    });
    try {
      const engine = new PnPWorkspaceSyncEngine;
      const report = await engine.syncCloudWorkspace({
        workspaceRoot: wsRoot,
        siteUrl,
        targetFolder,
        mockTransport: payload?.mockTransport,
        skipVerify: payload?.skipVerify
      });
      const nowIso = new Date().toISOString();
      if (!this.cloudWorkspace) {
        this.cloudWorkspace = {
          siteUrl,
          targetFolder,
          verified: true,
          lastSyncedAt: nowIso
        };
      } else {
        this.cloudWorkspace.lastSyncedAt = nowIso;
        this.cloudWorkspace.verified = true;
      }
      if (!this.workspaceRoot) {
        this.workspaceRoot = path20.resolve(wsRoot);
      }
      this.saveWorkspaceConfig({ cloudWorkspace: this.cloudWorkspace });
      this.send("terminal:chunk", {
        stream: "system",
        content: `[SharePoint Sync] 对账完成: 同步 ${report.syncedCount} 个, 跳过 ${report.skippedCount} 个, 清理 ${report.prunedCount} 个, 失败 ${report.failedCount} 个 (${report.durationMs}ms)
`
      });
      this.send("workspace:sync-report", {
        status: "completed",
        report
      });
    } catch (err) {
      this.send("terminal:chunk", {
        stream: "stderr",
        content: `[SharePoint Sync] 对账失败: ${err.message}
`
      });
      this.send("workspace:sync-report", {
        status: "failed",
        error: err.message
      });
    }
  }
  handleSessionNew(payload) {
    if (this.options.orchestrator && typeof this.options.orchestrator.resetHandshake === "function") {
      this.options.orchestrator.resetHandshake();
    }
    const title = payload?.title || "新会话";
    let newId = `ses_${Date.now()}`;
    const modelTone = this.options.cliApp?.getModelTone?.() || this.options.orchestrator?.modelTone || this.agentConfig?.modelTone || "Gpt_61_Sol_Reasoning";
    const maxTurns = this.options.cliApp?.getMaxTurns?.() || this.options.orchestrator?.maxTurns || 30;
    if (this.sessionManager) {
      try {
        const created = this.sessionManager.createSession({
          title,
          workspaceRoot: this.workspaceRoot || undefined,
          modelTone,
          maxTurns
        });
        newId = created.id;
      } catch {
        this.inMemorySessions.unshift({
          id: newId,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
          cwd: this.options.workspaceRoot || process.cwd()
        });
      }
    } else {
      this.inMemorySessions.unshift({
        id: newId,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        cwd: this.options.workspaceRoot || process.cwd()
      });
    }
    this.activeSessionId = newId;
    this.turns = [];
    this.sendSnapshot();
  }
  handleSessionSelect(payload) {
    if (payload?.sessionId) {
      this.activeSessionId = payload.sessionId;
      this.loadSessionTurns(payload.sessionId);
      this.sendSnapshot();
    }
  }
  async handleUserSubmit(payload) {
    const rawText = payload?.text || "";
    this.running = true;
    this.isInterrupted = false;
    let targetSkill = undefined;
    let executionTask = rawText;
    if (rawText.trim().startsWith("/")) {
      const parsedSlash = this.skillRegistry.parseSlashCommand(rawText.trim());
      if (parsedSlash.skill) {
        targetSkill = parsedSlash.skill;
        this.skillRegistry.activateSkill(targetSkill.name);
        executionTask = parsedSlash.task || rawText;
        const activeSkillNames = this.skillRegistry.getActiveSkills().map((s) => s.name);
        this.send("context:update", { activeSkills: activeSkillNames });
      }
    }
    if (this.pendingHandoffSnapshot) {
      const prefix = `【前序会话成果与交接备忘录】
${this.pendingHandoffSnapshot}

【接力任务目标】
`;
      executionTask = prefix + executionTask;
      this.pendingHandoffSnapshot = null;
    }
    const turnId = `turn-${Date.now()}`;
    const newTurn = {
      id: turnId,
      turnNumber: this.turns.length + 1,
      userMessage: {
        text: rawText,
        attachments: payload?.attachments
      },
      reasoning: {
        text: targetSkill ? this.skillRegistry.isAgentMounted(targetSkill.name) ? `\uD83C\uDFAF 已唤醒 Agent 内置技能: [${targetSkill.name}] (已内化于专属知识库，免附件轻量化传输)
${targetSkill.description ? `说明: ${targetSkill.description}

` : `
`}` : `\uD83C\uDFAF 已动态全量挂载技能: [${targetSkill.name}] (随任务下发完整规范手册与附件)
${targetSkill.description ? `说明: ${targetSkill.description}

` : `
`}` : "",
        isStreaming: true
      },
      assistantText: "",
      tools: [],
      status: "streaming"
    };
    this.turns.push(newTurn);
    if (this.options.orchestrator) {
      try {
        await this.runOrchestrator(newTurn, executionTask, targetSkill);
      } catch (err) {
        newTurn.status = "error";
        this.send("turn:end", { error: err?.message || String(err) });
      } finally {
        this.running = false;
        if (this.pool && this.activeSessionId) {
          this.pool.releaseSessionLease(this.activeSessionId);
        }
      }
    } else {
      try {
        await this.runDefaultGeneration(newTurn, executionTask, targetSkill);
      } finally {
        if (this.pool && this.activeSessionId) {
          this.pool.releaseSessionLease(this.activeSessionId);
        }
      }
    }
  }
  async runOrchestrator(turn, task, targetSkill) {
    const orchestrator = this.options.orchestrator;
    if (this.workspaceRoot && orchestrator) {
      if (typeof orchestrator.setWorkspaceRoot === "function") {
        orchestrator.setWorkspaceRoot(this.workspaceRoot, this.skillRegistry);
      } else {
        if (orchestrator.workspaceRoot !== this.workspaceRoot) {
          orchestrator.workspaceRoot = this.workspaceRoot;
        }
        if (orchestrator.bridge && typeof orchestrator.bridge.setCwd === "function") {
          orchestrator.bridge.setCwd(this.workspaceRoot);
        }
      }
    }
    const abortController = new AbortController;
    this.activeAbortController = abortController;
    const mountedSkills = this.skillRegistry.getAgentMountedSkills();
    const mountedSkillObjs = mountedSkills.map((name) => this.skillRegistry.findSkill(name)).filter((s) => Boolean(s));
    let skillsToUse;
    if (targetSkill) {
      const filteredMounted = mountedSkillObjs.filter((s) => s.name.toLowerCase() !== targetSkill.name.toLowerCase());
      skillsToUse = [targetSkill, ...filteredMounted];
    } else {
      skillsToUse = this.skillRegistry.getActiveSkills();
    }
    const rootTaskPrompt = task;
    let currentTaskPrompt = task;
    let currentInitialAnnotations = undefined;
    let hopCount = 0;
    let currentTurn = turn;
    const modelTone = this.options.cliApp?.getModelTone?.() || this.options.orchestrator?.modelTone || this.agentConfig?.modelTone || "Gpt_61_Sol_Reasoning";
    const maxTurns = this.options.cliApp?.getMaxTurns?.() || this.options.orchestrator?.maxTurns || 30;
    if (typeof orchestrator.run === "function") {
      try {
        while (true) {
          if (abortController.signal.aborted || this.isInterrupted) {
            break;
          }
          const sessionId = this.activeSessionId || `ses_${Date.now()}`;
          const startTime = Date.now();
          let toolCounter = 0;
          let turnFinalized = false;
          const runResult = await orchestrator.run({
            task: currentTaskPrompt,
            sessionId,
            signal: abortController.signal,
            activeSkills: skillsToUse,
            initialAnnotations: currentInitialAnnotations,
            rootUserPrompt: rootTaskPrompt,
            events: {
              onDelta: (chunk) => {
                if (this.isInterrupted)
                  return;
                if (currentTurn.reasoning)
                  currentTurn.reasoning.isStreaming = false;
                currentTurn.assistantText = (currentTurn.assistantText || "") + chunk;
                this.send("assistant:chunk", { chunk });
              },
              onReasoning: (chunk) => {
                if (this.isInterrupted)
                  return;
                if (currentTurn.reasoning) {
                  currentTurn.reasoning.text += chunk;
                  currentTurn.reasoning.isStreaming = true;
                }
                this.send("reasoning:chunk", { chunk });
              },
              onTurnStart: (turnNum) => {
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `[Copilot Engine] 轮次 ${turnNum} 开始执行...
`
                });
              },
              onToolStart: (action) => {
                toolCounter++;
                const toolId = `tool-${Date.now()}-${toolCounter}`;
                const toolName = action?.tool || action?.action || "tool";
                const toolArgs = action?.args || action || {};
                if (toolName === "invoke_subagent") {
                  this.activeSubagentToolId = toolId;
                }
                const toolCall = {
                  id: toolId,
                  name: toolName,
                  args: toolArgs,
                  status: "running"
                };
                currentTurn.tools.push(toolCall);
                this.send("tool:update", { tool: toolCall, turnId: currentTurn.id });
                this.send("terminal:chunk", {
                  stream: "stdout",
                  content: `$ ${toolName} ${JSON.stringify(toolArgs)}
`
                });
              },
              onToolEnd: (result) => {
                const lastTool = currentTurn.tools[currentTurn.tools.length - 1];
                if (lastTool?.name === "invoke_subagent") {
                  this.activeSubagentToolId = null;
                }
                if (lastTool) {
                  lastTool.status = result?.success === false ? "failed" : "completed";
                  lastTool.output = result?.output || result?.content || "";
                  lastTool.durationMs = result?.durationMs;
                  if (result?.diff)
                    lastTool.diff = result.diff;
                  this.send("tool:update", { tool: lastTool, turnId: currentTurn.id });
                }
                if (result?.stepId || result?.exitCode !== undefined) {
                  const entry = {
                    stepId: result.stepId || toolCounter,
                    timestamp: Date.now(),
                    toolName: lastTool?.name || "tool",
                    argsHash: result.argsHash || "sha256:auto",
                    exitCode: result.exitCode ?? (result.success ? 0 : 1),
                    durationMs: result.durationMs || 0,
                    evidencePath: result.evidencePath
                  };
                  this.send("wal:append", entry);
                }
              },
              onSubagentStart: (id, role, spec, hop, account) => {
                this.handleSubagentStart(id, role, spec, hop, account);
              },
              onSubagentProgress: (id, turn, delta, action, hopCount, account) => {
                this.handleSubagentProgress(id, turn, delta, action, hopCount, account);
              },
              onSubagentEnd: (report) => {
                this.handleSubagentEnd(report);
              },
              onRefusalIntercepted: (refusal, attempt) => {
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `⚠️ [Sydney Gateway] 检测到网关审查/拦截 (重试 ${attempt}): ${refusal.slice(0, 100)}
`
                });
              },
              onCompacted: (cleared, ratio) => {
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `[Context Compaction] 历史滑动压实完成，释放 ${cleared} 字符 (~${Math.round(ratio * 100)}% 压缩比)
`
                });
                this.send("context:update", { compactionRatio: ratio, clearedChars: cleared });
              },
              onDisasterOccurred: (blackbox, lastError) => {
                const shortErr = lastError ? lastError.replace(/[\r\n]+/g, " ").slice(0, 120) : "连接中断或频控异常";
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `
[Disaster Recovery] ⚠️ 检测到网络/频控异常中断 (${shortErr})，正在提取黑匣子快照...
`
                });
              },
              onArbitratorHandoffStart: (arbId, email) => {
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `[Disaster Recovery] 启动仲裁微会话 (${arbId.slice(0, 16)}...)，轮换账号 ${email} 正在生成交接文档...
`
                });
              },
              onArbitratorHandoffComplete: (docPath, arbId) => {
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `[Disaster Recovery] 仲裁交接完成，交接文档已落盘: ${path20.basename(docPath)}

`
                });
              },
              onAccountSwitched: (oldEmail, newEmail) => {
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `[Account Pool] 已自动切换账号: ${oldEmail} -> ${newEmail}
`
                });
                this.send("accounts:update", this.getAccountsPayload());
              },
              onHandoff: (snapshot, docPath) => {
                const docName = docPath ? path20.basename(docPath) : "handoff.md";
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `[Handoff] 会话已安全生成阶段性交接文档: ${docName}
`
                });
                this.handleHandoffOccurred(snapshot, docPath);
              },
              onSuccessorAwakened: (newSessionId, generation) => {
                this.handleSuccessorAwakened(newSessionId, generation);
              },
              onCompleted: async (ans) => {
                turnFinalized = true;
                if (currentTurn.reasoning)
                  currentTurn.reasoning.isStreaming = false;
                currentTurn.status = "completed";
                const durationMs = Date.now() - startTime;
                const totalChars = (currentTurn.assistantText?.length || 0) + (currentTurn.reasoning?.text?.length || 0);
                const tokens = Math.max(1, Math.round(totalChars / 2));
                const tps = durationMs > 200 ? Math.round(tokens / (durationMs / 1000) * 10) / 10 : undefined;
                currentTurn.metrics = {
                  durationMs,
                  model: "copilot-substrate",
                  tokens,
                  tokensOut: tokens,
                  ...tps !== undefined ? { tps } : {}
                };
                this.send("turn:end", { metrics: currentTurn.metrics });
                await this.persistActiveSession();
              },
              onError: async (err) => {
                turnFinalized = true;
                currentTurn.status = "error";
                this.send("turn:end", { error: err.message, status: "error" });
                await this.persistActiveSession();
              },
              onAttachmentUploaded: (attachment, toolName) => {
                this.send("terminal:chunk", {
                  stream: "system",
                  content: `[Substrate] 已无损上传附件: ${attachment.fileName || attachment.name} (${toolName})
`
                });
              }
            }
          });
          if (!turnFinalized) {
            if (currentTurn.reasoning)
              currentTurn.reasoning.isStreaming = false;
            const durationMs = Date.now() - startTime;
            const totalChars = (currentTurn.assistantText?.length || 0) + (currentTurn.reasoning?.text?.length || 0);
            const tokens = Math.max(1, Math.round(totalChars / 2));
            const tps = durationMs > 200 ? Math.round(tokens / (durationMs / 1000) * 10) / 10 : undefined;
            currentTurn.metrics = {
              durationMs,
              model: "copilot-substrate",
              tokens,
              tokensOut: tokens,
              ...tps !== undefined ? { tps } : {}
            };
            if (runResult?.handedOff) {
              currentTurn.status = "completed";
              const docName = runResult.handoffDocPath ? path20.basename(runResult.handoffDocPath) : "handoff.md";
              if (!this.pendingHandoffSnapshot && runResult.handoffSnapshot) {
                this.handleHandoffOccurred(runResult.handoffSnapshot, runResult.handoffDocPath);
              }
              if (!currentTurn.assistantText) {
                currentTurn.assistantText = `\uD83D\uDD04 **会话已安全完成阶段性成果交接 (Handoff)**

- **交接文档**: \`${docName}\`
- **状态**: 单轮推理达到阶段上限或检测到网络中断，当前已生成高保真阶段性交接文档并完整落盘至 \`.cph/handoffs/\`。`;
                this.send("assistant:chunk", { chunk: currentTurn.assistantText });
              }
              this.send("turn:end", {
                metrics: currentTurn.metrics,
                status: "handed_off",
                handoffDocPath: runResult.handoffDocPath
              });
            } else {
              currentTurn.status = "completed";
              if (runResult?.finalAnswer && !currentTurn.assistantText) {
                currentTurn.assistantText = runResult.finalAnswer;
                this.send("assistant:chunk", { chunk: currentTurn.assistantText });
              }
              this.send("turn:end", { metrics: currentTurn.metrics });
            }
            turnFinalized = true;
            await this.persistActiveSession();
          }
          if (runResult?.handedOff && hopCount < this.maxAutonomousHandoffHops) {
            hopCount++;
            const nextStage = hopCount + 1;
            const prevSessionId = this.activeSessionId || sessionId;
            let newSessionId = `ses_${Date.now()}`;
            let newSessionTitle = `接力任务 (接力 ${hopCount})`;
            if (this.pool && prevSessionId) {
              this.pool.releaseSessionLease(prevSessionId);
            }
            if (this.options.orchestrator && typeof this.options.orchestrator.resetHandshake === "function") {
              this.options.orchestrator.resetHandshake();
            }
            if (this.sessionManager) {
              const prevRecord = this.sessionManager.loadSession(prevSessionId);
              const rootTitle = prevRecord?.title || "接力任务";
              newSessionTitle = `${rootTitle} (接力 ${hopCount})`;
              const newSession = this.sessionManager.createSession({
                title: newSessionTitle,
                workspaceRoot: this.workspaceRoot || undefined,
                maxTurns,
                modelTone,
                handoffSnapshot: runResult.handoffSnapshot,
                handoffDocPath: runResult.handoffDocPath,
                disasterBlackbox: runResult.disasterBlackbox
              });
              newSessionId = newSession.id;
            }
            this.activeSessionId = newSessionId;
            currentInitialAnnotations = undefined;
            if (runResult.handoffSnapshot && this.graphTokenProvider) {
              try {
                const graphToken = await this.graphTokenProvider();
                if (graphToken) {
                  const uploadRes = await SubstrateUploader.uploadDocumentToOneDrive(graphToken, `handoff-${newSessionId}.md`, runResult.handoffSnapshot, "markdown");
                  if (uploadRes?.annotation) {
                    currentInitialAnnotations = [uploadRes.annotation];
                  }
                }
              } catch {}
            }
            this.send("session:handoff", {
              predecessorSessionId: prevSessionId,
              successorSessionId: newSessionId,
              handoffDocPath: runResult.handoffDocPath,
              memoSnippet: runResult.handoffSnapshot ? runResult.handoffSnapshot.slice(0, 300) : "",
              generation: nextStage
            });
            this.send("session:created", {
              sessionId: newSessionId,
              title: newSessionTitle,
              generation: nextStage,
              predecessorSessionId: prevSessionId
            });
            this.send("terminal:chunk", {
              stream: "system",
              content: `
\uD83D\uDD04 [Auto-Handoff] 已自动开启接力新阶段 (第 ${hopCount}/${this.maxAutonomousHandoffHops} 跳): ${newSessionId}
`
            });
            currentTaskPrompt = [
              `【自主接力延续任务 - 阶段 ${nextStage}】`,
              `终极目标: ${rootTaskPrompt}`,
              `交接资产: 详细交接文档已${currentInitialAnnotations ? "通过云端附件无损送达" : "落盘于工作区"} (本地路径: ${runResult.handoffDocPath || "未落盘"})`,
              `物理账本: .cph/state/execution-ledger.md`,
              `【接力行动准则】`,
              `请优先推进未完成的核心业务切片，聚焦于增量功能交付与深度代码构建，持续输出实质性工程成果。`
            ].join(`
`);
            const nextTurnId = `turn-${Date.now()}`;
            const nextTurn = {
              id: nextTurnId,
              turnNumber: this.turns.length + 1,
              userMessage: {
                text: `\uD83D\uDD04 自主接力延续 (阶段 ${nextStage})`
              },
              reasoning: {
                text: `\uD83C\uDFAF 阶段 ${nextStage} 自主接力启动，正在挂载前序成果并接续执行...`,
                isStreaming: true
              },
              assistantText: "",
              tools: [],
              status: "streaming"
            };
            this.turns.push(nextTurn);
            currentTurn = nextTurn;
            this.send("turn:start", {
              turn: nextTurn,
              activeSessionId: newSessionId,
              generation: nextStage
            });
            continue;
          }
          break;
        }
      } catch (err) {
        if (abortController.signal.aborted || this.isInterrupted) {
          currentTurn.status = "interrupted";
          this.send("turn:end", { status: "interrupted" });
          await this.persistActiveSession();
        } else {
          currentTurn.status = "error";
          this.send("turn:end", { error: err?.message || String(err), status: "error" });
          await this.persistActiveSession();
          throw err;
        }
      } finally {
        this.activeAbortController = undefined;
        if (this.pool && this.activeSessionId) {
          this.pool.releaseSessionLease(this.activeSessionId);
        }
      }
    } else if (typeof orchestrator.runTurn === "function") {
      await orchestrator.runTurn(task, {
        onReasoning: (chunk) => {
          if (this.isInterrupted)
            return;
          if (turn.reasoning)
            turn.reasoning.text += chunk;
          this.send("reasoning:chunk", { chunk });
        },
        onAssistant: (chunk) => {
          if (this.isInterrupted)
            return;
          if (turn.reasoning)
            turn.reasoning.isStreaming = false;
          turn.assistantText = (turn.assistantText || "") + chunk;
          this.send("assistant:chunk", { chunk });
        }
      });
      turn.status = "completed";
      this.send("turn:end", { metrics: turn.metrics });
      await this.persistActiveSession();
    } else {
      await this.runDefaultGeneration(turn, task, targetSkill);
    }
  }
  async runDefaultGeneration(turn, text, targetSkill) {
    const startTime = Date.now();
    const isMounted = targetSkill ? this.skillRegistry.isAgentMounted(targetSkill.name) : false;
    const skillPrefix = targetSkill ? isMounted ? `已唤醒 Agent 内置专业技能【${targetSkill.name}】(知识库内化免附件)。
` : `已识别并动态全量挂载专业技能【${targetSkill.name}】(随任务下发附件)。
` : "";
    const r1 = `${skillPrefix}正在分析指令并检视工作区状态...
`;
    if (turn.reasoning)
      turn.reasoning.text += r1;
    this.send("reasoning:chunk", { chunk: r1 });
    if (this.isInterrupted)
      return;
    await new Promise((r) => setTimeout(r, 15));
    if (this.isInterrupted)
      return;
    const r2 = targetSkill ? isMounted ? `遵循 Agent 内置【${targetSkill.name}】规范执行，准备输出结果。
` : `按照动态挂载【${targetSkill.name}】流程规范分析完成，准备输出结果。
` : `策略分析完毕，准备输出结果。
`;
    if (turn.reasoning)
      turn.reasoning.text += r2;
    this.send("reasoning:chunk", { chunk: r2 });
    if (this.isInterrupted)
      return;
    await new Promise((r) => setTimeout(r, 15));
    if (this.isInterrupted)
      return;
    if (turn.reasoning)
      turn.reasoning.isStreaming = false;
    const answer = targetSkill ? isMounted ? `已按照 Agent 内置技能【${targetSkill.name}】规范接收任务: "${text}"。
执行完成。` : `已按照动态挂载技能【${targetSkill.name}】规范接收任务: "${text}"。
执行完成。` : `已成功接收指令: "${text}"。
执行完成。`;
    turn.assistantText = answer;
    this.send("assistant:chunk", { chunk: answer });
    if (this.isInterrupted)
      return;
    turn.status = "completed";
    const durationMs = Date.now() - startTime;
    const totalChars = (turn.assistantText?.length || 0) + (turn.reasoning?.text?.length || 0);
    const tokens = Math.max(1, Math.round(totalChars / 2));
    const tps = durationMs > 200 ? Math.round(tokens / (durationMs / 1000) * 10) / 10 : undefined;
    turn.metrics = {
      durationMs,
      model: "copilot-gpt-4o",
      tokens,
      tokensOut: tokens,
      ...tps !== undefined ? { tps } : {}
    };
    this.send("turn:end", { metrics: turn.metrics });
    this.running = false;
    await this.persistActiveSession();
  }
  handleUserInterrupt() {
    this.isInterrupted = true;
    this.running = false;
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {}
    }
    const lastTurn = this.turns[this.turns.length - 1];
    if (lastTurn && lastTurn.status === "streaming") {
      lastTurn.status = "interrupted";
      if (lastTurn.reasoning) {
        lastTurn.reasoning.isStreaming = false;
      }
    }
    if (this.options.orchestrator && typeof this.options.orchestrator.interrupt === "function") {
      try {
        this.options.orchestrator.interrupt();
      } catch {}
    }
    if (this.pool && this.activeSessionId) {
      this.pool.releaseSessionLease(this.activeSessionId);
    }
    this.send("turn:end", { status: "interrupted" });
  }
  loadAgentConfig() {
    const config = {
      defaultMain: DEFAULT_MAIN_AGENT_ID,
      defaultCoder: DEFAULT_CODER_AGENT_ID,
      customAgents: []
    };
    if (!this.workspaceRoot)
      return config;
    try {
      const configPath = path20.join(this.workspaceRoot, ".cph", "config.json");
      if (fs15.existsSync(configPath)) {
        const raw = JSON.parse(fs15.readFileSync(configPath, "utf-8"));
        if (raw.customAgentId)
          config.customAgentId = raw.customAgentId;
        if (raw.coderAgentId)
          config.coderAgentId = raw.coderAgentId;
        if (Array.isArray(raw.customAgents))
          config.customAgents = raw.customAgents;
        if (Array.isArray(raw.agentMountedSkills) && this.skillRegistry) {
          this.skillRegistry.setAgentMountedSkills(raw.agentMountedSkills);
        }
        if (raw.cloudWorkspace && !this.cloudWorkspace) {
          this.cloudWorkspace = raw.cloudWorkspace;
        }
      }
    } catch {}
    return config;
  }
  saveWorkspaceConfig(updates) {
    if (!this.workspaceRoot)
      return;
    try {
      const cphDir = path20.join(this.workspaceRoot, ".cph");
      if (!fs15.existsSync(cphDir)) {
        fs15.mkdirSync(cphDir, { recursive: true });
      }
      const configPath = path20.join(cphDir, "config.json");
      let current = {};
      if (fs15.existsSync(configPath)) {
        try {
          current = JSON.parse(fs15.readFileSync(configPath, "utf-8"));
        } catch {
          current = {};
        }
      }
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined) {
          delete current[k];
        } else {
          current[k] = v;
        }
      }
      fs15.writeFileSync(configPath, JSON.stringify(current, null, 2), "utf-8");
    } catch (err) {
      console.warn("[RpcHandler] Failed to save workspace config:", err.message);
    }
  }
  getAccountsPayload() {
    const statuses = this.pool.getPoolStatus();
    const allowed = this.pool.getAllowedAccounts();
    const now = Date.now();
    const accounts = statuses.map((s) => ({
      email: s.email,
      isAvailable: s.isAvailable,
      isThrottled: s.isThrottled,
      isAllowed: s.isAllowed !== false,
      isLeased: s.isLeased,
      leasedBy: s.leasedBy,
      cooldownUntil: s.cooldownUntil,
      cooldownRemainingSec: Math.max(0, Math.ceil((s.cooldownUntil - now) / 1000)),
      totalRequests: s.totalRequests,
      throttledCount: s.throttledCount,
      throttleReason: s.throttleReason,
      authExpired: s.authExpired,
      authErrorReason: s.authErrorReason
    }));
    return { accounts, allowedAccounts: allowed ?? null };
  }
  sendAccountsStatus() {
    this.send("accounts:update", this.getAccountsPayload());
  }
  getAgentConfigPayload() {
    return { ...this.agentConfig };
  }
  handleAccountToggle(payload) {
    if (!payload || !payload.email)
      return;
    const { email, enabled } = payload;
    if (enabled) {
      this.pool.enableAccount(email);
    } else {
      this.pool.disableAccount(email);
    }
    const allowed = this.pool.getAllowedAccounts();
    this.saveWorkspaceConfig({ allowedAccounts: allowed });
    this.sendAccountsStatus();
  }
  handleAccountWhitelist(payload) {
    if (!payload)
      return;
    const emails = Array.isArray(payload.emails) && payload.emails.length > 0 ? payload.emails : undefined;
    this.pool.setAllowedAccounts(emails);
    this.saveWorkspaceConfig({ allowedAccounts: emails });
    this.sendAccountsStatus();
  }
  handleAccountResetCooldown(payload) {
    if (!payload || !payload.email)
      return;
    this.pool.resetCooldown(payload.email);
    this.sendAccountsStatus();
  }
  handlePkceStart(rawPayload) {
    const payload = rawPayload?.payload || rawPayload?.data || rawPayload;
    const targetEmail = payload?.email || payload?.targetEmail;
    try {
      const session = this.pool.startPkceAuth(targetEmail);
      const data = {
        authSessionId: session.authSessionId,
        authUrl: session.authUrl,
        state: session.state,
        targetEmail
      };
      this.send("account:pkce_started", {
        ...data,
        data
      });
    } catch (err) {
      const errData = { message: err?.message || String(err) };
      this.send("account:pkce_error", {
        ...errData,
        data: errData
      });
    }
  }
  async handlePkceComplete(rawPayload) {
    const payload = rawPayload?.payload || rawPayload?.data || rawPayload;
    try {
      const redirectUrl = payload?.redirectUrl || payload?.url || payload?.code || "";
      const state = payload?.state;
      const expectedEmail = payload?.expectedEmail || payload?.email;
      const result = await this.pool.completePkceAuth(redirectUrl, state, expectedEmail);
      this.sendAccountsStatus();
      this.send("account:pkce_completed", {
        ...result,
        data: result
      });
    } catch (err) {
      const errData = { message: err?.message || String(err) };
      this.send("account:pkce_error", {
        ...errData,
        data: errData
      });
    }
  }
  handleAgentSet(payload) {
    if (!payload || !payload.role)
      return;
    const rawId = payload.id ? payload.id.trim() : "";
    const normalized = rawId ? ChatHubClient.normalizeAgentId(rawId) : undefined;
    if (payload.role === "main" || payload.role === "custom") {
      this.agentConfig.customAgentId = normalized;
      this.saveWorkspaceConfig({ customAgentId: normalized });
      if (this.options.orchestrator?.setCustomAgentId) {
        this.options.orchestrator.setCustomAgentId(normalized);
      }
      if (this.options.cliApp?.setCustomAgentId) {
        this.options.cliApp.setCustomAgentId(normalized);
      }
    } else if (payload.role === "coder") {
      this.agentConfig.coderAgentId = normalized;
      this.saveWorkspaceConfig({ coderAgentId: normalized });
    }
    this.send("agent:update", this.getAgentConfigPayload());
  }
  handleAgentReset(payload) {
    const role = payload?.role || "all";
    if (role === "main" || role === "all") {
      this.agentConfig.customAgentId = undefined;
      this.saveWorkspaceConfig({ customAgentId: undefined });
      if (this.options.orchestrator?.setCustomAgentId) {
        this.options.orchestrator.setCustomAgentId(undefined);
      }
      if (this.options.cliApp?.setCustomAgentId) {
        this.options.cliApp.setCustomAgentId(undefined);
      }
    }
    if (role === "coder" || role === "all") {
      this.agentConfig.coderAgentId = undefined;
      this.saveWorkspaceConfig({ coderAgentId: undefined });
    }
    this.send("agent:update", this.getAgentConfigPayload());
  }
  handleAgentAddCustom(payload) {
    if (!payload?.agent)
      return;
    const { name, agentId, role, description } = payload.agent;
    if (!name || !agentId)
      return;
    const normalizedId = ChatHubClient.normalizeAgentId(agentId.trim()) || agentId.trim();
    const newAgent = {
      id: `agent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim(),
      agentId: normalizedId,
      role: role || "custom",
      description: description?.trim() || "",
      createdAt: Date.now()
    };
    if (!Array.isArray(this.agentConfig.customAgents)) {
      this.agentConfig.customAgents = [];
    }
    this.agentConfig.customAgents.push(newAgent);
    this.saveWorkspaceConfig({ customAgents: this.agentConfig.customAgents });
    this.send("agent:update", this.getAgentConfigPayload());
  }
  handleAgentRemoveCustom(payload) {
    if (!payload?.id)
      return;
    if (!Array.isArray(this.agentConfig.customAgents)) {
      this.agentConfig.customAgents = [];
    }
    this.agentConfig.customAgents = this.agentConfig.customAgents.filter((a) => a.id !== payload.id);
    this.saveWorkspaceConfig({ customAgents: this.agentConfig.customAgents });
    this.send("agent:update", this.getAgentConfigPayload());
  }
}

// src/web/server.ts
function resolveWebDistDir(customDir, baseDir) {
  if (customDir) {
    return path21.resolve(customDir);
  }
  const current = baseDir || (typeof import.meta.dir === "string" ? import.meta.dir : path21.dirname(fileURLToPath2(import.meta.url)));
  const candidates = [
    customDir,
    path21.resolve(current, "../../web/dist"),
    path21.resolve(current, "../web/dist"),
    path21.resolve(current, "../../../web/dist"),
    path21.resolve(process.cwd(), "web/dist"),
    path21.resolve(process.cwd(), "CPH-PI/web/dist"),
    path21.resolve(current, "web/dist")
  ].filter((p) => Boolean(p));
  for (const candidate of candidates) {
    if (fs16.existsSync(path21.resolve(candidate, "index.html"))) {
      return path21.resolve(candidate);
    }
  }
  return customDir || path21.resolve(current, "../../web/dist");
}
function startWebServer(options) {
  const distDir = resolveWebDistDir(options.distDir);
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    let pathname = "/";
    try {
      const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      pathname = parsed.pathname;
    } catch {
      pathname = req.url || "/";
    }
    if (pathname === "/api/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
      return;
    }
    const handled = serveStatic(req, res, distDir);
    if (!handled) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    }
  });
  const wss = new import_websocket_server.default({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(request.url || "", `http://${request.headers.host || "localhost"}`).pathname;
    } catch {
      pathname = request.url || "";
    }
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });
  wss.on("connection", (ws) => {
    new RpcHandler(ws, {
      workspaceRoot: options.workspaceRoot,
      orchestrator: options.orchestrator,
      sessionManager: options.sessionManager,
      pool: options.pool,
      cliApp: options.cliApp,
      skillRegistry: options.skillRegistry,
      debug: options.debug,
      debugLogPath: options.debugLogPath,
      maxAutonomousHandoffHops: options.maxAutonomousHandoffHops ?? options.cliApp?.maxAutonomousHandoffHops,
      graphTokenProvider: options.graphTokenProvider ?? options.cliApp?.graphTokenProvider
    });
  });
  const promise = new Promise((resolve, reject) => {
    let currentPort = options.port;
    const maxRetries = 10;
    let attempts = 0;
    const tryListen = () => {
      const onError = (err) => {
        if ((err.code === "EADDRINUSE" || err.code === "EACCES") && attempts < maxRetries) {
          attempts++;
          const nextPort = currentPort + 1;
          process.stdout.write(`
⚠️  端口 ${currentPort} 被系统或其它应用占用 (${err.code})，正在自动尝试端口 ${nextPort}...
`);
          currentPort = nextPort;
          server.removeListener("error", onError);
          setTimeout(tryListen, 50);
        } else {
          server.removeListener("error", onError);
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(currentPort, options.host, () => {
        server.removeListener("error", onError);
        if (options.autoOpen) {
          const targetHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
          const url = `http://${targetHost}:${currentPort}`;
          const startCmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `cmd.exe /c start "" "${url}"` : `xdg-open "${url}"`;
          try {
            exec(startCmd, () => {});
          } catch {}
        }
        resolve({ server, wss, port: currentPort, host: options.host });
      });
    };
    tryListen();
  });
  return Object.assign(promise, { server, wss });
}
async function stopWebServer(instance) {
  if (!instance)
    return;
  const { server, wss } = instance;
  if (wss) {
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {}
    }
    await new Promise((resolve) => {
      wss.close(() => resolve());
    });
  }
  if (server) {
    await new Promise((resolve) => {
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      server.close(() => resolve());
    });
  }
}

// src/agent/interrupt-controller.ts
class InterruptController {
  isBusyState = false;
  activeAbortController;
  lastIdleSigintTime = 0;
  idleExitTimeoutMs;
  isAttached = false;
  boundSigintHandler;
  options;
  constructor(options = {}) {
    this.options = options;
    this.idleExitTimeoutMs = options.idleExitTimeoutMs ?? 1500;
    if (options.autoAttach) {
      this.attach();
    }
  }
  beginBusy() {
    this.isBusyState = true;
    this.activeAbortController = new AbortController;
    this.lastIdleSigintTime = 0;
    return this.activeAbortController;
  }
  endBusy() {
    this.isBusyState = false;
    this.activeAbortController = undefined;
    this.lastIdleSigintTime = 0;
  }
  isBusy() {
    return this.isBusyState;
  }
  getActiveSignal() {
    return this.activeAbortController?.signal;
  }
  handleSigint() {
    const now = Date.now();
    if (this.isBusyState) {
      if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
        this.activeAbortController.abort();
      }
      this.options.onOperationAborted?.();
      return {
        action: "aborted_operation",
        message: "操作已中止，保留会话并返回交互等待模式",
        timestamp: now
      };
    }
    if (this.lastIdleSigintTime > 0 && now - this.lastIdleSigintTime <= this.idleExitTimeoutMs) {
      this.lastIdleSigintTime = 0;
      if (this.options.onExit) {
        this.options.onExit();
      } else {
        process.exit(0);
      }
      return {
        action: "exit_confirmed",
        message: "确认退出终端",
        timestamp: now
      };
    }
    this.lastIdleSigintTime = now;
    const promptMsg = "再次按 Ctrl+C 退出";
    this.options.onPromptExit?.(promptMsg);
    return {
      action: "exit_prompted",
      message: promptMsg,
      timestamp: now
    };
  }
  resetIdleTimer() {
    this.lastIdleSigintTime = 0;
  }
  getLastIdleSigintTime() {
    return this.lastIdleSigintTime;
  }
  attach() {
    if (this.isAttached)
      return;
    this.boundSigintHandler = () => {
      this.handleSigint();
    };
    process.on("SIGINT", this.boundSigintHandler);
    this.isAttached = true;
  }
  detach() {
    if (!this.isAttached)
      return;
    if (this.boundSigintHandler) {
      process.off("SIGINT", this.boundSigintHandler);
      this.boundSigintHandler = undefined;
    }
    this.isAttached = false;
  }
}

// src/ui/tui-renderer.ts
import * as fs17 from "node:fs";
import * as path22 from "node:path";

// src/ui/diff-highlighter.ts
var Diff2 = __toESM(require_lib(), 1);

class DiffHighlighter {
  c;
  constructor(options = {}) {
    this.c = options.chalk || new Chalk({ level: options.colorLevel ?? 3 });
  }
  parseDiffLine(line) {
    const match = line.match(/^([+-\s])(?:(\s*\d+)\s+)?(.*)$/);
    if (!match)
      return null;
    return { prefix: match[1], lineNum: match[2]?.trim() || "", content: match[3] };
  }
  renderIntraLineDiff(oldContent, newContent) {
    const wordDiff = Diff2.diffWords(oldContent, newContent);
    let removedLine = "";
    let addedLine = "";
    let isFirstRemoved = true;
    let isFirstAdded = true;
    for (const part of wordDiff) {
      if (part.removed) {
        let value = part.value;
        if (isFirstRemoved) {
          const leadingWs = value.match(/^(\s*)/)?.[1] || "";
          value = value.slice(leadingWs.length);
          removedLine += leadingWs;
          isFirstRemoved = false;
        }
        if (value) {
          removedLine += this.c.inverse(value);
        }
      } else if (part.added) {
        let value = part.value;
        if (isFirstAdded) {
          const leadingWs = value.match(/^(\s*)/)?.[1] || "";
          value = value.slice(leadingWs.length);
          addedLine += leadingWs;
          isFirstAdded = false;
        }
        if (value) {
          addedLine += this.c.inverse(value);
        }
      } else {
        removedLine += part.value;
        addedLine += part.value;
      }
    }
    return { removedLine, addedLine };
  }
  renderDiff(diffText) {
    const rawLines = diffText.split(`
`);
    const lines = rawLines.map((l) => l.replace(/\t/g, "   "));
    const result = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        result.push(this.c.bold.cyan(line));
        i++;
        continue;
      }
      if (line.startsWith("@@")) {
        result.push(this.c.cyan(line));
        i++;
        continue;
      }
      const parsed = this.parseDiffLine(line);
      if (!parsed) {
        result.push(this.c.dim(line));
        i++;
        continue;
      }
      if (parsed.prefix === "-") {
        const removedLines = [];
        while (i < lines.length) {
          const p = this.parseDiffLine(lines[i]);
          if (!p || p.prefix !== "-")
            break;
          removedLines.push({ lineNum: p.lineNum, content: p.content });
          i++;
        }
        const addedLines = [];
        while (i < lines.length) {
          const p = this.parseDiffLine(lines[i]);
          if (!p || p.prefix !== "+")
            break;
          addedLines.push({ lineNum: p.lineNum, content: p.content });
          i++;
        }
        if (removedLines.length === 1 && addedLines.length === 1) {
          const removed = removedLines[0];
          const added = addedLines[0];
          const { removedLine, addedLine } = this.renderIntraLineDiff(removed.content, added.content);
          const lineNumRem = removed.lineNum ? `${removed.lineNum} ` : "";
          const lineNumAdd = added.lineNum ? `${added.lineNum} ` : "";
          result.push(this.c.red(`-${lineNumRem}${removedLine}`));
          result.push(this.c.green(`+${lineNumAdd}${addedLine}`));
        } else {
          for (const rem of removedLines) {
            const lineNum = rem.lineNum ? `${rem.lineNum} ` : "";
            result.push(this.c.red(`-${lineNum}${rem.content}`));
          }
          for (const add of addedLines) {
            const lineNum = add.lineNum ? `${add.lineNum} ` : "";
            result.push(this.c.green(`+${lineNum}${add.content}`));
          }
        }
      } else if (parsed.prefix === "+") {
        const lineNum = parsed.lineNum ? `${parsed.lineNum} ` : "";
        result.push(this.c.green(`+${lineNum}${parsed.content}`));
        i++;
      } else {
        const lineNum = parsed.lineNum ? `${parsed.lineNum} ` : "";
        result.push(this.c.dim(` ${lineNum}${parsed.content}`));
        i++;
      }
    }
    return result.join(`
`);
  }
  static render(diffText, options) {
    return new DiffHighlighter(options).renderDiff(diffText);
  }
}

// src/ui/tui-renderer.ts
class TuiRenderer {
  writer;
  c;
  diffHighlighter;
  constructor(options = {}) {
    this.writer = options.writer || ((text) => process.stdout.write(text));
    this.c = new Chalk({ level: options.colorLevel ?? 3 });
    this.diffHighlighter = new DiffHighlighter({ chalk: this.c });
  }
  setWriter(writer) {
    this.writer = writer;
  }
  getChalk() {
    return this.c;
  }
  formatReasoning(chunk) {
    return this.c.magenta(chunk);
  }
  renderReasoningChunk(chunk) {
    this.writer(this.formatReasoning(chunk));
  }
  formatText(chunk) {
    return chunk;
  }
  renderTextChunk(chunk) {
    this.writer(this.formatText(chunk));
  }
  formatToolBadge(action) {
    const rawTool = action.tool || action.action || action.name || "unknown";
    let targetInfo = "";
    if (rawTool === "read_file" || rawTool === "read" || rawTool === "cat") {
      const filePath = action.path || action.filePath || action.file || "unknown";
      if (action.start_line !== undefined || action.end_line !== undefined) {
        const start = action.start_line ?? 1;
        const end = action.end_line ?? start + 99;
        targetInfo = `${filePath} (lines ${start}-${end})`;
      } else if (action.startLine !== undefined || action.endLine !== undefined) {
        const start = action.startLine ?? 1;
        const end = action.endLine ?? start + 99;
        targetInfo = `${filePath} (lines ${start}-${end})`;
      } else if (action.offset !== undefined || action.limit !== undefined) {
        const start = action.offset ?? 1;
        const end = action.limit !== undefined ? start + action.limit - 1 : start + 99;
        targetInfo = `${filePath} (lines ${start}-${end})`;
      } else {
        targetInfo = `${filePath} (lines 1-100)`;
      }
    } else if (rawTool === "edit" || rawTool === "patch_file" || rawTool === "edit_file") {
      const filePath = action.path || action.filePath || action.file || "unknown";
      const editsCount = Array.isArray(action.edits) ? action.edits.length : 1;
      targetInfo = `${filePath} (${editsCount} block${editsCount > 1 ? "s" : ""})`;
    } else if (rawTool === "write_file" || rawTool === "write") {
      const filePath = action.path || action.filePath || action.file || "unknown";
      targetInfo = filePath;
    } else if (rawTool === "run_command" || rawTool === "bash" || rawTool === "exec") {
      const cmd = action.command || action.cmd || "";
      targetInfo = cmd.length > 70 ? `${cmd.slice(0, 67)}...` : cmd;
    } else if (rawTool === "ask_question" || rawTool === "question") {
      const q = action.question || action.prompt || "";
      targetInfo = q.length > 70 ? `${q.slice(0, 67)}...` : q;
    } else {
      const fallback = action.path || action.command || action.question || "";
      targetInfo = fallback ? String(fallback) : JSON.stringify(action);
    }
    const lightning = this.c.yellow("⚡");
    const label = this.c.bold.cyan("正在执行");
    const toolFormatted = this.c.bold.white(rawTool);
    const targetFormatted = this.c.green(targetInfo);
    return `${lightning} ${label} ${toolFormatted}${this.c.gray(":")} ${targetFormatted}`;
  }
  renderToolBadge(action) {
    this.writer(`
${this.formatToolBadge(action)}
`);
  }
  renderDiff(diffText) {
    return this.diffHighlighter.renderDiff(diffText);
  }
  formatToolResult(result) {
    const isSuccess = result.success;
    const toolName = result.actionName || result.piToolName;
    const icon = isSuccess ? this.c.green("✔") : this.c.red("✖");
    const statusLabel = isSuccess ? this.c.green("执行成功") : this.c.red("执行失败");
    const target = this.c.gray(`[${result.target}]`);
    const header = `${icon} ${this.c.bold(toolName)} ${target} ${statusLabel}`;
    let diffContent = "";
    if (result.rawResult?.details?.diff) {
      diffContent = result.rawResult.details.diff;
    } else if (result.output && result.output.includes(`Diff:
`)) {
      const idx = result.output.indexOf(`Diff:
`);
      diffContent = result.output.slice(idx + `Diff:
`.length).trim();
    } else if ((toolName === "edit" || toolName === "patch_file") && (result.output.includes("@@") || result.output.startsWith("+") || result.output.startsWith("-"))) {
      diffContent = result.output;
    }
    if (diffContent) {
      const renderedDiff = this.renderDiff(diffContent);
      const diffBox = [
        this.c.gray("  ┌─ [Diff 局部预览] ──────────────────────────────────────────"),
        renderedDiff.split(`
`).map((l) => `  │ ${l}`).join(`
`),
        this.c.gray("  └────────────────────────────────────────────────────────────")
      ].join(`
`);
      return `${header}
${diffBox}`;
    }
    if (result.output) {
      const lines = result.output.trim().split(`
`);
      const previewLines = lines.slice(0, 15);
      const isTruncated = lines.length > 15;
      const formattedLines = previewLines.map((l) => this.c.gray(`  │ ${l}`)).join(`
`);
      const footer = isTruncated ? this.c.gray(`
  │ ... (已省略 ${lines.length - 15} 行输出)`) : "";
      return `${header}
${formattedLines}${footer}`;
    }
    return header;
  }
  renderToolResult(result) {
    this.writer(`${this.formatToolResult(result)}
`);
  }
  formatFinalAnswer(summary) {
    const rawLines = summary.trim().split(`
`);
    const contentLines = rawLines.map((l) => l.trimEnd());
    let maxLen = 0;
    for (const line of contentLines) {
      if (line.length > maxLen)
        maxLen = line.length;
    }
    const boxWidth = Math.min(90, Math.max(66, maxLen + 6));
    const topBorder = this.c.bold.green(`┌${"─".repeat(boxWidth - 2)}┐`);
    const headerTitle = " \uD83C\uDFAF 【任务已完成交付 / FINAL ANSWER】";
    const headerPadding = Math.max(0, boxWidth - 2 - headerTitle.length);
    const headerLine = `${this.c.bold.green("│")}${this.c.bold.white(headerTitle)}${" ".repeat(headerPadding)}${this.c.bold.green("│")}`;
    const midDivider = this.c.bold.green(`├${"─".repeat(boxWidth - 2)}┤`);
    const bottomBorder = this.c.bold.green(`└${"─".repeat(boxWidth - 2)}┘`);
    const formattedContent = contentLines.map((line) => {
      const lineLen = line.length;
      const pad = Math.max(0, boxWidth - 4 - lineLen);
      return `${this.c.bold.green("│")}  ${line}${" ".repeat(pad)}${this.c.bold.green("│")}`;
    });
    return [
      topBorder,
      headerLine,
      midDivider,
      ...formattedContent,
      bottomBorder
    ].join(`
`);
  }
  extractReferencedMarkdownFiles(text) {
    if (!text)
      return [];
    const rawMatches = [];
    const mdLinkRegex = /\[[^\]]*\]\(([^)\s]+?\.(?:md|markdown))\)/gi;
    let match;
    while ((match = mdLinkRegex.exec(text)) !== null) {
      rawMatches.push(match[1]);
    }
    const quotedRegex = /[`"']([^`"'\r\n]+?\.(?:md|markdown))[`"']/gi;
    while ((match = quotedRegex.exec(text)) !== null) {
      rawMatches.push(match[1]);
    }
    const winAbsRegex = /[A-Za-z]:[\\/][^\r\n`"'()<>*?，。；：！？\t]+?\.(?:md|markdown)\b/gi;
    while ((match = winAbsRegex.exec(text)) !== null) {
      rawMatches.push(match[0]);
    }
    const posixAbsRegex = /\/(?:[^\s`"'()<>*?，。；：！？\t]+?\/)?[^\s`"'()<>*?，。；：！？\t]+?\.(?:md|markdown)\b/gi;
    while ((match = posixAbsRegex.exec(text)) !== null) {
      rawMatches.push(match[0]);
    }
    const relPathRegex = /(?:\.{1,2}[\\/]|[a-zA-Z0-9_\-.]+[\\/])[^\s`"'()<>*?，。；：！？\t]+?\.(?:md|markdown)\b/gi;
    while ((match = relPathRegex.exec(text)) !== null) {
      rawMatches.push(match[0]);
    }
    const bareFileRegex = /(?<![\\/\w@.-])[a-zA-Z0-9_\-.]+\.(?:md|markdown)\b/gi;
    while ((match = bareFileRegex.exec(text)) !== null) {
      rawMatches.push(match[0]);
    }
    const cleaned = [];
    const seen = new Set;
    for (const raw of rawMatches) {
      let p = raw.trim();
      if (p.startsWith("file:///")) {
        p = decodeURIComponent(p.slice(8));
      } else if (p.startsWith("file://")) {
        p = decodeURIComponent(p.slice(7));
      }
      p = p.replace(/^[`"'\(\[<（【]+|[`"'\)\]>）】]+$/g, "");
      p = p.replace(/[.,;:!?，。；：！？]+$/, "");
      p = p.trim();
      if (!p)
        continue;
      const key = path22.normalize(p).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        cleaned.push(p);
      }
    }
    return cleaned;
  }
  formatArtifactCard(filePath) {
    const resolvedPath = path22.isAbsolute(filePath) ? filePath : path22.resolve(process.cwd(), filePath);
    if (!fs17.existsSync(resolvedPath)) {
      return null;
    }
    let stats;
    let content;
    try {
      stats = fs17.statSync(resolvedPath);
      if (!stats.isFile()) {
        return null;
      }
      content = fs17.readFileSync(resolvedPath, "utf-8");
    } catch {
      return null;
    }
    const sizeBytes = stats.size;
    let sizeStr;
    if (sizeBytes < 1024) {
      sizeStr = `${sizeBytes} B`;
    } else if (sizeBytes < 1024 * 1024) {
      sizeStr = `${(sizeBytes / 1024).toFixed(1)} KB`;
    } else {
      sizeStr = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    const rawLines = content.split(/\r?\n/);
    const totalLines = rawLines.length;
    const headings = [];
    let totalHeadings = 0;
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (/^(#{1,6})\s+/.test(trimmed)) {
        totalHeadings++;
        if (headings.length < 5) {
          headings.push(trimmed);
        }
      }
    }
    const displayPath = resolvedPath;
    const contentLines = [];
    contentLines.push(`\uD83D\uDCC4 交付文档: ${displayPath}`);
    contentLines.push(`\uD83D\uDCCA 规格指标: ${sizeStr} | ${totalLines} 行`);
    if (headings.length > 0) {
      contentLines.push(`\uD83D\uDCD1 章节大纲:`);
      for (const h of headings) {
        contentLines.push(`  • ${h}`);
      }
      if (totalHeadings > 5) {
        contentLines.push(`  • ... (共 ${totalHeadings} 个核心章节)`);
      }
    }
    let maxLen = 0;
    for (const l of contentLines) {
      if (l.length > maxLen)
        maxLen = l.length;
    }
    const boxWidth = Math.min(96, Math.max(72, maxLen + 6));
    const topBorder = this.c.bold.cyan(`┌${"─".repeat(boxWidth - 2)}┐`);
    const headerTitle = " \uD83C\uDFC6 战役成果交付展板 (Deliverable Artifact)";
    const headerPadding = Math.max(0, boxWidth - 2 - headerTitle.length);
    const headerLine = `${this.c.bold.cyan("│")}${this.c.bold.yellow(headerTitle)}${" ".repeat(headerPadding)}${this.c.bold.cyan("│")}`;
    const midDivider = this.c.bold.cyan(`├${"─".repeat(boxWidth - 2)}┤`);
    const bottomBorder = this.c.bold.cyan(`└${"─".repeat(boxWidth - 2)}┘`);
    const formattedContent = contentLines.map((l) => {
      const lineLen = l.length;
      const pad = Math.max(0, boxWidth - 4 - lineLen);
      return `${this.c.bold.cyan("│")}  ${this.c.white(l)}${" ".repeat(pad)}${this.c.bold.cyan("│")}`;
    });
    return [
      topBorder,
      headerLine,
      midDivider,
      ...formattedContent,
      bottomBorder
    ].join(`
`);
  }
  formatDeliverableArtifactCard(filePath) {
    return this.formatArtifactCard(filePath);
  }
  renderFinalAnswer(summary) {
    this.writer(`
${this.formatFinalAnswer(summary)}

`);
    const referencedFiles = this.extractReferencedMarkdownFiles(summary);
    for (const file of referencedFiles) {
      const card = this.formatArtifactCard(file);
      if (card) {
        this.writer(`${card}

`);
      }
    }
  }
  formatQuestionPrompt(question, options) {
    const rawQuestionLines = question.trim().split(/\r?\n/);
    const contentLines = [];
    for (const line of rawQuestionLines) {
      contentLines.push(line.trimEnd());
    }
    if (options && options.length > 0) {
      contentLines.push("");
      contentLines.push("可选项:");
      options.forEach((opt, idx) => {
        contentLines.push(`  [${idx + 1}] ${opt}`);
      });
    }
    let maxLen = 0;
    for (const line of contentLines) {
      if (line.length > maxLen)
        maxLen = line.length;
    }
    const boxWidth = Math.min(90, Math.max(66, maxLen + 6));
    const topBorder = this.c.bold.yellow(`┌${"─".repeat(boxWidth - 2)}┐`);
    const headerTitle = " ❓ 【Copilot 交互提问 / ASK_QUESTION】";
    const headerPadding = Math.max(0, boxWidth - 2 - headerTitle.length);
    const headerLine = `${this.c.bold.yellow("│")}${this.c.bold.yellow(headerTitle)}${" ".repeat(headerPadding)}${this.c.bold.yellow("│")}`;
    const midDivider = this.c.bold.yellow(`├${"─".repeat(boxWidth - 2)}┤`);
    const bottomBorder = this.c.bold.yellow(`└${"─".repeat(boxWidth - 2)}┘`);
    const formattedContent = contentLines.map((line) => {
      const lineLen = line.length;
      const pad = Math.max(0, boxWidth - 4 - lineLen);
      return `${this.c.bold.yellow("│")}  ${this.c.white(line)}${" ".repeat(pad)}${this.c.bold.yellow("│")}`;
    });
    return [
      topBorder,
      headerLine,
      midDivider,
      ...formattedContent,
      bottomBorder
    ].join(`
`);
  }
  renderQuestionPrompt(question, options) {
    this.writer(`
${this.formatQuestionPrompt(question, options)}

`);
  }
  renderBanner(workspaceRoot) {
    const banner = [
      this.c.bold.cyan("╔══════════════════════════════════════════════════════════════════╗"),
      this.c.bold.cyan("║") + this.c.bold.white("       CPH-PI: Copilot M365 x Pi Autonomous Coding Terminal       ") + this.c.bold.cyan("║"),
      this.c.bold.cyan("║") + this.c.gray("   Architecture: Pi Engine (@earendil-works/pi-tui)               ") + this.c.bold.cyan("║"),
      this.c.bold.cyan("║") + this.c.gray("   Protocol: Native Microsoft Sydney / ChatHub WebSocket          ") + this.c.bold.cyan("║"),
      this.c.bold.cyan("╚══════════════════════════════════════════════════════════════════╝"),
      ...workspaceRoot ? [this.c.cyan(`  工作区根目录: ${workspaceRoot}`)] : [],
      this.c.dim("  快捷命令: /help (帮助) | /reset (重置会话) | /status (状态) | /skills (技能) | /exit (退出)"),
      this.c.dim("  中断控制: 运行中按 Ctrl+C 中断当前步骤并保留会话 | 空闲时 1.5s 内连按两次退出"),
      ""
    ].join(`
`);
    this.writer(`${banner}
`);
  }
  formatAutonomousHandoffBanner(newSessionId, hopCount, maxHops, docPath) {
    const banner = [
      this.c.bold.yellow("\uD83D\uDD04 ══════════════════════════════════════════════════════════════════ \uD83D\uDD04"),
      this.c.bold.yellow(`   [Auto-Handoff] 自主换会话接力跃迁 (阶段 ${hopCount}/${maxHops})`),
      this.c.gray(`   新会话 ID: `) + this.c.cyan(newSessionId),
      ...docPath ? [this.c.gray(`   交接文档: `) + this.c.green(docPath)] : [],
      this.c.dim(`   提示: 已无感加载高保真 5 维交接文档，正在自动启动接力推理...`),
      this.c.bold.yellow("\uD83D\uDD04 ══════════════════════════════════════════════════════════════════ \uD83D\uDD04")
    ].join(`
`);
    return banner;
  }
  renderAutonomousHandoffBanner(newSessionId, hopCount, maxHops, docPath) {
    this.writer(`
${this.formatAutonomousHandoffBanner(newSessionId, hopCount, maxHops, docPath)}

`);
  }
  formatDisasterBlackboxBanner(sessionId, lastError) {
    const banner = [
      this.c.bold.red("⚡ ══════════════════════════════════════════════════════════════════ ⚡"),
      this.c.bold.yellow("   [Disaster-Recovery: 阶一] 遭遇 429 频控/突发中断，提炼事故现场黑匣子"),
      this.c.gray("   受害会话 ID: ") + this.c.cyan(sessionId),
      ...lastError ? [this.c.gray("   拦截异常原因: ") + this.c.red(lastError)] : [],
      this.c.dim("   操作: 正在将全量历史上下文浓缩为 5k~8k 字符高密度黑匣子快照..."),
      this.c.bold.red("⚡ ══════════════════════════════════════════════════════════════════ ⚡")
    ].join(`
`);
    return banner;
  }
  renderDisasterBlackboxBanner(sessionId, lastError) {
    this.writer(`
${this.formatDisasterBlackboxBanner(sessionId, lastError)}

`);
  }
  formatArbitratorHandoffBanner(arbitratorSessionId, accountEmail, docPath) {
    const banner = [
      this.c.bold.cyan("\uD83D\uDCD1 ══════════════════════════════════════════════════════════════════ \uD83D\uDCD1"),
      this.c.bold.cyan("   [Disaster-Recovery: 阶二] 账号池敏捷轮换，唤起原生 handoff 仲裁微会话"),
      this.c.gray("   仲裁会话 ID: ") + this.c.cyan(arbitratorSessionId),
      this.c.gray("   仲裁备用账号: ") + this.c.green(accountEmail),
      ...docPath ? [this.c.gray("   交接文档落盘: ") + this.c.green(docPath)] : [],
      this.c.dim("   操作: 正在通过云端 handoff 技能生成标准 5 维交接文档并落盘归档..."),
      this.c.bold.cyan("\uD83D\uDCD1 ══════════════════════════════════════════════════════════════════ \uD83D\uDCD1")
    ].join(`
`);
    return banner;
  }
  renderArbitratorHandoffBanner(arbitratorSessionId, accountEmail, docPath) {
    this.writer(`
${this.formatArbitratorHandoffBanner(arbitratorSessionId, accountEmail, docPath)}

`);
  }
  formatDisasterSuccessorBanner(successorSessionId, hopCount, maxHops, docPath) {
    const banner = [
      this.c.bold.green("\uD83D\uDE80 ══════════════════════════════════════════════════════════════════ \uD83D\uDE80"),
      this.c.bold.green(`   [Disaster-Recovery: 阶三] 灾备接力闭环就绪，接力会话继续攻坚 (阶段 ${hopCount}/${maxHops})`),
      this.c.gray("   接力会话 ID: ") + this.c.cyan(successorSessionId),
      ...docPath ? [this.c.gray("   承接交接文档: ") + this.c.green(docPath)] : [],
      this.c.dim("   操作: 挂载高保真交接文档，使用健康账号全速推进剩余业务需求..."),
      this.c.bold.green("\uD83D\uDE80 ══════════════════════════════════════════════════════════════════ \uD83D\uDE80")
    ].join(`
`);
    return banner;
  }
  renderDisasterSuccessorBanner(successorSessionId, hopCount, maxHops, docPath) {
    this.writer(`
${this.formatDisasterSuccessorBanner(successorSessionId, hopCount, maxHops, docPath)}

`);
  }
  formatAttachmentUploadedNotice(fileName, toolName) {
    return this.c.cyan(`☁️  [云端直传附件] 工具 ${this.c.bold(toolName)} 完整输出已上传至 OneDrive 并作为文件附件【${this.c.green(fileName)}】挂载送达 Copilot`);
  }
  renderAttachmentUploadedNotice(fileName, toolName) {
    this.writer(`${this.formatAttachmentUploadedNotice(fileName, toolName)}
`);
  }
  renderSkillActivated(name) {
    this.writer(this.c.bold.magenta(`
\uD83C\uDFAF [已激活专属技能: ${name}]

`));
  }
  renderTurnHeader(turn) {
    this.writer(this.c.bold.blue(`
▶ [Turn ${turn}]
`));
  }
  renderRefusalWarning(refusalText, retryAttempt) {
    const msg = this.c.yellow(`
\uD83D\uDEE1️  [RefusalGuard] 拦截到微软沙箱拒答模版，正在注入物理上下文纠偏 (第 ${retryAttempt} 次重试)...`);
    this.writer(`${msg}
`);
  }
  renderCompactedNotice(clearedChars, ratio) {
    const percentage = (ratio * 100).toFixed(1);
    const msg = this.c.gray(`✂️  [Compaction] 两轮滑动微压实完成：剥离 ${clearedChars} 字符历史工具输出 (节省约 ${percentage}% 上下文空间)`);
    this.writer(`${msg}
`);
  }
  renderAccountSwitchedNotice(oldEmail, newEmail) {
    const msg = this.c.magenta(`\uD83D\uDD04 [AccountPool] 账号 ${oldEmail} 触发限流，已自动无感轮换至 ${newEmail}`);
    this.writer(`${msg}
`);
  }
  renderAbortedNotice() {
    const msg = this.c.yellow(`
⚠️  已拦截 Ctrl+C：当前执行已安全中止。会话历史与上下文完整保留，已返回交互等待模式。
`);
    this.writer(msg);
  }
  renderError(err) {
    const text = typeof err === "string" ? err : err.message;
    this.writer(this.c.bold.red(`
❌ 出错: ${text}
`));
  }
  formatStatusBar(info) {
    const sessionIdStr = this.c.cyan(info.sessionId || "未命名");
    const gen = info.generation ?? (info.handoffCount !== undefined ? info.handoffCount + 1 : undefined);
    const handoffCount = info.handoffCount ?? (gen !== undefined ? Math.max(0, gen - 1) : undefined);
    let genBadge = "";
    if (gen !== undefined && handoffCount !== undefined) {
      genBadge = handoffCount > 0 ? this.c.yellow(` [第 ${gen} 代 (接手 ${handoffCount} 次)]`) : this.c.gray(` [第 1 代 (接手 0 次)]`);
    }
    const agentBadge = this.c.green(info.agentName || "通用握手模式");
    const turnCount = info.turnCount ?? 0;
    const maxTurns = info.maxTurns ?? 25;
    const turnStr = this.c.yellow(`${turnCount}/${maxTurns}`);
    let contextContent = "";
    if (info.estimatedTokens !== undefined) {
      const tokensFormatted = info.estimatedTokens >= 1000 ? `~${(info.estimatedTokens / 1000).toFixed(1)}k Token` : `~${info.estimatedTokens} Token`;
      if (info.compactionRatio !== undefined && info.compactionRatio > 0) {
        const ratioPercent = Math.round(info.compactionRatio > 1 ? info.compactionRatio : info.compactionRatio * 100);
        contextContent = `${tokensFormatted} (压实率 ${ratioPercent}%)`;
      } else {
        contextContent = tokensFormatted;
      }
    } else {
      contextContent = "初始";
    }
    const contextStr = this.c.green(contextContent);
    const accountStr = this.c.magenta(info.currentAccount || "默认");
    const prefix = this.c.gray("┌─ [ ");
    const suffix = this.c.gray(" ]");
    const div = this.c.gray(" | ");
    return prefix + this.c.dim("会话: ") + sessionIdStr + genBadge + div + this.c.dim("智能体: ") + agentBadge + div + this.c.dim("轮次: ") + turnStr + div + this.c.dim("上下文: ") + contextStr + div + this.c.dim("账号: ") + accountStr + suffix;
  }
  renderStatusBar(info) {
    const formatted = this.formatStatusBar(info);
    this.writer(`${formatted}
`);
    return formatted;
  }
  formatSubagentMatrixEvent(state) {
    const rawId = state.id || "sub-unknown";
    const displayId = rawId.replace(/^sub-/i, "Sub-");
    const role = state.role || "unknown";
    const status = state.status || "unknown";
    const action = state.lastAction || "";
    const account = state.account ? ` [${state.account}]` : "";
    return `[Subagent Event] [${displayId}] [${role}]${account} 状态: ${status} | 动作: ${action}
`;
  }
  formatSubagentMatrix(states, compact = false) {
    if (compact) {
      return states.map((s) => this.formatSubagentMatrixEvent(s).trimEnd()).join(`
`);
    }
    const lines = [];
    lines.push(this.c.bold.cyan("┌─ [多会话子代理协同看板 (Sub-Agent Matrix)] " + "─".repeat(30)));
    for (let i = 0;i < states.length; i++) {
      const s = states[i];
      const roleBadge = s.role === "coder" ? this.c.yellow(`[coder]`) : this.c.blue(`[researcher]`);
      const accountBadge = s.account ? this.c.magenta(`[${s.account}]`) : "";
      const hop = s.hopCount ?? (s.handoffCount !== undefined ? s.handoffCount + 1 : 1);
      const subHandoffs = s.handoffCount ?? Math.max(0, hop - 1);
      const hopBadge = subHandoffs > 0 ? this.c.yellow(`[Hop ${hop} (接手 ${subHandoffs} 次)]`) : this.c.gray(`[Hop 1 (接手 0 次)]`);
      const statusBadge = s.status === "completed" ? this.c.green("✅ 已完成") : s.status === "failed" ? this.c.red("❌ 失败") : this.c.cyan("\uD83D\uDD04 运行中");
      const durationSec = ((s.durationMs ?? 0) / 1000).toFixed(1);
      const headerBadges = [roleBadge, accountBadge, hopBadge].filter(Boolean).join(" ");
      lines.push(this.c.bold(`│ [Sub-${i + 1}] `) + `${headerBadges} ${(s.description || "").slice(0, 24)} | 状态: ${statusBadge} | 耗时: ${durationSec}s`);
      if (s.lastAction) {
        lines.push(`│   └─ 最新动作: ${this.c.gray(s.lastAction)}`);
      }
    }
    lines.push(this.c.bold.cyan("└" + "─".repeat(68)));
    return lines.join(`
`);
  }
  renderSubagentMatrix(states, compact = false) {
    if (compact) {
      for (const s of states) {
        this.writer(this.formatSubagentMatrixEvent(s));
      }
    } else {
      this.writer(this.formatSubagentMatrix(states) + `
`);
    }
  }
  formatMainVirtualizationBanner(sessionId, snapshotPath) {
    const border = "─".repeat(60);
    return [
      this.c.cyan(`┌${border}┐`),
      this.c.cyan(`│ \uD83D\uDCCC [主控会话已虚拟化归档] ${sessionId.padEnd(35)} │`),
      this.c.cyan(`│ 宏观规划快照已落盘: ${snapshotPath.padEnd(40)} │`),
      this.c.cyan(`│ 云端连接已安全释放，子任务开始受限排队攻坚...             │`),
      this.c.cyan(`└${border}┘`)
    ].join(`
`);
  }
  renderMainVirtualizationBanner(sessionId, snapshotPath) {
    this.writer(`
` + this.formatMainVirtualizationBanner(sessionId, snapshotPath) + `

`);
  }
  formatSuccessorAwakeningBanner(sessionId, generation) {
    const border = "─".repeat(60);
    const handoffCount = Math.max(0, generation - 1);
    const title = `\uD83D\uDE80 [第 ${generation} 代主控会话已唤醒 (接手 ${handoffCount} 次)] ${sessionId}`;
    return [
      this.c.green(`┌${border}┐`),
      this.c.green(`│ ${title.padEnd(58)} │`),
      this.c.green(`│ 注入前序架构快照与子任务结题成果，重置满额 30 轮推理预算   │`),
      this.c.green(`│ 进入系统交叉验证与交付审阅阶段...                        │`),
      this.c.green(`└${border}┘`)
    ].join(`
`);
  }
  renderSuccessorAwakeningBanner(sessionId, generation) {
    this.writer(`
` + this.formatSuccessorAwakeningBanner(sessionId, generation) + `

`);
  }
}

// src/cli/args.ts
import path23 from "node:path";
import fs18 from "node:fs";
function parseCliArgs(args) {
  const result = {
    help: false,
    version: false
  };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      result.help = true;
      i++;
    } else if (arg === "-v" || arg === "--version") {
      result.version = true;
      i++;
    } else if (arg === "-c" || arg === "--continue") {
      result.continueLast = true;
      i++;
    } else if (arg === "-r" || arg === "--resume") {
      result.resumeSessionId = args[++i];
      i++;
    } else if (arg.startsWith("--resume=")) {
      result.resumeSessionId = arg.slice("--resume=".length);
      i++;
    } else if (arg.startsWith("-r=")) {
      result.resumeSessionId = arg.slice("-r=".length);
      i++;
    } else if (arg === "-w" || arg === "--workspace") {
      result.workspaceRoot = args[++i];
      i++;
    } else if (arg.startsWith("--workspace=")) {
      result.workspaceRoot = arg.slice("--workspace=".length);
      i++;
    } else if (arg === "-a" || arg === "--agent") {
      result.customAgentId = ChatHubClient.normalizeAgentId(args[++i]);
      result.hasExplicitAgent = true;
      i++;
    } else if (arg.startsWith("--agent=")) {
      result.customAgentId = ChatHubClient.normalizeAgentId(arg.slice("--agent=".length));
      result.hasExplicitAgent = true;
      i++;
    } else if (arg.startsWith("-a=")) {
      result.customAgentId = ChatHubClient.normalizeAgentId(arg.slice("-a=".length));
      result.hasExplicitAgent = true;
      i++;
    } else if (arg === "--coder-agent" || arg === "--coder-agent-id") {
      result.coderAgentId = ChatHubClient.normalizeAgentId(args[++i]);
      i++;
    } else if (arg.startsWith("--coder-agent=")) {
      result.coderAgentId = ChatHubClient.normalizeAgentId(arg.slice("--coder-agent=".length));
      i++;
    } else if (arg.startsWith("--coder-agent-id=")) {
      result.coderAgentId = ChatHubClient.normalizeAgentId(arg.slice("--coder-agent-id=".length));
      i++;
    } else if (arg === "--researcher-agent" || arg === "--researcher-agent-id") {
      result.researcherAgentId = ChatHubClient.normalizeAgentId(args[++i]);
      i++;
    } else if (arg.startsWith("--researcher-agent=")) {
      result.researcherAgentId = ChatHubClient.normalizeAgentId(arg.slice("--researcher-agent=".length));
      i++;
    } else if (arg.startsWith("--researcher-agent-id=")) {
      result.researcherAgentId = ChatHubClient.normalizeAgentId(arg.slice("--researcher-agent-id=".length));
      i++;
    } else if (arg === "--accounts" || arg === "-acc") {
      const val = args[++i];
      if (val) {
        result.allowedAccounts = val.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      }
      i++;
    } else if (arg.startsWith("--accounts=")) {
      const val = arg.slice("--accounts=".length);
      result.allowedAccounts = val.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg.startsWith("-acc=")) {
      const val = arg.slice("-acc=".length);
      result.allowedAccounts = val.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg === "-m" || arg === "--model" || arg === "--tone" || arg === "--model-tone") {
      result.modelTone = args[++i];
      result.hasExplicitModel = true;
      i++;
    } else if (arg.startsWith("--model=")) {
      result.modelTone = arg.slice("--model=".length);
      result.hasExplicitModel = true;
      i++;
    } else if (arg.startsWith("-m=")) {
      result.modelTone = arg.slice("-m=".length);
      result.hasExplicitModel = true;
      i++;
    } else if (arg.startsWith("--tone=")) {
      result.modelTone = arg.slice("--tone=".length);
      result.hasExplicitModel = true;
      i++;
    } else if (arg.startsWith("--model-tone=")) {
      result.modelTone = arg.slice("--model-tone=".length);
      result.hasExplicitModel = true;
      i++;
    } else if (arg === "--max-turns") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val))
        result.maxTurns = val;
      i++;
    } else if (arg.startsWith("--max-turns=")) {
      const val = parseInt(arg.slice("--max-turns=".length), 10);
      if (!isNaN(val))
        result.maxTurns = val;
      i++;
    } else if (arg === "--max-hops" || arg === "--hops") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val))
        result.maxAutonomousHandoffHops = val;
      i++;
    } else if (arg.startsWith("--max-hops=")) {
      const val = parseInt(arg.slice("--max-hops=".length), 10);
      if (!isNaN(val))
        result.maxAutonomousHandoffHops = val;
      i++;
    } else if (arg.startsWith("--hops=")) {
      const val = parseInt(arg.slice("--hops=".length), 10);
      if (!isNaN(val))
        result.maxAutonomousHandoffHops = val;
      i++;
    } else if (arg === "-d" || arg === "--debug" || arg === "-debug") {
      result.debug = true;
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        const nextArg = args[i + 1];
        if (nextArg.endsWith(".log") || nextArg.endsWith(".txt") || nextArg.includes("/") || nextArg.includes("\\") || nextArg.includes(".")) {
          result.debugLogPath = args[++i];
        }
      }
      i++;
    } else if (arg.startsWith("--debug=") || arg.startsWith("-debug=")) {
      result.debug = true;
      result.debugLogPath = arg.startsWith("--debug=") ? arg.slice("--debug=".length) : arg.slice("-debug=".length);
      i++;
    } else if (arg === "--log" || arg === "--log-file" || arg === "-log" || arg === "-log-file") {
      result.debug = true;
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        result.debugLogPath = args[++i];
      }
      i++;
    } else if (arg.startsWith("--log=") || arg.startsWith("-log=")) {
      result.debug = true;
      result.debugLogPath = arg.startsWith("--log=") ? arg.slice("--log=".length) : arg.slice("-log=".length);
      i++;
    } else if (arg.startsWith("--log-file=") || arg.startsWith("-log-file=")) {
      result.debug = true;
      result.debugLogPath = arg.startsWith("--log-file=") ? arg.slice("--log-file=".length) : arg.slice("-log-file=".length);
      i++;
    } else if (arg === "--timeout") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val) && val > 0)
        result.timeoutSec = val;
      i++;
    } else if (arg.startsWith("--timeout=")) {
      const val = parseInt(arg.slice("--timeout=".length), 10);
      if (!isNaN(val) && val > 0)
        result.timeoutSec = val;
      i++;
    } else if (arg === "-t") {
      const nextArg = args[i + 1];
      const num = nextArg !== undefined ? parseInt(nextArg, 10) : NaN;
      if (!isNaN(num) && String(num) === nextArg?.trim() && num > 0) {
        result.timeoutSec = num;
        i += 2;
      } else {
        result.task = args[++i];
        i++;
      }
    } else if (arg.startsWith("-t=")) {
      const raw = arg.slice("-t=".length);
      const num = parseInt(raw, 10);
      if (!isNaN(num) && String(num) === raw.trim() && num > 0) {
        result.timeoutSec = num;
      } else {
        result.task = raw;
      }
      i++;
    } else if (arg === "--task") {
      result.task = args[++i];
      i++;
    } else if (arg.startsWith("--task=")) {
      result.task = arg.slice("--task=".length);
      i++;
    } else if (arg === "-p" || arg === "--port") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val) && val > 0)
        result.port = val;
      i++;
    } else if (arg.startsWith("--port=")) {
      const val = parseInt(arg.slice("--port=".length), 10);
      if (!isNaN(val) && val > 0)
        result.port = val;
      i++;
    } else if (arg.startsWith("-p=")) {
      const val = parseInt(arg.slice("-p=".length), 10);
      if (!isNaN(val) && val > 0)
        result.port = val;
      i++;
    } else if (arg === "--host") {
      result.host = args[++i];
      i++;
    } else if (arg.startsWith("--host=")) {
      result.host = arg.slice("--host=".length);
      i++;
    } else if (arg === "--no-open") {
      result.noOpen = true;
      i++;
    } else if (!arg.startsWith("-")) {
      if (arg === "web" && !result.subcommand && positional.length === 0) {
        result.subcommand = "web";
      } else if (arg === "auth" && !result.subcommand && positional.length === 0) {
        result.subcommand = "auth";
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          result.authAction = args[++i];
          if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
            result.authTargetEmail = args[++i];
          }
        }
      } else {
        positional.push(arg);
      }
      i++;
    } else {
      i++;
    }
  }
  if (result.subcommand === "web") {
    if (result.port === undefined) {
      result.port = 3000;
    }
    if (result.host === undefined) {
      result.host = "127.0.0.1";
    }
  }
  if (!result.hasExplicitModel) {
    result.modelTone = "Gpt_61_Sol_Reasoning";
  }
  if (!result.customAgentId) {
    result.customAgentId = DEFAULT_MAIN_AGENT_ID;
  }
  if (!result.coderAgentId) {
    result.coderAgentId = DEFAULT_CODER_AGENT_ID;
  }
  if (!result.researcherAgentId) {
    result.researcherAgentId = DEFAULT_RESEARCHER_AGENT_ID;
  }
  const baseDir = process.env.CPH_PI_ORIGINAL_CWD || process.cwd();
  if (!result.workspaceRoot) {
    if (positional.length > 0) {
      const first = positional[0];
      if (first === "." || first === "./" || first === ".\\") {
        result.workspaceRoot = baseDir;
        positional.shift();
      } else {
        const resolved = path23.isAbsolute(first) ? first : path23.resolve(baseDir, first);
        let isDir = false;
        try {
          isDir = fs18.existsSync(resolved) && fs18.statSync(resolved).isDirectory();
        } catch {
          isDir = false;
        }
        if (isDir) {
          result.workspaceRoot = resolved;
          positional.shift();
        }
      }
    }
  }
  if (!result.workspaceRoot) {
    result.workspaceRoot = baseDir;
  }
  if (!result.task && positional.length > 0) {
    if (result.subcommand !== "web" && result.subcommand !== "auth") {
      result.task = positional.join(" ");
    }
  }
  result.positional = positional;
  return result;
}
function getHelpText() {
  return [
    source_default.bold.cyan("CPH-PI: Copilot-Pi Hybrid Autonomous Coding Agent"),
    "",
    source_default.bold("用法 (Usage):"),
    `  cph-pi [选项] [任务描述...]`,
    `  cph-pi auth login [email]`,
    `  cph-pi web [选项]`,
    `  bun run src/cli.ts [选项] [任务描述...]`,
    "",
    source_default.bold("选项 (Options):"),
    `  ${source_default.green("-h, --help")}              显示帮助信息并退出`,
    `  ${source_default.green("-v, --version")}           显示版本号并退出`,
    `  ${source_default.green("-c, --continue")}          接续最近活跃的会话`,
    `  ${source_default.green("-r, --resume <id>")}       恢复指定 ID 的历史会话`,
    `  ${source_default.green("-w, --workspace <path>")}   指定工作区根目录 (默认: 当前目录)`,
    `  ${source_default.green("-a, --agent <id|url>")}     指定专属自建主协调智能体 ID 或 M365 分享链接 (默认: 主协调智能体)`,
    `  ${source_default.green("--coder-agent-id <id|url>")} 指定代码实现子智能体 ID (默认: 代码实现智能体)`,
    `  ${source_default.green("--researcher-agent-id <id|url>")} 指定深度调研子智能体 ID (默认: 深度调研智能体)`,
    `  ${source_default.green("-m, --model <tone>")}       指定模型风格 (默认: Gpt_61_Sol_Reasoning)`,
    `  ${source_default.green("-acc, --accounts <list>")}   设置允许启用的账号白名单 (逗号分隔，其余默认跳过)`,
    `  ${source_default.green("-d, --debug [path]")}       启用 Debug 模式并实时落盘终端输出到本地日志 (默认: .cph/logs/)`,
    `  ${source_default.green("--log <path>")}             指定终端输出落盘日志文件路径 (自动启用 Debug 模式)`,
    `  ${source_default.green("-t, --timeout <seconds>")}  单轮请求超时时间 (默认: 600 秒)`,
    `  ${source_default.green("--max-turns <n>")}          单任务最大推理循环轮数 (默认: 30)`,
    `  ${source_default.green("--max-hops, --hops <n>")}   连续自主接力跃迁上限 (默认: 50)`,
    `  ${source_default.green("--task <prompt>")}          非交互式直接执行任务并退出`,
    "",
    source_default.bold("Web 界面服务 (Web Frontend):"),
    `  cph-pi web [选项]`,
    `    ${source_default.green("-p, --port <number>")}    Web 服务端口 (默认: 3000)`,
    `    ${source_default.green("--host <string>")}        Web 监听地址 (默认: 127.0.0.1)`,
    `    ${source_default.green("--no-open")}              禁用自动打开默认浏览器`,
    "",
    source_default.bold("账号授权与换票 (Authentication):"),
    `  cph-pi auth login [email]               通过浏览器交互式 PKCE 刷新或新增账号凭据`,
    "",
    source_default.bold("交互模式命令 (Interactive Commands):"),
    `  ${source_default.yellow("/help")}        显示终端帮助与交互快捷键`,
    `  ${source_default.yellow("/status")}      查看当前会话诊断卡与账号池状态`,
    `  ${source_default.yellow("/accounts")}    查看或配置账号池 (/accounts login|enable|disable|set|reset)`,
    `  ${source_default.yellow("/agent [id|clear]")} 查看、绑定或解除工作区专属智能体`,
    `  ${source_default.yellow("/model [tone]")}    查看或动态切换模型风格`,
    `  ${source_default.yellow("/debug [on|off|path]")} 查看、开启或关闭终端输出实时落盘`,
    `  ${source_default.yellow("/new [title]")} 开启新会话 (重置两轮握手基准探测)`,
    `  ${source_default.yellow("/sessions")}    查看当前工作区所有历史会话列表`,
    `  ${source_default.yellow("/resume <id>")} 恢复指定 ID 的历史会话 (自动续跑脱困快照)`,
    `  ${source_default.yellow("/continue [任务]")} 自动续跑当前或最近接力会话 (别名 /relay)`,
    `  ${source_default.yellow("/relay [任务]")}    快捷接力推进当前或最近会话成果快照`,
    `  ${source_default.yellow("/skills")}      查看所有检测到的原生技能与激活状态`,
    `  ${source_default.yellow("/skills find")} 搜索指定关键词的技能 (如 /skills find tdd)`,
    `  ${source_default.yellow("/skill <name>")} 切换指定技能的激活状态`,
    `  ${source_default.yellow("/reset")}       归档当前会话并开启新会话`,
    `  ${source_default.yellow("/exit")}        退出终端 (或 /quit)`,
    "",
    source_default.bold("键盘与中断控制 (Keyboard Controls):"),
    `  ${source_default.magenta('"""')} 多行输入      在首行输入 """ 开启多行输入，再次输入 """ 提交`,
    `  ${source_default.magenta("\\")} 行尾续行       行末尾输入 \\ 在下一行继续输入`,
    `  ${source_default.magenta("Ctrl+C")} 中断流/命令 任务运行中按 Ctrl+C 中止当前流与工具执行，保留会话`,
    `  ${source_default.magenta("Ctrl+C (连按两次)")} 空闲中 1.5 秒内连按两次安全退出终端`
  ].join(`
`);
}
function printHelp() {
  const text = getHelpText();
  process.stdout.write(text + `
`);
  return text;
}
function renderHelpBanner() {
  return getHelpText();
}
var parseArgs = parseCliArgs;

// src/cli/commands.ts
var BUILTIN_SLASH_COMMANDS = {
  "/help": (_cli) => {
    const help = [
      source_default.bold.cyan(`
可用命令列表:`),
      `  ${source_default.bold.yellow("/help")}        - 显示本帮助信息与按键说明`,
      `  ${source_default.bold.yellow("/status")}      - 查看当前会话诊断卡与账号池状态`,
      `  ${source_default.bold.yellow("/accounts")}    - 查看或配置账号池 (/accounts login|enable|disable|set|reset)`,
      `  ${source_default.bold.yellow("/agent [id|clear]")} - 查看、绑定或解除专属智能体`,
      `  ${source_default.bold.yellow("/model [tone]")}      - 查看或动态切换当前模型风格`,
      `  ${source_default.bold.yellow("/debug [on|off|path]")} - 查看、开启或关闭终端输出实时落盘`,
      `  ${source_default.bold.yellow("/new [title]")} - 开启新会话 (重置两轮握手基准探测)`,
      `  ${source_default.bold.yellow("/sessions")}    - 查看当前工作区所有历史会话列表`,
      `  ${source_default.bold.yellow("/resume <id>")} - 恢复指定 ID 的历史会话 (自动续跑脱困快照)`,
      `  ${source_default.bold.yellow("/continue [任务]")} - 自动续跑当前或最近接力会话 (别名 /relay)`,
      `  ${source_default.bold.yellow("/relay [任务]")}    - 快捷接力推进当前或最近会话成果快照`,
      `  ${source_default.bold.yellow("/skills")}      - 列出所有技能并显示 [Agent内置] / [动态附件] 标识`,
      `  ${source_default.bold.yellow("/skills mounted")} - 查看已在 Agent 挂载与动态挂载的筛分总览`,
      `  ${source_default.bold.yellow("/skills mount <name>")} - 将技能设为 Agent 内置免附件轻量化唤醒`,
      `  ${source_default.bold.yellow("/skills unmount <name>")} - 将技能恢复为动态随任务挂载全量附件`,
      `  ${source_default.bold.yellow("/skills find <kw>")} - 搜索指定关键词的技能 (如 /skills find tdd)`,
      `  ${source_default.bold.yellow("/skill <name>")} - 切换指定技能的激活/停用状态`,
      `  ${source_default.bold.yellow("/<skill> <任务>")}- 快捷以专属技能模式执行任务 (如 /brainstorming 设计需求)`,
      `  ${source_default.bold.yellow("/audit")}       - 查看执行总账 (Execution Ledger) 审计状态与快照摘要`,
      `  ${source_default.bold.yellow("/clear")}       - 清空当前终端屏幕显示`,
      `  ${source_default.bold.yellow("/reset")}       - 归档当前会话并开启新会话`,
      `  ${source_default.bold.yellow("/exit")}        - 安全退出终端 (或输入 /quit)`,
      "",
      source_default.bold.cyan("输入技巧与按键控制:"),
      `  ${source_default.green('"""')} 多行块   - 首行输入 """ 进入多行模式，再次输入 """ 提交`,
      `  ${source_default.green("\\")} 行尾续行    - 行末输入 \\ 可在下一行继续输入`,
      `  ${source_default.green("Ctrl+C")}        - 运行中：中止当前网络流与子进程，保留上下文`,
      `                   空闲中：1.5 秒内连按两次退出终端`,
      ""
    ].join(`
`);
    process.stdout.write(help);
  },
  "/clear": () => {
    process.stdout.write("\x1Bc");
    process.stdout.write(source_default.green(`
✔ 终端显示已清空。

`));
  },
  "/audit": (cli) => {
    const ledger = cli.ledger;
    const entries = ledger && typeof ledger.getEntries === "function" ? ledger.getEntries() : [];
    const currentSession = cli.getCurrentSession();
    const info = [
      source_default.bold.cyan(`
[CPH-PI 安全审计与执行总账 (Execution Ledger)]`),
      source_default.gray("──────────────────────────────────────────────────"),
      `  工作区目录:      ${source_default.white(cli.getWorkspaceRoot())}`,
      `  当前活跃会话:    ${currentSession ? source_default.green(currentSession.id) : source_default.gray("无")}`,
      `  总账事件记录目:  ${source_default.green(String(entries.length))} 条`,
      `  当前会话已走轮数:${source_default.yellow(String(currentSession?.turnCount || 0))} 轮`,
      source_default.gray("──────────────────────────────────────────────────"),
      source_default.dim("  执行总账物理预写日志 (WAL) 由系统自动实时落盘于 .cph/state/。"),
      ""
    ].join(`
`);
    process.stdout.write(info);
  },
  "/reset": (cli) => {
    const newSession = cli.resetSessionAndOrchestrator("新会话");
    process.stdout.write(source_default.green(`
✔ 会话历史与上下文已重置。新会话已开启: ${newSession.id}

`));
  },
  "/new": (cli, args) => {
    const title = args.trim() || undefined;
    const currentSession = cli.getCurrentSession();
    if (currentSession) {
      currentSession.status = "completed";
      cli.getSessionManager().saveSession(currentSession);
    }
    const session = cli.getSessionManager().createSession({
      title: title || "新会话",
      workspaceRoot: cli.getWorkspaceRoot(),
      maxTurns: cli.getMaxTurns(),
      modelTone: cli.getModelTone()
    });
    cli.setCurrentSession(session);
    cli.getOrchestrator().resetHandshake();
    cli.setLastCompactionRatio(undefined);
    process.stdout.write(source_default.green(`
✔ 新会话已开启: ${session.id}${title ? ` ("${title}")` : ""}
  状态机已重置为 Turn 1 纯净基准探测握手。

`));
  },
  "/sessions": (cli) => {
    process.stdout.write(cli.formatSessionsList() + `
`);
  },
  "/resume": async (cli, args, rawCommand) => {
    const parts = rawCommand.trim().split(/\s+/);
    const targetId = parts[1];
    if (!targetId) {
      process.stdout.write(source_default.yellow(`
请输入要恢复的会话 ID，例如: /resume ses_123

`));
      return;
    }
    const loaded = cli.getSessionManager().loadSession(targetId);
    if (!loaded) {
      process.stdout.write(source_default.red(`
未找到会话 ID: "${targetId}"。输入 /sessions 查看可用历史会话。

`));
      return;
    }
    const currentSession = cli.getCurrentSession();
    if (currentSession && currentSession.id !== loaded.id) {
      cli.getSessionManager().saveSession(currentSession);
    }
    cli.setCurrentSession(loaded);
    if (loaded.turns && loaded.turns.length > 0 || loaded.handoffSnapshot) {
      cli.getOrchestrator().completeHandshake();
    } else {
      cli.getOrchestrator().resetHandshake();
    }
    process.stdout.write(source_default.green(`
✔ 已恢复会话: ${loaded.id} ("${loaded.title}") [已进行 ${loaded.turnCount} 轮]

`));
    const pending = cli.getPendingHandoffSnapshot();
    if (loaded.handoffSnapshot || loaded.status === "handed_off" || pending) {
      cli.setPendingHandoffSnapshot(loaded.handoffSnapshot || pending);
      const customPrompt = parts.slice(2).join(" ").trim();
      const resumeInstruction = customPrompt || "请根据前序会话成果快照继续推进剩余需求";
      await cli.executeTask(resumeInstruction);
    }
  },
  "/continue": async (cli, args) => {
    await handleContinueOrRelay(cli, args);
  },
  "/relay": async (cli, args) => {
    await handleContinueOrRelay(cli, args);
  },
  "/status": (cli) => {
    process.stdout.write(cli.getDiagnosticCard() + `
`);
  },
  "/accounts": async (cli, args) => {
    await cli.handleAccountsCommand(args);
  },
  "/agent": (cli, args) => {
    cli.handleAgentCommand(args);
  },
  "/model": (cli, args) => {
    cli.handleModelCommand(args);
  },
  "/skills": (cli, args) => {
    const trimmed = args.trim();
    if (trimmed === "mounted") {
      const allSkills = cli.getSkillRegistry().getAvailableSkills();
      const mountedNames = cli.getSkillRegistry().getAgentMountedSkills();
      const mountedSkills = allSkills.filter((s) => mountedNames.has(s.name.toLowerCase()));
      const dynamicSkills = allSkills.filter((s) => !mountedNames.has(s.name.toLowerCase()));
      const lines = [
        source_default.bold.cyan(`
[技能挂载筛分总览 (共 ${allSkills.length} 个技能)]`),
        source_default.gray("──────────────────────────────────────────────────"),
        source_default.bold.cyan(`◈ Agent 内置已挂载技能 (免附件/轻量通知, 共 ${mountedSkills.length} 个):`),
        mountedSkills.length === 0 ? source_default.gray("  (暂无内置技能)") : mountedSkills.map((s) => `  ${source_default.cyan("●")} ${source_default.bold.white(s.name)}${s.description ? source_default.gray(` - ${s.description}`) : ""}`).join(`
`),
        "",
        source_default.bold.yellow(`◈ 动态随任务挂载技能 (全量附件/Prompt正文注入, 共 ${dynamicSkills.length} 个):`),
        dynamicSkills.length === 0 ? source_default.gray("  (暂无动态技能)") : dynamicSkills.map((s) => `  ${source_default.yellow("○")} ${source_default.white(s.name)}${s.description ? source_default.gray(` - ${s.description}`) : ""}`).join(`
`),
        source_default.gray("──────────────────────────────────────────────────"),
        source_default.dim(`提示: /skills mount <name> 设为内置免附件 | /skills unmount <name> 设为动态附件
`)
      ];
      process.stdout.write(lines.join(`
`));
      return;
    }
    if (trimmed.startsWith("mount")) {
      const name = trimmed.slice("mount".length).trim();
      if (!name) {
        process.stdout.write(source_default.yellow(`
请输入要挂载为内置的技能名称，例如: /skills mount handoff

`));
        return;
      }
      const skill = cli.getSkillRegistry().findSkill(name);
      if (!skill) {
        process.stdout.write(source_default.red(`
未找到技能: "${name}"。输入 /skills 查看可用列表。

`));
        return;
      }
      cli.getSkillRegistry().setAgentMounted(skill.name, true);
      const mountedArr = Array.from(cli.getSkillRegistry().getAgentMountedSkills());
      cli.saveWorkspaceConfig({ agentMountedSkills: mountedArr });
      process.stdout.write(source_default.green(`
✔ 已将技能 "${skill.name}" 设为 Agent 内置已挂载模式 (免附件传输，指令轻量化唤醒)。
  配置已保存至 .cph/config.json

`));
      return;
    }
    if (trimmed.startsWith("unmount")) {
      const name = trimmed.slice("unmount".length).trim();
      if (!name) {
        process.stdout.write(source_default.yellow(`
请输入要移除内置的技能名称，例如: /skills unmount handoff

`));
        return;
      }
      const skill = cli.getSkillRegistry().findSkill(name);
      if (!skill) {
        process.stdout.write(source_default.red(`
未找到技能: "${name}"。输入 /skills 查看可用列表。

`));
        return;
      }
      cli.getSkillRegistry().setAgentMounted(skill.name, false);
      const mountedArr = Array.from(cli.getSkillRegistry().getAgentMountedSkills());
      cli.saveWorkspaceConfig({ agentMountedSkills: mountedArr });
      process.stdout.write(source_default.yellow(`
○ 已将技能 "${skill.name}" 恢复为动态随任务挂载模式 (全量附件/Prompt正文注入)。
  配置已保存至 .cph/config.json

`));
      return;
    }
    if (trimmed.startsWith("find")) {
      const kw = trimmed.slice("find".length).trim();
      if (!kw) {
        process.stdout.write(source_default.yellow(`
请输入要搜索的技能关键词，例如: /skills find tdd

`));
        return;
      }
      const matched = cli.getSkillRegistry().searchSkills(kw);
      if (matched.length === 0) {
        process.stdout.write(source_default.yellow(`
未找到匹配关键词 "${kw}" 的技能。

`));
        return;
      }
      const activeNames = new Set(cli.getSkillRegistry().getActiveSkills().map((s) => s.name.toLowerCase()));
      const lines = [
        source_default.bold.cyan(`
[搜索结果: 匹配 "${kw}" 的技能 (共 ${matched.length} 个)]`),
        ...matched.map((s) => {
          const isActive = activeNames.has(s.name.toLowerCase());
          const mark = isActive ? source_default.green("[✓]") : source_default.gray("[ ]");
          const isMounted = cli.getSkillRegistry().isAgentMounted(s.name);
          const modeTag = isMounted ? source_default.cyan("[Agent内置]") : source_default.gray("[动态附件]");
          const name = isActive ? source_default.bold.green(s.name) : source_default.bold.white(s.name);
          const desc = s.description ? source_default.gray(` - ${s.description}`) : "";
          return `  ${mark} ${name} ${modeTag}${desc}`;
        }),
        ""
      ];
      process.stdout.write(lines.join(`
`));
      return;
    }
    const allSkills = cli.getSkillRegistry().getAvailableSkills();
    if (allSkills.length === 0) {
      process.stdout.write(source_default.yellow(`
未在工作区或全局发现可用技能。

`));
      return;
    }
    const activeNames = new Set(cli.getSkillRegistry().getActiveSkills().map((s) => s.name.toLowerCase()));
    const lines = [
      source_default.bold.cyan(`
[CPH-PI 可用原生技能列表 (共 ${allSkills.length} 个)]`),
      ...allSkills.map((s) => {
        const isActive = activeNames.has(s.name.toLowerCase());
        const mark = isActive ? source_default.green("[✓]") : source_default.gray("[ ]");
        const isMounted = cli.getSkillRegistry().isAgentMounted(s.name);
        const modeTag = isMounted ? source_default.cyan("[Agent内置]") : source_default.gray("[动态附件]");
        const name = isActive ? source_default.bold.green(s.name) : source_default.bold.white(s.name);
        const desc = s.description ? source_default.gray(` - ${s.description}`) : "";
        return `  ${mark} ${name} ${modeTag}${desc}`;
      }),
      "",
      source_default.dim("提示: /skill <name> 切换激活 | /skills mounted 查看分类 | /skills mount|unmount <name> 筛分挂载 | /<skill-name> <任务> 直接运行"),
      ""
    ];
    process.stdout.write(lines.join(`
`));
  },
  "/skill": (cli, args) => {
    const name = args.trim();
    if (!name) {
      process.stdout.write(source_default.yellow(`
请输入技能名称，例如: /skill brainstorming

`));
      return;
    }
    const res = cli.getSkillRegistry().toggleSkill(name);
    if (!res.skill) {
      process.stdout.write(source_default.red(`
未找到技能: "${name}"。输入 /skills 查看可用列表。

`));
    } else if (res.active) {
      process.stdout.write(source_default.green(`
✔ 已激活技能: ${res.skill.name}${res.skill.description ? ` (${res.skill.description})` : ""}

`));
    } else {
      process.stdout.write(source_default.yellow(`
○ 已停用技能: ${res.skill.name}

`));
    }
  },
  "/debug": (cli, args, rawCommand) => {
    const parts = rawCommand.trim().split(/\s+/);
    const arg = parts[1]?.toLowerCase();
    const customPath = parts[1] && !["on", "off", "true", "false", "status"].includes(arg) ? parts.slice(1).join(" ") : undefined;
    if (!arg || arg === "status") {
      const isEnabled = cli.isDebugModeEnabled();
      const statusStr = isEnabled ? source_default.green("已开启") : source_default.yellow("已关闭");
      const logPath = TerminalLogger.getInstance().getLogFilePath() || cli.getDebugLogPath() || "(默认路径)";
      process.stdout.write(source_default.cyan(`
[Debug 终端落盘状态]
  状态: ${statusStr}
  日志路径: ${source_default.white(logPath)}

`));
      return;
    }
    if (arg === "off" || arg === "false") {
      cli.setDebugMode(false);
      cli.saveWorkspaceConfig({ debug: false });
      process.stdout.write(source_default.yellow(`
○ Debug 模式已关闭，停止终端输出落盘。

`));
      return;
    }
    if (arg === "on" || arg === "true" || customPath) {
      const targetPath = customPath || (parts[2] ? parts.slice(2).join(" ") : undefined);
      cli.setDebugMode(true, targetPath);
      const actualLog = TerminalLogger.getInstance().getLogFilePath();
      cli.saveWorkspaceConfig({ debug: true, debugLogPath: targetPath });
      process.stdout.write(source_default.green(`
✔ Debug 模式已开启，终端实时输出落盘至: ${source_default.bold(actualLog)}

`));
      return;
    }
  },
  "/exit": (cli) => {
    process.stdout.write(source_default.gray(`
退出 CPH-PI 终端。再见！
`));
    cli.close();
    process.exit(0);
  },
  "/quit": (cli) => {
    process.stdout.write(source_default.gray(`
退出 CPH-PI 终端。再见！
`));
    cli.close();
    process.exit(0);
  }
};
async function handleContinueOrRelay(cli, customInstruction) {
  const resumeInstruction = customInstruction.trim() || "请根据前序会话成果快照继续推进剩余需求";
  let targetSession = null;
  const current = cli.getCurrentSession();
  const pending = cli.getPendingHandoffSnapshot();
  if (current && (current.handoffSnapshot || current.status === "handed_off" || pending)) {
    targetSession = current;
  } else {
    const sessions = cli.getSessionManager().listSessions();
    const candidate = sessions.find((s) => s.handoffSnapshot || s.status === "handed_off") || sessions.find((s) => s.status === "active") || sessions[0];
    if (candidate) {
      targetSession = cli.getSessionManager().loadSession(candidate.id);
    }
  }
  if (!targetSession) {
    process.stdout.write(source_default.yellow(`
未发现可接力的历史会话或成果快照。输入 /sessions 查看可用会话。

`));
    return;
  }
  if (current && current.id !== targetSession.id) {
    cli.getSessionManager().saveSession(current);
  }
  cli.setCurrentSession(targetSession);
  cli.setPendingHandoffSnapshot(targetSession.handoffSnapshot || pending);
  if (targetSession.turns && targetSession.turns.length > 0 || targetSession.handoffSnapshot) {
    cli.getOrchestrator().completeHandshake();
  } else {
    cli.getOrchestrator().resetHandshake();
  }
  process.stdout.write(source_default.green(`
✔ 正在接力推进会话: ${targetSession.id} ("${targetSession.title}")

`));
  await cli.executeTask(resumeInstruction);
}
function isBuiltinSlashCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/"))
    return false;
  const verb = trimmed.split(/\s+/)[0].toLowerCase();
  return Object.prototype.hasOwnProperty.call(BUILTIN_SLASH_COMMANDS, verb);
}
async function dispatchSlashCommand(cli, rawCommand) {
  const trimmed = rawCommand.trim();
  if (!trimmed.startsWith("/"))
    return false;
  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toLowerCase();
  const args = trimmed.slice(parts[0].length).trim();
  const handler = BUILTIN_SLASH_COMMANDS[verb];
  if (handler) {
    await handler(cli, args, trimmed);
    return true;
  }
  return false;
}

// src/cli.ts
class CphPiCli {
  workspaceRoot;
  modelTone;
  maxTurns;
  timeoutSec;
  maxAutonomousHandoffHops;
  customAgentId;
  coderAgentId;
  researcherAgentId;
  pool;
  renderer;
  interruptController;
  orchestrator;
  chatClient;
  ledger;
  arbitratorChatClient;
  chatClientFactory;
  bridge;
  skillRegistry;
  sessionManager;
  currentSession = null;
  continueLast = false;
  resumeSessionId;
  lastCompactionRatio;
  rl;
  multilineBuffer = [];
  isMultilineMode = false;
  isInteractive = false;
  pendingHandoffSnapshot;
  graphTokenProvider;
  debug = false;
  debugLogPath;
  constructor(options = {}) {
    this.workspaceRoot = path24.resolve(options.workspaceRoot || options.workspace || process.env.CPH_PI_ORIGINAL_CWD || process.cwd());
    this.ledger = options.ledger || new ExecutionLedger(this.workspaceRoot);
    const config = this.loadWorkspaceConfig();
    const cliAgentId = options.customAgentId ? ChatHubClient.normalizeAgentId(options.customAgentId) : undefined;
    const envAgentId = ChatHubClient.normalizeAgentId(process.env.CPH_COPILOT_AGENT_ID);
    this.customAgentId = cliAgentId ?? envAgentId ?? config.customAgentId;
    this.coderAgentId = (options.coderAgentId ? ChatHubClient.normalizeAgentId(options.coderAgentId) : undefined) ?? DEFAULT_CODER_AGENT_ID;
    this.researcherAgentId = (options.researcherAgentId ? ChatHubClient.normalizeAgentId(options.researcherAgentId) : undefined) ?? DEFAULT_RESEARCHER_AGENT_ID;
    this.modelTone = options.modelTone || config.modelTone || "Gpt_61_Sol_Reasoning";
    this.maxTurns = options.maxTurns || 30;
    this.timeoutSec = options.timeoutSec ?? options.parsedArgs?.timeoutSec ?? 600;
    const timeoutMs = this.timeoutSec * 1000;
    this.maxAutonomousHandoffHops = options.maxAutonomousHandoffHops ?? 50;
    this.pool = options.pool || new AccountPool;
    const effectiveAllowedAccounts = options.allowedAccounts || config.allowedAccounts;
    if (effectiveAllowedAccounts && effectiveAllowedAccounts.length > 0) {
      this.pool.setAllowedAccounts(effectiveAllowedAccounts);
    }
    this.renderer = options.renderer || new TuiRenderer;
    this.chatClient = options.chatClient;
    this.arbitratorChatClient = options.arbitratorChatClient;
    this.chatClientFactory = options.chatClientFactory || ((token, factoryOpts = {}) => {
      return new ChatHubClient(token, {
        modelTone: factoryOpts.modelTone || this.modelTone,
        customAgentId: factoryOpts.customAgentId || this.customAgentId,
        timeoutMs
      });
    });
    this.rl = options.rl;
    this.isInteractive = options.isInteractive ?? (this.rl !== undefined ? true : false);
    this.graphTokenProvider = options.graphTokenProvider;
    this.bridge = options.bridge || new ToolBridge({
      cwd: this.workspaceRoot,
      ledger: this.ledger,
      onQuestion: async (qArgs) => {
        const answer = await this.handleInteractiveQuestion(qArgs);
        return ToolBridge.formatUserResponse(answer);
      }
    });
    this.sessionManager = options.sessionManager || new SessionManager(this.workspaceRoot);
    this.continueLast = options.continueLast ?? false;
    this.resumeSessionId = options.resumeSessionId;
    const loader = options.skillLoader || new SkillLoader2(this.workspaceRoot);
    this.skillRegistry = options.skillRegistry || new SkillRegistry(loader);
    if (config.agentMountedSkills && Array.isArray(config.agentMountedSkills)) {
      this.skillRegistry.setAgentMountedSkills(config.agentMountedSkills);
    }
    this.skillRegistry.loadSkills();
    this.interruptController = options.interruptController || new InterruptController({
      idleExitTimeoutMs: 1500,
      onPromptExit: (msg) => {
        process.stdout.write(`
${source_default.yellow(msg)}
> `);
      },
      onExit: () => {
        process.stdout.write(source_default.gray(`
退出 CPH-PI 终端。再见！
`));
        this.close();
        process.exit(0);
      }
    });
    this.orchestrator = options.orchestrator || new Orchestrator({
      workspaceRoot: this.workspaceRoot,
      modelTone: this.modelTone,
      maxTurns: this.maxTurns,
      maxGenerations: this.maxAutonomousHandoffHops,
      pool: this.pool,
      chatClient: this.chatClient,
      arbitratorChatClient: this.arbitratorChatClient,
      chatClientFactory: this.chatClientFactory,
      bridge: this.bridge,
      skillRegistry: this.skillRegistry,
      activeSkills: this.skillRegistry.getActiveSkills(),
      customAgentId: this.customAgentId,
      coderAgentId: this.coderAgentId,
      researcherAgentId: this.researcherAgentId,
      timeoutMs,
      cloudAttachmentThresholdChars: options.cloudAttachmentThresholdChars,
      cloudAttachmentThresholdLines: options.cloudAttachmentThresholdLines,
      graphTokenProvider: this.graphTokenProvider,
      enableWorkspaceCatalog: options.enableWorkspaceCatalog
    });
    this.orchestrator.timeoutMs = timeoutMs;
    this.debug = options.debug ?? config.debug ?? false;
    this.debugLogPath = options.debugLogPath ?? config.debugLogPath;
    if (this.debug) {
      TerminalLogger.getInstance().start({
        logFilePath: this.debugLogPath,
        workspaceRoot: this.workspaceRoot
      });
    }
  }
  isDebugModeEnabled() {
    return this.debug;
  }
  getDebugLogPath() {
    return this.debugLogPath || TerminalLogger.getInstance().getLogFilePath();
  }
  setDebugMode(enabled, logPath) {
    this.debug = enabled;
    if (logPath) {
      this.debugLogPath = logPath;
    }
    if (enabled) {
      TerminalLogger.getInstance().start({
        logFilePath: this.debugLogPath,
        workspaceRoot: this.workspaceRoot
      });
    } else {
      TerminalLogger.getInstance().stop();
    }
  }
  getMaxAutonomousHandoffHops() {
    return this.maxAutonomousHandoffHops;
  }
  setMaxAutonomousHandoffHops(hops) {
    this.maxAutonomousHandoffHops = hops;
  }
  getSkillRegistry() {
    return this.skillRegistry;
  }
  getRenderer() {
    return this.renderer;
  }
  getInterruptController() {
    return this.interruptController;
  }
  getOrchestrator() {
    return this.orchestrator;
  }
  getSessionManager() {
    return this.sessionManager;
  }
  getCurrentSession() {
    return this.currentSession;
  }
  setCurrentSession(session) {
    this.currentSession = session;
  }
  getWorkspaceRoot() {
    return this.workspaceRoot;
  }
  setWorkspaceRoot(newRoot) {
    this.workspaceRoot = path24.resolve(newRoot);
    this.ledger = new ExecutionLedger(this.workspaceRoot);
    if (this.bridge && typeof this.bridge.setCwd === "function") {
      this.bridge.setCwd(this.workspaceRoot, this.ledger);
    } else {
      this.bridge = new ToolBridge({
        cwd: this.workspaceRoot,
        ledger: this.ledger,
        onQuestion: async (qArgs) => {
          const answer = await this.handleInteractiveQuestion(qArgs);
          return ToolBridge.formatUserResponse(answer);
        }
      });
    }
    const loader = new SkillLoader2(this.workspaceRoot);
    this.skillRegistry = new SkillRegistry(loader);
    const config = this.loadWorkspaceConfig();
    if (config.agentMountedSkills && Array.isArray(config.agentMountedSkills)) {
      this.skillRegistry.setAgentMountedSkills(config.agentMountedSkills);
    }
    try {
      this.skillRegistry.loadSkills();
    } catch {}
    if (this.orchestrator && typeof this.orchestrator.setWorkspaceRoot === "function") {
      this.orchestrator.setWorkspaceRoot(this.workspaceRoot, this.skillRegistry);
    } else {
      this.orchestrator = new Orchestrator({
        workspaceRoot: this.workspaceRoot,
        modelTone: this.modelTone,
        maxTurns: this.maxTurns,
        maxGenerations: this.maxAutonomousHandoffHops,
        pool: this.pool,
        chatClient: this.chatClient,
        arbitratorChatClient: this.arbitratorChatClient,
        chatClientFactory: this.chatClientFactory,
        bridge: this.bridge,
        skillRegistry: this.skillRegistry,
        activeSkills: this.skillRegistry.getActiveSkills(),
        customAgentId: this.customAgentId,
        coderAgentId: this.coderAgentId,
        researcherAgentId: this.researcherAgentId,
        timeoutMs: this.timeoutSec * 1000
      });
    }
    try {
      this.sessionManager = new SessionManager(this.workspaceRoot);
    } catch {}
  }
  getModelTone() {
    return this.modelTone;
  }
  setModelTone(tone) {
    this.modelTone = tone;
  }
  getMaxTurns() {
    return this.maxTurns;
  }
  getPool() {
    return this.pool;
  }
  getGraphTokenProvider() {
    return this.graphTokenProvider;
  }
  getPendingHandoffSnapshot() {
    return this.pendingHandoffSnapshot;
  }
  setPendingHandoffSnapshot(snapshot) {
    this.pendingHandoffSnapshot = snapshot;
  }
  getLastCompactionRatio() {
    return this.lastCompactionRatio;
  }
  setLastCompactionRatio(ratio) {
    this.lastCompactionRatio = ratio;
  }
  resetSessionAndOrchestrator(title = "新会话") {
    if (this.currentSession) {
      this.currentSession.status = "completed";
      this.sessionManager.saveSession(this.currentSession);
    }
    this.currentSession = this.sessionManager.createSession({
      title,
      workspaceRoot: this.workspaceRoot,
      maxTurns: this.maxTurns,
      modelTone: this.modelTone
    });
    this.orchestrator = new Orchestrator({
      workspaceRoot: this.workspaceRoot,
      modelTone: this.modelTone,
      maxTurns: this.maxTurns,
      maxGenerations: this.maxAutonomousHandoffHops,
      pool: this.pool,
      chatClient: this.chatClient,
      arbitratorChatClient: this.arbitratorChatClient,
      chatClientFactory: this.chatClientFactory,
      bridge: this.bridge,
      skillRegistry: this.skillRegistry,
      activeSkills: this.skillRegistry.getActiveSkills(),
      customAgentId: this.customAgentId,
      coderAgentId: this.coderAgentId,
      researcherAgentId: this.researcherAgentId,
      timeoutMs: this.timeoutSec * 1000
    });
    this.orchestrator.timeoutMs = this.timeoutSec * 1000;
    this.lastCompactionRatio = undefined;
    return this.currentSession;
  }
  getBridge() {
    return this.bridge;
  }
  getReadline() {
    return this.rl;
  }
  setReadline(rl) {
    this.rl = rl;
  }
  getTimeoutSec() {
    return this.timeoutSec;
  }
  getTimeoutMs() {
    return this.timeoutSec * 1000;
  }
  createChatClient(token, options = {}) {
    if (this.chatClientFactory) {
      return this.chatClientFactory(token, options);
    }
    return new ChatHubClient(token, {
      modelTone: options.modelTone || this.modelTone,
      customAgentId: options.customAgentId || this.customAgentId,
      timeoutMs: this.timeoutSec * 1000
    });
  }
  static parseArgs(args) {
    return parseCliArgs(args);
  }
  parseArgs(args) {
    return parseCliArgs(args);
  }
  static printHelp() {
    return printHelp();
  }
  printHelp() {
    return printHelp();
  }
  static renderHelpBanner() {
    return renderHelpBanner();
  }
  renderHelpBanner() {
    return renderHelpBanner();
  }
  async startWebServer(options = {}) {
    const port = options.port ?? 3000;
    const host = options.host ?? "127.0.0.1";
    const autoOpen = options.autoOpen ?? true;
    const targetDistDir = resolveWebDistDir(options.distDir);
    const webDistIndex = path24.resolve(targetDistDir, "index.html");
    if (!fs19.existsSync(webDistIndex)) {
      console.warn(source_default.yellow(`⚠️  警告: 未找到前端构建产物 (web/dist/index.html)。请先运行: npm run web:build
`));
    }
    return await startWebServer({
      port,
      host,
      autoOpen,
      distDir: targetDistDir,
      workspaceRoot: this.workspaceRoot,
      orchestrator: this.orchestrator,
      sessionManager: this.sessionManager,
      pool: this.pool,
      cliApp: this,
      skillRegistry: this.skillRegistry,
      debug: this.isDebugModeEnabled(),
      debugLogPath: this.getDebugLogPath()
    });
  }
  async handleInteractiveQuestion(qArgs) {
    this.renderer.renderQuestionPrompt(qArgs.question, qArgs.options);
    if (!this.rl || !this.isInteractiveMode() || process.stdin.destroyed) {
      return "[QUESTION_UNAVAILABLE] 当前通道无法交互。请基于现有信息继续推进；若存在关键待确认点，请在 FINAL_ANSWER 中明确列出。";
    }
    return new Promise((resolve) => {
      let promptQuery = source_default.yellow(`
请输入你的选择或回答: `);
      if (qArgs.options && qArgs.options.length > 0) {
        promptQuery = source_default.yellow(`
请选择 (1-${qArgs.options.length}) 或输入回答: `);
      }
      this.rl.question(promptQuery, (answer) => {
        const trimmed = (answer || "").trim();
        if (qArgs.options && qArgs.options.length > 0) {
          const num = parseInt(trimmed, 10);
          if (!isNaN(num) && String(num) === trimmed && num >= 1 && num <= qArgs.options.length) {
            resolve(qArgs.options[num - 1]);
            return;
          }
        }
        resolve(trimmed || (qArgs.options && qArgs.options.length > 0 ? qArgs.options[0] : ""));
      });
    });
  }
  isInteractiveMode() {
    return this.isInteractive || this.rl !== undefined;
  }
  setInteractive(interactive) {
    this.isInteractive = interactive;
  }
  getPendingHandoffSnapshot() {
    return this.pendingHandoffSnapshot;
  }
  loadWorkspaceConfig() {
    const configPath = path24.join(this.workspaceRoot, ".cph", "config.json");
    try {
      if (fs19.existsSync(configPath)) {
        const content = fs19.readFileSync(configPath, "utf-8");
        return JSON.parse(content) || {};
      }
    } catch {}
    return {};
  }
  saveWorkspaceConfig(updates) {
    const cphDir = path24.join(this.workspaceRoot, ".cph");
    const configPath = path24.join(cphDir, "config.json");
    try {
      fs19.mkdirSync(cphDir, { recursive: true });
      let current = {};
      if (fs19.existsSync(configPath)) {
        try {
          current = JSON.parse(fs19.readFileSync(configPath, "utf-8")) || {};
        } catch {
          current = {};
        }
      }
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined) {
          delete current[k];
        } else {
          current[k] = v;
        }
      }
      fs19.writeFileSync(configPath, JSON.stringify(current, null, 2), "utf-8");
    } catch {}
  }
  initSession() {
    if (this.currentSession) {
      return this.currentSession;
    }
    if (this.continueLast) {
      let latest = this.sessionManager.getLatestActiveSession();
      if (!latest) {
        const list = this.sessionManager.listSessions();
        const cand = list.find((s) => s.status !== "handed_off") || list[0];
        if (cand) {
          latest = this.sessionManager.loadSession(cand.id);
        }
      }
      if (latest) {
        this.currentSession = latest;
        if (latest.turns && latest.turns.length > 0) {
          this.orchestrator.completeHandshake();
        }
        return latest;
      }
    }
    if (this.resumeSessionId) {
      const loaded = this.sessionManager.loadSession(this.resumeSessionId);
      if (loaded) {
        this.currentSession = loaded;
        if (loaded.turns && loaded.turns.length > 0) {
          this.orchestrator.completeHandshake();
        }
        return loaded;
      } else {
        process.stdout.write(source_default.yellow(`
未找到指定会话 "${this.resumeSessionId}"，已自动创建新会话。

`));
      }
    }
    this.currentSession = this.sessionManager.createSession({
      workspaceRoot: this.workspaceRoot,
      maxTurns: this.maxTurns,
      modelTone: this.modelTone
    });
    return this.currentSession;
  }
  renderCurrentStatusBar() {
    const session = this.currentSession || this.initSession();
    let estimatedChars = 0;
    for (const t of session.turns || []) {
      estimatedChars += (t.userInput?.length || 0) + (t.modelResponse?.length || 0);
      if (t.toolCalls) {
        for (const tc of t.toolCalls) {
          estimatedChars += tc.output?.length || 0;
        }
      }
    }
    const statuses = this.pool.getPoolStatus();
    const activeAllowed = statuses.filter((s) => s.isAllowed !== false && !s.isThrottled);
    const activeSessionLease = this.pool?.getSessionLease ? this.pool.getSessionLease(session.id) : undefined;
    const currentAcc = session.currentAccount || activeSessionLease || activeAllowed[0]?.email || statuses.find((s) => s.isAllowed !== false)?.email || statuses[0]?.email;
    const agentBadge = this.customAgentId ? this.customAgentId.length > 15 ? this.customAgentId.slice(0, 12) + "..." : this.customAgentId : "通用握手模式";
    const gen = this.orchestrator ? this.orchestrator.getGeneration?.() : session.generation || 1;
    const handoffs = this.orchestrator ? this.orchestrator.getHandoffCount?.() : session.handoffCount || 0;
    const info = {
      sessionId: session.id,
      turnCount: session.turnCount,
      maxTurns: session.maxTurns,
      estimatedTokens: estimatedChars > 0 ? Math.round(estimatedChars / 3.5) : undefined,
      compactionRatio: this.lastCompactionRatio,
      currentAccount: currentAcc,
      agentName: agentBadge,
      generation: gen,
      handoffCount: handoffs
    };
    this.renderer.renderStatusBar(info);
  }
  formatSessionsList() {
    const sessions = this.sessionManager.listSessions();
    if (sessions.length === 0) {
      return source_default.yellow(`
暂无历史会话记录。
`);
    }
    const currentId = this.currentSession?.id;
    const lines = [
      source_default.bold.cyan(`
[历史会话列表 (共 ${sessions.length} 个)]`),
      source_default.gray("┌────┬─────────────────────────────┬──────────────────────────┬───────┬────────────┬─────────────────────┐"),
      source_default.gray("│    │ ") + source_default.bold.white("会话 ID") + "                     │ " + source_default.bold.white("标题") + "                     │ " + source_default.bold.white("轮次") + "  │ " + source_default.bold.white("状态") + "       │ " + source_default.bold.white("最后活跃时间") + source_default.gray("        │"),
      source_default.gray("├────┼─────────────────────────────┼──────────────────────────┼───────┼────────────┼─────────────────────┤")
    ];
    for (const s of sessions) {
      const isCurrent = s.id === currentId;
      const mark = isCurrent ? source_default.green(" *  ") : "    ";
      const idPad = s.id.padEnd(27, " ");
      const idStr = isCurrent ? source_default.bold.green(idPad) : source_default.white(idPad);
      const titleRaw = s.title.length > 24 ? `${s.title.slice(0, 21)}...` : s.title;
      const titlePad = titleRaw.padEnd(24, " ");
      const titleStr = source_default.white(titlePad);
      const turnPad = `${s.turnCount}`.padStart(5, " ");
      const turnStr = source_default.yellow(turnPad);
      const statusColor = s.status === "active" ? source_default.green : s.status === "completed" ? source_default.blue : s.status === "handed_off" ? source_default.yellow : source_default.gray;
      const statusPad = s.status.padEnd(10, " ");
      const statusStr = statusColor(statusPad);
      const dateStr = s.updatedAt ? s.updatedAt.replace("T", " ").slice(0, 19) : "";
      const datePad = dateStr.padEnd(19, " ");
      const timeStr = source_default.gray(datePad);
      lines.push(source_default.gray("│") + mark + source_default.gray("│ ") + idStr + source_default.gray(" │ ") + titleStr + source_default.gray(" │ ") + turnStr + source_default.gray(" │ ") + statusStr + source_default.gray(" │ ") + timeStr + source_default.gray(" │"));
    }
    lines.push(source_default.gray("└────┴─────────────────────────────┴──────────────────────────┴───────┴────────────┴─────────────────────┘"), source_default.dim(`提示: 输入 /resume <id> 恢复指定会话 | 输入 /new [标题] 开启新会话
`));
    return lines.join(`
`);
  }
  async start() {
    this.isInteractive = true;
    this.initSession();
    this.renderer.renderBanner(this.workspaceRoot);
    if (this.debug) {
      const currentLog = TerminalLogger.getInstance().getLogFilePath() || this.debugLogPath;
      process.stdout.write(source_default.magenta(`\uD83D\uDC1E [Debug 模式] 终端输出已实时落盘至: ${source_default.bold(currentLog)}

`));
    }
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: source_default.cyan("cph-pi> ")
      });
    }
    this.rl.on?.("SIGINT", () => {
      this.interruptController.handleSigint();
    });
    this.promptUser();
    this.rl.on?.("line", async (line) => {
      await this.handleInputLine(line);
    });
    this.rl.on?.("close", () => {
      this.interruptController.detach();
    });
  }
  close() {
    if (this.rl) {
      if (typeof this.rl.close === "function") {
        this.rl.close();
      }
      this.rl = undefined;
    }
    this.isInteractive = false;
    this.interruptController.detach();
    TerminalLogger.getInstance().stop();
  }
  async handleInputLine(line) {
    if (this.interruptController.isBusy()) {
      return;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('"""')) {
      if (this.isMultilineMode) {
        this.isMultilineMode = false;
        const task = this.multilineBuffer.join(`
`).trim();
        this.multilineBuffer = [];
        if (task) {
          await this.executeTask(task);
        }
        this.promptUser();
        return;
      } else {
        this.isMultilineMode = true;
        const afterQuotes = trimmed.slice(3).trim();
        if (afterQuotes) {
          this.multilineBuffer.push(afterQuotes);
        }
        process.stdout.write(source_default.dim(`... (输入多行文本，输入 """ 并回车结束)
`));
        this.promptUser("... ");
        return;
      }
    }
    if (this.isMultilineMode) {
      this.multilineBuffer.push(line);
      this.promptUser("... ");
      return;
    }
    if (line.endsWith("\\")) {
      this.multilineBuffer.push(line.slice(0, -1));
      this.promptUser("... ");
      return;
    }
    if (this.multilineBuffer.length > 0) {
      this.multilineBuffer.push(line);
      const task = this.multilineBuffer.join(`
`).trim();
      this.multilineBuffer = [];
      if (task) {
        await this.executeTask(task);
      }
      this.promptUser();
      return;
    }
    if (!trimmed) {
      this.promptUser();
      return;
    }
    if (trimmed.startsWith("/")) {
      if (isBuiltinSlashCommand(trimmed)) {
        await this.handleCommand(trimmed);
        this.promptUser();
        return;
      }
      const parsedSlash = this.skillRegistry.parseSlashCommand(trimmed);
      if (parsedSlash.skill) {
        this.skillRegistry.activateSkill(parsedSlash.skill.name);
        this.renderer.renderSkillActivated(parsedSlash.skill.name);
        if (parsedSlash.task) {
          await this.executeTask(parsedSlash.task, [parsedSlash.skill]);
        } else {
          process.stdout.write(source_default.dim(`已激活技能 ${parsedSlash.skill.name}，请输入具体任务需求。
`));
        }
        this.promptUser();
        return;
      }
      process.stdout.write(source_default.red(`
未知命令或技能: ${trimmed}。输入 /help 或 /skills 查看可用指令。

`));
      this.promptUser();
      return;
    }
    await this.executeTask(trimmed);
    this.promptUser();
  }
  async handleCommand(command) {
    const handled = await dispatchSlashCommand(this, command);
    if (!handled) {
      process.stdout.write(source_default.red(`
未知命令: ${command}。输入 /help 查看可用命令。

`));
    }
  }
  getDiagnosticCard() {
    const statuses = this.pool.getPoolStatus();
    const hasAllowedFilter = this.pool.getAllowedAccounts() !== undefined;
    const allowedStatuses = hasAllowedFilter ? statuses.filter((s) => s.isAllowed !== false) : statuses;
    const available = allowedStatuses.filter((s) => !s.isThrottled).length;
    const total = allowedStatuses.length;
    const activeSkills = this.skillRegistry.getActiveSkills();
    const activeSkillStr = activeSkills.length > 0 ? activeSkills.map((s) => s.name).join(", ") : "无 (全部待机)";
    const currentSession = this.currentSession || this.initSession();
    let estimatedChars = 0;
    for (const turn of currentSession.turns || []) {
      estimatedChars += (turn.userInput?.length || 0) + (turn.modelResponse?.length || 0);
      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          estimatedChars += tc.output?.length || 0;
        }
      }
    }
    const tokenDisplay = estimatedChars > 0 ? `~${Math.round(estimatedChars / 3.5)} tokens` : "0 (全新)";
    const ratioDisplay = this.lastCompactionRatio !== undefined ? `${Math.round(this.lastCompactionRatio * 100)}%` : "0%";
    const agentDisplay = this.customAgentId ? source_default.green(this.customAgentId) : source_default.gray("无 (通用模式)");
    const activeSessionLease = this.pool?.getSessionLease ? this.pool.getSessionLease(currentSession.id) : undefined;
    const preferredEmail = currentSession.currentAccount || activeSessionLease || allowedStatuses.find((s) => !s.isThrottled)?.email || allowedStatuses[0]?.email || "默认";
    const lines = [
      source_default.bold.cyan(`
[CPH-PI 运行状态] - CPH-PI 运行与会话诊断卡`),
      source_default.gray("──────────────────────────────────────────────────"),
      `  当前会话 ID:   ${source_default.green(currentSession.id)}`,
      `  会话标题:      ${source_default.white(currentSession.title)}`,
      `  会话状态:      ${source_default.magenta(currentSession.status)}`,
      `  专属智能体:    ${agentDisplay}`,
      `  当前轮次:      ${source_default.yellow(`${currentSession.turnCount} / ${currentSession.maxTurns}`)}`,
      `  单次最大轮数:  ${source_default.white(String(this.maxTurns))}`,
      `  估算上下文:    ${source_default.cyan(tokenDisplay)} (历史压实率: ${ratioDisplay})`,
      `  创建时间:      ${source_default.gray(currentSession.createdAt)}`,
      `  更新时间:      ${source_default.gray(currentSession.updatedAt)}`,
      source_default.gray("──────────────────────────────────────────────────"),
      `  工作区目录:    ${source_default.white(this.workspaceRoot)}`,
      `  模型风格:      ${source_default.white(this.modelTone)}`,
      `  可用账号数:    ${source_default.green(`${available}/${total}`)}`,
      `  当前/首选账号: ${source_default.cyan(preferredEmail)}`,
      `  已激活技能:    ${source_default.magenta(activeSkillStr)}`,
      ""
    ];
    return lines.join(`
`);
  }
  handleAgentCommand(args) {
    const raw = args ? args.trim() : "";
    if (!raw) {
      if (this.customAgentId) {
        process.stdout.write(source_default.cyan(`
[专属智能体当前绑定: ${this.customAgentId}]
`) + source_default.dim(`提示: 输入 /agent <id|url> 切换绑定 | 输入 /agent clear 清除绑定

`));
      } else {
        process.stdout.write(source_default.yellow(`
[当前未绑定专属智能体，处于通用握手模式]
`) + source_default.dim(`提示: 输入 /agent <id|url> 绑定专属智能体

`));
      }
      return;
    }
    if (raw.toLowerCase() === "clear") {
      this.customAgentId = undefined;
      this.saveWorkspaceConfig({ customAgentId: undefined });
      this.orchestrator.setCustomAgentId(undefined);
      process.stdout.write(source_default.green(`
✔ 已解除专属智能体绑定，已切换回通用握手基准模式。

`));
      return;
    }
    const normalized = ChatHubClient.normalizeAgentId(raw);
    if (!normalized) {
      process.stdout.write(source_default.red(`
无效的智能体 ID 或 URL: "${raw}"

`));
      return;
    }
    this.customAgentId = normalized;
    this.saveWorkspaceConfig({ customAgentId: normalized });
    this.orchestrator.setCustomAgentId(normalized);
    process.stdout.write(source_default.green(`
✔ 专属智能体已绑定: ${normalized}
  配置已保存至 .cph/config.json，已开启 WebSocket 直通推理模式。

`));
  }
  handleModelCommand(args) {
    const raw = args ? args.trim() : "";
    if (!raw) {
      process.stdout.write(source_default.cyan(`
[当前模型风格: ${this.modelTone}]
`) + source_default.dim(`提示: 输入 /model <tone> 切换模型风格 (如 /model Gpt_61_Sol_Reasoning 或 /model Creative)

`));
      return;
    }
    this.modelTone = raw;
    this.saveWorkspaceConfig({ modelTone: raw });
    this.orchestrator.modelTone = raw;
    process.stdout.write(source_default.green(`
✔ 模型风格已切换为: ${raw}
  配置已保存至 .cph/config.json

`));
  }
  formatAccountsList() {
    const statuses = this.pool.getPoolStatus();
    const allowed = this.pool.getAllowedAccounts();
    const hasFilter = allowed !== undefined && allowed.length > 0;
    const lines = [
      source_default.bold.cyan(`
[CPH-PI 账号池白名单与可用状态 (共 ${statuses.length} 个账号)]`),
      source_default.gray("──────────────────────────────────────────────────"),
      ...statuses.map((s) => {
        const isAllowed = s.isAllowed !== false;
        const mark = isAllowed ? source_default.green("[✓]") : source_default.gray("[ ]");
        const emailStr = isAllowed ? source_default.bold.white(s.email) : source_default.gray(s.email);
        let throttleBadge = s.isThrottled ? source_default.red("(429限频冷却)") : source_default.green("(就绪)");
        if (s.authExpired) {
          throttleBadge = source_default.red(`\uD83D\uDD12 凭据已失效 (执行 /accounts login ${s.email} 刷新)`);
        }
        const allowedBadge = isAllowed ? source_default.cyan("(已启用)") : source_default.gray("(已跳过)");
        return `  ${mark} ${emailStr} ${throttleBadge} ${allowedBadge}`;
      }),
      source_default.gray("──────────────────────────────────────────────────"),
      hasFilter ? source_default.yellow(`  当前白名单限制: 仅启用 ${allowed.length} 个账号，其余已跳过`) : source_default.dim("  当前白名单限制: 未设置 (默认全部账号轮转)"),
      "",
      source_default.dim("提示: /accounts login <email> 刷新凭据 | /accounts enable <email> 启用 | /accounts disable <email> 跳过 | /accounts set <e1,e2> 批量设置 | /accounts reset 全量重置"),
      ""
    ];
    return lines.join(`
`);
  }
  async handleAccountsCommand(args) {
    const raw = args ? args.trim() : "";
    if (!raw) {
      process.stdout.write(this.formatAccountsList() + `
`);
      return;
    }
    const parts = raw.split(/\s+/);
    const sub = parts[0].toLowerCase();
    const rest = raw.slice(parts[0].length).trim();
    if (sub === "login") {
      const email = rest ? rest.trim() : undefined;
      await runCliPkceAuthFlow(this.pool, email, this.rl);
      return;
    }
    if (sub === "reset") {
      this.pool.setAllowedAccounts(undefined);
      this.saveWorkspaceConfig({ allowedAccounts: undefined });
      process.stdout.write(source_default.green(`
✔ 已重置账号白名单，所有账号均正常参与轮转。

`));
      return;
    }
    if (sub === "set") {
      if (!rest) {
        process.stdout.write(source_default.yellow(`
请输入要允许的账号邮箱列表，逗号或空格分隔。例如: /accounts set acc1@a.com, acc2@b.com

`));
        return;
      }
      const emails = rest.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      this.pool.setAllowedAccounts(emails);
      this.saveWorkspaceConfig({ allowedAccounts: this.pool.getAllowedAccounts() });
      process.stdout.write(source_default.green(`
✔ 已更新账号白名单 (${emails.length} 个): ${emails.join(", ")}
  配置已保存至 .cph/config.json，未包含账号将默认跳过。

`));
      return;
    }
    if (sub === "enable") {
      if (!rest) {
        process.stdout.write(source_default.yellow(`
请输入要启用的账号邮箱。例如: /accounts enable GSC.VFU2@cma-cgm.com

`));
        return;
      }
      const email = rest.trim();
      this.pool.enableAccount(email);
      const updated = this.pool.getAllowedAccounts();
      this.saveWorkspaceConfig({ allowedAccounts: updated });
      process.stdout.write(source_default.green(`
✔ 已启用账号: ${email}
  配置已同步至 .cph/config.json

`));
      return;
    }
    if (sub === "disable") {
      if (!rest) {
        process.stdout.write(source_default.yellow(`
请输入要跳过的账号邮箱。例如: /accounts disable GSC.MLU@cma-cgm.com

`));
        return;
      }
      const email = rest.trim();
      this.pool.disableAccount(email);
      const updated = this.pool.getAllowedAccounts();
      this.saveWorkspaceConfig({ allowedAccounts: updated });
      process.stdout.write(source_default.yellow(`
○ 已跳过账号: ${email}
  配置已同步至 .cph/config.json

`));
      return;
    }
    process.stdout.write(source_default.red(`
未知子命令: "${sub}"。可用子命令: /accounts [login|set|enable|disable|reset]

`));
  }
  async executeTask(task, overrideSkills) {
    const rootTaskPrompt = task;
    const abortController = this.interruptController.beginBusy();
    const skillsToUse = overrideSkills || this.skillRegistry.getActiveSkills();
    let currentSession = this.initSession();
    const rootTitle = currentSession.title && currentSession.title !== "新会话" ? currentSession.title : task.slice(0, 40).replace(/\n/g, " ");
    if (currentSession.turns.length === 0 && (!currentSession.title || currentSession.title === "新会话")) {
      currentSession.title = rootTitle;
    }
    let currentTaskPrompt = task;
    let currentInitialAnnotations = undefined;
    if (this.pendingHandoffSnapshot) {
      currentTaskPrompt = `【前序会话脱困成果快照】
${this.pendingHandoffSnapshot}

【接力执行需求】
${task}`;
      this.pendingHandoffSnapshot = undefined;
    }
    let hopCount = 0;
    const activeSubagents = new Map;
    const subagentStartTimes = new Map;
    try {
      while (true) {
        if (abortController.signal.aborted) {
          break;
        }
        const result = await this.orchestrator.run({
          task: currentTaskPrompt,
          sessionId: currentSession.id,
          signal: abortController.signal,
          activeSkills: skillsToUse,
          initialAnnotations: currentInitialAnnotations,
          rootUserPrompt: rootTaskPrompt,
          events: {
            onDelta: (d) => this.renderer.renderTextChunk(d),
            onReasoning: (r) => this.renderer.renderReasoningChunk(r),
            onTurnStart: (turn) => {
              if (this.pool?.getSessionLease) {
                const leased = this.pool.getSessionLease(currentSession.id);
                if (leased)
                  currentSession.currentAccount = leased;
              }
              this.renderer.renderTurnHeader(turn);
            },
            onToolStart: (action) => this.renderer.renderToolBadge(action),
            onToolEnd: (result) => this.renderer.renderToolResult(result),
            onSubagentStart: (id, role, spec, initialHop, account) => {
              subagentStartTimes.set(id, Date.now());
              const hop = initialHop || 1;
              activeSubagents.set(id, {
                id,
                role: role === "coder" ? "coder" : "researcher",
                account,
                description: spec?.description || spec?.prompt?.slice(0, 40) || id,
                status: "running",
                currentTurn: 1,
                durationMs: 0,
                lastAction: "正在启动会话与加载技能...",
                hopCount: hop,
                handoffCount: Math.max(0, hop - 1)
              });
              this.renderer.renderSubagentMatrix(Array.from(activeSubagents.values()));
            },
            onSubagentProgress: (id, turn, _delta, action, hopCount, account) => {
              const state = activeSubagents.get(id);
              if (!state)
                return;
              const startTime = subagentStartTimes.get(id) || Date.now();
              state.durationMs = Date.now() - startTime;
              let changed = false;
              if (account && account !== state.account) {
                state.account = account;
                changed = true;
              }
              if (hopCount && hopCount !== state.hopCount) {
                state.hopCount = hopCount;
                state.handoffCount = Math.max(0, hopCount - 1);
                changed = true;
              }
              if (turn > 0 && turn !== state.currentTurn) {
                state.currentTurn = turn;
                state.lastAction = `第 ${turn} 轮推理思考中...`;
                changed = true;
              }
              if (action) {
                const actName = action.tool || action.action || "tool";
                const target = action.path || action.filePath || action.command || "";
                state.lastAction = `${actName} ${target}`.trim();
                changed = true;
              }
              if (changed) {
                this.renderer.renderSubagentMatrix(Array.from(activeSubagents.values()));
              }
            },
            onSubagentEnd: (report) => {
              const state = activeSubagents.get(report.id);
              if (state) {
                state.status = report.success ? "completed" : "failed";
                state.durationMs = report.durationMs || Date.now() - (subagentStartTimes.get(report.id) || Date.now());
                state.currentTurn = report.turnsCount || state.currentTurn;
                if (report.account)
                  state.account = report.account;
                if (report.hopCount)
                  state.hopCount = report.hopCount;
                if (report.handoffCount !== undefined)
                  state.handoffCount = report.handoffCount;
                state.lastAction = report.success ? "成果交付并完成自验证" : `异常中断: ${report.error || "执行未完成"}`;
              }
              this.renderer.renderSubagentMatrix(Array.from(activeSubagents.values()));
            },
            onRefusalIntercepted: (refusal, attempt) => this.renderer.renderRefusalWarning(refusal, attempt),
            onCompacted: (cleared, ratio) => {
              this.lastCompactionRatio = ratio;
              this.renderer.renderCompactedNotice(cleared, ratio);
            },
            onAccountSwitched: (oldEmail, newEmail) => {
              currentSession.currentAccount = newEmail;
              this.renderer.renderAccountSwitchedNotice(oldEmail, newEmail);
            },
            onCompleted: (ans) => this.renderer.renderFinalAnswer(ans),
            onError: (err) => this.renderer.renderError(err),
            onDisasterOccurred: (blackbox, err) => this.renderer.renderDisasterBlackboxBanner(currentSession.id, err),
            onArbitratorHandoffStart: (arbId, email) => this.renderer.renderArbitratorHandoffBanner(arbId, email),
            onArbitratorHandoffComplete: (_docPath, _arbId) => {},
            onAttachmentUploaded: (attachment, toolName) => this.renderer.renderAttachmentUploadedNotice(attachment.fileName, toolName),
            onMainSessionVirtualized: (snapshot, path) => this.renderer.renderMainVirtualizationBanner(snapshot?.originalSessionId || currentSession.id, path),
            onSuccessorAwakened: (newSessionId, generation) => {
              currentSession.generation = generation;
              currentSession.handoffCount = Math.max(0, generation - 1);
              this.renderer.renderSuccessorAwakeningBanner(newSessionId, generation);
            }
          }
        });
        if (this.pool?.getSessionLease) {
          const leased = this.pool.getSessionLease(currentSession.id);
          if (leased)
            currentSession.currentAccount = leased;
        }
        currentInitialAnnotations = undefined;
        const startTurnNum = currentSession.turns.length;
        if (result.history && result.history.length > 0) {
          for (let i = 0;i < result.history.length; i++) {
            const h = result.history[i];
            currentSession.turns.push({
              turnNumber: startTurnNum + i + 1,
              timestamp: new Date().toISOString(),
              userInput: h.userInput || "",
              modelReasoning: h.thought,
              modelResponse: h.response || "",
              toolCalls: h.toolName ? [
                {
                  tool: h.toolName,
                  args: h.action,
                  output: h.toolOutput,
                  success: h.success
                }
              ] : undefined
            });
          }
        } else {
          currentSession.turns.push({
            turnNumber: startTurnNum + 1,
            timestamp: new Date().toISOString(),
            userInput: currentTaskPrompt,
            modelResponse: result.finalAnswer || ""
          });
        }
        currentSession.turnCount = currentSession.turns.length;
        if (this.orchestrator) {
          currentSession.generation = this.orchestrator.getGeneration?.() || currentSession.generation || 1;
          currentSession.handoffCount = this.orchestrator.getHandoffCount?.() || currentSession.handoffCount || 0;
        }
        if (result.completed) {
          currentSession.status = "completed";
          this.sessionManager.saveSession(currentSession);
          break;
        }
        if (result.handedOff) {
          currentSession.status = "handed_off";
          if (result.handoffSnapshot) {
            currentSession.handoffSnapshot = result.handoffSnapshot;
          }
          if (result.handoffDocPath) {
            currentSession.handoffDocPath = result.handoffDocPath;
          }
          if (result.disasterBlackbox) {
            currentSession.disasterBlackbox = result.disasterBlackbox;
          }
          this.sessionManager.saveSession(currentSession);
          if (!result.disasterRecovered) {
            process.stdout.write(source_default.yellow(`
\uD83D\uDD04 [Auto-Handoff] 当前会话已达单次推理上限，已自动提取成果快照并归档会话。

`));
            if (result.handoffSnapshot) {
              process.stdout.write(source_default.cyan(`【阶段性成果快照摘要】
`) + source_default.gray(result.handoffSnapshot) + `

`);
            }
          }
          if (abortController.signal.aborted) {
            break;
          }
          if (hopCount < this.maxAutonomousHandoffHops) {
            hopCount++;
            const nextStage = hopCount + 1;
            const newSession = this.sessionManager.createSession({
              title: `${rootTitle} (接力 ${hopCount})`,
              workspaceRoot: this.workspaceRoot,
              maxTurns: this.maxTurns,
              modelTone: this.modelTone,
              currentAccount: currentSession.currentAccount,
              handoffSnapshot: result.handoffSnapshot,
              handoffDocPath: result.handoffDocPath,
              disasterBlackbox: result.disasterBlackbox
            });
            this.currentSession = newSession;
            currentSession = newSession;
            this.orchestrator.resetHandshake();
            this.lastCompactionRatio = undefined;
            let handoffAnnotation = undefined;
            if (result.handoffSnapshot && this.graphTokenProvider) {
              try {
                const graphToken = await this.graphTokenProvider();
                if (graphToken) {
                  const uploadRes = await SubstrateUploader.uploadDocumentToOneDrive(graphToken, `handoff-${currentSession.id}.md`, result.handoffSnapshot, "markdown");
                  if (uploadRes?.annotation) {
                    handoffAnnotation = uploadRes.annotation;
                    currentInitialAnnotations = [handoffAnnotation];
                  }
                }
              } catch {}
            }
            if (result.disasterRecovered) {
              this.renderer.renderDisasterSuccessorBanner(newSession.id, hopCount, this.maxAutonomousHandoffHops, result.handoffDocPath);
            } else {
              this.renderer.renderAutonomousHandoffBanner(newSession.id, hopCount, this.maxAutonomousHandoffHops, result.handoffDocPath);
            }
            currentTaskPrompt = [
              `【自主${result.disasterRecovered ? "容灾" : ""}接力延续任务 - 阶段 ${nextStage}】`,
              `终极目标: ${rootTaskPrompt}`,
              `交接资产: 详细交接文档已通过附件无损挂载送达 (本地路径: ${result.handoffDocPath || "未落盘"})`,
              `物理账本: .cph/state/execution-ledger.md`,
              `【接力行动准则】`,
              `请基于${handoffAnnotation ? "附件中的交接文档" : "本地交接文档"}与物理清单，优先推进未完成的核心业务切片，严禁仅做基线核验即提前退出。`
            ].join(`
`);
            continue;
          } else {
            if (this.isInteractiveMode()) {
              const newSession = this.sessionManager.createSession({
                title: `${rootTitle} (接力)`,
                workspaceRoot: this.workspaceRoot,
                maxTurns: this.maxTurns,
                modelTone: this.modelTone,
                handoffSnapshot: result.handoffSnapshot,
                handoffDocPath: result.handoffDocPath,
                disasterBlackbox: result.disasterBlackbox
              });
              if (result.handoffSnapshot) {
                newSession.turns.push({
                  turnNumber: 1,
                  timestamp: new Date().toISOString(),
                  userInput: `[前序会话脱困成果快照]
${result.handoffSnapshot}`,
                  modelResponse: "已加载阶段性成果快照，随时接力推进剩余任务。"
                });
                newSession.turnCount = newSession.turns.length;
                this.sessionManager.saveSession(newSession);
              }
              this.currentSession = newSession;
              this.pendingHandoffSnapshot = result.handoffSnapshot;
              this.orchestrator.resetHandshake();
              this.lastCompactionRatio = undefined;
              process.stdout.write(source_default.green(`✔ 已自动开启接力新会话: ${newSession.id}，阶段性快照已注入背景。

`));
            }
            process.stdout.write(source_default.yellow(`
⚠️  [${result.disasterRecovered ? "Disaster-Recovery" : "Auto-Handoff"}] 已达到连续自主接力跃迁上限 (${this.maxAutonomousHandoffHops} 次接力)。
` + `   任务已安全挂起并保留当前全部进度。
` + (result.handoffDocPath ? `   交接文档已落盘至: ${result.handoffDocPath}
` : "") + `   如需继续推进，输入 /continue 或 /resume ${this.currentSession?.id || currentSession.id} 即可自动续跑，或直接输入新指令。

`));
            this.pendingHandoffSnapshot = result.handoffSnapshot;
            break;
          }
        }
        this.sessionManager.saveSession(currentSession);
        break;
      }
    } catch (err) {
      if (err?.name === "AbortError" || abortController.signal.aborted) {
        this.renderer.renderAbortedNotice();
      } else {
        this.renderer.renderError(err);
      }
    } finally {
      this.interruptController.endBusy();
    }
  }
  promptUser(customPrompt) {
    if (this.rl) {
      if (!this.isMultilineMode) {
        this.renderCurrentStatusBar();
      }
      this.rl.setPrompt(customPrompt ?? source_default.cyan("cph-pi> "));
      this.rl.prompt();
    }
  }
}
var CPH_PI_VERSION = "0.1.0";
async function runCliPkceAuthFlow(pool, targetEmail, customRl) {
  const session = pool.startPkceAuth(targetEmail);
  process.stdout.write(`
` + source_default.bold.cyan("==================================================") + `
`);
  process.stdout.write(source_default.bold.cyan("           Microsoft 365 账号授权与换票           ") + `
`);
  process.stdout.write(source_default.bold.cyan("==================================================") + `

`);
  if (targetEmail) {
    process.stdout.write(source_default.yellow(`目标授权账号: ${source_default.bold(targetEmail)}

`));
  }
  process.stdout.write(source_default.bold(`请复制以下链接在系统浏览器中打开并完成登录:
`));
  process.stdout.write(source_default.underline.blue(session.authUrl) + `

`);
  process.stdout.write(source_default.dim(`登录完成后浏览器将跳转至空白页 (或显示无法访问)。
`));
  process.stdout.write(source_default.dim(`请从浏览器地址栏复制完整重定向 URL，或直接粘贴返回的 code 参数。

`));
  const shouldCloseRl = !customRl;
  const rl = customRl || readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const input = await new Promise((resolve) => {
    rl.question(source_default.yellow("请输入重定向 URL 或 Code: "), (answer) => {
      resolve((answer || "").trim());
    });
  });
  if (shouldCloseRl) {
    rl.close();
  }
  if (!input) {
    process.stdout.write(source_default.red(`
✖ 输入为空，授权流程已取消。

`));
    return false;
  }
  try {
    const result = await pool.completePkceAuth(input, session.state, targetEmail);
    if (!result.success) {
      process.stdout.write(source_default.red(`
✖ 凭据刷新失败: ${result.error || "授权验证未通过"}

`));
      return false;
    }
    if (result.emailMismatch) {
      process.stdout.write(source_default.yellow(`
⚠️  检测到实际登录账号为 ${source_default.bold(result.email)}，原目标账号 ${source_default.bold(targetEmail)} 仍处于待重登状态。
`) + source_default.green(`✔ 账号 ${source_default.bold(result.email)} 已安全保存至 accounts.json 并就绪可用。

`));
    } else {
      process.stdout.write(source_default.green(`
✔ 凭据刷新成功! 账号 ${source_default.bold(result.email)} 已安全保存至 accounts.json 并就绪可用。

`));
    }
    return true;
  } catch (err) {
    process.stdout.write(source_default.red(`
✖ 授权流程发生异常: ${err.message || String(err)}

`));
    return false;
  }
}
async function runCli(args = process.argv.slice(2), customOptions = {}, isDirectRun = false) {
  const parsed = parseCliArgs(args);
  if (parsed.help) {
    const helpText = printHelp();
    if (isDirectRun)
      process.exit(0);
    return { exitCode: 0, mode: "help", output: helpText };
  }
  if (parsed.version) {
    const versionText = `CPH-PI v${CPH_PI_VERSION} (Copilot-Pi Hybrid Autonomous Coding Agent)`;
    process.stdout.write(versionText + `
`);
    if (isDirectRun)
      process.exit(0);
    return { exitCode: 0, mode: "version", output: versionText };
  }
  const options = {
    ...customOptions,
    workspaceRoot: parsed.workspaceRoot || customOptions.workspaceRoot,
    modelTone: parsed.hasExplicitModel ? parsed.modelTone : customOptions.modelTone,
    maxTurns: parsed.maxTurns ?? customOptions.maxTurns,
    timeoutSec: parsed.timeoutSec ?? customOptions.timeoutSec,
    maxAutonomousHandoffHops: parsed.maxAutonomousHandoffHops ?? customOptions.maxAutonomousHandoffHops,
    continueLast: parsed.continueLast ?? customOptions.continueLast,
    resumeSessionId: parsed.resumeSessionId || customOptions.resumeSessionId,
    customAgentId: customOptions.customAgentId !== undefined ? customOptions.customAgentId : customOptions.chatClient && !parsed.hasExplicitAgent ? undefined : parsed.customAgentId,
    coderAgentId: parsed.coderAgentId || customOptions.coderAgentId,
    researcherAgentId: parsed.researcherAgentId || customOptions.researcherAgentId,
    allowedAccounts: parsed.allowedAccounts || customOptions.allowedAccounts,
    debug: parsed.debug ?? customOptions.debug,
    debugLogPath: parsed.debugLogPath || customOptions.debugLogPath,
    cloudAttachmentThresholdChars: customOptions.cloudAttachmentThresholdChars,
    cloudAttachmentThresholdLines: customOptions.cloudAttachmentThresholdLines,
    graphTokenProvider: customOptions.graphTokenProvider,
    enableWorkspaceCatalog: customOptions.enableWorkspaceCatalog
  };
  const cli = new CphPiCli(options);
  if (parsed.subcommand === "web") {
    if (!parsed.workspace && !customOptions.workspaceRoot) {
      try {
        const globalConfigPath = path24.join(os.homedir(), ".cph", "global-config.json");
        if (fs19.existsSync(globalConfigPath)) {
          const raw = JSON.parse(fs19.readFileSync(globalConfigPath, "utf-8"));
          if (raw.lastWorkspace && typeof raw.lastWorkspace === "string" && fs19.existsSync(raw.lastWorkspace)) {
            cli.setWorkspaceRoot(raw.lastWorkspace);
          }
        }
      } catch {}
    }
    const port = parsed.port ?? customOptions.port ?? 3000;
    const host = parsed.host ?? customOptions.host ?? "127.0.0.1";
    const autoOpen = customOptions.autoOpen !== undefined ? customOptions.autoOpen : parsed.noOpen ? false : true;
    const distDir = resolveWebDistDir(customOptions.distDir);
    const webDistIndex = path24.resolve(distDir, "index.html");
    if (!fs19.existsSync(webDistIndex)) {
      console.warn(source_default.yellow(`⚠️  警告: 未找到前端构建产物 (web/dist/index.html)。请先运行: npm run web:build
`));
    }
    const serverInstance = await startWebServer({
      port,
      host,
      autoOpen,
      distDir,
      workspaceRoot: cli.getWorkspaceRoot(),
      orchestrator: cli.getOrchestrator(),
      sessionManager: cli.getSessionManager(),
      pool: cli.getPool(),
      cliApp: cli,
      skillRegistry: cli.getSkillRegistry(),
      debug: cli.isDebugModeEnabled(),
      debugLogPath: cli.getDebugLogPath(),
      maxAutonomousHandoffHops: cli.getMaxAutonomousHandoffHops(),
      graphTokenProvider: cli.getGraphTokenProvider()
    });
    const actualPort = serverInstance.port ?? port;
    process.stdout.write(source_default.bold.cyan(`
\uD83D\uDE80 CPH-PI Web 界面服务已就绪: http://${host}:${actualPort}
`));
    if (cli.isDebugModeEnabled()) {
      const logPath = cli.getDebugLogPath() || TerminalLogger.getInstance().getLogFilePath() || ".cph/logs/";
      process.stdout.write(source_default.green(`\uD83D\uDC1E Debug 模式已开启，终端实时输出落盘至: ${source_default.bold(logPath)}
`));
    }
    if (isDirectRun) {
      await new Promise((resolve) => {
        const shutdown = async () => {
          process.stdout.write(source_default.gray(`
正在关闭 Web 服务...
`));
          await stopWebServer(serverInstance);
          resolve();
          process.exit(0);
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
      });
    }
    return { exitCode: 0, mode: "web", serverInstance };
  }
  if (parsed.subcommand === "auth") {
    if (parsed.authAction === "login" || !parsed.authAction) {
      const pool = cli.getPool();
      const success = await runCliPkceAuthFlow(pool, parsed.authTargetEmail, customOptions.rl);
      cli.close();
      if (isDirectRun)
        process.exit(success ? 0 : 1);
      return { exitCode: success ? 0 : 1, mode: "auth" };
    } else {
      process.stdout.write(source_default.yellow(`
未知 auth 动作: "${parsed.authAction}"。可用命令: cph-pi auth login [email]

`));
      cli.close();
      if (isDirectRun)
        process.exit(1);
      return { exitCode: 1, mode: "auth" };
    }
  }
  if (parsed.task) {
    try {
      if (parsed.task.startsWith("/")) {
        const parsedSlash = cli.getSkillRegistry().parseSlashCommand(parsed.task);
        if (parsedSlash.skill) {
          cli.getSkillRegistry().activateSkill(parsedSlash.skill.name);
          cli.getRenderer().renderSkillActivated(parsedSlash.skill.name);
          await cli.executeTask(parsedSlash.task || parsed.task, [parsedSlash.skill]);
        } else {
          await cli.executeTask(parsed.task);
        }
      } else {
        await cli.executeTask(parsed.task);
      }
      cli.close();
      if (isDirectRun)
        process.exit(0);
      return { exitCode: 0, mode: "task" };
    } catch (err) {
      cli.close();
      if (isDirectRun)
        process.exit(1);
      return { exitCode: 1, mode: "task" };
    }
  }
  await cli.start();
  return { exitCode: 0, mode: "interactive" };
}
if (__require.main == __require.module) {
  runCli(process.argv.slice(2), {}, true).catch((err) => {
    console.error(source_default.red("Fatal CLI error:"), err);
    process.exit(1);
  });
}
export {
  BUILTIN_SLASH_COMMANDS,
  CPH_PI_VERSION,
  CphPiCli as CliApp,
  CphPiCli,
  DEFAULT_CODER_AGENT_ID,
  DEFAULT_MAIN_AGENT_ID,
  DEFAULT_RESEARCHER_AGENT_ID,
  dispatchSlashCommand,
  getHelpText,
  isBuiltinSlashCommand,
  parseArgs,
  parseCliArgs,
  printHelp,
  renderHelpBanner,
  resolveWebDistDir,
  runCli,
  runCliPkceAuthFlow,
  startWebServer,
  stopWebServer
};
