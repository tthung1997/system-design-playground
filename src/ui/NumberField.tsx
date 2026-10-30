import { useEffect, useId, useState } from 'react';

interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Display value = stored value / scale (e.g. 60 to show seconds as minutes). */
  scale?: number;
  unit?: string;
  title?: string;
}

const show = (v: number) => String(Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

export function NumberField({ label, value, onChange, min, max, step, scale = 1, unit, title }: Props) {
  const id = useId();
  const display = value / scale;
  const [text, setText] = useState(show(display));

  // Keep the text in sync with external changes (undo/redo, presets) without disturbing typing.
  useEffect(() => {
    setText((t) => (Number(t) === display ? t : show(display)));
  }, [display]);

  const commit = (raw: string) => {
    setText(raw);
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    if (min !== undefined && n < min) return;
    if (max !== undefined && n > max) return;
    onChange(Math.round(n * scale * 1e9) / 1e9);
  };

  const invalid =
    text.trim() === '' ||
    !Number.isFinite(Number(text)) ||
    (min !== undefined && Number(text) < min) ||
    (max !== undefined && Number(text) > max);

  return (
    <div className="my-1.5 grid grid-cols-[1fr_1.1fr] items-center gap-2" title={title}>
      <label htmlFor={id} className="text-slate-700">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          className="input w-full"
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step ?? 'any'}
          aria-invalid={invalid}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setText(show(display))}
        />
        {unit && <span className="text-xs whitespace-nowrap text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}
