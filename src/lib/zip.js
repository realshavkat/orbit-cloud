// Minimal .zip reader for mod uploads: stored and deflated entries only, with
// hard limits on entry count and unpacked size (no zip bombs).
import { inflateRawSync } from "node:zlib";
import { bad } from "./validate.js";

export function readZip(buf, { maxEntries = 40, maxTotal = 2 * 1024 * 1024 } = {}) {
  // End of central directory: last 22 bytes, or earlier when there is a comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) == 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad("zip_invalid");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > maxEntries) throw bad("zip_too_many_files");
  const out = {};
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) != 0x02014b50) throw bad("zip_invalid");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw bad("zip_encrypted");
    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) throw bad("zip_invalid");
    total += size;
    if (total > maxTotal) throw bad("file_too_big");
    if (local + 30 > buf.length || buf.readUInt32LE(local) != 0x04034b50) throw bad("zip_invalid");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method == 0) data = Buffer.from(raw);
    else if (method == 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: size + 1 });
      } catch {
        throw bad("zip_invalid");
      }
    } else throw bad("zip_unsupported");
    if (data.length != size) throw bad("zip_invalid");
    out[name] = data;
  }
  return out;
}
