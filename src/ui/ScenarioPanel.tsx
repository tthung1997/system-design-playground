import { useEffect, useState } from 'react';
import { formatCustomPoints, parseCustomPoints } from '../engine/index.ts';
import { MAX_STEPS } from '../engine/index.ts';
import type { TrafficProfileType } from '../model/types.ts';
import { useStore } from '../store/useStore.ts';
import { NumberField } from './NumberField.tsx';

const PROFILE_LABELS: Record<TrafficProfileType, string> = {
  constant: 'Constant',
  daily: 'Daily cycle',
  spike: 'Traffic spike',
  ramp: 'Linear ramp',
  custom: 'Custom points',
};

function CustomPoints() {
  const profile = useStore((s) => s.scenario.profile);
  const setProfile = useStore((s) => s.setProfile);
  const source = profile.type === 'custom' ? formatCustomPoints(profile.points) : '';
  const [text, setText] = useState(source);
  const [error, setError] = useState(false);

  useEffect(() => {
    setText(source);
    setError(false);
  }, [source]);

  return (
    <div className="my-1.5 grid gap-1.5">
      <label htmlFor="custom-points" className="text-slate-700">
        Points (seconds, rps per line)
      </label>
      <textarea
        className="input"
        id="custom-points"
        rows={5}
        value={text}
        aria-invalid={error}
        onChange={(e) => {
          setText(e.target.value);
          const pts = parseCustomPoints(e.target.value);
          setError(pts === null);
          if (pts) setProfile({ points: pts });
        }}
      />
      {error && <p className="text-xs text-danger">Use one "seconds, rps" pair per line.</p>}
    </div>
  );
}

export function ScenarioPanel() {
  const scenario = useStore((s) => s.scenario);
  const setScenario = useStore((s) => s.setScenario);
  const setProfileType = useStore((s) => s.setProfileType);
  const setProfile = useStore((s) => s.setProfile);
  const p = scenario.profile;
  const steps = Math.ceil(scenario.durationSec / Math.max(scenario.stepSec, 1e-9));

  return (
    <section className="card">
      <h2 className="card-title">Traffic scenario</h2>
      <div className="my-1.5 grid grid-cols-[1fr_1.1fr] items-center gap-2">
        <label htmlFor="profile-type" className="text-slate-700">
          Profile
        </label>
        <div className="flex items-center gap-1">
          <select id="profile-type" className="input w-full" value={p.type} onChange={(e) => setProfileType(e.target.value as TrafficProfileType)}>
            {(Object.keys(PROFILE_LABELS) as TrafficProfileType[]).map((t) => (
              <option key={t} value={t}>
                {PROFILE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {p.type === 'constant' && (
        <NumberField label="Load" unit="rps" min={0} value={p.rps} onChange={(v) => setProfile({ rps: v })} />
      )}
      {p.type === 'daily' && (
        <>
          <NumberField label="Off-peak load" unit="rps" min={0} value={p.baseRps} onChange={(v) => setProfile({ baseRps: v })} />
          <NumberField label="Peak load" unit="rps" min={0} value={p.peakRps} onChange={(v) => setProfile({ peakRps: v })} />
          <NumberField label="Peak hour" unit="h" min={0} max={24} value={p.peakHour} onChange={(v) => setProfile({ peakHour: v })} />
        </>
      )}
      {p.type === 'spike' && (
        <>
          <NumberField label="Base load" unit="rps" min={0} value={p.baseRps} onChange={(v) => setProfile({ baseRps: v })} />
          <NumberField label="Spike load" unit="rps" min={0} value={p.spikeRps} onChange={(v) => setProfile({ spikeRps: v })} />
          <NumberField label="Spike starts" unit="min" min={0} scale={60} value={p.startSec} onChange={(v) => setProfile({ startSec: v })} />
          <NumberField label="Spike lasts" unit="min" min={0} scale={60} value={p.durationSec} onChange={(v) => setProfile({ durationSec: v })} />
          <NumberField label="Ramp up/down" unit="min" min={0} scale={60} value={p.rampSec} onChange={(v) => setProfile({ rampSec: v })} />
        </>
      )}
      {p.type === 'ramp' && (
        <>
          <NumberField label="Start load" unit="rps" min={0} value={p.startRps} onChange={(v) => setProfile({ startRps: v })} />
          <NumberField label="End load" unit="rps" min={0} value={p.endRps} onChange={(v) => setProfile({ endRps: v })} />
        </>
      )}
      {p.type === 'custom' && <CustomPoints />}

      <NumberField label="Duration" unit="min" min={1} scale={60} value={scenario.durationSec} onChange={(v) => setScenario({ durationSec: v })} />
      <NumberField label="Time step" unit="s" min={1} value={scenario.stepSec} onChange={(v) => setScenario({ stepSec: v })} />
      <NumberField label="Noise" unit="%" min={0} max={100} scale={0.01} value={scenario.noise} onChange={(v) => setScenario({ noise: v })} title="Random variation applied to the offered load each step" />
      <NumberField label="Random seed" step={1} min={0} value={scenario.seed} onChange={(v) => setScenario({ seed: Math.floor(v) })} title="Same seed → identical results" />
      {steps > MAX_STEPS && <p className="text-xs text-danger">{steps} steps exceeds the limit of {MAX_STEPS}.</p>}
    </section>
  );
}
