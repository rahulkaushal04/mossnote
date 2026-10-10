/** The Mossnote mark: two moss cushions that make an "m", and an amber dot for the thing you found. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <rect width="512" height="512" rx="112" fill="var(--accent)" />
      <g
        fill="none"
        stroke="var(--accent-ink)"
        strokeWidth="46"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M132 350V268a62 62 0 0 1 124 0V350" />
        <path d="M256 268a62 62 0 0 1 124 0V308" />
      </g>
      <circle cx="380" cy="382" r="27" fill="#d9890b" />
    </svg>
  );
}
