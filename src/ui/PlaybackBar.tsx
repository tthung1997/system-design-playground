import { useEffect } from 'react';
import { PLAYBACK_SECONDS, useStore } from '../store/useStore.ts';
import { fmtClock } from './format.ts';

const SPEEDS = [0.5, 1, 2, 4, 8];

/** Advances the simulation cursor while playing, frame-rate independently. */
export function usePlayback() {
  const playing = useStore((s) => s.playing);
  const hasResult = useStore((s) => s.result !== null);

  useEffect(() => {
    if (!playing || !hasResult) return;
    let raf = 0;
    let last = performance.now();
    let pos = useStore.getState().cursor;
    const tick = (now: number) => {
      const s = useStore.getState();
      if (!s.result || !s.playing) return;
      const dt = (now - last) / 1000;
      last = now;
      // Follow external seeks (slider / chart drags).
      if (Math.abs(s.cursor - pos) > 1) pos = s.cursor;
      pos += (s.result.steps / PLAYBACK_SECONDS) * s.speed * dt;
      if (pos >= s.result.steps - 1) {
        s.setCursor(s.result.steps - 1);
        s.setPlaying(false);
        return;
      }
      s.setCursor(pos);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, hasResult]);
}

export function PlaybackBar() {
  const result = useStore((s) => s.result);
  const running = useStore((s) => s.running);
  const runError = useStore((s) => s.runError);
  const cursor = useStore((s) => s.cursor);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const runSimulation = useStore((s) => s.runSimulation);
  const setCursor = useStore((s) => s.setCursor);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const clearResult = useStore((s) => s.clearResult);

  const t = result ? result.times[Math.min(cursor, result.steps - 1)]! : 0;
  const withDay = (result?.scenario.durationSec ?? 0) > 86400;

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 px-3.5 py-2">
      <button type="button" className="btn btn-primary" onClick={() => void runSimulation()} disabled={running}>
        {running ? 'Running…' : result ? '↻ Re-run' : '▶ Run simulation'}
      </button>
      <button type="button" className="btn" onClick={() => setPlaying(!playing)} disabled={!result} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸ Pause' : '▶ Play'}
      </button>
      <label className="flex items-center gap-1.5 text-slate-500">
        Speed
        <select className="input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <input
        type="range"
        className="min-w-30 flex-[1_1_200px]"
        min={0}
        max={result ? result.steps - 1 : 0}
        value={result ? cursor : 0}
        disabled={!result}
        aria-label="Simulation time"
        onChange={(e) => setCursor(Number(e.target.value))}
      />
      <span className="min-w-30 text-slate-700 tabular-nums">{result ? `t = ${fmtClock(t, withDay)}` : 'Static (peak-load) view'}</span>
      {result && (
        <button type="button" className="btn" onClick={clearResult} title="Discard results and return to the static view">
          ✕ Close
        </button>
      )}
      {runError && (
        <span className="text-xs text-danger" role="alert">
          {runError}
        </span>
      )}
    </div>
  );
}
