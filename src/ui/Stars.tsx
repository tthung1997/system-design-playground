export function Stars({ count, size = 16 }: { count: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${count} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden className={i <= count ? 'text-amber-500' : 'text-line'}>
          <path
            d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.2 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"
            fill={i <= count ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}
