// Minimal MessagePack encoder for Fish's binary reference audio.
export function encode(value) {
  if (value === null) return Buffer.from([0xc0]);
  if (value === true || value === false) return Buffer.from([value ? 0xc3 : 0xc2]);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const b = Buffer.from(value); const h = Buffer.alloc(b.length <= 255 ? 2 : b.length <= 65535 ? 3 : 5);
    h[0] = h.length === 2 ? 0xc4 : h.length === 3 ? 0xc5 : 0xc6;
    if (h.length === 2) h.writeUInt8(b.length, 1); else if (h.length === 3) h.writeUInt16BE(b.length, 1); else h.writeUInt32BE(b.length, 1);
    return Buffer.concat([h, b]);
  }
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8'); let h;
    if (b.length < 32) h = Buffer.from([0xa0 | b.length]);
    else if (b.length < 256) h = Buffer.from([0xd9, b.length]);
    else { h = Buffer.alloc(b.length < 65536 ? 3 : 5); h[0] = h.length === 3 ? 0xda : 0xdb; h.length === 3 ? h.writeUInt16BE(b.length, 1) : h.writeUInt32BE(b.length, 1); }
    return Buffer.concat([h, b]);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 0 && value <= 127) return Buffer.from([value]);
    const b = Buffer.alloc(9); b[0] = 0xcb; b.writeDoubleBE(value, 1); return b;
  }
  if (Array.isArray(value)) {
    const h = value.length < 16 ? Buffer.from([0x90 | value.length]) : Buffer.from([0xdc, value.length >> 8, value.length & 255]);
    return Buffer.concat([h, ...value.map(encode)]);
  }
  if (typeof value === 'object' && value) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    const h = entries.length < 16 ? Buffer.from([0x80 | entries.length]) : Buffer.from([0xde, entries.length >> 8, entries.length & 255]);
    return Buffer.concat([h, ...entries.flatMap(([k, v]) => [encode(k), encode(v)])]);
  }
  throw new TypeError('Unsupported MessagePack value');
}