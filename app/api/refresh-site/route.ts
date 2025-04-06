export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh';
import { AppError } from '@/shared/utils/errorHandling';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceParam = url.searchParams.get('force');
    const shouldForce = forceParam === 'true';

    console.log('Request URL:', request.url);
    console.log('URL object:', url);
    console.log('Force param:', forceParam);
    console.log('Should force:', shouldForce);

    const result = await PlaylistRefreshServiceImpl.getInstance().refreshPlaylist(shouldForce);
    
    return NextResponse.json(result, {
      status: result.success ? 200 : 500
    });
  } catch (error) {
    console.error('Error in refresh route:', error);
    return NextResponse.json({ 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { 
      status: 500 
    });
  }
} 