import { NextRequest, NextResponse } from 'next/server';
import { suggestSubstitutes } from '@/lib/substitute';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teacherId = searchParams.get('teacherId');
    const date = searchParams.get('date');
    if (!teacherId || !date) {
      return NextResponse.json(
        { success: false, error: 'teacherId and date are required' },
        { status: 400 }
      );
    }

    const result = await suggestSubstitutes(teacherId, date);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[substitute-suggest] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to suggest substitutes' },
      { status: 500 }
    );
  }
}
