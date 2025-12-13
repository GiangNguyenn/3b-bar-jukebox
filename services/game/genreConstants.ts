/**
 * Shared genre constants and mappings
 * Used for both genre backfilling and similarity scoring
 */

// Common genre mappings (Wiki/User input -> Standard Spotify Genre)
export const GENRE_MAPPINGS: Record<string, string> = {
  rock: 'Rock',
  pop: 'Pop',
  'hip hop': 'Hip-Hop',
  'hip-hop': 'Hip-Hop',
  'r&b': 'R&B',
  'rhythm and blues': 'R&B',
  country: 'Country',
  jazz: 'Jazz',
  blues: 'Blues',
  electronic: 'Electronic',
  dance: 'Dance',
  folk: 'Folk',
  indie: 'Indie',
  alternative: 'Alternative',
  metal: 'Metal',
  punk: 'Punk',
  reggae: 'Reggae',
  soul: 'Soul',
  funk: 'Funk',
  disco: 'Disco',
  classical: 'Classical',
  latin: 'Latin',
  world: 'World',
  gospel: 'Gospel',
  christian: 'Christian',
  'new age': 'New Age',
  ambient: 'Ambient',
  techno: 'Techno',
  house: 'House',
  trance: 'Trance',
  dubstep: 'Dubstep',
  trap: 'Hip-Hop',
  edm: 'Electronic'
}

// Compound genre mappings (Sub-genre -> Standard Parent Genre)
// Used for heuristic matching when exact mapping fails
export const COMPOUND_GENRE_MAPPINGS: Record<string, string> = {
  'bedroom pop': 'Pop',
  bedroom: 'Pop',
  'arena rock': 'Rock',
  arena: 'Rock',
  'pop rock': 'Pop',
  'pop rap': 'Hip-Hop',
  'pop punk': 'Punk',
  'alternative rock': 'Alternative',
  'indie rock': 'Indie',
  'indie pop': 'Pop',
  'electronic dance': 'EDM',
  'deep house': 'House',
  'tropical house': 'House',
  tropical: 'House',
  deep: 'House',
  'contemporary r&b': 'R&B',
  contemporary: 'R&B',
  'neo-psychedelia': 'Alternative',
  'neo psychedelia': 'Alternative',
  psychedelia: 'Alternative',
  psychedelic: 'Alternative',

  indie: 'Indie',
  'post-punk': 'Punk',
  'post punk': 'Punk',
  'new wave': 'Alternative',
  'synth-pop': 'Pop',
  'synth pop': 'Pop',
  'art rock': 'Rock',
  'progressive rock': 'Rock',
  'prog rock': 'Rock'
}
