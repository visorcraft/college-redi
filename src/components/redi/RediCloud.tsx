import React from 'react';
import Image from 'next/image';
import type { RediState } from './widgetState';

export type RediMood = 'sleepy' | 'idle' | 'happy' | 'sad';

const LEGACY_STATE: Record<RediMood, RediState> = {
  sleepy: 'sleepy',
  idle: 'idle',
  happy: 'celebrating',
  sad: 'alert',
};

const DECORATION: Record<RediState, string> = {
  sleepy: 'zZ',
  idle: '',
  thinking: '•••',
  alert: '!',
  celebrating: '✦',
};

export function RediCloud({
  state,
  mood = 'idle',
  size = 72,
  className = '',
}: {
  state?: RediState;
  mood?: RediMood;
  size?: number;
  className?: string;
}) {
  const visualState = state ?? LEGACY_STATE[mood];
  return (
    <span
      className={`redi-cloud ${className}`}
      data-redi-state={visualState}
      role="img"
      aria-label={`Redi the cloud (${visualState})`}
      style={{
        display: 'inline-block',
        position: 'relative',
        width: size,
        height: size * 0.75,
      }}
    >
      <style>{`
        .redi-cloud__asset { display: block; height: 100%; width: 100%; }
        [data-redi-state="sleepy"] .redi-cloud__asset { opacity: .68; transform: scale(.92); }
        [data-redi-state="thinking"] .redi-cloud__asset { filter: drop-shadow(0 0 4px #FFC24B); transform: scale(1.03); }
        [data-redi-state="alert"] .redi-cloud__asset { filter: drop-shadow(0 0 7px #FFC24B); transform: rotate(-5deg); }
        [data-redi-state="celebrating"] .redi-cloud__asset { filter: drop-shadow(0 0 8px #FFC24B); transform: rotate(6deg) scale(1.08); }
        @keyframes redi-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes redi-think { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
        @keyframes redi-alert { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
        @keyframes redi-celebrate { 0%, 100% { transform: translateY(0) rotate(6deg); } 50% { transform: translateY(-7px) rotate(-6deg); } }
        @media (prefers-reduced-motion: no-preference) {
          [data-redi-state="idle"] .redi-cloud__asset { animation: redi-bob 3.2s ease-in-out infinite; }
          [data-redi-state="thinking"] .redi-cloud__asset { animation: redi-think .8s ease-in-out infinite; }
          [data-redi-state="alert"] .redi-cloud__asset { animation: redi-alert .55s ease-in-out infinite; }
          [data-redi-state="celebrating"] .redi-cloud__asset { animation: redi-celebrate .75s ease-in-out infinite; }
        }
      `}</style>
      <Image
        src="/redi-cloud.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={Math.round(size * 0.75)}
        unoptimized
        className="redi-cloud__asset"
      />
      {DECORATION[visualState] && (
        <span
          aria-hidden="true"
          data-redi-decoration={visualState}
          style={{
            position: 'absolute',
            right: visualState === 'thinking' ? '30%' : '-4%',
            top: visualState === 'thinking' ? '72%' : '-6%',
            borderRadius: 999,
            background: visualState === 'sleepy' ? 'transparent' : '#FFC24B',
            color: '#1F2D50',
            fontSize: Math.max(10, size * 0.18),
            fontWeight: 800,
            lineHeight: 1,
            padding: visualState === 'sleepy' ? 0 : '0.2em 0.35em',
          }}
        >
          {DECORATION[visualState]}
        </span>
      )}
    </span>
  );
}
