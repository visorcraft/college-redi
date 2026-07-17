import { ChangePasswordForm } from '@/components/settings/ChangePasswordForm';

export default function SecuritySettingsPage() {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#1F2D50]">Security</h2>
      <ChangePasswordForm />
    </section>
  );
}
