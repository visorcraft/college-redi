const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/^\w/, (char) => char.toUpperCase());

const display = (key: string, value: unknown) => {
  if (typeof value === 'boolean') {
    if (['ok', 'reachable', 'valid', 'alive'].includes(key)) {
      return value ? 'Healthy' : 'Unavailable';
    }
    return value ? 'Yes' : 'No';
  }
  if (value === null || value === '') return 'Not available';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export function StatusView({ status }: { status: Record<string, unknown> }) {
  return (
    <div className="flex flex-col gap-3">
      {Object.entries(status).map(([key, value]) => (
        <section key={key} className="rounded-2xl bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-[#1F2D50]">{label(key)}</h3>
          {value && typeof value === 'object' ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {Object.entries(value).map(([field, fieldValue]) => (
                <div key={field}>
                  <dt className="text-[#1F2D50]/60">{label(field)}</dt>
                  <dd className="break-words text-[#1F2D50]">
                    {display(field, fieldValue)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="break-words text-sm text-[#1F2D50]">
              {display(key, value)}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
