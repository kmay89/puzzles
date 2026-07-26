/* nbt-write.js — dev-only. An NBT *encoder*, written from the format
   description and deliberately sharing no code with `nbt.js`.

   It exists so the reader can be checked against something that is not
   itself. A parser tested against its own serialiser proves only that
   two halves of the same misunderstanding agree; two implementations
   written separately from the spec agreeing is evidence.

   Used by `nbt-check.js` and `anvil-check.js`. Never shipped.        */
"use strict";

function Writer() { this.parts = []; }
Writer.prototype.push = function (b) { this.parts.push(b); };
Writer.prototype.u8 = function (v) { this.push(Buffer.from([v & 0xff])); };
Writer.prototype.i16 = function (v) { var b = Buffer.alloc(2); b.writeInt16BE(v, 0); this.push(b); };
Writer.prototype.i32 = function (v) { var b = Buffer.alloc(4); b.writeInt32BE(v, 0); this.push(b); };
Writer.prototype.i64 = function (v) { var b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v), 0); this.push(b); };
Writer.prototype.f32 = function (v) { var b = Buffer.alloc(4); b.writeFloatBE(v, 0); this.push(b); };
Writer.prototype.f64 = function (v) { var b = Buffer.alloc(8); b.writeDoubleBE(v, 0); this.push(b); };
Writer.prototype.str = function (s) {
  var b = Buffer.from(String(s), "utf8");
  this.i16(b.length);
  this.push(b);
};
Writer.prototype.out = function () { return Buffer.concat(this.parts); };

function writePayload(w, type, v) {
  var i;
  switch (type) {
    case 1: w.u8(v < 0 ? v + 256 : v); break;
    case 2: w.i16(v); break;
    case 3: w.i32(v); break;
    case 4: w.i64(v); break;
    case 5: w.f32(v); break;
    case 6: w.f64(v); break;
    case 8: w.str(v); break;
    case 7: w.i32(v.length); for (i = 0; i < v.length; i++) w.u8(v[i] < 0 ? v[i] + 256 : v[i]); break;
    case 11: w.i32(v.length); for (i = 0; i < v.length; i++) w.i32(v[i]); break;
    case 12: w.i32(v.length); for (i = 0; i < v.length; i++) w.i64(v[i]); break;
    case 9:
      w.u8(v.itemType); w.i32(v.items.length);
      for (i = 0; i < v.items.length; i++) writePayload(w, v.itemType, v.items[i]);
      break;
    case 10:
      for (i = 0; i < v.length; i++) writeTag(w, v[i][0], v[i][1], v[i][2]);
      w.u8(0);
      break;
    default: throw new Error("nbt-write: unknown type " + type);
  }
}
function writeTag(w, type, name, value) {
  w.u8(type);
  w.str(name);
  writePayload(w, type, value);
}
/* a whole document: one tagged value, usually a compound */
function doc(type, name, value) {
  var w = new Writer();
  writeTag(w, type, name, value);
  return new Uint8Array(w.out());
}

module.exports = { Writer: Writer, writeTag: writeTag, writePayload: writePayload, doc: doc };
