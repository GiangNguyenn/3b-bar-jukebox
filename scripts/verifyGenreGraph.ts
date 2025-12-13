import {
  calculateGenreSimilarity,
  calculateAvgMaxGenreSimilarity,
  getGenreCluster
} from '../services/game/genreGraph'

const TEST_CASES = [
  { a: 'Metal', b: 'Nu Metal', expectedMin: 0.7, label: 'Parent-Child' },
  { a: 'Nu Metal', b: 'Metal', expectedMin: 0.7, label: 'Child-Parent' },
  { a: 'Thrash Metal', b: 'Nu Metal', expectedMin: 0.7, label: 'Same Cluster' },
  { a: 'Metal', b: 'Rock', expectedMin: 0.8, label: 'Related Cluster' },
  { a: 'Metal', b: 'Pop', expectedMax: 0.3, label: 'Unrelated' },
  {
    a: 'Hip Hop',
    b: 'R&B',
    expectedMin: 0.7,
    label: 'Related Cluster (Hip-Hop)'
  },
  { a: 'Trap', b: 'Hip Hop', expectedMin: 0.7, label: 'Mapped Sub-genre' },
  {
    a: 'Rock',
    b: 'Alternative Rock',
    expectedMin: 0.9,
    label: 'Partial String Match'
  }
]

console.log('=== Verifying Genre Graph Logic ===\n')

let passed = 0
let failed = 0

TEST_CASES.forEach(({ a, b, expectedMin, expectedMax, label }) => {
  const score = calculateGenreSimilarity(a, b)
  const clusterA = getGenreCluster(a)
  const clusterB = getGenreCluster(b)

  let success = true
  if (expectedMin !== undefined && score < expectedMin) success = false
  if (expectedMax !== undefined && score > expectedMax) success = false

  const status = success ? 'PASS' : 'FAIL'
  if (success) passed++
  else failed++

  console.log(`[${status}] ${label}: "${a}" vs "${b}"`)
  console.log(
    `       Score: ${score.toFixed(2)} (Expected ${expectedMin ? '>=' + expectedMin : '<=' + expectedMax})`
  )
  console.log(`       Clusters: ${clusterA} | ${clusterB}`)
  console.log('')
})

console.log('=== AvgMax Verification ===')
const listA = ['Metal', 'Rock', 'Alternative']
const listB = ['Nu Metal', 'Post-Grunge']
// Nu Metal -> Metal (0.9 partial or 0.7 cluster)
// Post-Grunge -> Rock? (maybe 0.0 if not mapped) or Alternative?
const avgMax = calculateAvgMaxGenreSimilarity(listA, listB)
console.log(`List A: ${listA.join(', ')}`)
console.log(`List B: ${listB.join(', ')}`)
console.log(`AvgMax Score: ${avgMax.score.toFixed(2)}`)

if (failed > 0) {
  console.error(`\nFAILED: ${failed} tests failed.`)
  process.exit(1)
} else {
  console.log(`\nSUCCESS: All ${passed} tests passed.`)
}
