'use client';

import { PrimaryButton } from '@/components/ui/forms';

export function WelcomeStep({ onComplete, busy }: { onComplete: () => Promise<void>; busy: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[#1F2D50]">Welcome aboard</h1>
      <ul className="flex flex-col gap-2 text-sm text-[#1F2D50]">
        <li>🎓 <strong>Degree planning</strong> — know exactly which courses to take, and when.</li>
        <li>🗓️ <strong>Registration tracking</strong> — never miss a registration window again.</li>
        <li>📋 <strong>Missing-item nudges</strong> — transcripts, vaccine records, forms: handled.</li>
        <li>📬 <strong>Email watching</strong> — I read your college inbox and summarize what matters.</li>
      </ul>
      <p className="text-sm text-[#1F2D50]/70">This takes about 5 minutes, and you can skip anything and come back to it.</p>
      <PrimaryButton onClick={() => onComplete()} disabled={busy}>Let&apos;s go</PrimaryButton>
    </div>
  );
}
