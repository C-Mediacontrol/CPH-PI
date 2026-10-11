import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// scripts/probe-agent-access.ts
import fs2 from "node:fs";
import path2 from "node:path";

// pi/node_modules/chalk/source/utilities.js
function stringReplaceAll(string, substring, postfix) {
  let index = string.indexOf(substring);
  if (index === -1) {
    return string;
  }
  const substringLength = substring.length;
  let endIndex = 0;
  let returnValue = "";
  do {
    returnValue += string.slice(endIndex, index) + substring + postfix;
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
    const isGotCR = string[index - 1] === "\r";
    returnValue += string.slice(endIndex, isGotCR ? index - 1 : index) + prefix + (isGotCR ? `\r
` : `
`) + postfix;
    endIndex = index + 1;
    index = string.indexOf(`
`, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}

// pi/node_modules/chalk/source/vendor/ansi-styles/index.js
var ANSI_BACKGROUND_OFFSET = 10;
var ANSI_UNDERLINE_OFFSET = 20;
var wrapAnsi16 = (offset = 0) => (code) => `\x1B[${code + offset}m`;
var wrapAnsi256 = (offset = 0) => (code) => `\x1B[${38 + offset};5;${code}m`;
var wrapAnsi16m = (offset = 0) => (red, green, blue) => `\x1B[${38 + offset};2;${red};${green};${blue}m`;
var wrapUnderlineAnsi = (code) => `\x1B[58;5;${code < 90 ? code - 30 : code - 90 + 8}m`;
var styles = {
  modifier: {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    underlineDouble: ["4:2", 24],
    underlineCurly: ["4:3", 24],
    underlineDotted: ["4:4", 24],
    underlineDashed: ["4:5", 24],
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
  },
  underlineColor: {
    underlineBlack: ["58;5;0", 59],
    underlineRed: ["58;5;1", 59],
    underlineGreen: ["58;5;2", 59],
    underlineYellow: ["58;5;3", 59],
    underlineBlue: ["58;5;4", 59],
    underlineMagenta: ["58;5;5", 59],
    underlineCyan: ["58;5;6", 59],
    underlineWhite: ["58;5;7", 59],
    underlineBlackBright: ["58;5;8", 59],
    underlineGray: ["58;5;8", 59],
    underlineGrey: ["58;5;8", 59],
    underlineRedBright: ["58;5;9", 59],
    underlineGreenBright: ["58;5;10", 59],
    underlineYellowBright: ["58;5;11", 59],
    underlineBlueBright: ["58;5;12", 59],
    underlineMagentaBright: ["58;5;13", 59],
    underlineCyanBright: ["58;5;14", 59],
    underlineWhiteBright: ["58;5;15", 59]
  }
};
var modifierNames = Object.keys(styles.modifier);
var foregroundColorNames = Object.keys(styles.color);
var backgroundColorNames = Object.keys(styles.bgColor);
var underlineColorNames = Object.keys(styles.underlineColor);
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
      codes.set(Number.parseInt(style[0], 10), style[1]);
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
  styles.underlineColor.close = "\x1B[59m";
  styles.color.ansi = wrapAnsi16();
  styles.color.ansi256 = wrapAnsi256();
  styles.color.ansi16m = wrapAnsi16m();
  styles.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);
  styles.underlineColor.ansi = wrapUnderlineAnsi;
  styles.underlineColor.ansi256 = wrapAnsi256(ANSI_UNDERLINE_OFFSET);
  styles.underlineColor.ansi16m = wrapAnsi16m(ANSI_UNDERLINE_OFFSET);
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
        const matches = /[\da-f]{6}|[\da-f]{3}/i.exec(hex.toString(16));
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

// pi/node_modules/chalk/source/vendor/supports-color/index.js
import process2 from "node:process";
import os from "node:os";
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
function hasNumericForceColor() {
  return /^\d+$/.test(env.FORCE_COLOR);
}
function envForceColor() {
  if (!("FORCE_COLOR" in env)) {
    return;
  }
  if (env.FORCE_COLOR === "false") {
    return 0;
  }
  if (env.FORCE_COLOR === "true" || env.FORCE_COLOR.length === 0) {
    return 1;
  }
  if (!hasNumericForceColor()) {
    return;
  }
  return Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
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
  if (forceColor !== undefined && hasNumericForceColor()) {
    return forceColor;
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
    const osRelease = os.release().split(".");
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
    return /^(?:9\.0*[1-9]\d*\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
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
    const version = Number.parseInt((env.TERM_PROGRAM_VERSION || "").split(".", 1)[0], 10);
    switch (env.TERM_PROGRAM) {
      case "iTerm.app": {
        return version >= 3 ? 3 : 2;
      }
      case "Apple_Terminal": {
        return 2;
      }
    }
  }
  if (/-256(?:color)?$/i.test(env.TERM)) {
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

// pi/node_modules/chalk/source/index.js
var { stdout: stdoutColor, stderr: stderrColor } = supports_color_default;
var GENERATOR = Symbol("GENERATOR");
var STYLER = Symbol("STYLER");
var IS_EMPTY = Symbol("IS_EMPTY");
var LEVEL = Symbol("LEVEL");
var styles2 = Object.create(null);
var assertValidLevel = (level) => {
  if (!Number.isSafeInteger(level) || level < 0 || level > 3) {
    throw new Error("The `level` should be an integer from 0 to 3");
  }
};
var levelDescriptor = {
  enumerable: true,
  get() {
    return this[LEVEL];
  },
  set(level) {
    assertValidLevel(level);
    this[LEVEL] = level;
  }
};
var applyOptions = (object, options = {}) => {
  if (options.level !== undefined) {
    assertValidLevel(options.level);
  }
  const colorLevel = stdoutColor ? stdoutColor.level : 0;
  object[LEVEL] = options.level === undefined ? colorLevel : options.level;
};
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
var createModelConverters = (model, type) => {
  const style = ansi_styles_default[type];
  if (model === "rgb") {
    const ansi = (red, green, blue) => style.ansi(ansi_styles_default.rgbToAnsi(red, green, blue));
    const ansi256 = (red, green, blue) => style.ansi256(ansi_styles_default.rgbToAnsi256(red, green, blue));
    return [ansi, ansi, ansi256, style.ansi16m];
  }
  if (model === "hex") {
    const ansi = (hex) => style.ansi(ansi_styles_default.hexToAnsi(hex));
    const ansi256 = (hex) => style.ansi256(ansi_styles_default.hexToAnsi256(hex));
    return [ansi, ansi, ansi256, (hex) => style.ansi16m(...ansi_styles_default.hexToRgb(hex))];
  }
  const ansi = (code) => style.ansi(ansi_styles_default.ansi256ToAnsi(code));
  return [ansi, ansi, style.ansi256, style.ansi256];
};
var usedModels = ["rgb", "hex", "ansi256"];
for (const model of usedModels) {
  const capitalizedModel = model[0].toUpperCase() + model.slice(1);
  for (const [styleName, type] of [
    [model, "color"],
    ["bg" + capitalizedModel, "bgColor"],
    ["underline" + capitalizedModel, "underlineColor"]
  ]) {
    const { close } = ansi_styles_default[type];
    const converters = createModelConverters(model, type);
    styles2[styleName] = {
      get() {
        const styleFunction = function(first, second, third) {
          const open = converters[this.level](first, second, third);
          return createBuilder(this, createStyler(open, close, this[STYLER]), this[IS_EMPTY]);
        };
        Object.defineProperty(this, styleName, { value: styleFunction });
        return styleFunction;
      }
    };
  }
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
  const builder = (...arguments_) => {
    if (arguments_.length === 1) {
      return applyStyle(builder, "" + arguments_[0]);
    }
    if (arguments_.length === 2) {
      return applyStyle(builder, arguments_[0] + " " + arguments_[1]);
    }
    return applyStyle(builder, arguments_.join(" "));
  };
  Object.setPrototypeOf(builder, proto);
  builder[GENERATOR] = self[GENERATOR] ?? self;
  builder[STYLER] = _styler;
  builder[IS_EMPTY] = _isEmpty;
  return builder;
};
var applyStyle = (self, string) => {
  if (self[GENERATOR][LEVEL] <= 0 || !string) {
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
Object.defineProperties(createChalk.prototype, { ...styles2, level: levelDescriptor });
var chalk = createChalk();
var chalkStderr = createChalk({ level: stderrColor ? stderrColor.level : 0 });
var source_default = chalk;

// src/auth/token-manager.ts
import fs from "fs";
import path from "path";
import os2 from "os";

// src/auth/crypto.ts
import crypto2 from "crypto";
var DEFAULT_PEPPER = "m365-copilot2api-fallback-pepper-v1-TODO-DPAPI-keyring";
var PEPPER_KEY = Buffer.from("m365-copilot2api-pepper-v1");
var ENC_PREFIX = "enc:v1:";
function deriveMasterKey(customMaster) {
  const rawMaster = customMaster || process.env.M365_MASTER_KEY || DEFAULT_PEPPER;
  return crypto2.createHmac("sha256", PEPPER_KEY).update(rawMaster).digest();
}
function encryptToken(plain, customMaster) {
  if (!plain)
    return "";
  if (plain.startsWith(ENC_PREFIX))
    return plain;
  const key = deriveMasterKey(customMaster);
  const nonce = crypto2.randomBytes(12);
  const cipher = crypto2.createCipheriv("aes-256-gcm", key, nonce);
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
  const decipher = crypto2.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// src/auth/token-manager.ts
var DEFAULT_CLIENT_ID = "c0ab8ce9-e9a0-42e7-b064-33d422df41f1";
var DEFAULT_SCOPE = "openid profile offline_access https://substrate.office.com/sydney/.default";
var GRAPH_SCOPE = "openid profile offline_access https://graph.microsoft.com/.default";
var DEFAULT_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

class TokenManager {
  static GRAPH_SCOPE = GRAPH_SCOPE;
  configPath;
  activeTokens = new Map;
  graphTokens = new Map;
  tokenEndpoint;
  fetchFn;
  constructor(customPath, options) {
    if (customPath) {
      this.configPath = customPath;
    } else {
      const home = os2.homedir();
      this.configPath = path.join(home, ".config", "m365-copilot2api", "accounts.json");
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
    if (!fs.existsSync(this.configPath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : parsed.accounts || [];
    } catch (err) {
      console.error(`[TokenManager] Failed to read ${this.configPath}:`, err);
      return [];
    }
  }
  saveAccounts(accounts) {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const sanitized = accounts.map((acc) => ({
      ...acc,
      refreshToken: acc.refreshToken.startsWith("enc:v1:") ? acc.refreshToken : encryptToken(acc.refreshToken)
    }));
    fs.writeFileSync(this.configPath, JSON.stringify({ accounts: sanitized }, null, 2), "utf8");
  }
  setCachedToken(email, token) {
    this.activeTokens.set(email.toLowerCase(), token);
  }
  clearCache(email) {
    if (email) {
      this.activeTokens.delete(email.toLowerCase());
    } else {
      this.activeTokens.clear();
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
}

// src/transport/chathub-client.ts
import crypto3 from "crypto";

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
  async sendMessage(payload, events) {
    const signal = payload.signal;
    if (signal?.aborted) {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    const wsUrl = this.buildWsUrl(payload.conversationId, payload.sessionId, payload.requestId);
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
              const chatArguments = {
                source: "officeweb",
                clientCorrelationId: crypto3.randomUUID(),
                sessionId: payload.sessionId,
                optionsSets: payload.optionsSets || [
                  "search_result_progress_messages_with_search_queries",
                  "update_textdoc_response_after_streaming",
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
                conversationId: payload.conversationId,
                traceId: crypto3.randomUUID(),
                isStartOfSession: payload.isStartOfSession ?? false,
                productThreadType: "Office",
                clientInfo: { clientPlatform: "mcmcopilot-web", clientAppName: "Office" },
                tone: payload.tone || this.options.modelTone || "Gpt_61_Sol_Reasoning",
                streamingMode: "ConciseWithPadding",
                message: {
                  author: "user",
                  inputMethod: "Keyboard",
                  text: payload.text,
                  requestId: payload.requestId,
                  locationInfo: { timeZoneOffset: 8, timeZone: this.options.timeZone || "Asia/Shanghai" },
                  locale: this.options.locale || "zh-CN",
                  messageType: "Chat",
                  experienceType: "Default"
                },
                plugins: [{ Id: "BingWebSearch", Source: "BuiltIn" }]
              };
              if (this.options.customAgentId) {
                chatArguments.threadLevelGptId = {
                  id: this.options.customAgentId,
                  source: "MOS3"
                };
                chatArguments.gpts = [
                  {
                    id: this.options.customAgentId,
                    source: "MOS3",
                    version: "1.0.0"
                  }
                ];
              }
              if (payload.annotations && payload.annotations.length > 0) {
                chatArguments.message.entityAnnotationTypes = [
                  "People",
                  "File",
                  "Event",
                  "Email",
                  "TeamsMessage"
                ];
                chatArguments.message.messageAnnotations = payload.annotations;
              }
              const chatFrame = {
                arguments: [chatArguments],
                invocationId: "0",
                target: "chat",
                type: 4
              };
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
                  } else if ((m.author === "bot" || m.messageType === "Disengaged" || m.messageType === "OffTopic") && m.text) {
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
                conversationId: payload.conversationId,
                sessionId: payload.sessionId,
                requestId: payload.requestId,
                rawMessages,
                rawFrames
              });
              return;
            }
            if (msg.type === 3) {
              settleResolve({
                text: fullText,
                reasoning: reasoningText,
                conversationId: payload.conversationId,
                sessionId: payload.sessionId,
                requestId: payload.requestId,
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
          if (ev.code === 1008 || ev.code === 1006) {
            events?.onRateLimitDetected?.(this.token.email);
          }
          settleReject(new Error(`WebSocket closed prematurely (${ev.code}): ${ev.reason || "unknown reason"}`));
        } else if (!isSettled) {
          settleResolve({
            text: fullText,
            reasoning: reasoningText,
            conversationId: payload.conversationId,
            sessionId: payload.sessionId,
            requestId: payload.requestId,
            rawMessages,
            rawFrames
          });
        }
      };
    });
  }
}

// scripts/probe-agent-access.ts
var DEFAULT_DEV_AGENT_ID = "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3";
async function probeAccountAccess(account, agentId, options) {
  const start = Date.now();
  const email = account.email;
  try {
    if (options.sendProbeMessage) {
      const res = await options.sendProbeMessage(email, agentId);
      return {
        email,
        status: "PASS",
        isEligible: true,
        durationMs: Date.now() - start,
        responseSnippet: (res.text || "").slice(0, 60).replace(/\n/g, " ")
      };
    }
    const tokenManager = options.tokenManager || new TokenManager;
    const activeToken = typeof tokenManager.getActiveSessionToken === "function" ? await tokenManager.getActiveSessionToken(account) : await tokenManager.getAccessToken(account.email);
    const client = new ChatHubClient(activeToken, {
      customAgentId: agentId,
      modelTone: "Gpt_61_Sol_Reasoning",
      timeoutMs: options.timeoutMs ?? 25000
    });
    const conversationId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const response = await client.sendMessage({
      text: "Ping: 专属智能体权限探测，请直接回复 PONG 即可。",
      conversationId,
      sessionId,
      requestId,
      isStartOfSession: true
    });
    return {
      email,
      status: "PASS",
      isEligible: true,
      durationMs: Date.now() - start,
      responseSnippet: (response.text || "").slice(0, 60).replace(/\n/g, " ")
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err?.message || String(err);
    const errorCode = err?.errorCode || "";
    if (errorCode === "GptAccessForbidden" || msg.includes("GptAccessForbidden") || msg.includes("403")) {
      return {
        email,
        status: "FORBIDDEN",
        isEligible: false,
        durationMs,
        errorMessage: "GptAccessForbidden: 未对该账号授予此 Agent 访问权限"
      };
    }
    if (errorCode === "GptNotAvailable" || msg.includes("GptNotAvailable") || msg.includes("未提供")) {
      return {
        email,
        status: "NOT_AVAILABLE",
        isEligible: false,
        durationMs,
        errorMessage: "GptNotAvailable: 该 Agent 未发布或未对当前组织/租户开放"
      };
    }
    if (errorCode === "Throttled" || msg.includes("429") || msg.includes("Rate limit") || msg.includes("too many requests") || msg.includes("配额已达上限")) {
      return {
        email,
        status: "THROTTLED",
        isEligible: true,
        durationMs,
        errorMessage: "429 Throttled: 频控限额中 (具备访问权限)"
      };
    }
    if (msg.includes("refresh_token") || msg.includes("401") || msg.includes("auth")) {
      return {
        email,
        status: "AUTH_FAIL",
        isEligible: false,
        durationMs,
        errorMessage: `认证失效: ${msg.slice(0, 60)}`
      };
    }
    return {
      email,
      status: "ERROR",
      isEligible: false,
      durationMs,
      errorMessage: msg.slice(0, 80)
    };
  }
}
async function probeAllAccounts(options = {}) {
  const root = options.workspaceRoot || process.cwd();
  const tokenManager = options.tokenManager || new TokenManager;
  const accounts = tokenManager.loadAccounts();
  let targetAgentId = options.agentId;
  if (!targetAgentId) {
    const configPath = path2.join(root, ".cph", "config.json");
    if (fs2.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs2.readFileSync(configPath, "utf-8"));
        targetAgentId = config.customAgentId;
      } catch {}
    }
  }
  if (!targetAgentId) {
    targetAgentId = DEFAULT_DEV_AGENT_ID;
  }
  const results = [];
  for (const account of accounts) {
    const result = await probeAccountAccess(account, targetAgentId, options);
    results.push(result);
  }
  if (options.apply) {
    const eligibleEmails = results.filter((r) => r.isEligible).map((r) => r.email);
    const cphDir = path2.join(root, ".cph");
    const configPath = path2.join(cphDir, "config.json");
    fs2.mkdirSync(cphDir, { recursive: true });
    let config = {};
    if (fs2.existsSync(configPath)) {
      try {
        config = JSON.parse(fs2.readFileSync(configPath, "utf-8")) || {};
      } catch {}
    }
    config.allowedAccounts = eligibleEmails;
    config.customAgentId = targetAgentId;
    fs2.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }
  return results;
}
function formatProbeReport(results, agentId) {
  const eligible = results.filter((r) => r.isEligible);
  const forbidden = results.filter((r) => !r.isEligible);
  const lines = [
    source_default.bold.cyan(`
╔══════════════════════════════════════════════════════════════════════════════╗`),
    source_default.bold.cyan("║           CPH-PI 专属智能体 (Custom Agent) 多账号权限探测诊断报告            ║"),
    source_default.bold.cyan("╚══════════════════════════════════════════════════════════════════════════════╝"),
    `  探测目标 Agent: ${source_default.bold.green(agentId)}`,
    `  探测账号总数:   ${source_default.bold.white(String(results.length))} 个`,
    `  权限就绪账号:   ${source_default.bold.green(String(eligible.length))} 个 (可授权/建议勾选)`,
    `  拦截/跳过账号:  ${source_default.bold.red(String(forbidden.length))} 个 (未授权/需跳过)`,
    source_default.gray("──────────────────────────────────────────────────────────────────────────────"),
    source_default.bold("序号 │ 账号邮箱                    │ 状态       │ 耗时    │ 权限诊断与详情"),
    source_default.gray("─────┼─────────────────────────────┼────────────┼─────────┼────────────────────────────────────")
  ];
  results.forEach((r, idx) => {
    const num = String(idx + 1).padStart(3, " ");
    const email = r.email.padEnd(27, " ");
    let statusBadge = "";
    let detail = "";
    switch (r.status) {
      case "PASS":
        statusBadge = source_default.green("\uD83D\uDFE2 可用   ");
        detail = source_default.green("完整交互权限 (建议勾选)");
        break;
      case "THROTTLED":
        statusBadge = source_default.yellow("⏱️  限频   ");
        detail = source_default.yellow(r.errorMessage || "429 频控 (具备权限，建议勾选)");
        break;
      case "FORBIDDEN":
        statusBadge = source_default.red("\uD83D\uDD34 拦截   ");
        detail = source_default.red(r.errorMessage || "GptAccessForbidden (未授权)");
        break;
      case "NOT_AVAILABLE":
        statusBadge = source_default.magenta("⚠️  未发布 ");
        detail = source_default.magenta(r.errorMessage || "GptNotAvailable (未共享)");
        break;
      case "AUTH_FAIL":
        statusBadge = source_default.red("❌ 认证失效");
        detail = source_default.red(r.errorMessage || "Token 失效");
        break;
      default:
        statusBadge = source_default.gray("❓ 异常   ");
        detail = source_default.gray(r.errorMessage || "未知错误");
    }
    const time = `${r.durationMs}ms`.padEnd(7, " ");
    lines.push(` ${num} │ ${email} │ ${statusBadge} │ ${time} │ ${detail}`);
  });
  lines.push(source_default.gray("──────────────────────────────────────────────────────────────────────────────"));
  if (eligible.length > 0) {
    lines.push(source_default.bold.green(`✔ 推荐白名单配置:`) + ` [ ${eligible.map((e) => `"${e.email}"`).join(", ")} ]`);
  } else {
    lines.push(source_default.bold.red("✖ 警告: 未探测到任何具备该 Agent 访问权限的账号！"));
  }
  lines.push("");
  return lines.join(`
`);
}
async function runProbeCli() {
  const args = process.argv.slice(2);
  let agentId = undefined;
  let apply = false;
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a === "--agent" || a === "-a") {
      agentId = ChatHubClient.normalizeAgentId(args[++i]);
    } else if (a.startsWith("--agent=")) {
      agentId = ChatHubClient.normalizeAgentId(a.slice("--agent=".length));
    } else if (a === "--apply") {
      apply = true;
    }
  }
  process.stdout.write(source_default.cyan(`
[+] 正在启动多账号权限自动化探测，请稍候...
`));
  const results = await probeAllAccounts({
    agentId,
    apply,
    workspaceRoot: process.cwd()
  });
  const targetAgent = agentId || DEFAULT_DEV_AGENT_ID;
  const report = formatProbeReport(results, targetAgent);
  process.stdout.write(report + `
`);
  if (apply) {
    const eligible = results.filter((r) => r.isEligible);
    process.stdout.write(source_default.bold.green(`✔ 已自动应用白名单到 .cph/config.json！
  本次已勾选启用 ${eligible.length} 个账号，未勾选账号将在会话与容灾中自动跳过。

`));
  } else {
    process.stdout.write(source_default.dim(`\uD83D\uDCA1 提示: 运行 bun run scripts/probe-agent-access.ts --apply 可一键将所有可用账号写入白名单。
` + `   或者在 CPH-PI 交互终端中输入 /accounts set <账号1,账号2> 自定义指定。

`));
  }
}
if (__require.main == __require.module) {
  runProbeCli().catch((err) => {
    console.error(source_default.red("探测运行异常:"), err);
    process.exit(1);
  });
}
export {
  DEFAULT_DEV_AGENT_ID,
  formatProbeReport,
  probeAccountAccess,
  probeAllAccounts
};
