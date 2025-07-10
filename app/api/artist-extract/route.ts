import { NextRequest, NextResponse } from 'next/server';

// Type-guard for MusicBrainz Artist Search API response
interface MusicBrainzArtist {
  id: string;
  name: string;
  'life-span': {
    ended: boolean | null;
  };
}

interface MusicBrainzSearchResponse {
  artists: MusicBrainzArtist[];
}

function isMusicBrainzSearchResponse(data: any): data is MusicBrainzSearchResponse {
  return data && Array.isArray(data.artists);
}

// Type-guard for MusicBrainz Relations API response
interface WikipediaRelation {
  type: string;
  url: {
    resource: string;
  };
}

interface MusicBrainzRelationsResponse {
  relations: WikipediaRelation[];
}

function isMusicBrainzRelationsResponse(data: any): data is MusicBrainzRelationsResponse {
  return data && Array.isArray(data.relations);
}

// Type-guard for Wikipedia Summary API response
interface WikipediaSummaryResponse {
  extract: string;
}

function isWikipediaSummaryResponse(data: any): data is WikipediaSummaryResponse {
  return data && typeof data.extract === 'string';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const artistName = searchParams.get('artistName');

  if (!artistName) {
    return NextResponse.json({ error: 'artistName query parameter is required' }, { status: 400 });
  }

  try {
    // 1. MusicBrainz Search to find MBID
    const searchResponse = await fetch(`https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json`, {
      headers: {
        'User-Agent': 'JM-Bar-Jukebox/1.0.0 ( a.j.maxwell@bigpond.com )'
      }
    });

    if (!searchResponse.ok) {
      console.error('MusicBrainz API search error:', searchResponse.status, await searchResponse.text());
      return NextResponse.json({ error: 'Failed to fetch data from MusicBrainz' }, { status: 500 });
    }

    const searchData = await searchResponse.json();

    if (!isMusicBrainzSearchResponse(searchData) || searchData.artists.length === 0) {
      return NextResponse.json({ error: 'Artist not found' }, { status: 404 });
    }

    let wikipediaUrl: string | undefined;
    
    // Enforce exact match
    const exactMatch = searchData.artists.find(artist => artist.name.toLowerCase() === artistName.toLowerCase());

    if (!exactMatch) {
      return NextResponse.json({ error: 'Exact artist match not found' }, { status: 404 });
    }

    const artistsToSearch = [exactMatch];

    for (const artist of artistsToSearch) {
      const mbid = artist.id;
      const relationsResponse = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`, {
        headers: {
          'User-Agent': 'JM-Bar-Jukebox/1.0.0 ( a.j.maxwell@bigpond.com )'
        }
      });

      if (!relationsResponse.ok) {
        console.warn(`Could not fetch relations for MBID ${mbid}, skipping.`);
        continue;
      }

      const relationsData = await relationsResponse.json();
      if (!isMusicBrainzRelationsResponse(relationsData)) {
        console.warn(`Could not parse relations for MBID ${mbid}, skipping.`);
        continue;
      }

      const wikipediaRelation = relationsData.relations.find(
        (relation) => relation.type === 'wikipedia' || relation.type === 'wikidata'
      );

      if (wikipediaRelation) {
        if (wikipediaRelation.type === 'wikidata') {
          const wikidataId = wikipediaRelation.url.resource.split('/').pop();
          if (wikidataId) {
            const wikidataResponse = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json&props=sitelinks`);
            if (wikidataResponse.ok) {
              const wikidataData = await wikidataResponse.json();
              const sitelink = wikidataData?.entities?.[wikidataId]?.sitelinks?.enwiki;
              if (sitelink) {
                // Construct the URL from the sitelink title
                wikipediaUrl = `https://en.wikipedia.org/wiki/${sitelink.title.replace(/ /g, '_')}`;
              }
            }
          }
        } else {
            wikipediaUrl = wikipediaRelation.url.resource;
        }
        
        if (wikipediaUrl) {
            break;
        }
      }
    }

    if (!wikipediaUrl) {
      return NextResponse.json({ error: 'Wikipedia page not found for this artist' }, { status: 404 });
    }

    const pageTitle = wikipediaUrl.split('/').pop();

    if (!pageTitle) {
        return NextResponse.json({ error: 'Could not extract page title from Wikipedia URL' }, { status: 500 });
    }

    // 3. Wikipedia Extract
    const summaryResponse = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`, { redirect: 'follow' });

    if (!summaryResponse.ok) {
      console.error('Wikipedia API error:', summaryResponse.status, await summaryResponse.text());
      return NextResponse.json({ error: 'Failed to fetch data from Wikipedia' }, { status: 500 });
    }

    const summaryData = await summaryResponse.json();

    if (!isWikipediaSummaryResponse(summaryData)) {
        return NextResponse.json({ error: 'Could not parse summary from Wikipedia' }, { status: 500 });
    }

    return NextResponse.json({ extract: summaryData.extract });

  } catch (error) {
    console.error('Unexpected error in artist-extract:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}