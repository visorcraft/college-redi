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
  raining: 'ha!',
};

export function RediCloud({
  state,
  mood = 'idle',
  size = 86,
  className = '',
  onClick,
  disabled,
  children,
}: {
  state?: RediState;
  mood?: RediMood;
  size?: number;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const visualState = state ?? LEGACY_STATE[mood];
  return (
    <span
      className={`redi-cloud ${className} ${onClick ? 'redi-cloud--clickable' : ''} ${disabled ? 'redi-cloud--disabled' : ''}`}
      data-redi-state={visualState}
      role={onClick ? 'button' : 'img'}
      tabIndex={onClick ? 0 : undefined}
      aria-disabled={onClick ? disabled || visualState === 'raining' : undefined}
      aria-label={`Redi the cloud (${visualState})`}
      onClick={onClick && !disabled && visualState !== 'raining' ? onClick : undefined}
      style={{
        display: 'inline-block',
        position: 'relative',
        width: size,
        height: size * 0.75,
      }}
    >
      <style>{`
        .redi-cloud__asset { display: block; height: 100%; width: 100%; }
        .redi-cloud--clickable { cursor: pointer; }
        .redi-cloud--clickable:focus-visible { outline: 2px solid #FFC24B; outline-offset: 4px; border-radius: 8px; }
        .redi-cloud--disabled { cursor: default; }
        [data-redi-state="sleepy"] .redi-cloud__asset { opacity: .68; transform: scale(.92); }
        [data-redi-state="thinking"] .redi-cloud__asset { filter: drop-shadow(0 0 4px #FFC24B); transform: scale(1.03); }
        [data-redi-state="alert"] .redi-cloud__asset { filter: drop-shadow(0 0 7px #FFC24B); transform: rotate(-5deg); }
        [data-redi-state="celebrating"] .redi-cloud__asset { filter: drop-shadow(0 0 8px #FFC24B); transform: rotate(6deg) scale(1.08); }
        [data-redi-state="raining"] .redi-cloud__asset { filter: drop-shadow(0 0 6px #88B8FF); }
        @keyframes redi-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes redi-think { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
        @keyframes redi-alert { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
        @keyframes redi-celebrate { 0%, 100% { transform: translateY(0) rotate(6deg); } 50% { transform: translateY(-7px) rotate(-6deg); } }
        @keyframes redi-laugh-bounce { 0%, 100% { transform: translateY(0); } 25% { transform: translateY(-10px); } 50% { transform: translateY(0); } 75% { transform: translateY(-6px); } }
        @media (prefers-reduced-motion: no-preference) {
          [data-redi-state="idle"] .redi-cloud__asset { animation: redi-bob 3.2s ease-in-out infinite; }
          [data-redi-state="thinking"] .redi-cloud__asset { animation: redi-think .8s ease-in-out infinite; }
          [data-redi-state="alert"] .redi-cloud__asset { animation: redi-alert .55s ease-in-out infinite; }
          [data-redi-state="celebrating"] .redi-cloud__asset { animation: redi-celebrate .75s ease-in-out infinite; }
          [data-redi-state="raining"] .redi-cloud__asset { animation: redi-laugh-bounce .4s ease-in-out infinite; }
        }
        .redi-rain-host { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
        .redi-rain-drop {
          position: absolute;
          top: 70%;
          width: 3px;
          height: 10px;
          background: linear-gradient(180deg, rgba(136,184,255,0) 0%, #88B8FF 100%);
          border-radius: 2px;
          opacity: 0;
        }
        @keyframes redi-rain-fall {
          0% { transform: translateY(0); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(220px); opacity: 0; }
        }
        .redi-rain-drop { animation: redi-rain-fall .9s linear forwards; }
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
      {children}
    </span>
  );
}
