'use client';

import { useState } from 'react';
import { PrimaryButton } from '@/components/ui/forms';
import { STANDARD_CHECKLIST } from '@/lib/schemas/settings';
import type { PendingChecklistItem } from '@/lib/schemas/settings';
import { useWizardSubmit, type WizardSubmitRef } from '../useWizardSubmit';

export function ChecklistStep({ onSave, busy, submitRef }: {
  onSave: (items: PendingChecklistItem[]) => Promise<void>; busy: boolean;
  submitRef?: WizardSubmitRef;
}) {
  const [checked, setChecked] = useState<boolean[]>(STANDARD_CHECKLIST.map(() => true));
  const today = new Date().toISOString().slice(0, 10);
  const [dates, setDates] = useState<string[]>(STANDARD_CHECKLIST.map(() => today));

  function save() {
    const items: PendingChecklistItem[] = STANDARD_CHECKLIST
      .map((item, i) => ({ item, i }))
      .filter(({ i }) => checked[i])
      .map(({ item, i }) => ({
        title: item.title,
        category: item.category,
        due_at: dates[i] ? new Date(`${dates[i]}T12:00:00`).toISOString() : null,
      }));
    return onSave(items);
  }

  useWizardSubmit(submitRef, () => { void save(); });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Starting checklist</h1>
      <ul className="flex flex-col gap-3">
        {STANDARD_CHECKLIST.map((item, i) => (
          <li key={item.title} className="flex flex-wrap items-center gap-3">
            <input id={`check-${i}`} type="checkbox" checked={checked[i]} aria-label={item.title}
              onChange={(e) => setChecked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
              className="h-4 w-4 accent-[#1F2D50]" />
            <label htmlFor={`check-${i}`} className="flex-1 text-sm text-[#1F2D50]">{item.title}</label>
            <input type="date" value={dates[i]} disabled={!checked[i]} aria-label={`Due date for ${item.title}`}
              onChange={(e) => setDates((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
              className="rounded-xl border border-[#1F2D50]/20 px-2 py-1 text-sm text-[#1F2D50] disabled:opacity-40" />
          </li>
        ))}
      </ul>
      {!submitRef && <PrimaryButton onClick={save} disabled={busy}>Save &amp; continue</PrimaryButton>}
    </div>
  );
}
