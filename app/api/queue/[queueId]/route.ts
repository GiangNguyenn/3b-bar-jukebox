import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { queueId: string } }
): Promise<NextResponse> {
  const { queueId } = params

  const { error } = await supabase
    .from('jukebox_queue')
    .delete()
    .eq('id', queueId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(null, { status: 200 })
}
