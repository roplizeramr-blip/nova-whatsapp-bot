/**
 * Audio Resampling and Conversion Utilities
 * Handles conversions between:
 * - 16kHz Float32Array (WhatsApp VoIP format)
 * - 16kHz 16-bit signed PCM (Gemini Live input format)
 * - 24kHz 16-bit signed PCM (Gemini Live output format)
 */

/**
 * Converts Float32Array [-1.0, 1.0] (16kHz) to 16-bit signed PCM Buffer (16kHz)
 * @param {Float32Array} float32
 * @returns {Buffer}
 */
export function float32ToInt16Buffer(float32) {
  const buf = Buffer.allocUnsafe(float32.length * 2);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1.0, Math.min(1.0, float32[i]));
    const val = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    buf.writeInt16LE(val, i * 2);
  }
  return buf;
}

/**
 * Converts 16-bit signed PCM Buffer to Float32Array [-1.0, 1.0]
 * @param {Buffer} buffer
 * @returns {Float32Array}
 */
export function int16BufferToFloat32(buffer) {
  const numSamples = Math.floor(buffer.length / 2);
  const out = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const val = buffer.readInt16LE(i * 2);
    out[i] = val < 0 ? val / 0x8000 : val / 0x7fff;
  }
  return out;
}

/**
 * Resamples 24kHz 16-bit Int16 PCM Buffer directly to 16kHz Float32Array [-1.0, 1.0]
 * Uses linear interpolation for clean, fast audio playback in WhatsApp VoIP
 * Ratio: 16000 / 24000 = 2 / 3
 * @param {Buffer} pcm24k
 * @returns {Float32Array}
 */
export function resample24kBufferTo16kFloat32(pcm24k) {
  const num24kSamples = Math.floor(pcm24k.length / 2);
  if (num24kSamples === 0) return new Float32Array(0);

  const num16kSamples = Math.floor((num24kSamples * 2) / 3);
  const out = new Float32Array(num16kSamples);

  for (let j = 0; j < num16kSamples; j++) {
    const pos = (j * 3) / 2; // Position in 24k stream
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, num24kSamples - 1);
    const frac = pos - i0;

    const s0Raw = pcm24k.readInt16LE(i0 * 2);
    const s1Raw = pcm24k.readInt16LE(i1 * 2);

    const s0 = s0Raw < 0 ? s0Raw / 0x8000 : s0Raw / 0x7fff;
    const s1 = s1Raw < 0 ? s1Raw / 0x8000 : s1Raw / 0x7fff;

    out[j] = (1 - frac) * s0 + frac * s1;
  }

  return out;
}

/**
 * Resamples 16kHz Int16 Buffer to 24kHz Int16 Buffer
 * Ratio: 24000 / 16000 = 3 / 2
 * @param {Buffer} pcm16k
 * @returns {Buffer}
 */
export function resample16kToInt16Buffer24k(pcm16k) {
  const num16k = Math.floor(pcm16k.length / 2);
  if (num16k === 0) return Buffer.alloc(0);

  const num24k = Math.floor((num16k * 3) / 2);
  const out = Buffer.allocUnsafe(num24k * 2);

  for (let j = 0; j < num24k; j++) {
    const pos = (j * 2) / 3;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, num16k - 1);
    const frac = pos - i0;

    const s0 = pcm16k.readInt16LE(i0 * 2);
    const s1 = pcm16k.readInt16LE(i1 * 2);
    const val = Math.round((1 - frac) * s0 + frac * s1);

    out.writeInt16LE(Math.max(-32768, Math.min(32767, val)), j * 2);
  }

  return out;
}

export default {
  float32ToInt16Buffer,
  int16BufferToFloat32,
  resample24kBufferTo16kFloat32,
  resample16kToInt16Buffer24k,
};
