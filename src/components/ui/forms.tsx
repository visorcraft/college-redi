'use client';

import { useId } from 'react';

const inputClass =
  'rounded-xl border border-[#1F2D50]/20 bg-white px-3 py-2 text-[#1F2D50] outline-none focus:ring-2 focus:ring-[#1F2D50]/40';

export function TextField(props: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; hint?: string; autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[#1F2D50]">{props.label}</label>
      <input id={id} type={props.type ?? 'text'} value={props.value} placeholder={props.placeholder}
        autoComplete={props.autoComplete} onChange={(e) => props.onChange(e.target.value)} className={inputClass} />
      {props.hint && <p className="text-xs text-[#1F2D50]/60">{props.hint}</p>}
    </div>
  );
}

export function PasswordField(props: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return <TextField {...props} type="password" autoComplete="new-password" />;
}

export function SelectField(props: {
  label: string; value: string; onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[#1F2D50]">{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)} className={inputClass}>
        {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function CheckboxField(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input id={id} type="checkbox" checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)} className="h-4 w-4 accent-[#1F2D50]" />
      <label htmlFor={id} className="text-sm text-[#1F2D50]">{props.label}</label>
    </div>
  );
}

export function PrimaryButton(props: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button type={props.type ?? 'button'} onClick={props.onClick} disabled={props.disabled}
      className="rounded-xl bg-[#1F2D50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2E416E] disabled:opacity-50">
      {props.children}
    </button>
  );
}
