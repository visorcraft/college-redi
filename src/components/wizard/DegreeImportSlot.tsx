'use client';

import { ImportFlow } from '@/components/degree/ImportFlow';
import type { SettingsSnapshot } from '@/lib/schemas/settings';

export function DegreeImportSlot({ settings }: { settings: SettingsSnapshot }) {
  void settings;
  return <ImportFlow compact />;
}
