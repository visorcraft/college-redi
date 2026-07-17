export type RediMood = 'sleepy' | 'idle' | 'happy' | 'sad';

export function RediCloud({ mood = 'idle', size = 72, className = '' }: { mood?: RediMood; size?: number; className?: string }) {
  return (
    <span className={`redi-cloud ${className}`} role="img" aria-label={`Redi the cloud (${mood})`}
      style={{ display: 'inline-block', width: size, height: size * 0.75 }}>
      <style>{`
        @keyframes redi-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @media (prefers-reduced-motion: no-preference) { .redi-cloud > svg { animation: redi-bob 3.2s ease-in-out infinite; } }
      `}</style>
      <svg viewBox="0 0 96 72" width="100%" height="100%">
        <path d="M24 58a14 14 0 0 1-2-27.8A20 20 0 0 1 60 18a16 16 0 0 1 14 24A12 12 0 0 1 72 58Z" fill="#1F2D50" />
        <ellipse cx="48" cy="52" rx="23" ry="9" fill="#2E416E" />
        {mood === 'sleepy' && (
          <>
            <path d="M31 40q4.5 3.5 9 0" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M56 40q4.5 3.5 9 0" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <text x="72" y="20" fontSize="11" fill="#2E416E" fontWeight="bold">z</text>
            <text x="78" y="12" fontSize="8" fill="#2E416E" fontWeight="bold">z</text>
          </>
        )}
        {mood === 'happy' && (
          <>
            <path d="M31 42q4.5-5 9 0" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M56 42q4.5-5 9 0" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </>
        )}
        {(mood === 'idle' || mood === 'sad') && (
          <>
            <ellipse cx="35.5" cy="38" rx="5" ry="5.6" fill="#fff" />
            <ellipse cx="60.5" cy="38" rx="5" ry="5.6" fill="#fff" />
            <circle cx="36.5" cy="39" r="2.3" fill="#1F2D50" />
            <circle cx="61.5" cy="39" r="2.3" fill="#1F2D50" />
            <circle cx="37.3" cy="37.6" r="0.9" fill="#fff" />
            <circle cx="62.3" cy="37.6" r="0.9" fill="#fff" />
            {mood === 'sad' && (
              <>
                <path d="M30 30l10 2.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                <path d="M66 30l-10 2.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </>
            )}
          </>
        )}
        {mood === 'idle' && <path d="M43 50q5 3.5 10 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />}
        {mood === 'happy' && <path d="M41 49q7 6 14 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />}
        {mood === 'sad' && <path d="M43 53q5-3.5 10 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />}
      </svg>
    </span>
  );
}
