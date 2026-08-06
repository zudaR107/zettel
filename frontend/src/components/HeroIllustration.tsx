// A flat-vector note slip, in the same construction style as schloss's
// own castle illustration (flat filled shapes, no strokes, one light
// recess tone, one small signature accent mark borrowed from a sibling
// app's color rather than this app's own accent) - part of the same
// visual family, different subject and color.
export function HeroIllustration({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size * (120 / 140)}
      height={size}
      viewBox="0 0 120 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Zettel"
      className={className}
    >
      {/* Page body */}
      <rect x="15" y="10" width="90" height="120" rx="6" fill="#db2777" />

      {/* Folded corner - the darker tone, same "roof over body" trick as
          the castle's darker roof triangles and kuvert's darker flap. */}
      <path d="M75 10 L105 10 L105 40 Z" fill="#be185d" />

      {/* Written lines - the second plays a brief "write-in" flourish on
          mount (see index.css's note-line-write). */}
      <rect x="30" y="55" width="60" height="7" rx="3.5" fill="#fce7f3" />
      <rect className="note-line-write" x="30" y="72" width="42" height="7" rx="3.5" fill="#fce7f3" />

      {/* Signature mark - schloss's own violet, a small cross-service
          wink tying the illustration family together (same color kuvert
          and tafel use for theirs). */}
      <rect x="30" y="98" width="16" height="16" rx="3" fill="#863bff" />
    </svg>
  )
}
