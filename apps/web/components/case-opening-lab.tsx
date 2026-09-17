"use client";

import Link from "next/link";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { RotateCcw, Sparkles, Volume2, VolumeX } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Rarity = "mil-spec" | "restricted" | "classified" | "covert" | "extraordinary";
type ValueTier = "field" | "premium" | "elite" | "jackpot";

type SkinItem = {
  id: string;
  weapon: string;
  name: string;
  rarity: Rarity;
  wear: string;
  value: number;
  stattrak?: boolean;
};

type Particle = {
  id: string;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  delay: number;
  duration: number;
};

const RARITY_ORDER: Rarity[] = ["mil-spec", "restricted", "classified", "covert", "extraordinary"];
const REEL_LENGTH = 56;
const WINNING_SLOT = 43;
const CARD_WIDTH = 176;
const CARD_GAP = 12;
const SLOT_SIZE = CARD_WIDTH + CARD_GAP;
const SPIN_TRAVEL_BASE_SECONDS = 5.2;
const SPIN_TRAVEL_VARIANCE_SECONDS = 1.35;
const SPIN_OVERSHOOT_SLOTS = 0.22;
const SPIN_OVERSHOOT_VARIANCE = 0.1;

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const RARITY_CONFIG: Record<
  Rarity,
  {
    label: string;
    chance: number;
    gradient: string;
    aura: string;
    text: string;
    border: string;
  }
> = {
  "mil-spec": {
    label: "Mil-Spec",
    chance: 54,
    gradient: "from-sky-500/35 via-blue-300/20 to-cyan-400/35",
    aura: "from-sky-500/25 via-transparent to-cyan-300/20",
    text: "text-sky-300",
    border: "border-sky-400/35"
  },
  restricted: {
    label: "Restricted",
    chance: 24,
    gradient: "from-indigo-500/35 via-violet-400/20 to-fuchsia-400/30",
    aura: "from-indigo-500/25 via-transparent to-fuchsia-400/20",
    text: "text-violet-300",
    border: "border-violet-400/35"
  },
  classified: {
    label: "Classified",
    chance: 12,
    gradient: "from-pink-500/35 via-rose-400/20 to-red-400/30",
    aura: "from-pink-500/30 via-transparent to-rose-400/25",
    text: "text-rose-300",
    border: "border-rose-400/40"
  },
  covert: {
    label: "Covert",
    chance: 7,
    gradient: "from-red-500/45 via-orange-300/30 to-rose-500/45",
    aura: "from-red-500/35 via-transparent to-orange-300/25",
    text: "text-orange-200",
    border: "border-orange-300/45"
  },
  extraordinary: {
    label: "Extraordinary",
    chance: 3,
    gradient: "from-amber-300/50 via-yellow-100/35 to-orange-300/55",
    aura: "from-amber-300/45 via-transparent to-yellow-100/35",
    text: "text-amber-100",
    border: "border-amber-200/55"
  }
};

const VALUE_EFFECTS: Record<
  ValueTier,
  {
    label: string;
    overlay: string;
    glow: string;
    particleCount: number;
  }
> = {
  field: {
    label: "Field Drop",
    overlay: "from-sky-500/20 via-transparent to-cyan-300/15",
    glow: "shadow-[0_0_80px_rgba(56,189,248,0.18)]",
    particleCount: 14
  },
  premium: {
    label: "Premium Pull",
    overlay: "from-violet-500/25 via-transparent to-fuchsia-400/18",
    glow: "shadow-[0_0_110px_rgba(168,85,247,0.24)]",
    particleCount: 20
  },
  elite: {
    label: "Elite Hit",
    overlay: "from-rose-500/25 via-transparent to-orange-300/18",
    glow: "shadow-[0_0_140px_rgba(251,113,133,0.28)]",
    particleCount: 28
  },
  jackpot: {
    label: "Jackpot",
    overlay: "from-amber-300/35 via-transparent to-yellow-100/30",
    glow: "shadow-[0_0_180px_rgba(251,191,36,0.35)]",
    particleCount: 40
  }
};

const SKINS: SkinItem[] = [
  { id: "ak-slate", weapon: "AK-47", name: "Slate", rarity: "mil-spec", wear: "Minimal Wear", value: 7.9 },
  { id: "m4a1-night-terror", weapon: "M4A1-S", name: "Night Terror", rarity: "mil-spec", wear: "Field-Tested", value: 6.4 },
  { id: "usp-ticket", weapon: "USP-S", name: "Ticket to Hell", rarity: "mil-spec", wear: "Factory New", value: 4.8 },
  { id: "galil-rocket-pop", weapon: "Galil AR", name: "Rocket Pop", rarity: "mil-spec", wear: "Minimal Wear", value: 5.1 },
  { id: "mp9-food-chain", weapon: "MP9", name: "Food Chain", rarity: "mil-spec", wear: "Field-Tested", value: 9.7 },
  { id: "famas-zx", weapon: "FAMAS", name: "ZX Spectron", rarity: "mil-spec", wear: "Factory New", value: 8.2 },

  { id: "glock-vogue", weapon: "Glock-18", name: "Vogue", rarity: "restricted", wear: "Minimal Wear", value: 21.4 },
  { id: "usp-cortex", weapon: "USP-S", name: "Cortex", rarity: "restricted", wear: "Factory New", value: 26.9 },
  { id: "deagle-ocean-drive", weapon: "Desert Eagle", name: "Ocean Drive", rarity: "restricted", wear: "Field-Tested", value: 37.6 },
  { id: "mac10-neon-rider", weapon: "MAC-10", name: "Neon Rider", rarity: "restricted", wear: "Minimal Wear", value: 18.5 },
  { id: "awp-chromatic", weapon: "AWP", name: "Chromatic Aberration", rarity: "restricted", wear: "Field-Tested", value: 43.2 },
  { id: "mp7-abyssal", weapon: "MP7", name: "Abyssal Apparition", rarity: "restricted", wear: "Factory New", value: 22.3 },

  { id: "ak-leet-museo", weapon: "AK-47", name: "Leet Museo", rarity: "classified", wear: "Field-Tested", value: 92.4 },
  { id: "m4a4-temukau", weapon: "M4A4", name: "Temukau", rarity: "classified", wear: "Minimal Wear", value: 114.8 },
  { id: "awp-wildfire", weapon: "AWP", name: "Wildfire", rarity: "classified", wear: "Factory New", value: 121.6 },
  { id: "p250-see-ya", weapon: "P250", name: "See Ya Later", rarity: "classified", wear: "Field-Tested", value: 85.9 },
  { id: "five-seven-angry", weapon: "Five-SeveN", name: "Angry Mob", rarity: "classified", wear: "Minimal Wear", value: 96.2 },
  { id: "ssg-dragonfire", weapon: "SSG 08", name: "Dragonfire", rarity: "classified", wear: "Factory New", value: 134.1 },

  { id: "deagle-printstream", weapon: "Desert Eagle", name: "Printstream", rarity: "covert", wear: "Field-Tested", value: 167.4 },
  { id: "ak-neon-rider", weapon: "AK-47", name: "Neon Rider", rarity: "covert", wear: "Minimal Wear", value: 174.5 },
  { id: "m4a1-printstream", weapon: "M4A1-S", name: "Printstream", rarity: "covert", wear: "Minimal Wear", value: 219.8 },
  { id: "awp-asiimov", weapon: "AWP", name: "Asiimov", rarity: "covert", wear: "Field-Tested", value: 241.3 },
  { id: "usps-kill-confirmed", weapon: "USP-S", name: "Kill Confirmed", rarity: "covert", wear: "Minimal Wear", value: 303.9 },
  { id: "st-ak-bloodsport", weapon: "AK-47", name: "Bloodsport", rarity: "covert", wear: "Factory New", value: 356.2, stattrak: true },

  { id: "knife-ursus-slaughter", weapon: "Ursus Knife", name: "Slaughter", rarity: "extraordinary", wear: "Minimal Wear", value: 734.5 },
  { id: "knife-talons-doppler", weapon: "Talon Knife", name: "Doppler", rarity: "extraordinary", wear: "Factory New", value: 1062.7 },
  { id: "gloves-amphibious", weapon: "Sport Gloves", name: "Amphibious", rarity: "extraordinary", wear: "Field-Tested", value: 1298.4 },
  { id: "knife-butterfly-fade", weapon: "Butterfly Knife", name: "Fade", rarity: "extraordinary", wear: "Factory New", value: 2384.9 },
  { id: "knife-karambit-gamma", weapon: "Karambit", name: "Gamma Doppler", rarity: "extraordinary", wear: "Factory New", value: 2671.6 }
];

const SKINS_BY_RARITY: Record<Rarity, SkinItem[]> = {
  "mil-spec": [],
  restricted: [],
  classified: [],
  covert: [],
  extraordinary: []
};

for (const skin of SKINS) {
  SKINS_BY_RARITY[skin.rarity].push(skin);
}

function formatUsd(value: number): string {
  return CURRENCY_FORMATTER.format(value);
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function pickRandom<T>(items: readonly T[]): T {
  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? items[0];
}

function pickRarityByChance(): Rarity {
  const roll = Math.random() * 100;
  let cursor = 0;
  for (const rarity of RARITY_ORDER) {
    cursor += RARITY_CONFIG[rarity].chance;
    if (roll <= cursor) return rarity;
  }
  return "mil-spec";
}

function pickSkin(rarity?: Rarity): SkinItem {
  const nextRarity = rarity ?? pickRarityByChance();
  const pool = SKINS_BY_RARITY[nextRarity];
  return pickRandom(pool);
}

function buildReel(winner: SkinItem): SkinItem[] {
  const reel = Array.from({ length: REEL_LENGTH }, () => pickSkin());
  reel[WINNING_SLOT] = winner;
  reel[WINNING_SLOT - 1] = pickSkin();
  reel[WINNING_SLOT + 1] = pickSkin();
  return reel;
}

function getValueTier(value: number): ValueTier {
  if (value >= 900) return "jackpot";
  if (value >= 220) return "elite";
  if (value >= 70) return "premium";
  return "field";
}

type SpinAudioOptions = { durationMs: number; slotCount: number };
type TickAudioOptions = { progress: number; offsetSeconds?: number };

type ScheduledSource = AudioBufferSourceNode | OscillatorNode;
type ManagedVoice = { source: ScheduledSource; nodes: AudioNode[] };
type WinSampleId = "whoosh" | "levelup" | "cash";

const WIN_SAMPLE_FILES: Record<WinSampleId, string> = {
  whoosh: "/audio/case/win-whoosh.mp3",
  levelup: "/audio/case/win-levelup.mp3",
  cash: "/audio/case/win-cash.mp3"
};

type AudioEngine = {
  context: AudioContext;
  master: GainNode;
  mixBus: GainNode;
  bedBus: GainNode;
  tickBus: GainNode;
  accentBus: GainNode;
  toneFilter: BiquadFilterNode;
  glueCompressor: DynamicsCompressorNode;
  softClipper: WaveShaperNode;
  limiter: DynamicsCompressorNode;
  noiseBuffer: AudioBuffer;
  ratchetBuffer: AudioBuffer;
  clackBuffer: AudioBuffer;
  activeVoices: Set<ManagedVoice>;
  winSamples: Partial<Record<WinSampleId, AudioBuffer>>;
  winSamplesPromise: Promise<void> | null;
  targetGain: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeDisconnect(node: AudioNode) {
  try {
    node.disconnect();
  } catch {
    // no-op
  }
}

function safeStop(source: ScheduledSource) {
  try {
    source.stop();
  } catch {
    // no-op
  }
}

function registerVoice(engine: AudioEngine, source: ScheduledSource, nodes: AudioNode[]) {
  const voice: ManagedVoice = { source, nodes };
  engine.activeVoices.add(voice);
  source.addEventListener(
    "ended",
    () => {
      engine.activeVoices.delete(voice);
      for (const node of nodes) {
        safeDisconnect(node);
      }
    },
    { once: true }
  );
}

function createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createRatchetBuffer(context: AudioContext): AudioBuffer {
  const duration = 0.05;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / context.sampleRate;
    const envelope = Math.exp(-t * 92);
    const noise = (Math.random() * 2 - 1) * 0.78;
    const ring = Math.sin(2 * Math.PI * (2100 - 520 * t) * t) * 0.24;
    const body = Math.sin(2 * Math.PI * 910 * t) * 0.16;
    data[i] = (noise * 0.72 + ring + body) * envelope;
  }
  return buffer;
}

function createClackBuffer(context: AudioContext): AudioBuffer {
  const duration = 0.09;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / context.sampleRate;
    const transient = (Math.random() * 2 - 1) * 0.62 * Math.exp(-t * 140);
    const metal = Math.sin(2 * Math.PI * (1560 - 680 * t) * t) * 0.3 * Math.exp(-t * 65);
    const body = Math.sin(2 * Math.PI * (180 - 42 * t) * t) * 0.34 * Math.exp(-t * 24);
    data[i] = transient + metal + body;
  }
  return buffer;
}

function createSoftClipCurve(amount: number, size: number): Float32Array {
  const curve = new Float32Array(size);
  const k = Math.max(1.1, amount);
  const norm = Math.tanh(k);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

function createAudioEngine(): AudioEngine | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor({ latencyHint: "interactive" });

  const master = context.createGain();
  master.gain.value = 0;

  const mixBus = context.createGain();
  mixBus.gain.value = 1;

  const bedBus = context.createGain();
  bedBus.gain.value = 1;

  const tickBus = context.createGain();
  tickBus.gain.value = 1;

  const accentBus = context.createGain();
  accentBus.gain.value = 1;

  const toneFilter = context.createBiquadFilter();
  toneFilter.type = "lowpass";
  toneFilter.frequency.value = 12000;
  toneFilter.Q.value = 0.35;

  const glueCompressor = context.createDynamicsCompressor();
  glueCompressor.threshold.value = -20;
  glueCompressor.knee.value = 18;
  glueCompressor.ratio.value = 2.4;
  glueCompressor.attack.value = 0.004;
  glueCompressor.release.value = 0.14;

  const softClipper = context.createWaveShaper();
  softClipper.curve = createSoftClipCurve(2.25, 2048) as unknown as Float32Array<ArrayBuffer>;
  softClipper.oversample = "4x";

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.07;

  bedBus.connect(mixBus);
  tickBus.connect(mixBus);
  accentBus.connect(mixBus);
  mixBus.connect(toneFilter);
  toneFilter.connect(glueCompressor);
  glueCompressor.connect(softClipper);
  softClipper.connect(limiter);
  limiter.connect(master);
  master.connect(context.destination);

  return {
    context,
    master,
    mixBus,
    bedBus,
    tickBus,
    accentBus,
    toneFilter,
    glueCompressor,
    softClipper,
    limiter,
    noiseBuffer: createNoiseBuffer(context, 4),
    ratchetBuffer: createRatchetBuffer(context),
    clackBuffer: createClackBuffer(context),
    activeVoices: new Set(),
    winSamples: {},
    winSamplesPromise: null,
    targetGain: 0.56
  };
}

function cancelEngineAutomation(engine: AudioEngine) {
  const now = engine.context.currentTime;
  engine.master.gain.cancelScheduledValues(now);
  engine.mixBus.gain.cancelScheduledValues(now);
  engine.bedBus.gain.cancelScheduledValues(now);
  engine.tickBus.gain.cancelScheduledValues(now);
  engine.accentBus.gain.cancelScheduledValues(now);
  engine.toneFilter.frequency.cancelScheduledValues(now);
}

function stopAllAudio(engine: AudioEngine) {
  cancelEngineAutomation(engine);
  for (const voice of Array.from(engine.activeVoices)) {
    safeStop(voice.source);
    for (const node of voice.nodes) {
      safeDisconnect(node);
    }
  }
  engine.activeVoices.clear();
}

function rampMasterGain(engine: AudioEngine, target: number, rampSeconds = 0.06) {
  const now = engine.context.currentTime;
  engine.master.gain.cancelScheduledValues(now);
  engine.master.gain.setValueAtTime(engine.master.gain.value, now);
  engine.master.gain.linearRampToValueAtTime(clamp(target, 0, 1), now + rampSeconds);
}

async function loadSampleBuffer(context: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load audio sample: ${url}`);
  }
  const bytes = await response.arrayBuffer();
  return context.decodeAudioData(bytes.slice(0));
}

async function ensureWinSamplesLoaded(engine: AudioEngine): Promise<void> {
  if (engine.winSamplesPromise) {
    await engine.winSamplesPromise;
    return;
  }

  engine.winSamplesPromise = (async () => {
    const entries = Object.entries(WIN_SAMPLE_FILES) as Array<[WinSampleId, string]>;
    await Promise.all(
      entries.map(async ([sampleId, file]) => {
        if (engine.winSamples[sampleId]) return;
        try {
          engine.winSamples[sampleId] = await loadSampleBuffer(engine.context, file);
        } catch {
          // keep going; missing sample shouldn't break reveal logic
        }
      })
    );
  })();

  await engine.winSamplesPromise;
}

function scheduleSpinBed(engine: AudioEngine, options: { when: number; duration: number; peakGain: number }) {
  const source = engine.context.createBufferSource();
  source.buffer = engine.noiseBuffer;
  source.loop = true;

  const highpass = engine.context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(170, options.when);
  highpass.frequency.exponentialRampToValueAtTime(95, options.when + options.duration);

  const lowpass = engine.context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(4200, options.when);
  lowpass.frequency.exponentialRampToValueAtTime(820, options.when + options.duration);

  const band = engine.context.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.55;
  band.frequency.setValueAtTime(1480, options.when);
  band.frequency.exponentialRampToValueAtTime(560, options.when + options.duration);

  const gain = engine.context.createGain();
  gain.gain.setValueAtTime(0.0001, options.when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.peakGain), options.when + Math.min(0.2, options.duration * 0.1));
  gain.gain.exponentialRampToValueAtTime(0.0001, options.when + options.duration);

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(band);
  band.connect(gain);
  gain.connect(engine.bedBus);
  source.start(options.when);
  source.stop(options.when + options.duration + 0.02);
  registerVoice(engine, source, [source, highpass, lowpass, band, gain]);
}

function scheduleRatchetTick(engine: AudioEngine, options: { when: number; progress: number }) {
  const source = engine.context.createBufferSource();
  source.buffer = engine.ratchetBuffer;
  source.playbackRate.value = clamp(1.16 - options.progress * 0.38 + Math.sin(options.progress * 12) * 0.015, 0.72, 1.26);

  const highpass = engine.context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 620;

  const lowpass = engine.context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 4200 - options.progress * 2200;
  lowpass.Q.value = 0.4;

  const gain = engine.context.createGain();
  gain.gain.setValueAtTime(0.0001, options.when);
  gain.gain.exponentialRampToValueAtTime(clamp(0.065 - options.progress * 0.018, 0.034, 0.072), options.when + 0.0016);
  gain.gain.exponentialRampToValueAtTime(0.0001, options.when + 0.042);

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(engine.tickBus);
  source.start(options.when);
  source.stop(options.when + 0.055);
  registerVoice(engine, source, [source, highpass, lowpass, gain]);
}

function scheduleStopImpact(engine: AudioEngine, when: number) {
  const clack = engine.context.createBufferSource();
  clack.buffer = engine.clackBuffer;
  clack.playbackRate.value = 0.95;

  const clackHighpass = engine.context.createBiquadFilter();
  clackHighpass.type = "highpass";
  clackHighpass.frequency.value = 120;

  const clackLowpass = engine.context.createBiquadFilter();
  clackLowpass.type = "lowpass";
  clackLowpass.frequency.value = 2600;

  const clackGain = engine.context.createGain();
  clackGain.gain.setValueAtTime(0.0001, when);
  clackGain.gain.exponentialRampToValueAtTime(0.082, when + 0.0025);
  clackGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);

  clack.connect(clackHighpass);
  clackHighpass.connect(clackLowpass);
  clackLowpass.connect(clackGain);
  clackGain.connect(engine.accentBus);
  clack.start(when);
  clack.stop(when + 0.1);
  registerVoice(engine, clack, [clack, clackHighpass, clackLowpass, clackGain]);

  const oscillator = engine.context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(82, when);
  oscillator.frequency.exponentialRampToValueAtTime(44, when + 0.12);

  const filter = engine.context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 165;
  filter.Q.value = 0.9;

  const gain = engine.context.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.052, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(engine.accentBus);
  oscillator.start(when);
  oscillator.stop(when + 0.13);
  registerVoice(engine, oscillator, [oscillator, filter, gain]);
}

function scheduleWinSample(
  engine: AudioEngine,
  options: {
    sampleId: WinSampleId;
    when: number;
    gain: number;
    rate?: number;
    highpassHz?: number;
    lowpassHz?: number;
    bandpassHz?: number;
    bandpassQ?: number;
  }
) {
  const buffer = engine.winSamples[options.sampleId];
  if (!buffer) return;

  const source = engine.context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = clamp(options.rate ?? 1, 0.65, 1.5);

  const gain = engine.context.createGain();
  gain.gain.setValueAtTime(0.0001, options.when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0003, options.gain), options.when + 0.004);

  const noteDuration = Math.min(0.6, buffer.duration / source.playbackRate.value);
  gain.gain.exponentialRampToValueAtTime(0.0001, options.when + noteDuration);

  const nodes: AudioNode[] = [source, gain];
  let head: AudioNode = source;

  if (options.highpassHz) {
    const highpass = engine.context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = options.highpassHz;
    head.connect(highpass);
    head = highpass;
    nodes.push(highpass);
  }

  if (options.lowpassHz) {
    const lowpass = engine.context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = options.lowpassHz;
    head.connect(lowpass);
    head = lowpass;
    nodes.push(lowpass);
  }

  if (options.bandpassHz) {
    const bandpass = engine.context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = options.bandpassHz;
    bandpass.Q.value = options.bandpassQ ?? 0.9;
    head.connect(bandpass);
    head = bandpass;
    nodes.push(bandpass);
  }

  head.connect(gain);
  gain.connect(engine.accentBus);

  source.start(options.when);
  source.stop(options.when + noteDuration + 0.03);
  registerVoice(engine, source, nodes);
}

function scheduleRevealSting(engine: AudioEngine, tier: ValueTier, when: number) {
  const layerMap: Record<
    ValueTier,
    Array<{
      sampleId: WinSampleId;
      delay: number;
      gain: number;
      rate: number;
      highpassHz?: number;
      lowpassHz?: number;
      bandpassHz?: number;
      bandpassQ?: number;
    }>
  > = {
    field: [
      { sampleId: "whoosh", delay: 0, gain: 0.025, rate: 0.88, bandpassHz: 1350, bandpassQ: 0.65 },
      { sampleId: "levelup", delay: 0.012, gain: 0.06, rate: 0.86, highpassHz: 220, lowpassHz: 4300 }
    ],
    premium: [
      { sampleId: "whoosh", delay: 0, gain: 0.032, rate: 0.98, bandpassHz: 1500, bandpassQ: 0.72 },
      { sampleId: "levelup", delay: 0.008, gain: 0.085, rate: 1.01, highpassHz: 220, lowpassHz: 5600 },
      { sampleId: "cash", delay: 0.048, gain: 0.042, rate: 1.03, highpassHz: 280, lowpassHz: 5000 }
    ],
    elite: [
      { sampleId: "whoosh", delay: 0, gain: 0.038, rate: 1.08, bandpassHz: 1650, bandpassQ: 0.78 },
      { sampleId: "levelup", delay: 0.008, gain: 0.116, rate: 1.09, highpassHz: 230, lowpassHz: 6400 },
      { sampleId: "cash", delay: 0.03, gain: 0.058, rate: 1.06, highpassHz: 310, lowpassHz: 5600 },
      { sampleId: "levelup", delay: 0.082, gain: 0.074, rate: 1.2, highpassHz: 320, lowpassHz: 7200 }
    ],
    jackpot: [
      { sampleId: "whoosh", delay: 0, gain: 0.048, rate: 1.16, bandpassHz: 1800, bandpassQ: 0.84 },
      { sampleId: "levelup", delay: 0.006, gain: 0.132, rate: 1.23, highpassHz: 260, lowpassHz: 7600 },
      { sampleId: "cash", delay: 0.024, gain: 0.076, rate: 1.1, highpassHz: 320, lowpassHz: 6200 },
      { sampleId: "levelup", delay: 0.072, gain: 0.108, rate: 1.34, highpassHz: 360, lowpassHz: 8200 },
      { sampleId: "cash", delay: 0.11, gain: 0.064, rate: 1.24, highpassHz: 360, lowpassHz: 6400 },
      { sampleId: "levelup", delay: 0.158, gain: 0.082, rate: 1.46, highpassHz: 420, lowpassHz: 9000 }
    ]
  };

  for (const layer of layerMap[tier]) {
    scheduleWinSample(engine, {
      sampleId: layer.sampleId,
      when: when + layer.delay,
      gain: layer.gain,
      rate: layer.rate,
      highpassHz: layer.highpassHz,
      lowpassHz: layer.lowpassHz,
      bandpassHz: layer.bandpassHz,
      bandpassQ: layer.bandpassQ
    });
  }
}

function useCaseAudio(enabled: boolean) {
  const engineRef = useRef<AudioEngine | null>(null);
  const spinRunIdRef = useRef(0);

  const ensureEngine = useCallback(async () => {
    if (typeof window === "undefined") return null;
    if (!engineRef.current) {
      engineRef.current = createAudioEngine();
    }
    const engine = engineRef.current;
    if (!engine) return null;
    if (engine.context.state === "suspended") {
      await engine.context.resume().catch(() => undefined);
    }
    rampMasterGain(engine, enabled ? engine.targetGain : 0);
    return engine;
  }, [enabled]);

  const unlock = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!engineRef.current) {
      engineRef.current = createAudioEngine();
    }
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.context.state !== "running") {
      await engine.context.resume().catch(() => undefined);
    }
    await ensureWinSamplesLoaded(engine).catch(() => undefined);
    rampMasterGain(engine, enabled ? engine.targetGain : 0, 0.03);
  }, [enabled]);

  const stopAll = useCallback(() => {
    spinRunIdRef.current += 1;
    const engine = engineRef.current;
    if (!engine) return;
    stopAllAudio(engine);
  }, []);

  const playSpin = useCallback(
    (options: SpinAudioOptions) => {
      void (async () => {
        spinRunIdRef.current += 1;
        const engine = await ensureEngine();
        if (!engine) return;

        stopAllAudio(engine);
        if (!enabled) return;

        const start = engine.context.currentTime + 0.03;
        const duration = clamp(options.durationMs / 1000, 5, 7);
        const normalizedSlots = clamp(Math.round(options.slotCount), 24, 130);

        scheduleSpinBed(engine, {
          when: start,
          duration: duration * 0.97,
          peakGain: clamp(0.052 + normalizedSlots / 4600, 0.05, 0.078)
        });

        scheduleStopImpact(engine, start + duration + 0.004);
      })();
    },
    [enabled, ensureEngine]
  );

  const playTick = useCallback(
    (options: TickAudioOptions) => {
      const engine = engineRef.current;
      if (!engine || !enabled || engine.context.state !== "running") return;
      const when = engine.context.currentTime + clamp(options.offsetSeconds ?? 0.002, 0, 0.02);
      scheduleRatchetTick(engine, { when, progress: clamp(options.progress, 0, 1) });
    },
    [enabled]
  );

  const playReveal = useCallback(
    (tier: ValueTier) => {
      void (async () => {
        const runId = spinRunIdRef.current;
        const engine = await ensureEngine();
        if (!engine || !enabled || runId !== spinRunIdRef.current) return;
        await ensureWinSamplesLoaded(engine).catch(() => undefined);
        scheduleRevealSting(engine, tier, engine.context.currentTime + 0.02);
      })();
    },
    [enabled, ensureEngine]
  );

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!enabled) {
      stopAllAudio(engine);
    }
    rampMasterGain(engine, enabled ? engine.targetGain : 0, 0.08);
  }, [enabled]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityOrFocus = () => {
      const engine = engineRef.current;
      if (!engine || !enabled) return;
      if (engine.context.state !== "running") {
        void engine.context.resume().catch(() => undefined);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (engine) {
        stopAllAudio(engine);
        engine.master.disconnect();
        engine.mixBus.disconnect();
        engine.bedBus.disconnect();
        engine.tickBus.disconnect();
        engine.accentBus.disconnect();
        engine.toneFilter.disconnect();
        engine.glueCompressor.disconnect();
        engine.softClipper.disconnect();
        engine.limiter.disconnect();
        void engine.context.close();
      }
      engineRef.current = null;
    };
  }, []);

  return { unlock, stopAll, playSpin, playTick, playReveal };
}

const ReelSkinCard = memo(function ReelSkinCard({ item, highlight }: { item: SkinItem; highlight?: boolean }) {
  const rarity = RARITY_CONFIG[item.rarity];

  return (
    <div
      className={`relative w-44 shrink-0 rounded-2xl border bg-zinc-950/85 p-3 transition-transform ${
        highlight
          ? "border-brand/60 shadow-[0_0_46px_rgba(255,157,0,0.35)]"
          : `${rarity.border} shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]`
      }`}
    >
      <div className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br ${rarity.gradient}`} />
      {highlight ? (
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[linear-gradient(120deg,transparent_20%,rgba(255,255,255,0.2)_48%,transparent_76%)] opacity-40" />
      ) : null}
      <div className="relative space-y-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.24em]">
          <span className={`font-semibold ${rarity.text}`}>{rarity.label}</span>
          <span className="rounded-full border border-white/15 bg-black/35 px-2 py-0.5 text-[9px] text-zinc-200">
            {item.stattrak ? "StatTrak" : "Standard"}
          </span>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/35 p-2">
          <div className={`relative h-14 overflow-hidden rounded-lg bg-gradient-to-r ${rarity.gradient}`}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.55),transparent_36%)]" />
            <div className="absolute bottom-1.5 left-2 text-[8px] font-medium uppercase tracking-[0.35em] text-black/60">
              NEBULA
            </div>
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-[0.25em] text-zinc-500">{item.weapon}</p>
          <p className="text-sm font-semibold text-white leading-tight">{item.name}</p>
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-300">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
            {item.wear}
          </span>
          <span className="font-semibold text-white">{formatUsd(item.value)}</span>
        </div>
      </div>
    </div>
  );
});

ReelSkinCard.displayName = "ReelSkinCard";

export function CaseOpeningLab() {
  const controls = useAnimationControls();
  const laneRef = useRef<HTMLDivElement>(null);
  const spinIdRef = useRef(0);
  const slotTickRef = useRef({
    active: false,
    lastSlot: 0,
    totalSlots: 1,
    spinId: 0
  });
  const [laneWidth, setLaneWidth] = useState(960);
  const [audioMuted, setAudioMuted] = useState(false);
  const [opening, setOpening] = useState(false);
  const [spinFx, setSpinFx] = useState(0);
  const [reel, setReel] = useState<SkinItem[]>(() => buildReel(pickSkin("mil-spec")));
  const [result, setResult] = useState<SkinItem | null>(null);
  const [history, setHistory] = useState<SkinItem[]>([]);
  const [valueTier, setValueTier] = useState<ValueTier>("field");
  const [effectTick, setEffectTick] = useState(0);
  const audio = useCaseAudio(!audioMuted);

  useEffect(() => {
    const updateLaneWidth = () => {
      setLaneWidth(laneRef.current?.clientWidth ?? 960);
    };

    updateLaneWidth();
    if (!laneRef.current || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateLaneWidth);
    observer.observe(laneRef.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  const onReelUpdate = useCallback(
    (latest: { x?: number | string }) => {
      const tracker = slotTickRef.current;
      if (!tracker.active || tracker.spinId !== spinIdRef.current) return;

      const rawX = latest.x;
      const x = typeof rawX === "number" ? rawX : Number.parseFloat(rawX ?? "0");
      if (!Number.isFinite(x)) return;

      const traveled = Math.max(0, Math.abs(x));
      const nextSlot = Math.floor(traveled / SLOT_SIZE);
      if (nextSlot <= tracker.lastSlot) return;

      const crossed = nextSlot - tracker.lastSlot;
      for (let step = 1; step <= crossed; step += 1) {
        const slotIndex = tracker.lastSlot + step;
        const progress = tracker.totalSlots <= 1 ? 1 : slotIndex / tracker.totalSlots;
        audio.playTick({
          progress,
          offsetSeconds: (step - 1) * 0.0025
        });
      }

      tracker.lastSlot = nextSlot;
    },
    [audio]
  );

  const openCase = useCallback(async () => {
    const spinId = spinIdRef.current + 1;
    spinIdRef.current = spinId;

    await audio.unlock();
    audio.stopAll();
    controls.stop();

    const winner = pickSkin();
    const nextReel = buildReel(winner);
    const winningCenterX = WINNING_SLOT * SLOT_SIZE + CARD_WIDTH / 2;
    const rawTargetX = laneWidth / 2 - winningCenterX;
    const targetX = Math.round(rawTargetX * 2) / 2;
    const overshootSlots = SPIN_OVERSHOOT_SLOTS + Math.random() * SPIN_OVERSHOOT_VARIANCE;
    const overshootX = Math.round((targetX + overshootSlots * SLOT_SIZE) * 2) / 2;
    const travelSeconds = SPIN_TRAVEL_BASE_SECONDS + Math.random() * SPIN_TRAVEL_VARIANCE_SECONDS;
    const slotCount = Math.max(24, Math.round(Math.abs(overshootX) / SLOT_SIZE));
    slotTickRef.current = {
      active: true,
      lastSlot: 0,
      totalSlots: Math.max(1, slotCount),
      spinId
    };

    setOpening(true);
    setSpinFx(1);
    setResult(null);
    setReel(nextReel);
    setValueTier("field");
    controls.set({ x: 0 });

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      if (spinId !== spinIdRef.current) {
        slotTickRef.current.active = false;
        return;
      }

      audio.playSpin({
        durationMs: Math.round((travelSeconds + 0.35) * 1000),
        slotCount
      });

      await controls.start(
        { x: overshootX },
        {
          duration: travelSeconds,
          ease: [0.07, 0.97, 0.13, 1]
        }
      );

      if (spinId !== spinIdRef.current) {
        slotTickRef.current.active = false;
        return;
      }
      setSpinFx(0.2);

      await controls.start({
        x: targetX,
        transition: {
          type: "spring",
          stiffness: 185,
          damping: 24,
          mass: 0.82,
          restSpeed: 0.12,
          restDelta: 0.08
        }
      });

      if (spinId !== spinIdRef.current) {
        slotTickRef.current.active = false;
        return;
      }
      slotTickRef.current.active = false;
      setSpinFx(0);

      const tier = getValueTier(winner.value);
      setValueTier(tier);
      setResult(winner);
      setHistory((previous) => [winner, ...previous].slice(0, 8));
      setEffectTick((count) => count + 1);
      audio.playReveal(tier);
    } finally {
      if (spinId === spinIdRef.current) {
        slotTickRef.current.active = false;
        setOpening(false);
        setSpinFx(0);
      }
    }
  }, [audio, controls, laneWidth]);

  const clearResult = useCallback(() => {
    spinIdRef.current += 1;
    slotTickRef.current.active = false;
    audio.stopAll();
    controls.stop();
    setResult(null);
    setValueTier("field");
    setOpening(false);
    setSpinFx(0);
    controls.set({ x: 0 });
  }, [audio, controls]);

  const effect = VALUE_EFFECTS[valueTier];
  const resultRarity = result ? RARITY_CONFIG[result.rarity] : null;

  const particles = useMemo<Particle[]>(() => {
    if (!result) return [];
    return Array.from({ length: effect.particleCount }, (_, index) => {
      const noise = pseudoRandom((effectTick + 1) * 997 + index * 73);
      const angle = (Math.PI * 2 * index) / effect.particleCount + noise * 0.65;
      const distance = 130 + noise * 240;
      return {
        id: `${effectTick}-${index}`,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        scale: 0.55 + noise * 1.1,
        rotate: -120 + noise * 240,
        delay: noise * 0.2,
        duration: 0.9 + noise * 0.8
      };
    });
  }, [effect.particleCount, effectTick, result]);

  return (
    <main className="max-w-7xl mx-auto px-6 pb-16 space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#05070d]/90 px-5 py-8 md:px-8 md:py-10">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -left-16 h-80 w-80 rounded-full bg-sky-500/15 blur-3xl" />
          <div className="absolute top-0 right-0 h-96 w-96 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_50%,rgba(255,255,255,0.08),transparent_45%)]" />
        </div>

        <AnimatePresence>
          {result ? (
            <motion.div
              key={`${effectTick}-${valueTier}`}
              className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${effect.overlay}`}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: [0, 0.75, 0], scale: [0.98, 1, 1.04] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.3, ease: "easeOut" }}
            />
          ) : null}
        </AnimatePresence>

        <div className="relative space-y-7">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-[0.35em] text-zinc-400">VultStrike Essentials</p>
              <h1 className="text-3xl md:text-4xl font-semibold text-white">Essential Case</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn-ghost"
                type="button"
                onClick={() => {
                  setAudioMuted((previous) => !previous);
                }}
              >
                {audioMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                {audioMuted ? "Audio Off" : "Audio On"}
              </button>
              <button className="btn-ghost" type="button" onClick={clearResult}>
                <RotateCcw className="h-4 w-4" />
                Reset Scene
              </button>
              <Link className="btn-ghost" href="/">
                Back Home
              </Link>
            </div>
          </header>

          <section className="rounded-3xl border border-white/15 bg-black/35 p-3 md:p-5">
            <div className="relative rounded-2xl border border-white/10 bg-black/35 px-2 py-4 md:px-3 md:py-5">
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#020304] via-black/50 to-transparent md:w-28" />
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#020304] via-black/50 to-transparent md:w-28" />

              <div className="pointer-events-none absolute inset-x-0 inset-y-0 z-30 flex justify-center">
                <div className="relative h-full w-0">
                  <div className="absolute -top-7 inset-x-0 flex justify-center">
                    <motion.div
                      className="rounded-full border border-brand/40 bg-black/80 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.32em] text-brand"
                      animate={{ opacity: [0.66, 1, 0.66], y: [0, -1, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                    >
                      Drop Zone
                    </motion.div>
                  </div>

                  <div className="absolute inset-y-2 left-0 -ml-px w-[2px] rounded-full bg-gradient-to-b from-white/0 via-brand to-white/0 shadow-[0_0_28px_rgba(255,157,0,0.56)]" />

                  <div className="absolute inset-x-0 top-1/2 -mt-[33px] flex justify-center">
                    <motion.div
                      className="h-[66px] w-[66px] rounded-full border border-brand/35"
                      animate={{ scale: [0.9, 1.1, 0.9], opacity: [0.35, 0.72, 0.35] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </div>

                  <div className="absolute inset-x-0 top-1/2 -mt-3 flex justify-center">
                    <div className="flex h-6 w-[74px] items-center justify-between drop-shadow-[0_0_8px_rgba(255,157,0,0.52)]">
                      <span className="h-0 w-0 border-y-[7px] border-y-transparent border-r-[12px] border-r-brand/90" />
                      <span className="h-0 w-0 border-y-[7px] border-y-transparent border-l-[12px] border-l-brand/90" />
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="pointer-events-none absolute inset-x-8 inset-y-4 z-20 rounded-2xl bg-[radial-gradient(circle_at_50%_50%,rgba(255,157,0,0.24),transparent_70%)] transition-opacity duration-200 ease-out"
                style={{ opacity: spinFx * 0.52 }}
              />

              <div ref={laneRef} className="overflow-hidden">
                <motion.div
                  className="flex gap-3 transform-gpu transition-[filter,opacity] duration-200 ease-out"
                  style={{
                    willChange: opening ? "transform, filter, opacity" : "transform",
                    backfaceVisibility: "hidden",
                    filter: `blur(${(spinFx * 0.72).toFixed(2)}px)`,
                    opacity: 1 - spinFx * 0.05
                  }}
                  animate={controls}
                  initial={{ x: 0 }}
                  onUpdate={onReelUpdate}
                >
                  {reel.map((item, index) => (
                    <ReelSkinCard key={`${index}-${item.id}`} item={item} highlight={index === WINNING_SLOT} />
                  ))}
                </motion.div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-300">
                Rarity weights: <span className="text-sky-300">Mil-Spec 54%</span>,{" "}
                <span className="text-violet-300">Restricted 24%</span>,{" "}
                <span className="text-rose-300">Classified 12%</span>,{" "}
                <span className="text-orange-300">Covert 7%</span>,{" "}
                <span className="text-amber-200">Extraordinary 3%</span>
              </p>

              <motion.button
                className="rounded-full bg-brand text-black font-semibold px-6 py-3 shadow-[0_16px_45px_rgba(255,157,0,0.38)] disabled:opacity-60"
                type="button"
                onPointerDown={() => {
                  audio.unlock();
                }}
                onClick={() => {
                  void openCase();
                }}
                disabled={opening}
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
              >
                {opening ? "Rolling..." : "Open Nebula Case"}
              </motion.button>
            </div>
          </section>

          <AnimatePresence>
            {result && resultRarity ? (
              <motion.section
                key={`${result.id}-${effectTick}`}
                className={`relative overflow-hidden rounded-3xl border bg-black/45 p-5 md:p-6 ${resultRarity.border} ${effect.glow}`}
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${resultRarity.aura}`} />

                <div className="relative flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.34em] text-zinc-400">Drop Confirmed</p>
                    <h2 className="text-2xl font-semibold text-white">
                      {result.weapon} | {result.name}
                    </h2>
                    <p className="text-sm text-zinc-300">
                      {result.wear} • {resultRarity.label}
                      {result.stattrak ? " • StatTrak" : ""}
                    </p>
                  </div>

                  <div className="text-right space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-zinc-400">{effect.label}</p>
                    <p className="text-3xl font-semibold text-white">{formatUsd(result.value)}</p>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs">
                      <Sparkles className="h-3.5 w-3.5 text-brand" />
                      <span className={resultRarity.text}>{resultRarity.label}</span>
                    </div>
                  </div>
                </div>

                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  {particles.map((particle) => (
                    <motion.span
                      key={particle.id}
                      className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-white"
                      initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 }}
                      animate={{
                        x: particle.x,
                        y: particle.y,
                        opacity: [0, 0.95, 0],
                        scale: [0.2, particle.scale, 0],
                        rotate: particle.rotate
                      }}
                      transition={{
                        duration: particle.duration,
                        delay: particle.delay,
                        ease: "easeOut"
                      }}
                    />
                  ))}
                </div>
              </motion.section>
            ) : null}
          </AnimatePresence>
        </div>
      </section>

      <section className="glass-panel p-5 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Recent Drops</p>
            <p className="text-sm text-zinc-300">Aynı oturumdaki son denemeler.</p>
          </div>
          {history.length > 0 ? <span className="pill-muted">{history.length} tracked</span> : null}
        </div>

        {history.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">Henüz drop yok. Bir kasa aç ve akışı test et.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {history.map((item, index) => {
              const rarity = RARITY_CONFIG[item.rarity];
              return (
                <div key={`${item.id}-${index}`} className={`rounded-2xl border bg-black/40 px-4 py-3 ${rarity.border}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {item.weapon} | {item.name}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {item.wear} • {rarity.label}
                        {item.stattrak ? " • StatTrak" : ""}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-white">{formatUsd(item.value)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
