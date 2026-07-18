import { NextResponse } from 'next/server';
import { exportUserData } from '@/server/privacy';

export async function GET() {
  const response = NextResponse.json(await exportUserData());
  response.headers.set('content-disposition', `attachment; filename="redi-export-${new Date().toISOString().slice(0, 10)}.json"`);
  response.headers.set('cache-control', 'no-store');
  return response;
}
