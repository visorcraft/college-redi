'use client';

import { useState } from 'react';
import { TextField, PrimaryButton } from '@/components/ui/forms';
import { DegreeImportSlot } from '../DegreeImportSlot';
import type { DegreeImportDraft } from '@/lib/schemas/degree';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export function DegreeStep({ settings, onComplete, busy }: {
  settings: SettingsSnapshot; onComplete: (patch?: Record<string, unknown>) => Promise<void>; busy: boolean;
}) {
  const dp = settings.degree_profile ?? { institution: '', program: '', catalog_year: '' };
  const [institution, setInstitution] = useState(dp.institution);
  const [program, setProgram] = useState(dp.program);
  const [catalogYear, setCatalogYear] = useState(dp.catalog_year);

  async function imported(_programId: string, draft: DegreeImportDraft) {
    const profile = {
      institution: draft.program.institution,
      program: draft.program.name,
      catalog_year: draft.program.catalog_year ?? '',
    };
    setInstitution(profile.institution);
    setProgram(profile.program);
    setCatalogYear(profile.catalog_year);
    await onComplete({ degree_profile: profile });
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Your degree</h1>
      <TextField label="Institution" value={institution} onChange={setInstitution} placeholder="State University" />
      <TextField label="Program" value={program} onChange={setProgram} placeholder="B.S. Computer Science" />
      <TextField label="Catalog year" value={catalogYear} onChange={setCatalogYear} placeholder="2025" />
      <DegreeImportSlot onConfirmed={imported} />
      <p className="text-sm text-[#1F2D50]/70">
        Prefer to do it yourself? You can add requirements and courses by hand later on the My Degree page.
      </p>
      <PrimaryButton
        onClick={() => onComplete({ degree_profile: { institution, program, catalog_year: catalogYear } })}
        disabled={busy}>
        Save &amp; continue
      </PrimaryButton>
    </div>
  );
}
