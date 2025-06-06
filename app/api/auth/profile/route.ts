import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    
    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      console.error('Auth error:', userError);
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.log('User data:', {
      id: user.id,
      metadata: user.user_metadata,
      email: user.email
    });

    // Check if profile already exists
    const { data: existingProfile, error: selectError } = await supabase
      .from('profiles')
      .select()
      .eq('id', user.id)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      console.error('Error checking existing profile:', selectError);
      return NextResponse.json({ error: 'Failed to check existing profile' }, { status: 500 });
    }

    if (existingProfile) {
      console.log('Profile already exists:', existingProfile);
      return NextResponse.json({ message: 'Profile already exists' });
    }

    // Create new profile
    const profileData = {
      id: user.id,
      spotify_user_id: user.user_metadata.provider_id,
      display_name: user.user_metadata.name,
      avatar_url: user.user_metadata.avatar_url
    };

    console.log('Creating profile with data:', profileData);

    const { error: insertError } = await supabase
      .from('profiles')
      .insert(profileData);

    if (insertError) {
      console.error('Error creating profile:', insertError);
      return NextResponse.json({ 
        error: 'Failed to create profile',
        details: insertError
      }, { status: 500 });
    }

    return NextResponse.json({ message: 'Profile created successfully' });
  } catch (error) {
    console.error('Error in profile creation:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 