import WebSocket from 'ws';
import EventEmitter from 'node:events';
import { config } from '../config.js';
import resampler from './audio-resampler.js';

/**
 * GeminiLiveSession manages real-time bidirectional streaming with Gemini 3.8 Live API
 * over WebSockets (PCM Audio In <-> PCM Audio Out).
 */
export class GeminiLiveSession extends EventEmitter {
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || config.geminiApiKey || 'AIzaSyAxwTASMEQqhGZk7By8s6xPGu7Jq8lMPos';
    this.model = options.model || config.geminiLiveModel || 'gemini-3.8-live-extended-thinking';
    this.voiceName = options.voiceName || 'Puck'; // Puck, Kore, Fenrir, Aoede
    this.systemInstruction = options.systemInstruction || 
      'أنت أسترو (Astro)، بوت واتساب ذكي وخفيف الظل. أنت تجري مكالمة صوتية هاتفية حية ومباشرة مع المستخدم الآن. تحدث باللهجة المصرية العامية الطبيعية والودودة. كلامك مختصر ومباشر وسريع كأنك تتكلم في مكالمة هاتفية حقيقية، بدون إطالة أو قراءة نصوص طويلة. رحب بالمستخدم عندما يبدأ الكلام وتجاوب معه كصديق.';
    this.ws = null;
    this.connected = false;
    this.ready = false;
  }

  /**
   * Establishes WebSocket connection and sends the setup payload
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        if (!this.ready) {
          try { this.ws.close(); } catch (_) {}
          reject(new Error('Gemini Live WebSocket setup timed out (10s)'));
        }
      }, 10000);

      this.ws.on('open', () => {
        this.connected = true;
        const setupMsg = {
          setup: {
            model: `models/${this.model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: this.voiceName
                  }
                }
              },
              thinkingConfig: {
                thinkingLevel: 'LOW'
              }
            },
            systemInstruction: {
              parts: [{ text: this.systemInstruction }]
            }
          }
        };
        this.ws.send(JSON.stringify(setupMsg));
      });

      this.ws.on('message', (data) => {
        try {
          const resp = JSON.parse(data.toString());
          if (resp.setupComplete) {
            clearTimeout(timeout);
            this.ready = true;
            this.emit('ready');
            resolve();
            return;
          }

          if (resp.serverContent) {
            const parts = resp.serverContent.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/pcm')) {
                const rawPcm24k = Buffer.from(part.inlineData.data, 'base64');
                // Emit raw 24kHz Int16 buffer
                this.emit('audio24k', rawPcm24k);
                // Also resample to 16kHz Float32Array for WhatsApp VoIP
                const f32_16k = resampler.resample24kBufferTo16kFloat32(rawPcm24k);
                this.emit('audio16kFloat32', f32_16k);
              }
              if (part.text) {
                this.emit('text', part.text);
              }
            }

            if (resp.serverContent.turnComplete) {
              this.emit('turnComplete');
            }
            if (resp.serverContent.interrupted) {
              this.emit('interrupted');
            }
          }
        } catch (err) {
          this.emit('error', err);
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        this.emit('error', err);
        if (!this.ready) reject(err);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        this.connected = false;
        this.ready = false;
        this.emit('close', { code, reason: reason?.toString() });
      });
    });
  }

  /**
   * Stream user audio to Gemini Live
   * Accepts either Float32Array (16kHz) from WhatsApp VoIP or Buffer (16kHz Int16)
   */
  sendAudio(audioInput) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    let pcm16kBuffer;
    if (audioInput instanceof Float32Array) {
      pcm16kBuffer = resampler.float32ToInt16Buffer(audioInput);
    } else if (Buffer.isBuffer(audioInput)) {
      pcm16kBuffer = audioInput;
    } else {
      return false;
    }

    const msg = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: pcm16kBuffer.toString('base64')
          }
        ]
      }
    };
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /**
   * Send text into the live conversation
   */
  sendText(text, endOfTurn = true) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const msg = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }]
          }
        ],
        turnComplete: endOfTurn
      }
    };
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /**
   * Cleanly close the live session
   */
  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
    this.connected = false;
    this.ready = false;
  }
}

export default GeminiLiveSession;
