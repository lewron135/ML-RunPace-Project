'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript Interfaces
// ─────────────────────────────────────────────────────────────────────────────

interface ConfidenceMap {
  Advanced:     number;
  Intermediate: number;
  Beginner:     number;
}

interface PredictionResult {
  tingkat_pengalaman: 'Advanced' | 'Intermediate' | 'Beginner';
  confidence:         ConfidenceMap;
  rekomendasi_pace:   string;
  estimasi_durasi:    string;
  total_detik:        number;
}

interface DebugInfo {
  rf_raw_detik:          number;
  physics_detik:         number;
  alpha_used:            number;
  pace_base_used:        number;
  training_dist_km_used: number;
  race_dist_km_used:     number;
}

interface ApiResponse {
  status:   'success' | 'error';
  hasil:    PredictionResult;
  debug:    DebugInfo;
  message?: string;
}

interface TrainingSession {
  jarakKm:   number;
  heartRate: number;
}

type WizardStep    = 1 | 2 | 3;
type RaceCategory  = '10K' | 'HALF' | 'FULL';
type FeedbackRating = 1 | 2 | 3 | 4 | 5;

// ─────────────────────────────────────────────────────────────────────────────
// Static Configuration
// ─────────────────────────────────────────────────────────────────────────────

const RACE_CONFIG: Record<
  RaceCategory,
  { label: string; sublabel: string; jarakKm: number; cotDetik: number; cotLabel: string }
> = {
  '10K':  { label: '10K Race',      sublabel: '10.0 km', jarakKm: 10.0, cotDetik: 12600, cotLabel: '3:30:00' },
  'HALF': { label: 'Half Marathon', sublabel: '21.1 km', jarakKm: 21.1, cotDetik: 12600, cotLabel: '3:30:00' },
  'FULL': { label: 'Full Marathon', sublabel: '42.2 km', jarakKm: 42.2, cotDetik: 25200, cotLabel: '7:00:00' },
};

const KASTA_CONFIG: Record<
  'Advanced' | 'Intermediate' | 'Beginner',
  { text: string; bg: string; border: string; bar: string; dot: string; label: string }
> = {
  Advanced:     { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    bar: 'bg-rose-500',    dot: 'bg-rose-400',    label: 'Advanced'     },
  Intermediate: { text: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/30',     bar: 'bg-sky-500',     dot: 'bg-sky-400',     label: 'Intermediate' },
  Beginner:     { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', bar: 'bg-emerald-500', dot: 'bg-emerald-400', label: 'Beginner'     },
};

const FEEDBACK_LABELS: Record<FeedbackRating, string> = {
  1: 'Tidak Akurat',
  2: 'Kurang Akurat',
  3: 'Cukup Akurat',
  4: 'Akurat',
  5: 'Sangat Akurat',
};

const DEFAULT_SESSIONS: [TrainingSession, TrainingSession, TrainingSession] = [
  { jarakKm: 5.0,  heartRate: 155 },
  { jarakKm: 7.0,  heartRate: 160 },
  { jarakKm: 10.0, heartRate: 158 },
];

const SESSION_ACCENT = 'rgb(251 146 60)';

// ─────────────────────────────────────────────────────────────────────────────
// Pure Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildTrackStyle(
  value: number,
  min:   number,
  max:   number,
  color  = 'rgb(20 184 166)'
): CSSProperties {
  const pct = ((value - min) / (max - min)) * 100;
  return {
    background: `linear-gradient(to right,
      ${color} 0%, ${color} ${pct}%,
      rgb(15 23 42) ${pct}%, rgb(15 23 42) 100%)`,
  };
}

function resolveWaktu(jam: number): { label: string; classes: string } {
  if (jam >= 5  && jam < 11) return { label: 'PAGI',  classes: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  if (jam >= 11 && jam < 16) return { label: 'SIANG', classes: 'text-orange-400 bg-orange-500/10 border-orange-500/20' };
  return                             { label: 'MALAM', classes: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' };
}

function formatSeconds(totalSec: number): string {
  const abs = Math.abs(totalSec);
  const h   = Math.floor(abs / 3600);
  const m   = Math.floor((abs % 3600) / 60);
  const s   = Math.floor(abs % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Converts a float pace (minutes/km) to "M:SS" display string.
// e.g. 5.5 -> "5:30", 4.0833 -> "4:05"
function formatPace(paceFloat: number): string {
  const totalSec = Math.round(paceFloat * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Parses "M:SS /km" strings from backend back to float minutes for comparison.
function parsePaceToFloat(paceStr: string): number {
  const match = paceStr.match(/(\d+):(\d+)/);
  if (!match) return 0;
  return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
}

// Indonesian-style duration string matching backend _format_duration output.
function formatDurationIndo(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h   = Math.floor(sec / 3600);
  const m   = Math.floor((sec % 3600) / 60);
  const s   = sec % 60;
  if (h > 0) return `${h} jam ${m} menit ${s} detik`;
  return `${m} menit ${s} detik`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface SessionSliderRowProps {
  index:    number;
  session:  TrainingSession;
  locked:   boolean;
  onChange: (idx: number, field: keyof TrainingSession, val: number) => void;
}

function SessionSliderRow({ index, session, locked, onChange }: SessionSliderRowProps) {
  return (
    <div className={`bg-slate-950/60 border rounded-xl p-4 transition-opacity duration-300 ${
      locked ? 'border-orange-500/5 opacity-60' : 'border-orange-500/10'
    }`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-5 h-5 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-[9px] font-black text-orange-400 flex-shrink-0">
          {index + 1}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
          Sesi Latihan {index + 1}
        </span>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-700">Jarak Latihan</span>
            <span className="text-base font-black tabular-nums text-orange-400 leading-none">
              {session.jarakKm.toFixed(1)}
              <span className="text-[10px] font-semibold text-slate-600 ml-1">km</span>
            </span>
          </div>
          <input
            type="range" min={1.0} max={30.0} step={0.5}
            value={session.jarakKm}
            disabled={locked}
            onChange={(e) => onChange(index, 'jarakKm', parseFloat(e.target.value))}
            style={buildTrackStyle(session.jarakKm, 1.0, 30.0, SESSION_ACCENT)}
            className="slider-session w-full h-[5px] rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[9px] text-slate-800 font-mono select-none">
            <span>1.0</span><span>15.5</span><span>30.0</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-700">Avg Heart Rate</span>
            <span className="text-base font-black tabular-nums text-slate-200 leading-none">
              {session.heartRate}
              <span className="text-[10px] font-semibold text-slate-600 ml-1">bpm</span>
            </span>
          </div>
          <input
            type="range" min={90} max={190} step={1}
            value={session.heartRate}
            disabled={locked}
            onChange={(e) => onChange(index, 'heartRate', parseInt(e.target.value))}
            style={buildTrackStyle(session.heartRate, 90, 190, SESSION_ACCENT)}
            className="slider-session w-full h-[5px] rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[9px] text-slate-800 font-mono select-none">
            <span>90</span><span>140</span><span>190</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StepIndicatorProps { current: WizardStep; }

function StepIndicator({ current }: StepIndicatorProps) {
  const steps: { n: WizardStep; label: string }[] = [
    { n: 1, label: 'Profil Latihan'   },
    { n: 2, label: 'Parameter Lomba'  },
    { n: 3, label: 'Laporan Akhir'    },
  ];
  return (
    <div className="flex items-center gap-0 mb-10">
      {steps.map(({ n, label }, i) => {
        const done   = current > n;
        const active = current === n;
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border transition-all duration-300 ${
                done   ? 'bg-teal-500 border-teal-400 text-slate-950' :
                active ? 'bg-teal-500/15 border-teal-400/60 text-teal-300' :
                         'bg-slate-900 border-slate-800 text-slate-700'
              }`}>
                {done ? (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : n}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider hidden sm:block transition-colors duration-300 ${
                active ? 'text-teal-400' : done ? 'text-slate-500' : 'text-slate-700'
              }`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-3 transition-colors duration-300 ${
                done ? 'bg-teal-500/40' : 'bg-slate-800'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RunPaceDashboard() {

  // ── Wizard state ─────────────────────────────────────────────────────────────
  const [step,          setStep]          = useState<WizardStep>(1);
  const [, setProfileLocked] = useState<boolean>(false);

  // ── Training inputs ──────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<[TrainingSession, TrainingSession, TrainingSession]>(
    DEFAULT_SESSIONS
  );

  // ── Race parameter inputs ────────────────────────────────────────────────────
  const [raceCategory, setRaceCategory] = useState<RaceCategory>('HALF');
  const [elevasiM,     setElevasiM]     = useState<number>(25);
  const [gender,       setGender]       = useState<'M' | 'F'>('M');
  const [jamLari,      setJamLari]      = useState<number>(6);

  // ── Prediction state ─────────────────────────────────────────────────────────
  const [hasil,    setHasil]    = useState<PredictionResult | null>(null);
  const [debug,    setDebug]    = useState<DebugInfo | null>(null);
  const [loading,  setLoading]  = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // ── Feedback state ───────────────────────────────────────────────────────────
  const [fbRating,    setFbRating]    = useState<FeedbackRating | null>(null);
  const [fbComment,   setFbComment]   = useState<string>('');
  const [fbSubmitted, setFbSubmitted] = useState<boolean>(false);

  // ── Target pace (frontend-only — never sent to backend) ──────────────────────
  const [targetPace, setTargetPace] = useState<number>(5.0);

  // ── Session mutation ─────────────────────────────────────────────────────────
  const updateSession = useCallback(
    (idx: number, field: keyof TrainingSession, val: number) => {
      setSessions((prev) => {
        const next = [...prev] as [TrainingSession, TrainingSession, TrainingSession];
        next[idx] = { ...next[idx], [field]: val };
        return next;
      });
    }, []
  );

  // ── Derived training aggregates ──────────────────────────────────────────────
  const avgHeartRate = Math.round(
    sessions.reduce((sum, s) => sum + s.heartRate, 0) / sessions.length
  );
  const avgTrainingDistance = parseFloat(
    (sessions.reduce((sum, s) => sum + s.jarakKm, 0) / sessions.length).toFixed(1)
  );

  const raceCfg   = RACE_CONFIG[raceCategory];
  const waktuInfo = resolveWaktu(jamLari);

  // ── Auto-predict on step 3 only ──────────────────────────────────────────────
  useEffect(() => {
    if (step !== 3) return;
    if (avgHeartRate < 40 || avgHeartRate > 220) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setApiError(null);
      try {
        const res = await fetch('/api/predict', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            training_dist_km: avgTrainingDistance,
            jarak_km:         raceCfg.jarakKm,
            elevasi_m:        elevasiM,
            gender,
            jam_lari:         jamLari,
            heart_rate:       avgHeartRate,
          }),
          signal: controller.signal,
        });
        const data: ApiResponse = await res.json();
        if (data.status === 'success') {
          setHasil(data.hasil);
          setDebug(data.debug);
        } else {
          setApiError(data.message ?? 'Prediction request failed.');
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setApiError('Backend unreachable. Ensure python3 api/index.py is running on port 5000.');
        }
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [step, raceCategory, elevasiM, gender, jamLari, avgHeartRate, avgTrainingDistance, raceCfg.jarakKm]);

  // ── Derived output ───────────────────────────────────────────────────────────
  const kastaCfg        = hasil ? KASTA_CONFIG[hasil.tingkat_pengalaman] : null;
  const worthinessReady = hasil ? hasil.total_detik < raceCfg.cotDetik   : null;
  const cotMarginSec    = hasil ? raceCfg.cotDetik - hasil.total_detik    : 0;

  // Expectation vs Reality — pure frontend math, no ML involvement
  const expectedDurationSec = raceCfg.jarakKm * targetPace * 60;
  const aiPaceFloat         = hasil ? parsePaceToFloat(hasil.rekomendasi_pace) : 0;
  // True when user's target pace is > 0.2 min/km faster than AI recommendation
  const paceGapAggressive   = hasil ? (aiPaceFloat - targetPace) > 0.2 : false;

  // Three-state banner status for COT Worthiness Validation:
  //   CRITICAL_RISK      — AI prediction exceeds COT (red)
  //   UNREALISTIC_TARGET — Under COT but pace target too aggressive (amber)
  //   FULLY_READY        — Under COT and pace target realistic (green)
  const bannerStatus = !hasil
    ? ('IDLE' as const)
    : hasil.total_detik >= raceCfg.cotDetik
      ? ('CRITICAL_RISK' as const)
      : paceGapAggressive
        ? ('UNREALISTIC_TARGET' as const)
        : ('FULLY_READY' as const);

  // Dynamic race category constraints derived from Step 1 training volume.
  // Thresholds mirror the Sanity Gate in the Flask backend to prevent
  // out-of-distribution requests before they reach the model.
  const halfAllowed = avgTrainingDistance >= 8.0;
  const fullAllowed = avgTrainingDistance >= 15.0;
  const raceConstraintWarning: string | null = !fullAllowed
    ? `Pilihan kategori ${
        !halfAllowed ? 'Half Marathon dan Full Marathon' : 'Full Marathon'
      } dikunci karena rata-rata volume latihan Anda saat ini (${avgTrainingDistance.toFixed(1)} km) belum memenuhi ambang batas adaptasi fisik yang aman untuk simulasi.`
    : null;

  // ── Wizard actions ───────────────────────────────────────────────────────────
  const handleLockProfile = () => {
    setProfileLocked(true);
    // Auto-correct raceCategory if the current selection is now locked
    // by the training-volume constraint.
    if (avgTrainingDistance < 8.0 && raceCategory !== '10K') {
      setRaceCategory('10K');
    } else if (avgTrainingDistance < 15.0 && raceCategory === 'FULL') {
      setRaceCategory('HALF');
    }
    setStep(2);
  };

  const handleUnlockProfile = () => {
    setProfileLocked(false);
    setHasil(null);
    setDebug(null);
    setStep(1);
  };

  const handleStartSimulation = () => {
    setHasil(null);
    setDebug(null);
    setStep(3);
  };

  const handleFeedbackSubmit = async () => {
    if (!fbRating) return;
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: fbRating, comment: fbComment }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        setApiError(`Feedback gagal tersimpan: ${err.message ?? res.statusText}`);
        return;
      }
      setFbSubmitted(true);
    } catch (e) {
      setApiError(`Feedback gagal tersimpan: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes cot-risk-pulse {
          0%, 100% { background-color: rgb(185 28 28); box-shadow: 0 0 0 0 rgba(239,68,68,0.45); }
          50%       { background-color: rgb(220 38 38); box-shadow: 0 0 0 8px rgba(239,68,68,0);  }
        }
        .animate-cot-risk { animation: cot-risk-pulse 1.4s ease-in-out infinite; }

        .slider-custom::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(20 184 166); cursor: pointer;
          border: 2px solid rgb(2 6 23);
          box-shadow: 0 0 0 3px rgba(20,184,166,0.20);
          transition: box-shadow 0.15s;
        }
        .slider-custom::-webkit-slider-thumb:hover { box-shadow: 0 0 0 5px rgba(20,184,166,0.25); }
        .slider-custom::-moz-range-thumb {
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(20 184 166); cursor: pointer;
          border: 2px solid rgb(2 6 23);
        }

        .slider-session::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(251 146 60); cursor: pointer;
          border: 2px solid rgb(2 6 23);
          box-shadow: 0 0 0 3px rgba(251,146,60,0.20);
          transition: box-shadow 0.15s;
        }
        .slider-session::-webkit-slider-thumb:hover { box-shadow: 0 0 0 5px rgba(251,146,60,0.25); }
        .slider-session::-moz-range-thumb {
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(251 146 60); cursor: pointer;
          border: 2px solid rgb(2 6 23);
        }
      `}</style>

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-14">

          {/* ── Header ──────────────────────────────────────────────────────── */}
          <header className="mb-10">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-none mb-2">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-300">RunPace</span>
              <span className="text-slate-600 ml-3 text-3xl md:text-4xl font-light">AI</span>
            </h1>
            <p className="text-slate-500 text-sm font-medium">
              Marathon Readiness &amp; Cut-Off Time Simulator &mdash; BINUS University Final Project
            </p>
          </header>

          {/* ── Step Indicator ──────────────────────────────────────────────── */}
          <StepIndicator current={step} />

          {/* ── Error Banner ─────────────────────────────────────────────────── */}
          {apiError && (
            <div className="mb-6 px-4 py-3 bg-rose-500/5 border border-rose-500/20 rounded-xl flex items-start gap-3">
              <div className="w-1 min-h-[16px] bg-rose-500/40 rounded-full flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-400 font-mono leading-relaxed">{apiError}</p>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 1 — PROFIL LATIHAN
          ══════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="space-y-5">

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-start justify-between pb-5 mb-5 border-b border-slate-800">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-[0.2em] text-teal-400">
                      Langkah 1 — Profil Kebugaran
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Masukkan data 3 sesi latihan terakhirmu. Kasta pelari ditentukan dari profil ini.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {sessions.map((s, i) => (
                    <SessionSliderRow
                      key={i}
                      index={i}
                      session={s}
                      locked={false}
                      onChange={updateSession}
                    />
                  ))}
                </div>

                {/* Live aggregate display */}
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl px-4 py-3">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600 block">
                      Rata-rata Jarak Latihan
                    </span>
                    <span className="text-xl font-black font-mono text-orange-400 tabular-nums leading-tight mt-0.5 block">
                      {avgTrainingDistance.toFixed(1)}
                      <span className="text-[11px] text-slate-600 ml-1">km</span>
                    </span>
                    <span className="text-[9px] text-slate-700 mt-0.5 block">
                      Dikirim ke Classifier sebagai training_dist_km
                    </span>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl px-4 py-3">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600 block">
                      Rata-rata Heart Rate
                    </span>
                    <span className="text-xl font-black font-mono text-teal-300 tabular-nums leading-tight mt-0.5 block">
                      {avgHeartRate}
                      <span className="text-[11px] text-slate-600 ml-1">bpm</span>
                    </span>
                    <span className="text-[9px] text-slate-700 mt-0.5 block">
                      Representasi kapasitas kardiovaskular
                    </span>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <button
                type="button"
                onClick={handleLockProfile}
                className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest border transition-all duration-150 cursor-pointer bg-teal-500/15 border-teal-400/50 text-teal-300 hover:bg-teal-500/25 hover:border-teal-300/70 active:scale-[0.99]"
              >
                Kunci Profil Kebugaran &amp; Lanjut ke Simulasi
              </button>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 2 — PARAMETER TARGET LOMBA
          ══════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="space-y-5">

              {/* Locked profile summary */}
              <div className="bg-teal-500/5 border border-teal-500/20 rounded-2xl px-5 py-4 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-teal-600 block">
                    Profil Kebugaran Terkunci
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Avg Jarak: <span className="font-black text-orange-400">{avgTrainingDistance.toFixed(1)} km</span>
                    <span className="mx-2 text-slate-700">|</span>
                    Avg HR: <span className="font-black text-teal-300">{avgHeartRate} bpm</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleUnlockProfile}
                  className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400 transition-colors flex-shrink-0 ml-4 cursor-pointer"
                >
                  Ubah Profil
                </button>
              </div>

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-6">
                <div className="pb-4 border-b border-slate-800">
                  <h2 className="text-sm font-black uppercase tracking-[0.2em] text-teal-400">
                    Langkah 2 — Parameter Target Lomba
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Tentukan spesifikasi lomba yang ingin kamu ikuti untuk simulasi COT.
                  </p>
                </div>

                {/* Race category */}
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 block">
                    Kategori Target Lomba
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(RACE_CONFIG) as RaceCategory[]).map((cat) => {
                      const cfg      = RACE_CONFIG[cat];
                      const isActive = raceCategory === cat;
                      const isLocked =
                        (cat === 'HALF' && !halfAllowed) ||
                        (cat === 'FULL' && !fullAllowed);
                      return (
                        <button
                          key={cat}
                          type="button"
                          disabled={isLocked}
                          onClick={() => !isLocked && setRaceCategory(cat)}
                          className={`py-4 px-2 rounded-xl border transition-all duration-150 text-center ${
                            isLocked
                              ? 'bg-slate-950/20 border-slate-800/40 opacity-40 cursor-not-allowed'
                              : isActive
                                ? 'bg-teal-500/15 border-teal-400/50 cursor-pointer'
                                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 cursor-pointer'
                          }`}
                        >
                          <span className={`text-[10px] font-black uppercase tracking-wide block ${
                            isLocked ? 'text-slate-700' : isActive ? 'text-teal-300' : 'text-slate-500'
                          }`}>
                            {cfg.label}
                          </span>
                          <span className={`text-[9px] font-mono mt-1 block ${
                            isLocked ? 'text-slate-800' : isActive ? 'text-teal-500' : 'text-slate-700'
                          }`}>
                            {cfg.sublabel}
                          </span>
                          <span className={`text-[8px] font-bold uppercase tracking-wider mt-1 block ${
                            isLocked ? 'text-slate-800' : isActive ? 'text-teal-600' : 'text-slate-800'
                          }`}>
                            {isLocked ? 'DIKUNCI' : `COT ${cfg.cotLabel}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {raceConstraintWarning && (
                    <p className="text-[10px] text-amber-500/80 leading-relaxed pt-1">
                      {raceConstraintWarning}
                    </p>
                  )}
                </div>

                {/* Elevation */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Estimasi Elevasi Rute Lomba
                    </span>
                    <span className="text-xl font-black tabular-nums text-slate-200 leading-none">
                      {elevasiM}
                      <span className="text-[11px] font-semibold text-slate-500 ml-1">m</span>
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={500} step={5}
                    value={elevasiM}
                    onChange={(e) => setElevasiM(parseFloat(e.target.value))}
                    style={buildTrackStyle(elevasiM, 0, 500)}
                    className="slider-custom w-full h-[5px] rounded-full appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-700 font-mono select-none">
                    <span>0</span><span>250</span><span>500</span>
                  </div>
                </div>

                {/* Race start time */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Jam Mulai Lomba
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-black tabular-nums font-mono text-slate-200 leading-none">
                        {String(jamLari).padStart(2, '0')}:00
                      </span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${waktuInfo.classes}`}>
                        {waktuInfo.label}
                      </span>
                    </div>
                  </div>
                  <input
                    type="range" min={0} max={23} step={1}
                    value={jamLari}
                    onChange={(e) => setJamLari(parseInt(e.target.value))}
                    style={buildTrackStyle(jamLari, 0, 23)}
                    className="slider-custom w-full h-[5px] rounded-full appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-700 font-mono select-none">
                    <span>00:00</span><span>12:00</span><span>23:00</span>
                  </div>
                </div>

                {/* Gender */}
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 block">
                    Physiological Gender
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    {(['M', 'F'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGender(g)}
                        className={`py-3 rounded-xl text-xs font-bold uppercase tracking-widest border transition-all duration-100 cursor-pointer ${
                          gender === g
                            ? 'bg-teal-500/15 border-teal-400/50 text-teal-300'
                            : 'bg-slate-950/60 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-400'
                        }`}
                      >
                        {g === 'M' ? 'Male' : 'Female'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target Pace — frontend-only, never sent to backend */}
                <div className="space-y-2 pt-2 border-t border-slate-800/60">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 block">
                        Target Pace Incaran Kamu
                      </span>
                      <span className="text-[9px] text-slate-700 mt-0.5 block">
                        Hanya untuk komparasi — tidak masuk ke model AI
                      </span>
                    </div>
                    <span className="text-xl font-black tabular-nums font-mono text-violet-400 leading-none flex-shrink-0 ml-4">
                      {formatPace(targetPace)}
                      <span className="text-[11px] font-semibold text-slate-500 ml-1">/km</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={4.0} max={10.0} step={0.0833}
                    value={targetPace}
                    onChange={(e) => setTargetPace(parseFloat(parseFloat(e.target.value).toFixed(4)))}
                    style={buildTrackStyle(targetPace, 4.0, 10.0, 'rgb(167 139 250)')}
                    className="slider-custom w-full h-[5px] rounded-full appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-700 font-mono select-none">
                    <span>4:00 (cepat)</span><span>7:00</span><span>10:00 (santai)</span>
                  </div>
                </div>

              </div>

              {/* CTA */}
              <button
                type="button"
                onClick={handleStartSimulation}
                className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest border transition-all duration-150 cursor-pointer bg-teal-500/15 border-teal-400/50 text-teal-300 hover:bg-teal-500/25 hover:border-teal-300/70 active:scale-[0.99]"
              >
                Mulai Simulasi Kesiapan Maraton
              </button>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 3 — LAPORAN KELAYAKAN
          ══════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="space-y-5">

              {/* Input summary strip */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-5 py-3 flex flex-wrap gap-x-6 gap-y-1 items-center justify-between">
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span className="text-[10px] text-slate-600">
                    Avg Jarak Latihan: <span className="font-black text-orange-400">{avgTrainingDistance.toFixed(1)} km</span>
                  </span>
                  <span className="text-[10px] text-slate-600">
                    Avg HR: <span className="font-black text-teal-300">{avgHeartRate} bpm</span>
                  </span>
                  <span className="text-[10px] text-slate-600">
                    Target: <span className="font-black text-slate-300">{raceCfg.label}</span>
                  </span>
                  <span className="text-[10px] text-slate-600">
                    Elevasi: <span className="font-black text-slate-300">{elevasiM} m</span>
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                    loading
                      ? 'text-amber-400 bg-amber-500/5 border-amber-500/20'
                      : hasil
                        ? 'text-teal-500 bg-teal-500/5 border-teal-500/20'
                        : 'text-slate-600 bg-slate-800/50 border-slate-700'
                  }`}>
                    {loading ? 'COMPUTING' : hasil ? 'DONE' : 'PENDING'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-400 hover:border-slate-600 transition-colors cursor-pointer"
                  >
                    Ubah Parameter
                  </button>
                </div>
              </div>

              {/* ── Expectation vs Reality ──────────────────────────────────── */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    Expectation vs. Reality Check
                  </span>
                  <span className="text-[9px] font-mono text-slate-700">
                    Uji Realita Pace Target
                  </span>
                </div>
                <div className="grid grid-cols-2 divide-x divide-slate-800">

                  {/* Kolom kiri — ekspektasi subjektif */}
                  <div className="px-5 py-4 space-y-3">
                    <span className="text-[9px] font-black uppercase tracking-widest text-violet-500 block">
                      Ekspektasi Subjektif
                    </span>
                    <div>
                      <span className="text-[9px] text-slate-600 block mb-0.5">Target Pace Incaran</span>
                      <span className="text-2xl font-black font-mono tabular-nums text-violet-400 leading-none">
                        {formatPace(targetPace)}
                        <span className="text-[11px] text-slate-600 ml-1">/km</span>
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-600 block mb-0.5">Estimasi Durasi Ekspektasi</span>
                      <span className={`text-sm font-extrabold leading-snug text-violet-300`}>
                        {formatDurationIndo(expectedDurationSec)}
                      </span>
                    </div>
                    <div className="pt-1">
                      <span className="text-[9px] text-slate-700 leading-relaxed block">
                        Berdasarkan: {formatPace(targetPace)} /km x {raceCfg.jarakKm} km
                      </span>
                    </div>
                  </div>

                  {/* Kolom kanan — proyeksi objektif AI */}
                  <div className="px-5 py-4 space-y-3">
                    <span className="text-[9px] font-black uppercase tracking-widest text-teal-500 block">
                      Proyeksi Objektif AI
                    </span>
                    <div>
                      <span className="text-[9px] text-slate-600 block mb-0.5">Rekomendasi Pace AI</span>
                      {hasil ? (
                        <span className="text-2xl font-black font-mono tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 leading-none">
                          {hasil.rekomendasi_pace}
                        </span>
                      ) : (
                        <span className={`text-2xl font-black font-mono text-slate-700 leading-none ${loading ? 'animate-pulse' : ''}`}>
                          --:--
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-600 block mb-0.5">Estimasi Durasi AI</span>
                      <span className={`text-sm font-extrabold leading-snug transition-all duration-200 ${
                        loading ? 'text-amber-700 opacity-40' : hasil ? 'text-amber-400' : 'text-slate-700'
                      }`}>
                        {hasil ? hasil.estimasi_durasi : loading ? 'Menghitung...' : '—'}
                      </span>
                    </div>
                    <div className="pt-1">
                      <span className="text-[9px] text-slate-700 leading-relaxed block">
                        Hybrid physics + RF Regressor
                      </span>
                    </div>
                  </div>

                </div>

                {/* Gap indicator — only when AI result is available */}
                {hasil && (
                  <div className={`px-5 py-3 border-t border-slate-800 flex items-center justify-between ${
                    paceGapAggressive ? 'bg-amber-500/5' : ''
                  }`}>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600">
                      Selisih Pace
                    </span>
                    <span className={`text-xs font-black font-mono tabular-nums ${
                      paceGapAggressive
                        ? 'text-amber-400'
                        : targetPace > aiPaceFloat
                          ? 'text-slate-500'
                          : 'text-teal-400'
                    }`}>
                      {paceGapAggressive
                        ? `Target kamu ${formatPace(aiPaceFloat - targetPace)} /km lebih cepat dari AI`
                        : targetPace > aiPaceFloat
                          ? `Target kamu ${formatPace(targetPace - aiPaceFloat)} /km lebih lambat dari AI`
                          : 'Target pace selaras dengan rekomendasi AI'}
                    </span>
                  </div>
                )}
              </div>

              {/* ── COT Status Banner (three-state) ─────────────────────── */}
              <div className={`rounded-2xl border transition-colors duration-500 overflow-hidden ${
                loading || !hasil
                  ? 'bg-slate-900/40 border-slate-800'
                  : bannerStatus === 'FULLY_READY'
                    ? 'bg-emerald-700 border-emerald-500'
                    : bannerStatus === 'UNREALISTIC_TARGET'
                      ? 'bg-amber-600 border-amber-500'
                      : 'border-rose-600 animate-cot-risk'
              }`}>
                <div className="px-6 py-5">

                  {/* Header row */}
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
                      !hasil || loading ? 'text-slate-600' : 'text-white/60'
                    }`}>
                      Marathon Worthiness Validation
                    </span>
                    <span className={`text-[9px] font-mono px-2.5 py-0.5 rounded border uppercase tracking-wider flex-shrink-0 ml-3 ${
                      !hasil || loading
                        ? 'text-slate-600 bg-slate-800/50 border-slate-700'
                        : bannerStatus === 'FULLY_READY'
                          ? 'text-emerald-100 bg-emerald-900/30 border-emerald-400/30'
                          : bannerStatus === 'UNREALISTIC_TARGET'
                            ? 'text-amber-100 bg-amber-900/30 border-amber-400/30'
                            : 'text-rose-100 bg-rose-900/30 border-rose-400/30'
                    }`}>
                      {raceCfg.label} &mdash; COT {raceCfg.cotLabel}
                    </span>
                  </div>

                  {/* Main status text */}
                  <p className={`text-base font-black uppercase tracking-wider leading-snug ${
                    !hasil || loading ? 'text-slate-700' : 'text-white'
                  }`}>
                    {loading
                      ? 'STATUS: COMPUTING...'
                      : !hasil
                        ? 'STATUS: AWAITING PREDICTION'
                        : bannerStatus === 'FULLY_READY'
                          ? 'STATUS: READY FOR RACE (Diprediksi Lolos dari Cut-Off Time Lomba)'
                          : bannerStatus === 'UNREALISTIC_TARGET'
                            ? 'STATUS: REGISTRASI AMAN, TAPI TARGET EKSEKUSI BERISIKO TINGGI'
                            : 'STATUS: HIGH RISK (Diprediksi Melebihi Batas Waktu / Terkena Sweeper Bus)'}
                  </p>

                  {/* Amber warning body — hanya muncul pada state UNREALISTIC_TARGET */}
                  {hasil && !loading && bannerStatus === 'UNREALISTIC_TARGET' && (
                    <p className="mt-2 text-[11px] text-amber-100/90 leading-relaxed">
                      Secara kapasitas total durasi Anda diprediksi mampu finis sebelum batas
                      Cut-Off Time, DENGAN SYARAT Anda wajib menurunkan ego dan berlari mengikuti
                      rekomendasi pace aman dari AI. Memaksakan target pace impian Anda saat ini
                      akan memicu deplesi energi ekstrem atau kegagalan fisik sebelum kilometer 15.
                    </p>
                  )}

                  {/* Info stats row */}
                  {hasil && !loading && (
                    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 pt-4 border-t border-white/10">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">COT Limit</span>
                        <span className="text-xs font-black font-mono text-white">{raceCfg.cotLabel}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">Prediksi Kamu</span>
                        <span className="text-xs font-black font-mono text-white">{hasil.estimasi_durasi}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                          {bannerStatus === 'CRITICAL_RISK' ? 'Over Limit By' : 'Safety Margin'}
                        </span>
                        <span className={`text-xs font-black font-mono ${
                          bannerStatus === 'CRITICAL_RISK' ? 'text-rose-200' : 'text-white'
                        }`}>
                          {bannerStatus === 'CRITICAL_RISK' ? '-' : '+'}{formatSeconds(cotMarginSec)}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">Avg HR Input</span>
                        <span className="text-xs font-black font-mono text-white">{avgHeartRate} bpm</span>
                      </div>
                    </div>
                  )}

                </div>
              </div>

              {/* ── 3 Metric Cards ──────────────────────────────────────────── */}
              <div className="grid grid-cols-3 gap-4">
                <div className={`rounded-2xl p-5 flex flex-col gap-3 border bg-slate-900/40 transition-colors duration-500 ${kastaCfg ? kastaCfg.border : 'border-slate-800'}`}>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Runner Class</span>
                  <div className="flex-1 flex items-center min-h-[34px]">
                    {hasil && kastaCfg ? (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider border ${kastaCfg.text} ${kastaCfg.bg} ${kastaCfg.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${kastaCfg.dot}`} />
                        {hasil.tingkat_pengalaman}
                      </span>
                    ) : (
                      <span className={`text-sm font-bold text-slate-700 ${loading ? 'animate-pulse' : ''}`}>— — —</span>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-700">K-Means + RF Classifier</span>
                </div>

                <div className="rounded-2xl p-5 flex flex-col gap-3 border border-teal-500/20 bg-gradient-to-br from-teal-950/50 to-slate-900/40 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-teal-500/5 rounded-full translate-x-5 -translate-y-5 pointer-events-none" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-500">Target Pace</span>
                  <div className="flex-1 flex items-center min-h-[34px]">
                    <span className={`text-2xl font-black font-mono tabular-nums leading-none text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 transition-opacity duration-200 ${loading ? 'opacity-30' : 'opacity-100'}`}>
                      {hasil ? hasil.rekomendasi_pace : '--:--'}
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-600">per km</span>
                </div>

                <div className="rounded-2xl p-5 flex flex-col gap-3 border border-slate-800 bg-slate-900/40">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Est. Duration</span>
                  <div className="flex-1 flex items-center min-h-[34px]">
                    <span className={`text-sm font-extrabold leading-tight transition-all duration-200 ${loading ? 'text-amber-700 opacity-40' : 'text-amber-400'}`}>
                      {hasil ? hasil.estimasi_durasi : '—'}
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-700">Hybrid physics + RF</span>
                </div>
              </div>

              {/* ── Confidence Bars ──────────────────────────────────────────── */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Classifier Confidence</span>
                  <span className="text-[10px] font-mono text-slate-700">predict_proba output</span>
                </div>
                <div className="space-y-4">
                  {(['Advanced', 'Intermediate', 'Beginner'] as const).map((kasta) => {
                    const cfg      = KASTA_CONFIG[kasta];
                    const prob     = hasil?.confidence[kasta] ?? 0;
                    const isActive = hasil?.tingkat_pengalaman === kasta;
                    return (
                      <div key={kasta}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? cfg.dot : 'bg-slate-700'}`} />
                            <span className={`text-xs font-bold uppercase tracking-wider ${isActive ? cfg.text : 'text-slate-600'}`}>{kasta}</span>
                          </div>
                          <span className={`text-xs font-mono tabular-nums ${isActive ? cfg.text : 'text-slate-700'}`}>
                            {(prob * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-[5px] bg-slate-800/80 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ease-out ${isActive ? cfg.bar : 'bg-slate-700/50'}`}
                            style={{ width: `${prob * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {loading && (
                  <p className="text-center text-slate-700 text-[11px] font-mono mt-5 pt-4 border-t border-slate-800/50 animate-pulse">
                    Menghitung prediksi...
                  </p>
                )}
              </div>

              {/* ── AI Actionable Coaching Advice ───────────────────────────── */}
              {hasil && (
                <div className={`rounded-2xl border p-6 ${
                  worthinessReady
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : 'bg-rose-500/5 border-rose-500/20'
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                      AI Actionable Coaching Advice
                    </span>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                      worthinessReady
                        ? 'text-emerald-500 bg-emerald-500/5 border-emerald-500/20'
                        : 'text-rose-500 bg-rose-500/5 border-rose-500/20'
                    }`}>
                      {worthinessReady ? 'RACE DAY TIPS' : 'IMPROVEMENT PLAN'}
                    </span>
                  </div>

                  {paceGapAggressive && (
                    <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 space-y-1">
                      <span className="text-[9px] font-black uppercase tracking-widest text-amber-500 block">
                        Peringatan Pace Agresif
                      </span>
                      <p className="text-[11px] text-amber-300 leading-relaxed">
                        Target pace incaran kamu terlalu agresif dibandingkan kapasitas kardiovaskular
                        hasil latihan kamu (Avg HR {avgHeartRate} bpm). Memaksakan pace ini berisiko
                        memaksa jantung beroperasi di zona anaerobik terlalu dini sebelum kilometer 20.
                        AI menyarankan kamu mengikuti rekomendasi pace aman{' '}
                        <span className="font-black text-white">{hasil.rekomendasi_pace} /km</span>{' '}
                        demi keselamatan dan performa optimal di hari H.
                      </p>
                    </div>
                  )}

                  {worthinessReady ? (
                    <div className="space-y-3">
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Profil latihanmu menunjukkan kesiapan fisik yang cukup untuk menyelesaikan{' '}
                        <span className="font-bold text-emerald-400">{raceCfg.label}</span> dalam
                        batas Cut-Off Time. Berikut rekomendasi manajemen energi pada hari H:
                      </p>
                      <ul className="space-y-2 mt-3">
                        {[
                          `Mulailah dengan pace ${hasil.rekomendasi_pace} /km dan pertahankan konsistensi. Jangan tergoda lari lebih cepat di 5 km pertama karena euforia crowd.`,
                          `Dengan elevasi ${elevasiM} m, atur napas saat tanjakan dan manfaatkan turunan untuk recovery. Jangan sprint di downhill terlalu agresif.`,
                          `Konsumsi gel energi atau asupan karbohidrat setiap 45 menit sekali, terutama menjelang km 30 untuk menghindari dinding energi (the wall).`,
                          `Pantau Heart Rate agar tidak melebihi zona anaerobik secara konsisten. Target HR lomba sebaiknya berada di kisaran yang serupa dengan rata-rata latihanmu (${avgHeartRate} bpm).`,
                        ].map((tip, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[11px] text-slate-400 leading-relaxed">
                            <span className="w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-[8px] font-black text-emerald-500 flex-shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Berdasarkan profil latihan dan prediksi durasi, risiko terkena sweeper bus
                        di <span className="font-bold text-rose-400">{raceCfg.label}</span> cukup
                        tinggi. Berikut langkah perbaikan yang terukur:
                      </p>
                      <ul className="space-y-2 mt-3">
                        {[
                          raceCategory === 'FULL'
                            ? `Pertimbangkan untuk mendaftar Half Marathon (21.1 km, COT 3:30:00) terlebih dahulu. Rata-rata jarak latihanmu ${avgTrainingDistance.toFixed(1)} km lebih sesuai dengan kategori tersebut untuk saat ini.`
                            : `Pertimbangkan untuk turun ke kategori 10K (COT 3:30:00) dan bangun volume latihan secara progresif sebelum mencoba ${raceCfg.label}.`,
                          `Tingkatkan volume latihan mingguan secara bertahap. Tambah rata-rata jarak per sesi sebesar 10% per minggu selama 8-12 minggu ke depan.`,
                          `Fokus pada latihan Zone 2 (65-75% max HR) untuk membangun base aerobik. Berlari terlalu sering di intensitas tinggi (HR ${avgHeartRate} bpm) menghambat adaptasi aerobik jangka panjang.`,
                          `Lakukan long run sekali per minggu dengan jarak progresif. Targetkan minimal satu long run sejauh 75% dari jarak lomba sebelum hari H.`,
                        ].map((tip, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[11px] text-slate-400 leading-relaxed">
                            <span className="w-4 h-4 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-[8px] font-black text-rose-500 flex-shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* ── Debug Panel ──────────────────────────────────────────────── */}
              <div className={`bg-slate-950 border border-slate-800/60 rounded-2xl p-5 transition-opacity duration-300 ${debug ? 'opacity-100' : 'opacity-35'}`}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Hybrid Formula Debug</span>
                  <span className="text-[10px] font-mono text-slate-700">Academic transparency panel</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                    { key: 'alpha_used',       val: debug ? debug.alpha_used.toFixed(3)               : '—', note: 'physics weight (alpha)' },
                    { key: 'pace_base',        val: debug ? `${debug.pace_base_used.toFixed(0)} s/km` : '—', note: 'from dataset median'    },
                    { key: 'physics_detik',    val: debug ? `${debug.physics_detik.toFixed(1)} s`     : '—', note: 'domain logic output'    },
                    { key: 'rf_raw_detik',     val: debug ? `${debug.rf_raw_detik.toFixed(1)} s`      : '—', note: 'RF model raw output'    },
                  ].map(({ key, val, note }) => (
                    <div key={key} className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-3">
                      <p className="text-[10px] font-mono text-slate-700 mb-1.5 truncate">{key}</p>
                      <p className="text-sm font-black font-mono text-slate-200 tabular-nums">{val}</p>
                      <p className="text-[9px] text-slate-700 mt-1.5 leading-tight">{note}</p>
                    </div>
                  ))}
                </div>
                {debug && (
                  <div className="bg-slate-900/40 rounded-xl px-3 py-2.5 border border-slate-800/40 mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1">Classifier Input</p>
                    <p className="text-[10px] font-mono text-slate-600">
                      training_dist = {debug.training_dist_km_used} km
                      <span className="mx-2 text-slate-800">|</span>
                      race_dist = {debug.race_dist_km_used} km
                    </p>
                  </div>
                )}
                <div className="bg-slate-900/40 rounded-xl px-3 py-2.5 border border-slate-800/40">
                  <p className="text-[11px] font-mono text-slate-500 leading-relaxed break-all">
                    {debug && hasil
                      ? `final = ${debug.alpha_used.toFixed(2)} x physics(${debug.physics_detik.toFixed(1)}s) + ${(1 - debug.alpha_used).toFixed(2)} x rf(${debug.rf_raw_detik.toFixed(1)}s) = ${hasil.total_detik.toFixed(1)}s`
                      : 'final = alpha x physics_detik + (1 - alpha) x rf_raw_detik — awaiting data'
                    }
                  </p>
                </div>
              </div>

              {/* ── Feedback Widget ──────────────────────────────────────────── */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">User Feedback</span>
                  <span className="text-[10px] font-mono text-slate-700">Academic requirement · LO3</span>
                </div>
                {fbSubmitted ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <div className="w-10 h-10 rounded-full bg-teal-500/10 border border-teal-500/25 flex items-center justify-center">
                      <div className="w-3 h-3 rounded-full bg-teal-400" />
                    </div>
                    <p className="text-sm font-bold text-teal-400 tracking-wide">Feedback Recorded</p>
                    <p className="text-[11px] text-slate-600 text-center max-w-xs leading-relaxed">
                      Terima kasih. Respons kamu ({fbRating ? FEEDBACK_LABELS[fbRating] : ''}) telah
                      dicatat dan akan dimasukkan dalam analisis user testing.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs text-slate-400 mb-3 font-medium">
                        Seberapa akurat prediksi ini dibandingkan kemampuan lari kamu sesungguhnya?
                      </p>
                      <div className="grid grid-cols-5 gap-2">
                        {([1, 2, 3, 4, 5] as FeedbackRating[]).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setFbRating(r)}
                            className={`py-3 rounded-xl text-[10px] font-bold border transition-all duration-100 cursor-pointer text-center leading-tight px-1 ${
                              fbRating === r
                                ? 'bg-teal-500/15 border-teal-400/50 text-teal-300'
                                : 'bg-slate-950/60 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-400'
                            }`}
                          >
                            {FEEDBACK_LABELS[r]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-2 font-medium">
                        Komentar kualitatif <span className="text-slate-700">(opsional)</span>
                      </p>
                      <textarea
                        rows={3}
                        value={fbComment}
                        onChange={(e) => setFbComment(e.target.value)}
                        placeholder="Contoh: Prediksi terasa terlalu optimistis untuk rute dengan elevasi tinggi..."
                        className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-300 placeholder-slate-700 focus:outline-none focus:border-slate-700 transition resize-none font-mono leading-relaxed"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 pt-1">
                      <span className="text-[10px] text-slate-700 font-mono flex-shrink-0">
                        {fbRating ? `Selected: ${FEEDBACK_LABELS[fbRating]}` : 'Pilih rating di atas untuk mengaktifkan submit'}
                      </span>
                      <button
                        type="button"
                        onClick={handleFeedbackSubmit}
                        disabled={!fbRating}
                        className="px-6 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all duration-150 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed bg-teal-500/10 border-teal-500/30 text-teal-400 hover:bg-teal-500/20 hover:border-teal-400/50 flex-shrink-0"
                      >
                        Submit Feedback
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ── Footer ──────────────────────────────────────────────────────── */}
          <footer className="mt-12 pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-[11px] text-slate-700 font-mono">Machine Learning Final Project · BINUS University</p>
            <p className="text-[11px] text-slate-700 font-mono">K-Means + RF Classifier + RF Regressor · Hybrid Formula</p>
          </footer>

        </div>
      </div>
    </>
  );
}
