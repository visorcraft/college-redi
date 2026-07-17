import { buildDashboardLine } from '../../server/chat/statusLine';

export default async function RediOneLiner() {
  const { line } = await buildDashboardLine();
  return (
    <p aria-label="Redi says" className="text-sm italic text-[#1F2D50]">
      {line}
    </p>
  );
}
