"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return $externalize(fn(this, new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))), $emptyInterface); }; };
var $unused = function(v) {};

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $substring = function(str, low, high) {
  if (low < 0 || high < low || high > str.length) {
    $throwRuntimeError("slice bounds out of range");
  }
  return str.substring(low, high);
};

var $sliceToArray = function(slice) {
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, named, pkg, exported, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, "", false, function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, pkg, exported, constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(pkgPath, fields) {
      typ.pkgPath = pkgPath;
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.anonymous) {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.named = named;
  typ.pkg = pkg;
  typ.exported = exported;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if (e.typ.named) {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.anonymous) {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           true, "", false, null);
var $Int           = $newType( 4, $kindInt,           "int",            true, "", false, null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           true, "", false, null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          true, "", false, null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          true, "", false, null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          true, "", false, null);
var $Uint          = $newType( 4, $kindUint,          "uint",           true, "", false, null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          true, "", false, null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         true, "", false, null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         true, "", false, null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         true, "", false, null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        true, "", false, null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        true, "", false, null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        true, "", false, null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      true, "", false, null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     true, "", false, null);
var $String        = $newType( 8, $kindString,        "string",         true, "", false, null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", true, "", false, null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, false, "", false, null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, false, "", false, null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, false, "", false, null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, false, "", false, null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", true, "", false, null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, false, "", false, null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, false, "", elem.exported, null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, false, "", false, null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(pkgPath, fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, false, "", false, function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(pkgPath, fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $noGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [] };
var $curGoroutine = $noGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $noGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $schedule($goroutine);
};

var $scheduled = [];
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
  } finally {
    if ($scheduled.length > 0) {
      setTimeout($runScheduled, 0);
    }
  }
};

var $schedule = function(goroutine) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }
  $scheduled.push(goroutine);
  if ($curGoroutine === $noGoroutine) {
    $runScheduled();
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if ($curGoroutine === $noGoroutine) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  var closedDuringSend;
  chan.$sendQueue.push(function(closed) {
    closedDuringSend = closed;
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (closedDuringSend) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend(false));
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(true); /* will panic */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if ($isASCII(v)) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (!f.exported) {
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var result = v.apply(passThis ? this : undefined, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if ($isASCII(v)) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

/* $isASCII reports whether string s contains only ASCII characters. */
var $isASCII = function(s) {
  for (var i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 128) {
      return false;
    }
  }
  return true;
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, ptrType, ptrType$1, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", true, "github.com/gopherjs/gopherjs/js", true, function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", true, "github.com/gopherjs/gopherjs/js", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	init = function() {
		var e;
		e = new Error.ptr(null);
		$unused(e);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init("github.com/gopherjs/gopherjs/js", [{prop: "object", name: "object", anonymous: false, exported: false, typ: ptrType, tag: ""}]);
	Error.init("", [{prop: "Object", name: "Object", anonymous: true, exported: true, typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, sys, TypeAssertionError, errorString, ptrType$4, init, NumCPU, throw$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sys = $packages["runtime/internal/sys"];
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", true, "runtime", true, function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.interfaceString = "";
			this.concreteString = "";
			this.assertedString = "";
			this.missingMethod = "";
			return;
		}
		this.interfaceString = interfaceString_;
		this.concreteString = concreteString_;
		this.assertedString = assertedString_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", true, "runtime", false, null);
	ptrType$4 = $ptrType(TypeAssertionError);
	init = function() {
		var e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = throw$1;
		e = $ifaceNil;
		e = new TypeAssertionError.ptr("", "", "", "");
		$unused(e);
	};
	NumCPU = function() {
		return 1;
	};
	$pkg.NumCPU = NumCPU;
	throw$1 = function(s) {
		var s;
		$panic(new errorString((s)));
	};
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var e;
		e = this.$val;
		return "runtime error: " + (e);
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType$4.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	TypeAssertionError.init("runtime", [{prop: "interfaceString", name: "interfaceString", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "concreteString", name: "concreteString", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "assertedString", name: "assertedString", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "missingMethod", name: "missingMethod", anonymous: false, exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/gopherjs/gopherjs/nosync"] = (function() {
	var $pkg = {}, $init, Mutex, ptrType$1;
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "nosync.Mutex", true, "github.com/gopherjs/gopherjs/nosync", true, function(locked_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.locked = false;
			return;
		}
		this.locked = locked_;
	});
	ptrType$1 = $ptrType(Mutex);
	Mutex.ptr.prototype.Lock = function() {
		var m;
		m = this;
		if (m.locked) {
			$panic(new $String("nosync: mutex is already locked"));
		}
		m.locked = true;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var m;
		m = this;
		if (!m.locked) {
			$panic(new $String("nosync: unlock of unlocked mutex"));
		}
		m.locked = false;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	ptrType$1.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	Mutex.init("github.com/gopherjs/gopherjs/nosync", [{prop: "locked", name: "locked", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, $init, js, arrayType, arrayType$1, arrayType$2, structType, math, zero, nan, buf, Exp, Log, init;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	arrayType = $arrayType($Uint32, 2);
	arrayType$1 = $arrayType($Float32, 2);
	arrayType$2 = $arrayType($Float64, 1);
	structType = $structType("math", [{prop: "uint32array", name: "uint32array", anonymous: false, exported: false, typ: arrayType, tag: ""}, {prop: "float32array", name: "float32array", anonymous: false, exported: false, typ: arrayType$1, tag: ""}, {prop: "float64array", name: "float64array", anonymous: false, exported: false, typ: arrayType$2, tag: ""}]);
	Exp = function(x) {
		var x;
		return $parseFloat(math.exp(x));
	};
	$pkg.Exp = Exp;
	Log = function(x) {
		var x;
		if (!((x === x))) {
			return nan;
		}
		return $parseFloat(math.log(x));
	};
	$pkg.Log = Log;
	init = function() {
		var ab;
		ab = new ($global.ArrayBuffer)(8);
		buf.uint32array = new ($global.Uint32Array)(ab);
		buf.float32array = new ($global.Float32Array)(ab);
		buf.float64array = new ($global.Float64Array)(ab);
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		buf = new structType.ptr(arrayType.zero(), arrayType$1.zero(), arrayType$2.zero());
		math = $global.Math;
		zero = 0;
		nan = 0 / zero;
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math/rand"] = (function() {
	var $pkg = {}, $init, nosync, math, Source, Source64, Rand, lockedSource, rngSource, arrayType, ptrType, ptrType$1, sliceType, ptrType$2, ptrType$3, sliceType$1, ptrType$5, ke, we, fe, kn, wn, fn, globalRand, rng_cooked, absInt32, NewSource, New, read, Float64, seedrand;
	nosync = $packages["github.com/gopherjs/gopherjs/nosync"];
	math = $packages["math"];
	Source = $pkg.Source = $newType(8, $kindInterface, "rand.Source", true, "math/rand", true, null);
	Source64 = $pkg.Source64 = $newType(8, $kindInterface, "rand.Source64", true, "math/rand", true, null);
	Rand = $pkg.Rand = $newType(0, $kindStruct, "rand.Rand", true, "math/rand", true, function(src_, s64_, readVal_, readPos_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.src = $ifaceNil;
			this.s64 = $ifaceNil;
			this.readVal = new $Int64(0, 0);
			this.readPos = 0;
			return;
		}
		this.src = src_;
		this.s64 = s64_;
		this.readVal = readVal_;
		this.readPos = readPos_;
	});
	lockedSource = $pkg.lockedSource = $newType(0, $kindStruct, "rand.lockedSource", true, "math/rand", false, function(lk_, src_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lk = new nosync.Mutex.ptr(false);
			this.src = $ifaceNil;
			return;
		}
		this.lk = lk_;
		this.src = src_;
	});
	rngSource = $pkg.rngSource = $newType(0, $kindStruct, "rand.rngSource", true, "math/rand", false, function(tap_, feed_, vec_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.tap = 0;
			this.feed = 0;
			this.vec = arrayType.zero();
			return;
		}
		this.tap = tap_;
		this.feed = feed_;
		this.vec = vec_;
	});
	arrayType = $arrayType($Int64, 607);
	ptrType = $ptrType(lockedSource);
	ptrType$1 = $ptrType($Int8);
	sliceType = $sliceType($Int);
	ptrType$2 = $ptrType($Int64);
	ptrType$3 = $ptrType(Rand);
	sliceType$1 = $sliceType($Uint8);
	ptrType$5 = $ptrType(rngSource);
	Rand.ptr.prototype.ExpFloat64 = function() {
		var _r, _r$1, _r$2, _r$3, i, j, r, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; i = $f.i; j = $f.j; r = $f.r; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* while (true) { */ case 1:
			_r = r.Uint32(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			j = _r;
			i = (j & 255) >>> 0;
			x = (j) * (((i < 0 || i >= we.length) ? ($throwRuntimeError("index out of range"), undefined) : we[i]));
			if (j < ((i < 0 || i >= ke.length) ? ($throwRuntimeError("index out of range"), undefined) : ke[i])) {
				$s = -1; return x;
			}
			/* */ if (i === 0) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (i === 0) { */ case 4:
				_r$1 = r.Float64(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = math.Log(_r$1); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$s = -1; return 7.69711747013105 - _r$2;
			/* } */ case 5:
			_r$3 = r.Float64(); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			/* */ if ($fround(((i < 0 || i >= fe.length) ? ($throwRuntimeError("index out of range"), undefined) : fe[i]) + $fround(($fround(_r$3)) * ($fround((x$1 = i - 1 >>> 0, ((x$1 < 0 || x$1 >= fe.length) ? ($throwRuntimeError("index out of range"), undefined) : fe[x$1])) - ((i < 0 || i >= fe.length) ? ($throwRuntimeError("index out of range"), undefined) : fe[i]))))) < ($fround(math.Exp(-x)))) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if ($fround(((i < 0 || i >= fe.length) ? ($throwRuntimeError("index out of range"), undefined) : fe[i]) + $fround(($fround(_r$3)) * ($fround((x$1 = i - 1 >>> 0, ((x$1 < 0 || x$1 >= fe.length) ? ($throwRuntimeError("index out of range"), undefined) : fe[x$1])) - ((i < 0 || i >= fe.length) ? ($throwRuntimeError("index out of range"), undefined) : fe[i]))))) < ($fround(math.Exp(-x)))) { */ case 8:
				$s = -1; return x;
			/* } */ case 9:
		/* } */ $s = 1; continue; case 2:
		$s = -1; return 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.ExpFloat64 }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f.i = i; $f.j = j; $f.r = r; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.ExpFloat64 = function() { return this.$val.ExpFloat64(); };
	absInt32 = function(i) {
		var i;
		if (i < 0) {
			return ((-i >>> 0));
		}
		return ((i >>> 0));
	};
	Rand.ptr.prototype.NormFloat64 = function() {
		var _r, _r$1, _r$2, _r$3, _r$4, _r$5, i, j, r, x, x$1, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; i = $f.i; j = $f.j; r = $f.r; x = $f.x; x$1 = $f.x$1; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* while (true) { */ case 1:
			_r = r.Uint32(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			j = ((_r >> 0));
			i = j & 127;
			x = (j) * (((i < 0 || i >= wn.length) ? ($throwRuntimeError("index out of range"), undefined) : wn[i]));
			if (absInt32(j) < ((i < 0 || i >= kn.length) ? ($throwRuntimeError("index out of range"), undefined) : kn[i])) {
				$s = -1; return x;
			}
			/* */ if (i === 0) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (i === 0) { */ case 4:
				/* while (true) { */ case 6:
					_r$1 = r.Float64(); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_r$2 = math.Log(_r$1); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					x = -_r$2 * 0.29047645161474317;
					_r$3 = r.Float64(); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_r$4 = math.Log(_r$3); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					y = -_r$4;
					if (y + y >= x * x) {
						/* break; */ $s = 7; continue;
					}
				/* } */ $s = 6; continue; case 7:
				if (j > 0) {
					$s = -1; return 3.442619855899 + x;
				}
				$s = -1; return -3.442619855899 - x;
			/* } */ case 5:
			_r$5 = r.Float64(); /* */ $s = 14; case 14: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			/* */ if ($fround(((i < 0 || i >= fn.length) ? ($throwRuntimeError("index out of range"), undefined) : fn[i]) + $fround(($fround(_r$5)) * ($fround((x$1 = i - 1 >> 0, ((x$1 < 0 || x$1 >= fn.length) ? ($throwRuntimeError("index out of range"), undefined) : fn[x$1])) - ((i < 0 || i >= fn.length) ? ($throwRuntimeError("index out of range"), undefined) : fn[i]))))) < ($fround(math.Exp(-0.5 * x * x)))) { $s = 12; continue; }
			/* */ $s = 13; continue;
			/* if ($fround(((i < 0 || i >= fn.length) ? ($throwRuntimeError("index out of range"), undefined) : fn[i]) + $fround(($fround(_r$5)) * ($fround((x$1 = i - 1 >> 0, ((x$1 < 0 || x$1 >= fn.length) ? ($throwRuntimeError("index out of range"), undefined) : fn[x$1])) - ((i < 0 || i >= fn.length) ? ($throwRuntimeError("index out of range"), undefined) : fn[i]))))) < ($fround(math.Exp(-0.5 * x * x)))) { */ case 12:
				$s = -1; return x;
			/* } */ case 13:
		/* } */ $s = 1; continue; case 2:
		$s = -1; return 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.NormFloat64 }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f.i = i; $f.j = j; $f.r = r; $f.x = x; $f.x$1 = x$1; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.NormFloat64 = function() { return this.$val.NormFloat64(); };
	NewSource = function(seed) {
		var rng, seed;
		rng = new rngSource.ptr(0, 0, arrayType.zero());
		rng.Seed(seed);
		return rng;
	};
	$pkg.NewSource = NewSource;
	New = function(src) {
		var _tuple, s64, src;
		_tuple = $assertType(src, Source64, true);
		s64 = _tuple[0];
		return new Rand.ptr(src, s64, new $Int64(0, 0), 0);
	};
	$pkg.New = New;
	Rand.ptr.prototype.Seed = function(seed) {
		var _tuple, lk, ok, r, seed, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _tuple = $f._tuple; lk = $f.lk; ok = $f.ok; r = $f.r; seed = $f.seed; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_tuple = $assertType(r.src, ptrType, true);
		lk = _tuple[0];
		ok = _tuple[1];
		/* */ if (ok) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (ok) { */ case 1:
			$r = lk.seedPos(seed, (r.$ptr_readPos || (r.$ptr_readPos = new ptrType$1(function() { return this.$target.readPos; }, function($v) { this.$target.readPos = $v; }, r)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return;
		/* } */ case 2:
		$r = r.src.Seed(seed); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r.readPos = 0;
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Seed }; } $f._tuple = _tuple; $f.lk = lk; $f.ok = ok; $f.r = r; $f.seed = seed; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	Rand.ptr.prototype.Int63 = function() {
		var _r, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_r = r.src.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int63 }; } $f._r = _r; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int63 = function() { return this.$val.Int63(); };
	Rand.ptr.prototype.Uint32 = function() {
		var _r, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_r = r.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return (($shiftRightInt64(_r, 31).$low >>> 0));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Uint32 }; } $f._r = _r; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Uint32 = function() { return this.$val.Uint32(); };
	Rand.ptr.prototype.Uint64 = function() {
		var _r, _r$1, _r$2, r, x, x$1, x$2, x$3, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; r = $f.r; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* */ if (!($interfaceIsEqual(r.s64, $ifaceNil))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!($interfaceIsEqual(r.s64, $ifaceNil))) { */ case 1:
			_r = r.s64.Uint64(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r;
		/* } */ case 2:
		_r$1 = r.Int63(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = r.Int63(); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return (x = $shiftRightUint64(((x$1 = _r$1, new $Uint64(x$1.$high, x$1.$low))), 31), x$2 = $shiftLeft64(((x$3 = _r$2, new $Uint64(x$3.$high, x$3.$low))), 32), new $Uint64(x.$high | x$2.$high, (x.$low | x$2.$low) >>> 0));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Uint64 }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.r = r; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Rand.ptr.prototype.Int31 = function() {
		var _r, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_r = r.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return (((x = $shiftRightInt64(_r, 32), x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int31 }; } $f._r = _r; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int31 = function() { return this.$val.Int31(); };
	Rand.ptr.prototype.Int = function() {
		var _r, r, u, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; r = $f.r; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_r = r.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		u = ((_r.$low >>> 0));
		$s = -1; return ((((u << 1 >>> 0) >>> 1 >>> 0) >> 0));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int }; } $f._r = _r; $f.r = r; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int = function() { return this.$val.Int(); };
	Rand.ptr.prototype.Int63n = function(n) {
		var _r, _r$1, _r$2, max, n, r, v, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; max = $f.max; n = $f.n; r = $f.r; v = $f.v; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		if ((n.$high < 0 || (n.$high === 0 && n.$low <= 0))) {
			$panic(new $String("invalid argument to Int63n"));
		}
		/* */ if ((x = (x$1 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(n.$high & x$1.$high, (n.$low & x$1.$low) >>> 0)), (x.$high === 0 && x.$low === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((x = (x$1 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(n.$high & x$1.$high, (n.$low & x$1.$low) >>> 0)), (x.$high === 0 && x.$low === 0))) { */ case 1:
			_r = r.Int63(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return (x$2 = _r, x$3 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(x$2.$high & x$3.$high, (x$2.$low & x$3.$low) >>> 0));
		/* } */ case 2:
		max = ((x$4 = (x$5 = $div64(new $Uint64(2147483648, 0), (new $Uint64(n.$high, n.$low)), true), new $Uint64(2147483647 - x$5.$high, 4294967295 - x$5.$low)), new $Int64(x$4.$high, x$4.$low)));
		_r$1 = r.Int63(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		v = _r$1;
		/* while (true) { */ case 5:
			/* if (!((v.$high > max.$high || (v.$high === max.$high && v.$low > max.$low)))) { break; } */ if(!((v.$high > max.$high || (v.$high === max.$high && v.$low > max.$low)))) { $s = 6; continue; }
			_r$2 = r.Int63(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			v = _r$2;
		/* } */ $s = 5; continue; case 6:
		$s = -1; return $div64(v, n, true);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int63n }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.max = max; $f.n = n; $f.r = r; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int63n = function(n) { return this.$val.Int63n(n); };
	Rand.ptr.prototype.Int31n = function(n) {
		var _r, _r$1, _r$2, _r$3, _r$4, max, n, r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; max = $f.max; n = $f.n; r = $f.r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		if (n <= 0) {
			$panic(new $String("invalid argument to Int31n"));
		}
		/* */ if ((n & ((n - 1 >> 0))) === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((n & ((n - 1 >> 0))) === 0) { */ case 1:
			_r = r.Int31(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r & ((n - 1 >> 0));
		/* } */ case 2:
		max = (((2147483647 - (_r$1 = 2147483648 % ((n >>> 0)), _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) >>> 0) >> 0));
		_r$2 = r.Int31(); /* */ $s = 4; case 4: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		v = _r$2;
		/* while (true) { */ case 5:
			/* if (!(v > max)) { break; } */ if(!(v > max)) { $s = 6; continue; }
			_r$3 = r.Int31(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			v = _r$3;
		/* } */ $s = 5; continue; case 6:
		$s = -1; return (_r$4 = v % n, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int31n }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.max = max; $f.n = n; $f.r = r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int31n = function(n) { return this.$val.Int31n(n); };
	Rand.ptr.prototype.Intn = function(n) {
		var _r, _r$1, n, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; n = $f.n; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		if (n <= 0) {
			$panic(new $String("invalid argument to Intn"));
		}
		/* */ if (n <= 2147483647) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (n <= 2147483647) { */ case 1:
			_r = r.Int31n(((n >> 0))); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return ((_r >> 0));
		/* } */ case 2:
		_r$1 = r.Int63n((new $Int64(0, n))); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return (((x = _r$1, x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Intn }; } $f._r = _r; $f._r$1 = _r$1; $f.n = n; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Intn = function(n) { return this.$val.Intn(n); };
	Rand.ptr.prototype.Float64 = function() {
		var _r, f, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; f = $f.f; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* again: */ case 1:
		_r = r.Int63(); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		f = ($flatten64(_r)) / 9.223372036854776e+18;
		/* */ if (f === 1) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if (f === 1) { */ case 3:
			/* goto again */ $s = 1; continue;
		/* } */ case 4:
		$s = -1; return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Float64 }; } $f._r = _r; $f.f = f; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Float64 = function() { return this.$val.Float64(); };
	Rand.ptr.prototype.Float32 = function() {
		var _r, f, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; f = $f.f; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* again: */ case 1:
		_r = r.Float64(); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		f = ($fround(_r));
		/* */ if (f === 1) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if (f === 1) { */ case 3:
			/* goto again */ $s = 1; continue;
		/* } */ case 4:
		$s = -1; return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Float32 }; } $f._r = _r; $f.f = f; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Float32 = function() { return this.$val.Float32(); };
	Rand.ptr.prototype.Perm = function(n) {
		var _r, i, j, m, n, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; i = $f.i; j = $f.j; m = $f.m; n = $f.n; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		m = $makeSlice(sliceType, n);
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < n)) { break; } */ if(!(i < n)) { $s = 2; continue; }
			_r = r.Intn(i + 1 >> 0); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			j = _r;
			((i < 0 || i >= m.$length) ? ($throwRuntimeError("index out of range"), undefined) : m.$array[m.$offset + i] = ((j < 0 || j >= m.$length) ? ($throwRuntimeError("index out of range"), undefined) : m.$array[m.$offset + j]));
			((j < 0 || j >= m.$length) ? ($throwRuntimeError("index out of range"), undefined) : m.$array[m.$offset + j] = i);
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return m;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Perm }; } $f._r = _r; $f.i = i; $f.j = j; $f.m = m; $f.n = n; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Perm = function(n) { return this.$val.Perm(n); };
	Rand.ptr.prototype.Read = function(p) {
		var _r, _r$1, _tuple, _tuple$1, _tuple$2, err, lk, n, ok, p, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; err = $f.err; lk = $f.lk; n = $f.n; ok = $f.ok; p = $f.p; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this;
		_tuple = $assertType(r.src, ptrType, true);
		lk = _tuple[0];
		ok = _tuple[1];
		/* */ if (ok) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (ok) { */ case 1:
			_r = lk.read(p, (r.$ptr_readVal || (r.$ptr_readVal = new ptrType$2(function() { return this.$target.readVal; }, function($v) { this.$target.readVal = $v; }, r))), (r.$ptr_readPos || (r.$ptr_readPos = new ptrType$1(function() { return this.$target.readPos; }, function($v) { this.$target.readPos = $v; }, r)))); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple$1 = _r;
			n = _tuple$1[0];
			err = _tuple$1[1];
			$s = -1; return [n, err];
		/* } */ case 2:
		_r$1 = read(p, $methodVal(r, "Int63"), (r.$ptr_readVal || (r.$ptr_readVal = new ptrType$2(function() { return this.$target.readVal; }, function($v) { this.$target.readVal = $v; }, r))), (r.$ptr_readPos || (r.$ptr_readPos = new ptrType$1(function() { return this.$target.readPos; }, function($v) { this.$target.readPos = $v; }, r)))); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$2 = _r$1;
		n = _tuple$2[0];
		err = _tuple$2[1];
		$s = -1; return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Read }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.err = err; $f.lk = lk; $f.n = n; $f.ok = ok; $f.p = p; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Read = function(p) { return this.$val.Read(p); };
	read = function(p, int63, readVal, readPos) {
		var _r, err, int63, n, p, pos, readPos, readVal, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; err = $f.err; int63 = $f.int63; n = $f.n; p = $f.p; pos = $f.pos; readPos = $f.readPos; readVal = $f.readVal; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		pos = readPos.$get();
		val = readVal.$get();
		n = 0;
		/* while (true) { */ case 1:
			/* if (!(n < p.$length)) { break; } */ if(!(n < p.$length)) { $s = 2; continue; }
			/* */ if (pos === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (pos === 0) { */ case 3:
				_r = int63(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				val = _r;
				pos = 7;
			/* } */ case 4:
			((n < 0 || n >= p.$length) ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + n] = ((val.$low << 24 >>> 24)));
			val = $shiftRightInt64(val, (8));
			pos = pos - (1) << 24 >> 24;
			n = n + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		readPos.$set(pos);
		readVal.$set(val);
		$s = -1; return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: read }; } $f._r = _r; $f.err = err; $f.int63 = int63; $f.n = n; $f.p = p; $f.pos = pos; $f.readPos = readPos; $f.readVal = readVal; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Float64 = function() {
		var _r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = globalRand.Float64(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Float64 }; } $f._r = _r; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Float64 = Float64;
	lockedSource.ptr.prototype.Int63 = function() {
		var _r, n, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; n = $f.n; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		r = this;
		r.lk.Lock();
		_r = r.src.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n = _r;
		r.lk.Unlock();
		$s = -1; return n;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.Int63 }; } $f._r = _r; $f.n = n; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.Int63 = function() { return this.$val.Int63(); };
	lockedSource.ptr.prototype.Uint64 = function() {
		var _r, n, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; n = $f.n; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Uint64(0, 0);
		r = this;
		r.lk.Lock();
		_r = r.src.Uint64(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n = _r;
		r.lk.Unlock();
		$s = -1; return n;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.Uint64 }; } $f._r = _r; $f.n = n; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.Uint64 = function() { return this.$val.Uint64(); };
	lockedSource.ptr.prototype.Seed = function(seed) {
		var r, seed, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; r = $f.r; seed = $f.seed; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		r.lk.Lock();
		$r = r.src.Seed(seed); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r.lk.Unlock();
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.Seed }; } $f.r = r; $f.seed = seed; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	lockedSource.ptr.prototype.seedPos = function(seed, readPos) {
		var r, readPos, seed, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; r = $f.r; readPos = $f.readPos; seed = $f.seed; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		r.lk.Lock();
		$r = r.src.Seed(seed); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		readPos.$set(0);
		r.lk.Unlock();
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.seedPos }; } $f.r = r; $f.readPos = readPos; $f.seed = seed; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.seedPos = function(seed, readPos) { return this.$val.seedPos(seed, readPos); };
	lockedSource.ptr.prototype.read = function(p, readVal, readPos) {
		var _r, _tuple, err, n, p, r, readPos, readVal, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; err = $f.err; n = $f.n; p = $f.p; r = $f.r; readPos = $f.readPos; readVal = $f.readVal; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this;
		r.lk.Lock();
		_r = read(p, $methodVal(r.src, "Int63"), readVal, readPos); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		n = _tuple[0];
		err = _tuple[1];
		r.lk.Unlock();
		$s = -1; return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.read }; } $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.n = n; $f.p = p; $f.r = r; $f.readPos = readPos; $f.readVal = readVal; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.read = function(p, readVal, readPos) { return this.$val.read(p, readVal, readPos); };
	seedrand = function(x) {
		var _q, _r, hi, lo, x;
		hi = (_q = x / 44488, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		lo = (_r = x % 44488, _r === _r ? _r : $throwRuntimeError("integer divide by zero"));
		x = ($imul(48271, lo)) - ($imul(3399, hi)) >> 0;
		if (x < 0) {
			x = x + (2147483647) >> 0;
		}
		return x;
	};
	rngSource.ptr.prototype.Seed = function(seed) {
		var i, rng, seed, u, x, x$1, x$2, x$3, x$4, x$5;
		rng = this;
		rng.tap = 0;
		rng.feed = 334;
		seed = $div64(seed, new $Int64(0, 2147483647), true);
		if ((seed.$high < 0 || (seed.$high === 0 && seed.$low < 0))) {
			seed = (x = new $Int64(0, 2147483647), new $Int64(seed.$high + x.$high, seed.$low + x.$low));
		}
		if ((seed.$high === 0 && seed.$low === 0)) {
			seed = new $Int64(0, 89482311);
		}
		x$1 = (((seed.$low + ((seed.$high >> 31) * 4294967296)) >> 0));
		i = -20;
		while (true) {
			if (!(i < 607)) { break; }
			x$1 = seedrand(x$1);
			if (i >= 0) {
				u = new $Int64(0, 0);
				u = $shiftLeft64((new $Int64(0, x$1)), 40);
				x$1 = seedrand(x$1);
				u = (x$2 = $shiftLeft64((new $Int64(0, x$1)), 20), new $Int64(u.$high ^ x$2.$high, (u.$low ^ x$2.$low) >>> 0));
				x$1 = seedrand(x$1);
				u = (x$3 = (new $Int64(0, x$1)), new $Int64(u.$high ^ x$3.$high, (u.$low ^ x$3.$low) >>> 0));
				u = (x$4 = ((i < 0 || i >= rng_cooked.length) ? ($throwRuntimeError("index out of range"), undefined) : rng_cooked[i]), new $Int64(u.$high ^ x$4.$high, (u.$low ^ x$4.$low) >>> 0));
				(x$5 = rng.vec, ((i < 0 || i >= x$5.length) ? ($throwRuntimeError("index out of range"), undefined) : x$5[i] = u));
			}
			i = i + (1) >> 0;
		}
	};
	rngSource.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	rngSource.ptr.prototype.Int63 = function() {
		var rng, x, x$1;
		rng = this;
		return ((x = (x$1 = rng.Uint64(), new $Uint64(x$1.$high & 2147483647, (x$1.$low & 4294967295) >>> 0)), new $Int64(x.$high, x.$low)));
	};
	rngSource.prototype.Int63 = function() { return this.$val.Int63(); };
	rngSource.ptr.prototype.Uint64 = function() {
		var rng, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8;
		rng = this;
		rng.tap = rng.tap - (1) >> 0;
		if (rng.tap < 0) {
			rng.tap = rng.tap + (607) >> 0;
		}
		rng.feed = rng.feed - (1) >> 0;
		if (rng.feed < 0) {
			rng.feed = rng.feed + (607) >> 0;
		}
		x$6 = (x = (x$1 = rng.vec, x$2 = rng.feed, ((x$2 < 0 || x$2 >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[x$2])), x$3 = (x$4 = rng.vec, x$5 = rng.tap, ((x$5 < 0 || x$5 >= x$4.length) ? ($throwRuntimeError("index out of range"), undefined) : x$4[x$5])), new $Int64(x.$high + x$3.$high, x.$low + x$3.$low));
		(x$7 = rng.vec, x$8 = rng.feed, ((x$8 < 0 || x$8 >= x$7.length) ? ($throwRuntimeError("index out of range"), undefined) : x$7[x$8] = x$6));
		return (new $Uint64(x$6.$high, x$6.$low));
	};
	rngSource.prototype.Uint64 = function() { return this.$val.Uint64(); };
	ptrType$3.methods = [{prop: "ExpFloat64", name: "ExpFloat64", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "NormFloat64", name: "NormFloat64", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint32", name: "Uint32", pkg: "", typ: $funcType([], [$Uint32], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Int31", name: "Int31", pkg: "", typ: $funcType([], [$Int32], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int63n", name: "Int63n", pkg: "", typ: $funcType([$Int64], [$Int64], false)}, {prop: "Int31n", name: "Int31n", pkg: "", typ: $funcType([$Int32], [$Int32], false)}, {prop: "Intn", name: "Intn", pkg: "", typ: $funcType([$Int], [$Int], false)}, {prop: "Float64", name: "Float64", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Float32", name: "Float32", pkg: "", typ: $funcType([], [$Float32], false)}, {prop: "Perm", name: "Perm", pkg: "", typ: $funcType([$Int], [sliceType], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType$1], [$Int, $error], false)}];
	ptrType.methods = [{prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "seedPos", name: "seedPos", pkg: "math/rand", typ: $funcType([$Int64, ptrType$1], [], false)}, {prop: "read", name: "read", pkg: "math/rand", typ: $funcType([sliceType$1, ptrType$2, ptrType$1], [$Int, $error], false)}];
	ptrType$5.methods = [{prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}];
	Source.init([{prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}]);
	Source64.init([{prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}]);
	Rand.init("math/rand", [{prop: "src", name: "src", anonymous: false, exported: false, typ: Source, tag: ""}, {prop: "s64", name: "s64", anonymous: false, exported: false, typ: Source64, tag: ""}, {prop: "readVal", name: "readVal", anonymous: false, exported: false, typ: $Int64, tag: ""}, {prop: "readPos", name: "readPos", anonymous: false, exported: false, typ: $Int8, tag: ""}]);
	lockedSource.init("math/rand", [{prop: "lk", name: "lk", anonymous: false, exported: false, typ: nosync.Mutex, tag: ""}, {prop: "src", name: "src", anonymous: false, exported: false, typ: Source64, tag: ""}]);
	rngSource.init("math/rand", [{prop: "tap", name: "tap", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "feed", name: "feed", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "vec", name: "vec", anonymous: false, exported: false, typ: arrayType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = nosync.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ke = $toNativeArray($kindUint32, [3801129273, 0, 2615860924, 3279400049, 3571300752, 3733536696, 3836274812, 3906990442, 3958562475, 3997804264, 4028649213, 4053523342, 4074002619, 4091154507, 4105727352, 4118261130, 4129155133, 4138710916, 4147160435, 4154685009, 4161428406, 4167506077, 4173011791, 4178022498, 4182601930, 4186803325, 4190671498, 4194244443, 4197554582, 4200629752, 4203493986, 4206168142, 4208670408, 4211016720, 4213221098, 4215295924, 4217252177, 4219099625, 4220846988, 4222502074, 4224071896, 4225562770, 4226980400, 4228329951, 4229616109, 4230843138, 4232014925, 4233135020, 4234206673, 4235232866, 4236216336, 4237159604, 4238064994, 4238934652, 4239770563, 4240574564, 4241348362, 4242093539, 4242811568, 4243503822, 4244171579, 4244816032, 4245438297, 4246039419, 4246620374, 4247182079, 4247725394, 4248251127, 4248760037, 4249252839, 4249730206, 4250192773, 4250641138, 4251075867, 4251497493, 4251906522, 4252303431, 4252688672, 4253062674, 4253425844, 4253778565, 4254121205, 4254454110, 4254777611, 4255092022, 4255397640, 4255694750, 4255983622, 4256264513, 4256537670, 4256803325, 4257061702, 4257313014, 4257557464, 4257795244, 4258026541, 4258251531, 4258470383, 4258683258, 4258890309, 4259091685, 4259287526, 4259477966, 4259663135, 4259843154, 4260018142, 4260188212, 4260353470, 4260514019, 4260669958, 4260821380, 4260968374, 4261111028, 4261249421, 4261383632, 4261513736, 4261639802, 4261761900, 4261880092, 4261994441, 4262105003, 4262211835, 4262314988, 4262414513, 4262510454, 4262602857, 4262691764, 4262777212, 4262859239, 4262937878, 4263013162, 4263085118, 4263153776, 4263219158, 4263281289, 4263340187, 4263395872, 4263448358, 4263497660, 4263543789, 4263586755, 4263626565, 4263663224, 4263696735, 4263727099, 4263754314, 4263778377, 4263799282, 4263817020, 4263831582, 4263842955, 4263851124, 4263856071, 4263857776, 4263856218, 4263851370, 4263843206, 4263831695, 4263816804, 4263798497, 4263776735, 4263751476, 4263722676, 4263690284, 4263654251, 4263614520, 4263571032, 4263523724, 4263472530, 4263417377, 4263358192, 4263294892, 4263227394, 4263155608, 4263079437, 4262998781, 4262913534, 4262823581, 4262728804, 4262629075, 4262524261, 4262414220, 4262298801, 4262177846, 4262051187, 4261918645, 4261780032, 4261635148, 4261483780, 4261325704, 4261160681, 4260988457, 4260808763, 4260621313, 4260425802, 4260221905, 4260009277, 4259787550, 4259556329, 4259315195, 4259063697, 4258801357, 4258527656, 4258242044, 4257943926, 4257632664, 4257307571, 4256967906, 4256612870, 4256241598, 4255853155, 4255446525, 4255020608, 4254574202, 4254106002, 4253614578, 4253098370, 4252555662, 4251984571, 4251383021, 4250748722, 4250079132, 4249371435, 4248622490, 4247828790, 4246986404, 4246090910, 4245137315, 4244119963, 4243032411, 4241867296, 4240616155, 4239269214, 4237815118, 4236240596, 4234530035, 4232664930, 4230623176, 4228378137, 4225897409, 4223141146, 4220059768, 4216590757, 4212654085, 4208145538, 4202926710, 4196809522, 4189531420, 4180713890, 4169789475, 4155865042, 4137444620, 4111806704, 4073393724, 4008685917, 3873074895]);
		we = $toNativeArray($kindFloat32, [2.0249555365836613e-09, 1.4866739783681027e-11, 2.4409616689036184e-11, 3.1968806074589295e-11, 3.844677007314168e-11, 4.42282044321729e-11, 4.951644302919611e-11, 5.443358958023836e-11, 5.905943789574764e-11, 6.34494193296753e-11, 6.764381416113352e-11, 7.167294535648239e-11, 7.556032188826833e-11, 7.932458162551725e-11, 8.298078890689453e-11, 8.654132271912474e-11, 9.001651507523079e-11, 9.341507428706208e-11, 9.674443190998971e-11, 1.0001099254308699e-10, 1.0322031424037093e-10, 1.0637725422757427e-10, 1.0948611461891744e-10, 1.1255067711157807e-10, 1.1557434870246297e-10, 1.1856014781042035e-10, 1.2151082917633005e-10, 1.2442885610752796e-10, 1.2731647680563896e-10, 1.3017574518325858e-10, 1.330085347417409e-10, 1.3581656632677408e-10, 1.386014220061682e-10, 1.413645728254309e-10, 1.4410737880776736e-10, 1.4683107507629245e-10, 1.4953686899854546e-10, 1.522258291641876e-10, 1.5489899640730442e-10, 1.575573282952547e-10, 1.6020171300645814e-10, 1.628330109637588e-10, 1.6545202707884954e-10, 1.68059510752272e-10, 1.7065616975120435e-10, 1.73242697965037e-10, 1.758197337720091e-10, 1.783878739169964e-10, 1.8094774290045024e-10, 1.834998542005195e-10, 1.8604476292871652e-10, 1.8858298256319017e-10, 1.9111498494872592e-10, 1.9364125580789704e-10, 1.9616222535212557e-10, 1.9867835154840918e-10, 2.011900368525943e-10, 2.0369768372052732e-10, 2.062016807302669e-10, 2.0870240258208383e-10, 2.1120022397624894e-10, 2.136955057352452e-10, 2.1618855317040442e-10, 2.1867974098199738e-10, 2.2116936060356807e-10, 2.2365774510202385e-10, 2.2614519978869652e-10, 2.2863201609713002e-10, 2.3111849933865614e-10, 2.3360494094681883e-10, 2.3609159072179864e-10, 2.3857874009713953e-10, 2.4106666662859766e-10, 2.4355562011635357e-10, 2.460458781161634e-10, 2.485376904282077e-10, 2.5103127909709144e-10, 2.5352694943414633e-10, 2.560248957284017e-10, 2.585253955356137e-10, 2.610286709003873e-10, 2.6353494386732734e-10, 2.6604446423661443e-10, 2.6855745405285347e-10, 2.71074163116225e-10, 2.7359478571575835e-10, 2.7611959940720965e-10, 2.786487707240326e-10, 2.8118254946640775e-10, 2.8372118543451563e-10, 2.8626484516180994e-10, 2.8881380620404684e-10, 2.9136826285025563e-10, 2.9392840938946563e-10, 2.96494523377433e-10, 2.990667713476114e-10, 3.016454031001814e-10, 3.042306406797479e-10, 3.068226783753403e-10, 3.09421765987139e-10, 3.12028125559749e-10, 3.1464195138219964e-10, 3.17263521010247e-10, 3.1989300097734485e-10, 3.225306410836737e-10, 3.2517669112941405e-10, 3.2783134540359526e-10, 3.3049485370639786e-10, 3.3316743808242677e-10, 3.3584937608743815e-10, 3.385408342548857e-10, 3.4124211789610115e-10, 3.4395342130011386e-10, 3.4667499426710435e-10, 3.494071143528288e-10, 3.521500313574677e-10, 3.54903967325626e-10, 3.576691720574843e-10, 3.6044595086437425e-10, 3.632345535464765e-10, 3.660352021483959e-10, 3.688482297370399e-10, 3.716738583570134e-10, 3.7451239331964814e-10, 3.773641121807003e-10, 3.802292924959261e-10, 3.831082673322328e-10, 3.8600128648980103e-10, 3.8890865527996255e-10, 3.9183070676962473e-10, 3.9476774627011935e-10, 3.977200790927782e-10, 4.006880383045086e-10, 4.0367195697221803e-10, 4.066721681628138e-10, 4.0968900494320337e-10, 4.127228558914453e-10, 4.15774054074447e-10, 4.188429603146915e-10, 4.2192993543466173e-10, 4.25035395767992e-10, 4.2815970213716525e-10, 4.313032986313914e-10, 4.3446651831757777e-10, 4.376498607960855e-10, 4.408536868893975e-10, 4.4407846844229937e-10, 4.4732464954400086e-10, 4.5059267428371186e-10, 4.538830145062178e-10, 4.5719619756745544e-10, 4.605326675566346e-10, 4.638929240741163e-10, 4.672775499869886e-10, 4.706869893844612e-10, 4.74121908400349e-10, 4.775827511238617e-10, 4.810701836888143e-10, 4.845848167178701e-10, 4.881271498113904e-10, 4.916979601254923e-10, 4.952977472605369e-10, 4.989272883726414e-10, 5.025872495956207e-10, 5.062783525744408e-10, 5.100013189540675e-10, 5.13756870379467e-10, 5.175458395179078e-10, 5.21369003525507e-10, 5.252272505806843e-10, 5.29121357839557e-10, 5.330522134805449e-10, 5.3702081670437e-10, 5.41028055689452e-10, 5.450749851476644e-10, 5.491624932574268e-10, 5.532918012640664e-10, 5.574638528571541e-10, 5.616799247931681e-10, 5.659410717839819e-10, 5.702485705860738e-10, 5.746036979559221e-10, 5.790077306500052e-10, 5.83462111958255e-10, 5.879682296594524e-10, 5.925275825546805e-10, 5.971417249561739e-10, 6.01812211176167e-10, 6.065408175714992e-10, 6.113292094767075e-10, 6.16179329782085e-10, 6.21092954844471e-10, 6.260721940876124e-10, 6.311191569352559e-10, 6.362359528111483e-10, 6.414249686947926e-10, 6.466885360545405e-10, 6.520292639144998e-10, 6.574497612987784e-10, 6.629528592760892e-10, 6.685415554485985e-10, 6.742187919073217e-10, 6.799880103436351e-10, 6.858525969377638e-10, 6.918161599145378e-10, 6.978825850545434e-10, 7.040559801829716e-10, 7.103406751696184e-10, 7.167412219288849e-10, 7.232625609532306e-10, 7.2990985477972e-10, 7.366885990123251e-10, 7.436047333442275e-10, 7.506645305355164e-10, 7.57874762946642e-10, 7.652426470272644e-10, 7.727759543385559e-10, 7.804830115532013e-10, 7.883728114777e-10, 7.964550685635174e-10, 8.047402189070851e-10, 8.132396422944055e-10, 8.219657177122031e-10, 8.309318788590758e-10, 8.401527806789488e-10, 8.496445214056791e-10, 8.594246980742071e-10, 8.695127395874636e-10, 8.799300732498239e-10, 8.90700457834015e-10, 9.01850316648023e-10, 9.134091816243028e-10, 9.254100818978372e-10, 9.37890431984556e-10, 9.508922538259412e-10, 9.64463842123564e-10, 9.78660263939446e-10, 9.935448019859905e-10, 1.0091912860943353e-09, 1.0256859805934937e-09, 1.0431305819125214e-09, 1.0616465484503124e-09, 1.0813799855569073e-09, 1.1025096391392708e-09, 1.1252564435793033e-09, 1.149898620766976e-09, 1.176793218427008e-09, 1.2064089727203964e-09, 1.2393785997488749e-09, 1.2765849488616254e-09, 1.319313880365769e-09, 1.36954347862428e-09, 1.4305497897382224e-09, 1.5083649884672923e-09, 1.6160853766322703e-09, 1.7921247819074893e-09]);
		fe = $toNativeArray($kindFloat32, [1, 0.9381436705589294, 0.900469958782196, 0.8717043399810791, 0.847785472869873, 0.8269932866096497, 0.8084216713905334, 0.7915276288986206, 0.7759568691253662, 0.7614634037017822, 0.7478685975074768, 0.7350381016731262, 0.7228676676750183, 0.7112747430801392, 0.7001926302909851, 0.6895664930343628, 0.6793505549430847, 0.669506311416626, 0.6600008606910706, 0.6508058309555054, 0.6418967247009277, 0.633251965045929, 0.62485271692276, 0.6166821718215942, 0.608725368976593, 0.6009689569473267, 0.5934008955955505, 0.5860103368759155, 0.5787873864173889, 0.5717230439186096, 0.5648092031478882, 0.5580382943153381, 0.5514034032821655, 0.5448982119560242, 0.5385168790817261, 0.5322538614273071, 0.526104211807251, 0.5200631618499756, 0.5141264200210571, 0.5082897543907166, 0.5025495290756226, 0.4969019889831543, 0.4913438558578491, 0.4858720004558563, 0.48048335313796997, 0.4751752018928528, 0.4699448347091675, 0.4647897481918335, 0.4597076177597046, 0.4546961486339569, 0.4497532546520233, 0.44487687945365906, 0.4400651156902313, 0.4353161156177521, 0.4306281507015228, 0.42599955201148987, 0.42142874002456665, 0.4169141948223114, 0.4124544560909271, 0.40804818272590637, 0.4036940038204193, 0.39939069747924805, 0.3951369822025299, 0.39093172550201416, 0.38677382469177246, 0.38266217708587646, 0.378595769405365, 0.37457355856895447, 0.37059465050697327, 0.366658091545105, 0.362762987613678, 0.358908474445343, 0.35509374737739563, 0.35131800174713135, 0.3475804924964905, 0.34388044476509094, 0.34021714329719543, 0.33658990263938904, 0.3329980671405792, 0.3294409513473511, 0.32591795921325684, 0.32242849469184875, 0.3189719021320343, 0.3155476748943329, 0.31215524673461914, 0.3087940812110901, 0.30546361207962036, 0.30216339230537415, 0.29889291524887085, 0.29565170407295227, 0.2924392819404602, 0.2892552316188812, 0.28609907627105713, 0.2829704284667969, 0.27986884117126465, 0.2767939269542694, 0.2737452983856201, 0.2707225978374481, 0.26772540807724, 0.26475343108177185, 0.2618062496185303, 0.258883535861969, 0.2559850215911865, 0.25311028957366943, 0.25025907158851624, 0.24743106961250305, 0.2446259707212448, 0.24184346199035645, 0.23908329010009766, 0.23634515702724457, 0.2336287796497345, 0.23093391954898834, 0.22826029360294342, 0.22560766339302063, 0.22297576069831848, 0.22036437690258026, 0.21777324378490448, 0.21520215272903442, 0.212650865316391, 0.21011915802955627, 0.20760682225227356, 0.20511364936828613, 0.20263944566249847, 0.20018397271633148, 0.19774706661701202, 0.1953285187482834, 0.19292815029621124, 0.19054576754570007, 0.18818120658397675, 0.18583425879478455, 0.18350479006767273, 0.18119260668754578, 0.17889754474163055, 0.17661945521831512, 0.17435817420482635, 0.1721135377883911, 0.16988539695739746, 0.16767361760139465, 0.16547803580760956, 0.16329853236675262, 0.16113494336605072, 0.1589871346950531, 0.15685498714447021, 0.15473836660385132, 0.15263713896274567, 0.1505511850118637, 0.1484803706407547, 0.14642459154129028, 0.1443837285041809, 0.14235764741897583, 0.1403462439775467, 0.13834942877292633, 0.136367067694664, 0.13439907133579254, 0.1324453204870224, 0.1305057406425476, 0.12858019769191742, 0.12666863203048706, 0.12477091699838638, 0.12288697808980942, 0.1210167184472084, 0.11916005611419678, 0.11731690168380737, 0.11548716574907303, 0.11367076635360718, 0.11186762899160385, 0.11007767915725708, 0.1083008274435997, 0.10653700679540634, 0.10478614270687103, 0.1030481606721878, 0.10132300108671188, 0.0996105819940567, 0.09791085124015808, 0.09622374176979065, 0.09454918652772903, 0.09288713335990906, 0.09123751521110535, 0.08960027992725372, 0.08797537535429001, 0.08636274188756943, 0.0847623273730278, 0.08317409455776215, 0.08159798383712769, 0.08003395050764084, 0.07848194986581802, 0.07694194465875626, 0.07541389018297195, 0.07389774918556213, 0.07239348441362381, 0.070901058614254, 0.06942043453454971, 0.06795158982276917, 0.06649449467658997, 0.06504911929368973, 0.06361543387174606, 0.06219341605901718, 0.06078304722905159, 0.0593843050301075, 0.05799717456102371, 0.05662164092063904, 0.05525768920779228, 0.05390531197190285, 0.05256449431180954, 0.05123523622751236, 0.04991753399372101, 0.04861138388514519, 0.047316793352365494, 0.04603376239538193, 0.044762298464775085, 0.04350241273641586, 0.04225412383675575, 0.04101744294166565, 0.039792392402887344, 0.03857899457216263, 0.03737728297710419, 0.03618728369474411, 0.03500903770327568, 0.03384258225560188, 0.0326879620552063, 0.031545232981443405, 0.030414443463087082, 0.0292956605553627, 0.028188949450850487, 0.027094384655356407, 0.02601204626262188, 0.024942025542259216, 0.023884421214461327, 0.022839335724711418, 0.021806888282299042, 0.020787203684449196, 0.019780423492193222, 0.018786700442433357, 0.017806200310587883, 0.016839107498526573, 0.015885621309280396, 0.014945968054234982, 0.01402039173990488, 0.013109165243804455, 0.012212592177093029, 0.011331013403832912, 0.010464809834957123, 0.009614413604140282, 0.008780314587056637, 0.007963077165186405, 0.007163353264331818, 0.0063819061033427715, 0.005619642324745655, 0.004877655766904354, 0.004157294984906912, 0.003460264764726162, 0.0027887988835573196, 0.0021459676790982485, 0.001536299823783338, 0.0009672692976891994, 0.0004541343660093844]);
		kn = $toNativeArray($kindUint32, [1991057938, 0, 1611602771, 1826899878, 1918584482, 1969227037, 2001281515, 2023368125, 2039498179, 2051788381, 2061460127, 2069267110, 2075699398, 2081089314, 2085670119, 2089610331, 2093034710, 2096037586, 2098691595, 2101053571, 2103168620, 2105072996, 2106796166, 2108362327, 2109791536, 2111100552, 2112303493, 2113412330, 2114437283, 2115387130, 2116269447, 2117090813, 2117856962, 2118572919, 2119243101, 2119871411, 2120461303, 2121015852, 2121537798, 2122029592, 2122493434, 2122931299, 2123344971, 2123736059, 2124106020, 2124456175, 2124787725, 2125101763, 2125399283, 2125681194, 2125948325, 2126201433, 2126441213, 2126668298, 2126883268, 2127086657, 2127278949, 2127460589, 2127631985, 2127793506, 2127945490, 2128088244, 2128222044, 2128347141, 2128463758, 2128572095, 2128672327, 2128764606, 2128849065, 2128925811, 2128994934, 2129056501, 2129110560, 2129157136, 2129196237, 2129227847, 2129251929, 2129268426, 2129277255, 2129278312, 2129271467, 2129256561, 2129233410, 2129201800, 2129161480, 2129112170, 2129053545, 2128985244, 2128906855, 2128817916, 2128717911, 2128606255, 2128482298, 2128345305, 2128194452, 2128028813, 2127847342, 2127648860, 2127432031, 2127195339, 2126937058, 2126655214, 2126347546, 2126011445, 2125643893, 2125241376, 2124799783, 2124314271, 2123779094, 2123187386, 2122530867, 2121799464, 2120980787, 2120059418, 2119015917, 2117825402, 2116455471, 2114863093, 2112989789, 2110753906, 2108037662, 2104664315, 2100355223, 2094642347, 2086670106, 2074676188, 2054300022, 2010539237]);
		wn = $toNativeArray($kindFloat32, [1.7290404663583558e-09, 1.2680928529462676e-10, 1.689751810696194e-10, 1.9862687883343e-10, 2.223243117382978e-10, 2.4244936613904144e-10, 2.601613091623989e-10, 2.761198769629658e-10, 2.9073962681813725e-10, 3.042996965518796e-10, 3.169979556627567e-10, 3.289802041894774e-10, 3.4035738116777736e-10, 3.5121602848242617e-10, 3.61625090983253e-10, 3.7164057942185025e-10, 3.813085680537398e-10, 3.906675816178762e-10, 3.997501218933053e-10, 4.0858399996679395e-10, 4.1719308563337165e-10, 4.255982233303257e-10, 4.3381759295968436e-10, 4.4186720948857783e-10, 4.497613115272969e-10, 4.57512583373898e-10, 4.6513240481438345e-10, 4.726310454117311e-10, 4.800177477726209e-10, 4.873009773476156e-10, 4.944885056978876e-10, 5.015873272284921e-10, 5.086040477664255e-10, 5.155446070048697e-10, 5.224146670812502e-10, 5.292193350214802e-10, 5.359634958068682e-10, 5.426517013518151e-10, 5.492881705038144e-10, 5.558769555769061e-10, 5.624218868405251e-10, 5.689264614971989e-10, 5.75394121238304e-10, 5.818281967329142e-10, 5.882316855831959e-10, 5.946076964136182e-10, 6.009590047817426e-10, 6.072883862451306e-10, 6.135985053390414e-10, 6.19892026598734e-10, 6.261713370037114e-10, 6.324390455780815e-10, 6.386973727678935e-10, 6.449488165749528e-10, 6.511955974453087e-10, 6.574400468473129e-10, 6.636843297158634e-10, 6.699307220081607e-10, 6.761814441702541e-10, 6.824387166481927e-10, 6.887046488657234e-10, 6.949815167800466e-10, 7.012714853260604e-10, 7.075767749498141e-10, 7.13899661608508e-10, 7.202424212593428e-10, 7.266072743483676e-10, 7.329966078550854e-10, 7.394128087589991e-10, 7.458582640396116e-10, 7.523354716987285e-10, 7.588469852493063e-10, 7.653954137154528e-10, 7.719834771435785e-10, 7.786139510912449e-10, 7.852897221383159e-10, 7.920137878869582e-10, 7.987892014504894e-10, 8.056192379868321e-10, 8.125072836762115e-10, 8.194568912323064e-10, 8.264716688799467e-10, 8.3355555791087e-10, 8.407127216614185e-10, 8.479473234679347e-10, 8.552640262671218e-10, 8.626675485068347e-10, 8.701631637464402e-10, 8.777562010564566e-10, 8.854524335966119e-10, 8.932581896381464e-10, 9.011799639857543e-10, 9.092249730890956e-10, 9.174008219758889e-10, 9.25715837318819e-10, 9.341788453909317e-10, 9.42799727177146e-10, 9.515889187738935e-10, 9.605578554783278e-10, 9.697193048552322e-10, 9.790869226478094e-10, 9.886760299337993e-10, 9.985036131254788e-10, 1.008588212947359e-09, 1.0189509236369076e-09, 1.0296150598776421e-09, 1.040606933955246e-09, 1.0519566329136865e-09, 1.0636980185552147e-09, 1.0758701707302976e-09, 1.0885182755160372e-09, 1.101694735439196e-09, 1.115461056855338e-09, 1.1298901814171813e-09, 1.1450695946990663e-09, 1.1611052119775422e-09, 1.178127595480305e-09, 1.1962995039027646e-09, 1.2158286599728285e-09, 1.2369856250415978e-09, 1.2601323318151003e-09, 1.2857697129220469e-09, 1.3146201904845611e-09, 1.3477839955200466e-09, 1.3870635751089821e-09, 1.43574030442295e-09, 1.5008658760251592e-09, 1.6030947680434338e-09]);
		fn = $toNativeArray($kindFloat32, [1, 0.963599681854248, 0.9362826943397522, 0.9130436182022095, 0.8922816514968872, 0.8732430338859558, 0.8555005788803101, 0.8387836217880249, 0.8229072093963623, 0.8077383041381836, 0.7931770086288452, 0.7791460752487183, 0.7655841708183289, 0.7524415850639343, 0.7396772503852844, 0.7272568941116333, 0.7151514887809753, 0.7033361196517944, 0.6917891502380371, 0.6804918646812439, 0.6694276928901672, 0.6585819721221924, 0.6479418277740479, 0.6374954581260681, 0.6272324919700623, 0.6171433925628662, 0.6072195172309875, 0.5974531769752502, 0.5878370404243469, 0.5783646702766418, 0.5690299868583679, 0.5598273873329163, 0.550751805305481, 0.5417983531951904, 0.5329626798629761, 0.5242405533790588, 0.5156282186508179, 0.5071220397949219, 0.49871864914894104, 0.4904148280620575, 0.48220765590667725, 0.47409430146217346, 0.466072142124176, 0.45813870429992676, 0.45029163360595703, 0.44252872467041016, 0.4348478317260742, 0.42724698781967163, 0.41972434520721436, 0.41227802634239197, 0.40490642189979553, 0.39760786294937134, 0.3903807997703552, 0.3832238018512726, 0.3761354684829712, 0.3691144585609436, 0.36215949058532715, 0.3552693724632263, 0.3484429717063904, 0.3416791558265686, 0.33497685194015503, 0.32833510637283325, 0.3217529058456421, 0.3152293860912323, 0.30876362323760986, 0.3023548424243927, 0.2960021495819092, 0.2897048592567444, 0.28346219658851624, 0.2772735059261322, 0.271138072013855, 0.2650552988052368, 0.25902456045150757, 0.25304529070854187, 0.24711695313453674, 0.24123899638652802, 0.23541094362735748, 0.22963231801986694, 0.22390270233154297, 0.21822164952754974, 0.21258877217769623, 0.20700371265411377, 0.20146611332893372, 0.1959756463766098, 0.19053204357624054, 0.18513499200344086, 0.17978426814079285, 0.1744796335697174, 0.16922089457511902, 0.16400785744190216, 0.1588403731584549, 0.15371830761432648, 0.14864157140254974, 0.14361007511615753, 0.13862377405166626, 0.13368265330791473, 0.12878671288490295, 0.12393598258495331, 0.11913054436445236, 0.11437050998210907, 0.10965602099895477, 0.1049872562289238, 0.10036443918943405, 0.09578784555196762, 0.09125780314207077, 0.08677466958761215, 0.08233889937400818, 0.07795098423957825, 0.07361150532960892, 0.06932111829519272, 0.06508058309555054, 0.06089077144861221, 0.05675266310572624, 0.05266740173101425, 0.048636294901371, 0.044660862535238266, 0.040742866694927216, 0.03688438981771469, 0.03308788686990738, 0.029356317594647408, 0.025693291798233986, 0.02210330404341221, 0.018592102453112602, 0.015167297795414925, 0.011839478276669979, 0.0086244847625494, 0.005548994988203049, 0.0026696291752159595]);
		rng_cooked = $toNativeArray($kindInt64, [new $Int64(-973649357, 3952672746), new $Int64(-1065661887, 3130416987), new $Int64(324977939, 3414273807), new $Int64(1241840476, 2806224363), new $Int64(-1477934308, 1997590414), new $Int64(2103305448, 2402795971), new $Int64(1663160183, 1140819369), new $Int64(1120601685, 1788868961), new $Int64(1848035537, 1089001426), new $Int64(1235702047, 873593504), new $Int64(1911387977, 581324885), new $Int64(-1654874170, 1609182556), new $Int64(1069394745, 1241596776), new $Int64(1895445337, 1771189259), new $Int64(-1374618802, 3467012610), new $Int64(-140526423, 2344407434), new $Int64(-1745367887, 782467244), new $Int64(26335124, 3404933915), new $Int64(1063924276, 618867887), new $Int64(-968700782, 520164395), new $Int64(-1591572833, 1341358184), new $Int64(-1515085039, 665794848), new $Int64(1527227641, 3183648150), new $Int64(1781176124, 696329606), new $Int64(1789146075, 4151988961), new $Int64(-2087444114, 998951326), new $Int64(-612324923, 1364957564), new $Int64(63173359, 4090230633), new $Int64(-1498029007, 4009697548), new $Int64(248009524, 2569622517), new $Int64(778703922, 3742421481), new $Int64(-1109106023, 1506914633), new $Int64(1738099768, 1983412561), new $Int64(236311649, 1436266083), new $Int64(-1111517500, 3922894967), new $Int64(-1336974714, 1792680179), new $Int64(563141142, 1188796351), new $Int64(1349617468, 405968250), new $Int64(1044074554, 433754187), new $Int64(870549669, 4073162024), new $Int64(-1094251604, 433121399), new $Int64(2451824, 4162580594), new $Int64(-137262572, 4132415622), new $Int64(-1536231048, 3033822028), new $Int64(2016407895, 824682382), new $Int64(2366218, 3583765414), new $Int64(-624604839, 535386927), new $Int64(1637219058, 2286693689), new $Int64(1453075389, 2968466525), new $Int64(193683513, 1351410206), new $Int64(-283806096, 1412813499), new $Int64(492736522, 4126267639), new $Int64(512765208, 2105529399), new $Int64(2132966268, 2413882233), new $Int64(947457634, 32226200), new $Int64(1149341356, 2032329073), new $Int64(106485445, 1356518208), new $Int64(-2067810156, 3430061722), new $Int64(-1484435135, 3820169661), new $Int64(-1665985194, 2981816134), new $Int64(1017155588, 4184371017), new $Int64(206574701, 2119206761), new $Int64(-852109057, 2472200560), new $Int64(-560457548, 2853524696), new $Int64(1307803389, 1681119904), new $Int64(-174986835, 95608918), new $Int64(392686347, 3690479145), new $Int64(-1205570926, 1397922290), new $Int64(-1159314025, 1516129515), new $Int64(-320178155, 1547420459), new $Int64(1311333971, 1470949486), new $Int64(-1953469798, 1336785672), new $Int64(-45086614, 4131677129), new $Int64(-1392278100, 4246329084), new $Int64(-1142500187, 3788585631), new $Int64(-66478285, 3080389532), new $Int64(-646438364, 2215402037), new $Int64(391002300, 1171593935), new $Int64(1408774047, 1423855166), new $Int64(-519177718, 2276716302), new $Int64(-368453140, 2068027241), new $Int64(1369359303, 3427553297), new $Int64(189241615, 3289637845), new $Int64(1057480830, 3486407650), new $Int64(-1512910664, 3071877822), new $Int64(1159653919, 3363620705), new $Int64(-934256930, 4159821533), new $Int64(-76621938, 1894661), new $Int64(-674493898, 1156868282), new $Int64(348271067, 776219088), new $Int64(-501428838, 2425634259), new $Int64(1716021749, 680510161), new $Int64(-574263456, 1310101429), new $Int64(1095885995, 2964454134), new $Int64(-325695512, 3467098407), new $Int64(1990672920, 2109628894), new $Int64(-2139648704, 1232604732), new $Int64(-1838070714, 3261916179), new $Int64(1699175360, 434597899), new $Int64(235436061, 1624796439), new $Int64(-1626402839, 3589632480), new $Int64(1198416575, 864579159), new $Int64(-1938748161, 1380889830), new $Int64(619206309, 2654509477), new $Int64(1419738251, 1468209306), new $Int64(-1744284772, 100794388), new $Int64(-1191421458, 2991674471), new $Int64(-208666741, 2224662036), new $Int64(-173659161, 977097250), new $Int64(1351320195, 726419512), new $Int64(-183459897, 1747974366), new $Int64(-753095183, 1556430604), new $Int64(-1049492215, 1080776742), new $Int64(-385846958, 280794874), new $Int64(117767733, 919835643), new $Int64(-967009426, 3434019658), new $Int64(-1951414480, 2461941785), new $Int64(133215641, 3615001066), new $Int64(417204809, 3103414427), new $Int64(790056561, 3380809712), new $Int64(-1267681408, 2724693469), new $Int64(547796833, 598827710), new $Int64(-1846559452, 3452273442), new $Int64(-75778224, 649274915), new $Int64(-801301329, 2585724112), new $Int64(-1510934263, 3165579553), new $Int64(1185578221, 2635894283), new $Int64(-52910178, 2053289721), new $Int64(985976581, 3169337108), new $Int64(1170569632, 144717764), new $Int64(1079216270, 1383666384), new $Int64(-124804942, 681540375), new $Int64(1375448925, 537050586), new $Int64(-1964768344, 315246468), new $Int64(226402871, 849323088), new $Int64(-885062465, 45543944), new $Int64(-946445250, 2319052083), new $Int64(-40708194, 3613090841), new $Int64(560472520, 2992171180), new $Int64(-381863169, 2068244785), new $Int64(917538188, 4239862634), new $Int64(-1369555809, 3892253031), new $Int64(720683925, 958186149), new $Int64(-423297785, 1877702262), new $Int64(1357886971, 837674867), new $Int64(1837048883, 1507589294), new $Int64(1905518400, 873336795), new $Int64(-1879761037, 2764496274), new $Int64(-1806480530, 4196182374), new $Int64(-1066765755, 550964545), new $Int64(818747069, 420611474), new $Int64(-1924830376, 204265180), new $Int64(1549974541, 1787046383), new $Int64(1215581865, 3102292318), new $Int64(418321538, 1552199393), new $Int64(1243493047, 980542004), new $Int64(267284263, 3293718720), new $Int64(1179528763, 3771917473), new $Int64(599484404, 2195808264), new $Int64(252818753, 3894702887), new $Int64(-1367475956, 2099949527), new $Int64(1424094358, 338442522), new $Int64(490737398, 637158004), new $Int64(-1727621530, 281976339), new $Int64(574970164, 3619802330), new $Int64(-431930823, 3084554784), new $Int64(-1264611183, 4129772886), new $Int64(-2104399043, 1680378557), new $Int64(-1621962591, 3339087776), new $Int64(1680500332, 4220317857), new $Int64(-1935828963, 2959322499), new $Int64(1675600481, 1488354890), new $Int64(-834863562, 3958162143), new $Int64(-1226511573, 2773705983), new $Int64(1876039582, 225908689), new $Int64(-1183735113, 908216283), new $Int64(-605696219, 3574646075), new $Int64(-1827723091, 1936937569), new $Int64(1519770881, 75492235), new $Int64(816689472, 1935193178), new $Int64(2142521206, 2018250883), new $Int64(455141620, 3943126022), new $Int64(-601399488, 3066544345), new $Int64(1932392669, 2793082663), new $Int64(-1239009361, 3297036421), new $Int64(1640597065, 2206987825), new $Int64(-553246738, 807894872), new $Int64(-1781325307, 766252117), new $Int64(2060649606, 3833114345), new $Int64(845619743, 1255067973), new $Int64(1201145605, 741697208), new $Int64(-1476242608, 2810093753), new $Int64(1109032642, 4229340371), new $Int64(1462188720, 1361684224), new $Int64(-1159399429, 1906263026), new $Int64(475781207, 3904421704), new $Int64(-623537128, 1769075545), new $Int64(1062308525, 2621599764), new $Int64(1279509432, 3431891480), new $Int64(-1742751146, 1871896503), new $Int64(128756421, 1412808876), new $Int64(1605404688, 952876175), new $Int64(-230443691, 1824438899), new $Int64(1662295856, 1005035476), new $Int64(-156574141, 527508597), new $Int64(1288873303, 3066806859), new $Int64(565995893, 3244940914), new $Int64(-889746188, 209092916), new $Int64(-247669406, 1242699167), new $Int64(-713830396, 456723774), new $Int64(1776978905, 1001252870), new $Int64(1468772157, 2026725874), new $Int64(857254202, 2137562569), new $Int64(765939740, 3183366709), new $Int64(1533887628, 2612072960), new $Int64(56977098, 1727148468), new $Int64(-1197583895, 3803658212), new $Int64(1883670356, 479946959), new $Int64(685713571, 1562982345), new $Int64(-1946242443, 1766109365), new $Int64(700596547, 3257093788), new $Int64(-184714929, 2365720207), new $Int64(93384808, 3742754173), new $Int64(-458385235, 2878193673), new $Int64(1096135042, 2174002182), new $Int64(-834260953, 3573511231), new $Int64(-754572527, 1760299077), new $Int64(-1375627191, 2260779833), new $Int64(-866019274, 1452805722), new $Int64(-1229671918, 2940011802), new $Int64(1890251082, 1886183802), new $Int64(893897673, 2514369088), new $Int64(1644345561, 3924317791), new $Int64(-1974867432, 500935732), new $Int64(1403501753, 676580929), new $Int64(-1565912283, 1184984890), new $Int64(-691968413, 1271474274), new $Int64(-1828754738, 3163791473), new $Int64(2051027584, 2842487377), new $Int64(1511537551, 2170968612), new $Int64(573262976, 3535856740), new $Int64(-2053227187, 1488599718), new $Int64(-1180531831, 3408913763), new $Int64(-2086531912, 2501050084), new $Int64(-875130448, 1639124157), new $Int64(-2009482504, 4088176393), new $Int64(1574896563, 3989947576), new $Int64(-165243708, 3414355209), new $Int64(-792329287, 2275136352), new $Int64(-2057774345, 2151835223), new $Int64(-931144933, 1654534827), new $Int64(-679921451, 377892833), new $Int64(-482716010, 660204544), new $Int64(85706799, 390828249), new $Int64(-1422172693, 3402783878), new $Int64(-1468634160, 3717936603), new $Int64(1113532086, 2211058823), new $Int64(1564224320, 2692150867), new $Int64(1952770442, 1928910388), new $Int64(788716862, 3931011137), new $Int64(1083670504, 1112701047), new $Int64(-68150572, 2452299106), new $Int64(-896164822, 2337204777), new $Int64(1774877857, 273889282), new $Int64(1798719843, 1462008793), new $Int64(2138834788, 1554494002), new $Int64(-1194967131, 182675323), new $Int64(-1598554764, 1882802136), new $Int64(589279648, 3700220025), new $Int64(381039426, 3083431543), new $Int64(-851859191, 3622207527), new $Int64(338126939, 432729309), new $Int64(-1667470126, 2391914317), new $Int64(-1849558151, 235747924), new $Int64(2120733629, 3088823825), new $Int64(-745079795, 2314658321), new $Int64(1165929723, 2957634338), new $Int64(501323675, 4117056981), new $Int64(1564699815, 1482500298), new $Int64(-740826490, 840489337), new $Int64(799522364, 3483178565), new $Int64(532129761, 2074004656), new $Int64(724246478, 3643392642), new $Int64(-665153481, 1583624461), new $Int64(-885822954, 287473085), new $Int64(1667835381, 3136843981), new $Int64(1138806821, 1266970974), new $Int64(135185781, 1998688839), new $Int64(392094735, 1492900209), new $Int64(1031326774, 1538112737), new $Int64(-2070568842, 2207265429), new $Int64(-1886797613, 963263315), new $Int64(1671145500, 2295892134), new $Int64(1068469660, 2002560897), new $Int64(-356250305, 1369254035), new $Int64(33436120, 3353312708), new $Int64(57507843, 947771099), new $Int64(-1945755145, 1747061399), new $Int64(1507240140, 2047354631), new $Int64(720000810, 4165367136), new $Int64(479265078, 3388864963), new $Int64(-952181250, 286492130), new $Int64(2045622690, 2795735007), new $Int64(-715730566, 3703961339), new $Int64(-148436487, 1797825479), new $Int64(1429039600, 1116589674), new $Int64(-1665420098, 2593309206), new $Int64(1329049334, 3404995677), new $Int64(-750579440, 3453462936), new $Int64(1014767077, 3016498634), new $Int64(75698599, 1650371545), new $Int64(1592007860, 212344364), new $Int64(1127766888, 3843932156), new $Int64(-748019856, 3573129983), new $Int64(-890581831, 665897820), new $Int64(1071492673, 1675628772), new $Int64(243225682, 2831752928), new $Int64(2120298836, 1486294219), new $Int64(-1954407413, 268782709), new $Int64(-1002123503, 4186179080), new $Int64(624342951, 1613720397), new $Int64(857179861, 2703686015), new $Int64(-911618704, 2205342611), new $Int64(-672703993, 1411666394), new $Int64(-1528454899, 677744900), new $Int64(-1876628533, 4172867247), new $Int64(135494707, 2163418403), new $Int64(849547544, 2841526879), new $Int64(-1117516959, 1082141470), new $Int64(-1770111792, 4046134367), new $Int64(51415528, 2142943655), new $Int64(-249824333, 3124627521), new $Int64(998228909, 219992939), new $Int64(-1078790951, 1756846531), new $Int64(1283749206, 1225118210), new $Int64(-525858006, 1647770243), new $Int64(-2035959705, 444807907), new $Int64(2036369448, 3952076173), new $Int64(53201823, 1461839639), new $Int64(315761893, 3699250910), new $Int64(702974850, 1373688981), new $Int64(734022261, 147523747), new $Int64(-2047330906, 1211276581), new $Int64(1294440951, 2548832680), new $Int64(1144696256, 1995631888), new $Int64(-1992983070, 2011457303), new $Int64(-1351022674, 3057425772), new $Int64(667839456, 81484597), new $Int64(-1681980888, 3646681560), new $Int64(-1372462725, 635548515), new $Int64(602489502, 2508044581), new $Int64(-1794220117, 1014917157), new $Int64(719992433, 3214891315), new $Int64(-1294799037, 959582252), new $Int64(226415134, 3347040449), new $Int64(-362868096, 4102971975), new $Int64(397887437, 4078022210), new $Int64(-536803826, 2851767182), new $Int64(-1398321012, 1540160644), new $Int64(-1549098876, 1057290595), new $Int64(-112592988, 3907769253), new $Int64(579300318, 4248952684), new $Int64(-1054576049, 132554364), new $Int64(-1085862414, 1029351092), new $Int64(697840928, 2583007416), new $Int64(298619124, 1486185789), new $Int64(55905697, 2871589073), new $Int64(2017643612, 723203291), new $Int64(146250550, 2494333952), new $Int64(-1082993397, 2230939180), new $Int64(-1804568072, 3943232912), new $Int64(1768732449, 2181367922), new $Int64(-729261111, 2889274791), new $Int64(1824032949, 2046728161), new $Int64(1653899792, 1376052477), new $Int64(1022327048, 381236993), new $Int64(-1113097690, 3188942166), new $Int64(-74480109, 350070824), new $Int64(144881592, 61758415), new $Int64(-741824226, 3492950336), new $Int64(-2030042720, 3093818430), new $Int64(-453590535, 2962480613), new $Int64(-1912050708, 3154871160), new $Int64(-1636478569, 3228564679), new $Int64(610731502, 888276216), new $Int64(-946702974, 3574998604), new $Int64(-1277068380, 1967526716), new $Int64(-1556147941, 1554691298), new $Int64(-1573024234, 339944798), new $Int64(1223764147, 1154515356), new $Int64(1825645307, 967516237), new $Int64(1546195135, 596588202), new $Int64(-1867600880, 3764362170), new $Int64(-1655392592, 266611402), new $Int64(-393255880, 2047856075), new $Int64(-1000726433, 21444105), new $Int64(-949424754, 3065563181), new $Int64(-232418803, 1140663212), new $Int64(633187674, 2323741028), new $Int64(2126290159, 3103873707), new $Int64(1008658319, 2766828349), new $Int64(-485587503, 1970872996), new $Int64(1628585413, 3766615585), new $Int64(-595148528, 2036813414), new $Int64(-1994877121, 3105536507), new $Int64(13954645, 3396176938), new $Int64(-721402003, 1377154485), new $Int64(-61839181, 3807014186), new $Int64(543009040, 3710110597), new $Int64(-1751425519, 916420443), new $Int64(734556788, 2103831255), new $Int64(-1766161494, 717331943), new $Int64(-1574598896, 3550505941), new $Int64(45939673, 378749927), new $Int64(-1997615719, 611017331), new $Int64(592130075, 758907650), new $Int64(1012992349, 154266815), new $Int64(-1040454942, 1407468696), new $Int64(-1678191250, 970098704), new $Int64(-285057486, 1971660656), new $Int64(998365243, 3332747885), new $Int64(1947089649, 1935189867), new $Int64(1510248801, 203520055), new $Int64(-1305165746, 3916463034), new $Int64(-388598655, 3474113316), new $Int64(1036101639, 316544223), new $Int64(-1773744891, 1650844677), new $Int64(-907191419, 4267565603), new $Int64(-1070275024, 2501167616), new $Int64(-1520651863, 3929401789), new $Int64(-2091360852, 337170252), new $Int64(-960502090, 2061966842), new $Int64(-304190848, 2508461464), new $Int64(-1941471116, 2791377107), new $Int64(1240791848, 1227227588), new $Int64(1813978778, 1709681848), new $Int64(1153692192, 3768820575), new $Int64(-1002297449, 2887126398), new $Int64(-1447111334, 296561685), new $Int64(700300844, 3729960077), new $Int64(-1572311344, 372833036), new $Int64(2078875613, 2409779288), new $Int64(1829161290, 555274064), new $Int64(-1105595719, 4239804901), new $Int64(1839403216, 3723486978), new $Int64(-1649093095, 2145871984), new $Int64(-1582765715, 3565480803), new $Int64(-1568653827, 2197313814), new $Int64(974785092, 3613674566), new $Int64(438638731, 3042093666), new $Int64(-96556264, 3324034321), new $Int64(869420878, 3708873369), new $Int64(946682149, 1698090092), new $Int64(1618900382, 4213940712), new $Int64(-1843479747, 2087477361), new $Int64(-1766167800, 2407950639), new $Int64(-1296225558, 3942568569), new $Int64(-1223900450, 4088074412), new $Int64(723260036, 2964773675), new $Int64(-673921829, 1539178386), new $Int64(1062961552, 2694849566), new $Int64(460977733, 2120273838), new $Int64(-1604570740, 2484608657), new $Int64(880846449, 2956190677), new $Int64(1970902366, 4223313749), new $Int64(662161910, 3502682327), new $Int64(705634754, 4133891139), new $Int64(-1031359300, 1166449596), new $Int64(1038247601, 3362705993), new $Int64(93734798, 3892921029), new $Int64(1876124043, 786869787), new $Int64(1057490746, 1046342263), new $Int64(242763728, 493777327), new $Int64(-853573201, 3304827646), new $Int64(616460742, 125356352), new $Int64(499300063, 74094113), new $Int64(-795586925, 2500816079), new $Int64(-490248444, 514015239), new $Int64(1377565129, 543520454), new $Int64(-2039776725, 3614531153), new $Int64(2056746300, 2356753985), new $Int64(1390062617, 2018141668), new $Int64(131272971, 2087974891), new $Int64(-1502927041, 3166972343), new $Int64(372256200, 1517638666), new $Int64(-935275664, 173466846), new $Int64(-695774461, 4241513471), new $Int64(-1413550842, 2783126920), new $Int64(1972004134, 4167264826), new $Int64(29260506, 3907395640), new $Int64(-910901561, 1539634186), new $Int64(-595957298, 178241987), new $Int64(-113277636, 182168164), new $Int64(-1102530459, 2386154934), new $Int64(1379126408, 4077374341), new $Int64(-2114679722, 1732699140), new $Int64(-421057745, 1041306002), new $Int64(1860414813, 2068001749), new $Int64(1005320202, 3208962910), new $Int64(844054010, 697710380), new $Int64(-1509359403, 2228431183), new $Int64(-810313977, 3554678728), new $Int64(-750989047, 173470263), new $Int64(-85886265, 3848297795), new $Int64(-926936977, 246236185), new $Int64(-1984190461, 2066374846), new $Int64(1771673660, 312890749), new $Int64(703378057, 3573310289), new $Int64(-598851901, 143166754), new $Int64(613554316, 2081511079), new $Int64(1197802104, 486038032), new $Int64(-1906483789, 2982218564), new $Int64(364901986, 1000939191), new $Int64(1902782651, 2750454885), new $Int64(-671844857, 3375313137), new $Int64(-1643868040, 881302957), new $Int64(-1508784745, 2514186393), new $Int64(-1703622845, 360024739), new $Int64(1399671872, 292500025), new $Int64(1381210821, 2276300752), new $Int64(521803381, 4069087683), new $Int64(-1938982667, 1637778212), new $Int64(720490469, 1676670893), new $Int64(1067262482, 3855174429), new $Int64(2114075974, 2067248671), new $Int64(-89426259, 2884561259), new $Int64(-805741095, 2456511185), new $Int64(983726246, 561175414), new $Int64(-1719489563, 432588903), new $Int64(885133709, 4059399550), new $Int64(-93096266, 1075014784), new $Int64(-1733832628, 2728058415), new $Int64(1839142064, 1299703678), new $Int64(1262333188, 2347583393), new $Int64(1285481956, 2468164145), new $Int64(-1158354011, 1140014346), new $Int64(2033889184, 1936972070), new $Int64(-1737578993, 3870530098), new $Int64(-484494257, 1717789158), new $Int64(-232997156, 1153452491), new $Int64(-990424416, 3948827651), new $Int64(-1357145630, 2101413152), new $Int64(1495744672, 3854091229), new $Int64(83644069, 4215565463), new $Int64(-1385277313, 1202710438), new $Int64(-564909037, 2072216740), new $Int64(705690639, 2066751068), new $Int64(-2113583312, 173902580), new $Int64(-741983806, 142459001), new $Int64(172391592, 1889151926), new $Int64(-498943125, 3034199774), new $Int64(1618587731, 516490102), new $Int64(93114264, 3692577783), new $Int64(-2078821353, 2953948865), new $Int64(-320938673, 4041040923), new $Int64(-1942517976, 592046130), new $Int64(-705643640, 384297211), new $Int64(-2051649464, 265863924), new $Int64(2101717619, 1333136237), new $Int64(1499611781, 1406273556), new $Int64(1074670496, 426305476), new $Int64(125704633, 2750898176), new $Int64(488068495, 1633944332), new $Int64(2037723464, 3236349343), new $Int64(-1703423246, 4013676611), new $Int64(1718532237, 2265047407), new $Int64(1433593806, 875071080), new $Int64(-343047503, 1418843655), new $Int64(2009228711, 451657300), new $Int64(1229446621, 1866374663), new $Int64(1653472867, 1551455622), new $Int64(577191481, 3560962459), new $Int64(1669204077, 3347903778), new $Int64(-298327194, 2675874918), new $Int64(-1831355577, 2762991672), new $Int64(530492383, 3689068477), new $Int64(844089962, 4071997905), new $Int64(1508155730, 1381702441), new $Int64(2089931018, 2373284878), new $Int64(-864267462, 2143983064), new $Int64(308739063, 1938207195), new $Int64(1754949306, 1188152253), new $Int64(1272345009, 615870490), new $Int64(742653194, 2662252621), new $Int64(1477718295, 3839976789), new $Int64(-2091334213, 306752547), new $Int64(-1426688067, 2162363077), new $Int64(-57052633, 2767224719), new $Int64(-1471624099, 2628837712), new $Int64(1678405918, 2967771969), new $Int64(1694285728, 499792248), new $Int64(-1744131281, 4285253508), new $Int64(962357072, 2856511070), new $Int64(679471692, 2526409716), new $Int64(-1793706473, 1240875658), new $Int64(-914893422, 2577342868), new $Int64(-1001298215, 4136853496), new $Int64(-1477114974, 2403540137), new $Int64(1372824515, 1371410668), new $Int64(-176562048, 371758825), new $Int64(-441063112, 1528834084), new $Int64(-71688630, 1504757260), new $Int64(-1461820072, 699052551), new $Int64(-505543539, 3347789870), new $Int64(1951619734, 3430604759), new $Int64(2119672219, 1935601723), new $Int64(966789690, 834676166)]);
		globalRand = New(new lockedSource.ptr(new nosync.Mutex.ptr(false), $assertType(NewSource(new $Int64(0, 1)), Source64)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["main"] = (function() {
	var $pkg = {}, $init, js, rand, runtime, Board, ptrType, funcType, mapType, sliceType, sliceType$1, board, playing, main, Play, PlayLoop, Pause, Draw, DrawGrid, ClearTile, FillTile, CreateEmptyBoard, CreateBoard;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	rand = $packages["math/rand"];
	runtime = $packages["runtime"];
	Board = $pkg.Board = $newType(0, $kindStruct, "main.Board", true, "main", true, function(length_, width_, Tiles_, next_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.length = 0;
			this.width = 0;
			this.Tiles = sliceType$1.nil;
			this.next = sliceType$1.nil;
			return;
		}
		this.length = length_;
		this.width = width_;
		this.Tiles = Tiles_;
		this.next = next_;
	});
	ptrType = $ptrType(Board);
	funcType = $funcType([], [], false);
	mapType = $mapType($String, $emptyInterface);
	sliceType = $sliceType($Bool);
	sliceType$1 = $sliceType(sliceType);
	main = function() {
		var density, length, width;
		length = $global.lifeBoardLength;
		width = $global.lifeBoardWidth;
		density = $global.lifeBoardDensity;
		board = CreateBoard($parseInt(length) >> 0, $parseInt(width) >> 0, (function $b(x, y) {
			var _r, x, y, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; x = $f.x; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r = rand.Float64(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r <= $parseFloat(density);
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f._r = _r; $f.x = x; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
		}));
		$global.lifeBoard = $externalize($makeMap($String.keyFor, [{ k: "Tiles", v: board.Tiles }, { k: "Step", v: new funcType($methodVal(board, "Step")) }, { k: "Play", v: new funcType(Play) }, { k: "Pause", v: new funcType(Pause) }, { k: "Draw", v: new funcType(Draw) }, { k: "DrawGrid", v: new funcType(DrawGrid) }, { k: "PlayLoop", v: new funcType(PlayLoop) }]), mapType);
	};
	Play = function() {
		playing = true;
		PlayLoop();
	};
	$pkg.Play = Play;
	PlayLoop = function() {
		if (playing) {
			board.Step();
			$global.setTimeout($externalize(PlayLoop, funcType), 5);
		}
	};
	$pkg.PlayLoop = PlayLoop;
	Pause = function() {
		playing = false;
	};
	$pkg.Pause = Pause;
	Draw = function() {
		var canvas, context, i, j, x, x$1;
		DrawGrid();
		canvas = $global.document.getElementById($externalize("BoardCanvas", $String));
		if (!(canvas === null)) {
			context = canvas.getContext($externalize("2d", $String));
			if (!(context === null)) {
				i = 0;
				while (true) {
					if (!(i < board.GetLength())) { break; }
					j = 0;
					while (true) {
						if (!(j < board.GetWidth())) { break; }
						if ((x = (x$1 = board.Tiles, ((i < 0 || i >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + i])), ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]))) {
							FillTile(i, j);
						} else {
							ClearTile(i, j);
						}
						j = j + (1) >> 0;
					}
					i = i + (1) >> 0;
				}
			}
		}
	};
	$pkg.Draw = Draw;
	DrawGrid = function() {
		var _q, _q$1, canvas, context, x, x$1, xoffset, yoffset;
		canvas = $global.canvas;
		if (!(canvas === null)) {
			context = canvas.getContext($externalize("2d", $String));
			if (!(context === null)) {
				xoffset = (_q = ($parseInt(canvas.width) >> 0) / board.GetWidth(), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
				yoffset = (_q$1 = ($parseInt(canvas.height) >> 0) / board.GetLength(), (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
				x = 0;
				while (true) {
					if (!(x < board.GetWidth())) { break; }
					context.moveTo(0.5 + (($imul(x, xoffset))), 0);
					context.lineTo(0.5 + (($imul(x, xoffset))), $imul(board.GetLength(), yoffset));
					x = x + (1) >> 0;
				}
				x$1 = 0;
				while (true) {
					if (!(x$1 < board.GetLength())) { break; }
					context.moveTo(0, 0.5 + (($imul(x$1, yoffset))));
					context.lineTo($imul(board.GetWidth(), xoffset), 0.5 + (($imul(x$1, yoffset))));
					x$1 = x$1 + (1) >> 0;
				}
				context.strokeStyle = $externalize("black", $String);
				context.stroke();
			}
		}
	};
	$pkg.DrawGrid = DrawGrid;
	ClearTile = function(x, y) {
		var _q, _q$1, canvas, context, x, xoffset, y, yoffset;
		canvas = $global.canvas;
		if (!(canvas === null)) {
			context = canvas.getContext($externalize("2d", $String));
			if (!(context === null)) {
				xoffset = (_q = ($parseInt(canvas.width) >> 0) / board.GetWidth(), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
				yoffset = (_q$1 = ($parseInt(canvas.height) >> 0) / board.GetLength(), (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
				context.fillStyle = $externalize("#ffffff", $String);
				context.fillRect((($imul(x, xoffset))) + 0.5, (($imul(y, yoffset))) + 0.5, xoffset, yoffset);
			}
		}
	};
	$pkg.ClearTile = ClearTile;
	FillTile = function(x, y) {
		var _q, _q$1, canvas, context, x, xoffset, y, yoffset;
		canvas = $global.canvas;
		if (!(canvas === null)) {
			context = canvas.getContext($externalize("2d", $String));
			if (!(context === null)) {
				xoffset = (_q = ($parseInt(canvas.width) >> 0) / board.GetWidth(), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
				yoffset = (_q$1 = ($parseInt(canvas.height) >> 0) / board.GetLength(), (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
				context.fillStyle = $externalize("#000000", $String);
				context.fillRect((($imul(x, xoffset))) + 0.5, (($imul(y, yoffset))) + 0.5, xoffset, yoffset);
			}
		}
	};
	$pkg.FillTile = FillTile;
	Board.ptr.prototype.GetSize = function() {
		var board$1;
		board$1 = this;
		return $imul(board$1.length, board$1.width);
	};
	Board.prototype.GetSize = function() { return this.$val.GetSize(); };
	Board.ptr.prototype.GetLength = function() {
		var board$1;
		board$1 = this;
		return board$1.length;
	};
	Board.prototype.GetLength = function() { return this.$val.GetLength(); };
	Board.ptr.prototype.GetWidth = function() {
		var board$1;
		board$1 = this;
		return board$1.width;
	};
	Board.prototype.GetWidth = function() { return this.$val.GetWidth(); };
	Board.ptr.prototype.Get = function(x, y) {
		var _r, _r$1, board$1, x, x$1, x$2, y;
		board$1 = this;
		x = x + (board$1.length) >> 0;
		x = (_r = x % (board$1.length), _r === _r ? _r : $throwRuntimeError("integer divide by zero"));
		y = y + (board$1.width) >> 0;
		y = (_r$1 = y % (board$1.width), _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero"));
		return (x$1 = (x$2 = board$1.Tiles, ((x < 0 || x >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + x])), ((y < 0 || y >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + y]));
	};
	Board.prototype.Get = function(x, y) { return this.$val.Get(x, y); };
	Board.ptr.prototype.stepTile = function(x, y) {
		var alive, board$1, i, j, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y;
		board$1 = this;
		alive = 0;
		i = -1;
		while (true) {
			if (!(i <= 1)) { break; }
			j = -1;
			while (true) {
				if (!(j <= 1)) { break; }
				if ((!((j === 0)) || !((i === 0))) && board$1.Get(x + i >> 0, y + j >> 0)) {
					alive = alive + (1) >> 0;
				}
				j = j + (1) >> 0;
			}
			i = i + (1) >> 0;
		}
		if ((alive === 3) || ((alive === 2) && (x$1 = (x$2 = board$1.Tiles, ((x < 0 || x >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + x])), ((y < 0 || y >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + y])))) {
			(x$3 = (x$4 = board$1.next, ((x < 0 || x >= x$4.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$4.$array[x$4.$offset + x])), ((y < 0 || y >= x$3.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$3.$array[x$3.$offset + y] = true));
		} else {
			(x$5 = (x$6 = board$1.next, ((x < 0 || x >= x$6.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$6.$array[x$6.$offset + x])), ((y < 0 || y >= x$5.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$5.$array[x$5.$offset + y] = false));
		}
		if ((x$7 = (x$8 = board$1.Tiles, ((x < 0 || x >= x$8.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$8.$array[x$8.$offset + x])), ((y < 0 || y >= x$7.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$7.$array[x$7.$offset + y])) && !(x$9 = (x$10 = board$1.next, ((x < 0 || x >= x$10.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$10.$array[x$10.$offset + x])), ((y < 0 || y >= x$9.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$9.$array[x$9.$offset + y]))) {
			ClearTile(x, y);
		} else if (!(x$11 = (x$12 = board$1.Tiles, ((x < 0 || x >= x$12.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$12.$array[x$12.$offset + x])), ((y < 0 || y >= x$11.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$11.$array[x$11.$offset + y])) && (x$13 = (x$14 = board$1.next, ((x < 0 || x >= x$14.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$14.$array[x$14.$offset + x])), ((y < 0 || y >= x$13.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$13.$array[x$13.$offset + y]))) {
			FillTile(x, y);
		}
		return (x$15 = (x$16 = board$1.next, ((x < 0 || x >= x$16.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$16.$array[x$16.$offset + x])), ((y < 0 || y >= x$15.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$15.$array[x$15.$offset + y]));
	};
	Board.prototype.stepTile = function(x, y) { return this.$val.stepTile(x, y); };
	Board.ptr.prototype.Step = function() {
		var _q, _tmp, _tmp$1, board$1, chunkSize, i, numCPU;
		board$1 = this;
		numCPU = runtime.NumCPU();
		chunkSize = (_q = (((board$1.length + numCPU >> 0) - 1 >> 0)) / numCPU, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		i = 0;
		while (true) {
			if (!(i < board$1.length)) { break; }
			$go((function(x) {
				var j, k, x;
				j = x;
				while (true) {
					if (!(j < (x + chunkSize >> 0))) { break; }
					k = 0;
					while (true) {
						if (!(k < board$1.width)) { break; }
						board$1.stepTile(j, k);
						k = k + (1) >> 0;
					}
					j = j + (1) >> 0;
				}
			}), [i]);
			i = i + (chunkSize) >> 0;
		}
		_tmp = board$1.next;
		_tmp$1 = board$1.Tiles;
		board$1.Tiles = _tmp;
		board$1.next = _tmp$1;
	};
	Board.prototype.Step = function() { return this.$val.Step(); };
	CreateEmptyBoard = function(length, width) {
		var _i, _ref, board$1, i, length, width, x, x$1;
		board$1 = new Board.ptr(length, width, $makeSlice(sliceType$1, length), $makeSlice(sliceType$1, length));
		_ref = board$1.Tiles;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			(x = board$1.Tiles, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i] = $makeSlice(sliceType, width)));
			(x$1 = board$1.next, ((i < 0 || i >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + i] = $makeSlice(sliceType, width)));
			_i++;
		}
		return board$1;
	};
	$pkg.CreateEmptyBoard = CreateEmptyBoard;
	CreateBoard = function(length, width, filler) {
		var _q, board$1, chunkSize, filler, i, length, numCPU, width;
		board$1 = CreateEmptyBoard(length, width);
		numCPU = runtime.NumCPU();
		chunkSize = (_q = (((board$1.length + numCPU >> 0) - 1 >> 0)) / numCPU, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		i = 0;
		while (true) {
			if (!(i < board$1.length)) { break; }
			$go((function $b(x) {
				var _r, j, k, x, x$1, x$2, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; j = $f.j; k = $f.k; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				j = x;
				/* while (true) { */ case 1:
					/* if (!(j < (x + chunkSize >> 0))) { break; } */ if(!(j < (x + chunkSize >> 0))) { $s = 2; continue; }
					k = 0;
					/* while (true) { */ case 3:
						/* if (!(k < board$1.width)) { break; } */ if(!(k < board$1.width)) { $s = 4; continue; }
						_r = filler(i, j); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
						(x$1 = (x$2 = board$1.Tiles, ((j < 0 || j >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + j])), ((k < 0 || k >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + k] = _r));
						k = k + (1) >> 0;
					/* } */ $s = 3; continue; case 4:
					j = j + (1) >> 0;
				/* } */ $s = 1; continue; case 2:
				$s = -1; return;
				/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f._r = _r; $f.j = j; $f.k = k; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
			}), [i]);
			i = i + (chunkSize) >> 0;
		}
		return board$1;
	};
	$pkg.CreateBoard = CreateBoard;
	ptrType.methods = [{prop: "GetSize", name: "GetSize", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "GetLength", name: "GetLength", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "GetWidth", name: "GetWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Get", name: "Get", pkg: "", typ: $funcType([$Int, $Int], [$Bool], false)}, {prop: "stepTile", name: "stepTile", pkg: "main", typ: $funcType([$Int, $Int], [$Bool], false)}, {prop: "Step", name: "Step", pkg: "", typ: $funcType([], [], false)}];
	Board.init("main", [{prop: "length", name: "length", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "width", name: "width", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "Tiles", name: "Tiles", anonymous: false, exported: true, typ: sliceType$1, tag: ""}, {prop: "next", name: "next", anonymous: false, exported: false, typ: sliceType$1, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = rand.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		board = ptrType.nil;
		playing = false;
		if ($pkg === $mainPkg) {
			main();
			$mainFinished = true;
		}
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["main"];
$packages["runtime"].$init();
$go($mainPkg.$init, []);
$flushConsole();

}).call(this);
//# sourceMappingURL=life.js.map
