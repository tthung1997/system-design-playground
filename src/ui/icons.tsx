import { useId } from 'react';
import type { ReactNode, SVGProps } from 'react';
import type { NodeKind } from '../model/types.ts';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="System Design Playground logo">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M32 3 56 17v30L32 61 8 47V17z" fill="#10143a" stroke={`url(#${id})`} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M20 40 32 22l12 18M20 40h24" fill="none" stroke={`url(#${id})`} strokeWidth="3" strokeLinejoin="round" opacity=".55" />
      <circle cx="32" cy="22" r="5.5" fill="#22d3ee" />
      <circle cx="20" cy="40" r="5.5" fill="#8b5cf6" />
      <circle cx="44" cy="40" r="5.5" fill="#a78bfa" />
    </svg>
  );
}

export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);
export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);
export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);
export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 10v4M12 17.5h.01" />
  </Svg>
);
export const CursorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 3 14 7-6 2-2 6z" />
  </Svg>
);

const ClientsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <circle cx="17.5" cy="9" r="2.5" />
    <path d="M17 14.2c2.6.3 4.5 2.3 4.5 5.3" />
  </Svg>
);
const CdnIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </Svg>
);
const LoadBalancerIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="2.5" />
    <circle cx="5.5" cy="19" r="2.5" />
    <circle cx="18.5" cy="19" r="2.5" />
    <path d="M12 7.5V11M12 11l-6 5M12 11l6 5" />
  </Svg>
);
const ServiceIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </Svg>
);
const CacheIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Svg>
);
const QueueIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h13M3 12h18M3 18h9" />
  </Svg>
);
const DatabaseIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Svg>
);

/** Per-kind icon and accent color; the color feeds the `--kind` CSS variable. */
export const KIND_STYLES: Record<NodeKind, { Icon: (p: IconProps) => ReactNode; color: string }> = {
  client: { Icon: ClientsIcon, color: 'var(--kind-client)' },
  cdn: { Icon: CdnIcon, color: 'var(--kind-cdn)' },
  loadBalancer: { Icon: LoadBalancerIcon, color: 'var(--kind-lb)' },
  service: { Icon: ServiceIcon, color: 'var(--kind-service)' },
  cache: { Icon: CacheIcon, color: 'var(--kind-cache)' },
  queue: { Icon: QueueIcon, color: 'var(--kind-queue)' },
  database: { Icon: DatabaseIcon, color: 'var(--kind-db)' },
};

export function KindTile({ kind, size = 28 }: { kind: NodeKind; size?: number }) {
  const { Icon, color } = KIND_STYLES[kind];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg"
      style={{
        width: size,
        height: size,
        color,
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      <Icon size={Math.round(size * 0.58)} />
    </span>
  );
}
