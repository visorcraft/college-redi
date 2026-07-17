export function StatusView({ status }: { status: Record<string, unknown> }) {
  return (
    <div className="flex flex-col gap-3">
      {Object.entries(status).map(([key, value]) => (
        <section key={key} className="rounded-2xl bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#1F2D50]/60">{key}</h3>
          <pre className="whitespace-pre-wrap break-words text-sm text-[#1F2D50]">
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </pre>
        </section>
      ))}
    </div>
  );
}
