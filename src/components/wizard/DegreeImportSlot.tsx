'use client';

import { ImportFlow } from '@/components/degree/ImportFlow';
import type { DegreeImportDraft } from '@/lib/schemas/degree';

export function DegreeImportSlot({ onConfirmed }: {
  onConfirmed: (programId: string, draft: DegreeImportDraft) => Promise<void>;
}) {
  return <ImportFlow compact onConfirmed={onConfirmed} />;
}
