// TODO: Kyle to populate with actual client school list from GetEducated CRM
//
// This file serves as a LOCAL FALLBACK when the Supabase `client_schools`
// table is unreachable. The canonical source of truth is the database.
//
// The 94 schools below were extracted from the paid schools seed migration
// (supabase/migrations/20251217000000_seed_paid_schools.sql).
//
// KNOWN NON-CLIENT SCHOOLS (do NOT add these):
//   - Western Carolina University (NOT a client)
//   - Winston-Salem State University (NOT a client)
//   - Columbus State University (NOT a client)
//
// To update this list:
//   1. Export from Supabase: SELECT school_name, school_slug, geteducated_url FROM client_schools WHERE is_active = true ORDER BY school_name;
//   2. Replace the CLIENT_SCHOOLS_FALLBACK array below with the export results
//   3. Commit the change

/**
 * Client Schools Configuration
 *
 * Schools that are GetEducated clients (sponsored/partnered schools).
 * When QA reviewers comment "use a client school" or "replace with client degree",
 * the AI revision system uses this list instead of fabricating school names.
 *
 * HOW TO UPDATE:
 * 1. Add schools as they become clients
 * 2. Each school should have: name, degrees offered, and GetEducated page URL
 * 3. The AI will ONLY suggest schools from this list when "client" is mentioned
 * 4. Schools with higher priority values are preferred when multiple matches exist
 *
 * IMPORTANT: Keep GetEducated URLs (geUrl / geteducated_url) up to date. These
 * are used for internal linking. Never use .edu URLs in articles.
 */

/**
 * Fallback client school data used when Supabase is unreachable.
 * Each entry mirrors the shape of a `client_schools` row (minimal fields).
 * Degree and category data will be empty in fallback mode -- the full
 * data lives in the database.
 *
 * COST FIELDS (added for cheapest-degree selection):
 *   - avg_tuition_total: Average total tuition cost for the school's online programs (USD).
 *                        Used to rank schools by affordability. null = data not yet populated.
 *   - cost_per_credit:   Average per-credit-hour cost (USD). Useful for degree-completion
 *                        cost estimates. null = data not yet populated.
 *
 * TODO: Kyle to populate avg_tuition_total and cost_per_credit from GetEducated ranking
 *       report data. Until then, these remain null and the cheapest-school logic will
 *       gracefully fall back to the standard unsorted list.
 */
export const CLIENT_SCHOOLS_FALLBACK = [
  { school_name: 'Adelphi University', school_slug: 'adelphi-university', geteducated_url: '/online-schools/adelphi-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Alvernia University', school_slug: 'alvernia-university', geteducated_url: '/online-schools/alvernia-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'American Public University System', school_slug: 'american-public-university-system', geteducated_url: '/online-schools/american-public-university-system/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'American University', school_slug: 'american-university', geteducated_url: '/online-schools/american-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Anna Maria College', school_slug: 'anna-maria-college', geteducated_url: '/online-schools/anna-maria-college/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Arcadia University', school_slug: 'arcadia-university', geteducated_url: '/online-schools/arcadia-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Arizona State University', school_slug: 'arizona-state-university', geteducated_url: '/online-schools/arizona-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Arkansas State University', school_slug: 'arkansas-state-university', geteducated_url: '/online-schools/arkansas-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Auburn University at Montgomery', school_slug: 'auburn-university-at-montgomery', geteducated_url: '/online-schools/auburn-university-at-montgomery/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Aurora University', school_slug: 'aurora-university', geteducated_url: '/online-schools/aurora-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Avila University', school_slug: 'avila-university', geteducated_url: '/online-schools/avila-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Barry University', school_slug: 'barry-university', geteducated_url: '/online-schools/barry-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Benedictine University', school_slug: 'benedictine-university', geteducated_url: '/online-schools/benedictine-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Bowling Green State University', school_slug: 'bowling-green-state-university', geteducated_url: '/online-schools/bowling-green-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Brenau University', school_slug: 'brenau-university', geteducated_url: '/online-schools/brenau-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Campbellsville University', school_slug: 'campbellsville-university', geteducated_url: '/online-schools/campbellsville-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Carlow University', school_slug: 'carlow-university', geteducated_url: '/online-schools/carlow-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Chamberlain University', school_slug: 'chamberlain-university', geteducated_url: '/online-schools/chamberlain-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Concordia University, St. Paul', school_slug: 'concordia-university-st-paul', geteducated_url: '/online-schools/concordia-university-st-paul/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'East Central University', school_slug: 'east-central-university', geteducated_url: '/online-schools/east-central-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'East Mississippi Community College', school_slug: 'east-mississippi-community-college', geteducated_url: '/online-schools/east-mississippi-community-college/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'East Tennessee State University', school_slug: 'east-tennessee-state-university', geteducated_url: '/online-schools/east-tennessee-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Eastern Oregon University', school_slug: 'eastern-oregon-university', geteducated_url: '/online-schools/eastern-oregon-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Eastern Washington University', school_slug: 'eastern-washington-university', geteducated_url: '/online-schools/eastern-washington-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'ECPI University', school_slug: 'ecpi-university', geteducated_url: '/online-schools/ecpi-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Emporia State University', school_slug: 'emporia-state-university', geteducated_url: '/online-schools/emporia-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Fisher College', school_slug: 'fisher-college', geteducated_url: '/online-schools/fisher-college/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Fitchburg State University', school_slug: 'fitchburg-state-university', geteducated_url: '/online-schools/fitchburg-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Florida Gulf Coast University', school_slug: 'florida-gulf-coast-university', geteducated_url: '/online-schools/florida-gulf-coast-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Florida Institute of Technology', school_slug: 'florida-institute-of-technology', geteducated_url: '/online-schools/florida-institute-of-technology/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'George Mason University', school_slug: 'george-mason-university', geteducated_url: '/online-schools/george-mason-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Georgetown University', school_slug: 'georgetown-university', geteducated_url: '/online-schools/georgetown-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Grand Canyon University', school_slug: 'grand-canyon-university', geteducated_url: '/online-schools/grand-canyon-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Henderson State University', school_slug: 'henderson-state-university', geteducated_url: '/online-schools/henderson-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Johns Hopkins University', school_slug: 'johns-hopkins-university', geteducated_url: '/online-schools/johns-hopkins-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'King University', school_slug: 'king-university', geteducated_url: '/online-schools/king-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Lamar University', school_slug: 'lamar-university', geteducated_url: '/online-schools/lamar-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Liberty University', school_slug: 'liberty-university', geteducated_url: '/online-schools/liberty-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Longwood University', school_slug: 'longwood-university', geteducated_url: '/online-schools/longwood-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Methodist University', school_slug: 'methodist-university', geteducated_url: '/online-schools/methodist-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Michigan State University', school_slug: 'michigan-state-university', geteducated_url: '/online-schools/michigan-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Middlebury Institute of International Studies at Monterey', school_slug: 'middlebury-institute', geteducated_url: '/online-schools/middlebury-institute/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Millersville University of Pennsylvania', school_slug: 'millersville-university', geteducated_url: '/online-schools/millersville-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Murray State University', school_slug: 'murray-state-university', geteducated_url: '/online-schools/murray-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'National University', school_slug: 'national-university', geteducated_url: '/online-schools/national-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'New Mexico Highlands University', school_slug: 'new-mexico-highlands-university', geteducated_url: '/online-schools/new-mexico-highlands-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Northern Kentucky University', school_slug: 'northern-kentucky-university', geteducated_url: '/online-schools/northern-kentucky-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Northwest Missouri State University', school_slug: 'northwest-missouri-state-university', geteducated_url: '/online-schools/northwest-missouri-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Ohio University', school_slug: 'ohio-university', geteducated_url: '/online-schools/ohio-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Pittsburg State University', school_slug: 'pittsburg-state-university', geteducated_url: '/online-schools/pittsburg-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Purdue Global', school_slug: 'purdue-global', geteducated_url: '/online-schools/purdue-global/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Purdue University', school_slug: 'purdue-university', geteducated_url: '/online-schools/purdue-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Radford University', school_slug: 'radford-university', geteducated_url: '/online-schools/radford-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Rochester Christian University', school_slug: 'rochester-christian-university', geteducated_url: '/online-schools/rochester-christian-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Sacred Heart University', school_slug: 'sacred-heart-university', geteducated_url: '/online-schools/sacred-heart-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Saint Cloud State University', school_slug: 'saint-cloud-state-university', geteducated_url: '/online-schools/saint-cloud-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Saint Mary\'s University of Minnesota', school_slug: 'saint-marys-university-minnesota', geteducated_url: '/online-schools/saint-marys-university-minnesota/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Southeastern Oklahoma State University', school_slug: 'southeastern-oklahoma-state-university', geteducated_url: '/online-schools/southeastern-oklahoma-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Southern Illinois University-Carbondale', school_slug: 'southern-illinois-university-carbondale', geteducated_url: '/online-schools/southern-illinois-university-carbondale/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Southern Illinois University-Edwardsville', school_slug: 'southern-illinois-university-edwardsville', geteducated_url: '/online-schools/southern-illinois-university-edwardsville/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Southern New Hampshire University', school_slug: 'southern-new-hampshire-university', geteducated_url: '/online-schools/southern-new-hampshire-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Southern Oregon University', school_slug: 'southern-oregon-university', geteducated_url: '/online-schools/southern-oregon-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Southern Utah University', school_slug: 'southern-utah-university', geteducated_url: '/online-schools/southern-utah-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Southwest Minnesota State University', school_slug: 'southwest-minnesota-state-university', geteducated_url: '/online-schools/southwest-minnesota-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'St. Thomas University', school_slug: 'st-thomas-university', geteducated_url: '/online-schools/st-thomas-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Texas A&M International University', school_slug: 'texas-am-international-university', geteducated_url: '/online-schools/texas-am-international-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Texas A&M University-Corpus Christi', school_slug: 'texas-am-university-corpus-christi', geteducated_url: '/online-schools/texas-am-university-corpus-christi/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Texas State University', school_slug: 'texas-state-university', geteducated_url: '/online-schools/texas-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'The University of Texas at Arlington', school_slug: 'university-of-texas-arlington', geteducated_url: '/online-schools/university-of-texas-arlington/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'The University of Texas at Tyler', school_slug: 'university-of-texas-tyler', geteducated_url: '/online-schools/university-of-texas-tyler/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Arizona Global Campus', school_slug: 'university-of-arizona-global', geteducated_url: '/online-schools/university-of-arizona-global/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Illinois Springfield', school_slug: 'university-of-illinois-springfield', geteducated_url: '/online-schools/university-of-illinois-springfield/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Kentucky', school_slug: 'university-of-kentucky', geteducated_url: '/online-schools/university-of-kentucky/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Louisiana at Monroe', school_slug: 'university-of-louisiana-monroe', geteducated_url: '/online-schools/university-of-louisiana-monroe/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Mary Hardin-Baylor', school_slug: 'university-of-mary-hardin-baylor', geteducated_url: '/online-schools/university-of-mary-hardin-baylor/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Minnesota-Twin Cities', school_slug: 'university-of-minnesota-twin-cities', geteducated_url: '/online-schools/university-of-minnesota-twin-cities/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Mount Saint Vincent', school_slug: 'university-of-mount-saint-vincent', geteducated_url: '/online-schools/university-of-mount-saint-vincent/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of North Carolina at Pembroke', school_slug: 'university-of-north-carolina-pembroke', geteducated_url: '/online-schools/university-of-north-carolina-pembroke/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of North Carolina Wilmington', school_slug: 'university-of-north-carolina-wilmington', geteducated_url: '/online-schools/university-of-north-carolina-wilmington/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Northern Colorado', school_slug: 'university-of-northern-colorado', geteducated_url: '/online-schools/university-of-northern-colorado/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of South Carolina Aiken', school_slug: 'university-of-south-carolina-aiken', geteducated_url: '/online-schools/university-of-south-carolina-aiken/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Southern Indiana', school_slug: 'university-of-southern-indiana', geteducated_url: '/online-schools/university-of-southern-indiana/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Tulsa', school_slug: 'university-of-tulsa', geteducated_url: '/online-schools/university-of-tulsa/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of West Alabama', school_slug: 'university-of-west-alabama', geteducated_url: '/online-schools/university-of-west-alabama/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of West Florida', school_slug: 'university-of-west-florida', geteducated_url: '/online-schools/university-of-west-florida/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Wisconsin-Parkside', school_slug: 'university-of-wisconsin-parkside', geteducated_url: '/online-schools/university-of-wisconsin-parkside/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'University of Wisconsin-Superior', school_slug: 'university-of-wisconsin-superior', geteducated_url: '/online-schools/university-of-wisconsin-superior/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Wake Forest University', school_slug: 'wake-forest-university', geteducated_url: '/online-schools/wake-forest-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Walden University', school_slug: 'walden-university', geteducated_url: '/online-schools/walden-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Widener University', school_slug: 'widener-university', geteducated_url: '/online-schools/widener-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'William Paterson University of New Jersey', school_slug: 'william-paterson-university', geteducated_url: '/online-schools/william-paterson-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Winthrop University', school_slug: 'winthrop-university', geteducated_url: '/online-schools/winthrop-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Worcester State University', school_slug: 'worcester-state-university', geteducated_url: '/online-schools/worcester-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
  { school_name: 'Youngstown State University', school_slug: 'youngstown-state-university', geteducated_url: '/online-schools/youngstown-state-university/', is_active: true, categories: [], degrees: [], avg_tuition_total: null, cost_per_credit: null },
]

// Legacy export: alias for backward compatibility with existing code that
// imports CLIENT_SCHOOLS from this module (e.g., formatClientSchoolsForPrompt).
export const CLIENT_SCHOOLS = CLIENT_SCHOOLS_FALLBACK

/**
 * Known non-client schools.
 * These have been explicitly confirmed as NOT GetEducated partners.
 * The AI should avoid prioritizing these in generated content.
 */
export const KNOWN_NON_CLIENT_SCHOOLS = [
  'Western Carolina University',
  'Winston-Salem State University',
  'Columbus State University',
]

/**
 * Quick lookup Set for O(1) client school name checks (lowercase).
 * Use this for fast validation without hitting the database.
 */
export const CLIENT_SCHOOL_NAMES_SET = new Set(
  CLIENT_SCHOOLS_FALLBACK.map(s => s.school_name.toLowerCase())
)

/**
 * Quick check if a school name is in the fallback client list.
 * Case-insensitive exact match.
 *
 * @param {string} name - School name to check
 * @returns {boolean}
 */
export function isKnownClientSchool(name) {
  if (!name) return false
  return CLIENT_SCHOOL_NAMES_SET.has(name.toLowerCase().trim())
}

/**
 * Quick check if a school name is a known non-client.
 * Case-insensitive exact match.
 *
 * @param {string} name - School name to check
 * @returns {boolean}
 */
export function isKnownNonClientSchool(name) {
  if (!name) return false
  return KNOWN_NON_CLIENT_SCHOOLS.some(
    nonClient => nonClient.toLowerCase() === name.toLowerCase().trim()
  )
}

/**
 * Find client schools matching a subject area or degree level.
 * Searches the fallback data (for use when Supabase is unavailable).
 *
 * @param {Object} options - Search options
 * @param {string} options.subject - Subject area to match (e.g., 'business', 'education', 'nursing')
 * @param {string} options.level - Degree level to match (e.g., 'bachelors', 'masters', 'doctorate')
 * @param {string} options.category - Category tag to match (searches categories array)
 * @param {number} options.limit - Maximum number of schools to return (default: 5)
 * @returns {Array} Matching client schools
 */
export function findClientSchools({ subject, level, category, limit = 5 } = {}) {
  let matches = [...CLIENT_SCHOOLS_FALLBACK]

  if (subject) {
    const subjectLower = subject.toLowerCase()
    matches = matches.filter(school =>
      school.degrees?.some(d =>
        (d.degree_name || d.name || '').toLowerCase().includes(subjectLower)
      ) ||
      school.categories?.some(cat =>
        cat.toLowerCase().includes(subjectLower)
      )
    )
  }

  if (level) {
    const levelLower = level.toLowerCase()
    matches = matches.filter(school =>
      school.degrees?.some(d =>
        (d.degree_level || d.level || '').toLowerCase().includes(levelLower)
      )
    )
  }

  if (category) {
    const categoryLower = category.toLowerCase()
    matches = matches.filter(school =>
      school.categories?.some(cat =>
        cat.toLowerCase() === categoryLower
      )
    )
  }

  return matches.slice(0, limit)
}

/**
 * Format client schools for injection into AI prompts.
 * This produces a text block that can be prepended to AI generation prompts
 * so the model knows which schools are client partners.
 *
 * @param {Array} schools - Array of client school objects (defaults to all)
 * @returns {string} Formatted text block for prompt injection
 */
export function formatClientSchoolsForPrompt(schools = null) {
  const list = schools || CLIENT_SCHOOLS_FALLBACK

  if (!list || list.length === 0) {
    return `NOTE: No client schools are currently configured. When asked to use a "client" school or degree, respond with: "CLIENT SCHOOLS NOT CONFIGURED - please add schools to src/config/clientSchools.js or provide the school name manually."`
  }

  const formatted = list.map(school => {
    const degrees = school.degrees?.length > 0
      ? school.degrees.map(d => `    - ${d.degree_name || d.name} (${d.degree_level || d.level})`).join('\n')
      : '    - (degree data available in database)'
    const geUrl = school.geteducated_url || school.geUrl || 'N/A'
    return `  - ${school.school_name || school.name}
    GetEducated page: ${geUrl}
    Degrees:
${degrees}`
  }).join('\n\n')

  return `=== CLIENT SCHOOLS (SPONSORED/PARTNER SCHOOLS) ===

The following schools are GetEducated clients (partner schools). You should PROACTIVELY
reference these schools in article content when they are relevant to the topic being discussed.
Do not wait for a reviewer to ask -- actively weave client school mentions into the content.
NEVER fabricate school names or use schools not on this list as "client" schools.

${formatted}

KNOWN NON-CLIENT SCHOOLS (do NOT use these as client schools):
${KNOWN_NON_CLIENT_SCHOOLS.map(s => `  - ${s}`).join('\n')}

RULES FOR CLIENT SCHOOLS:
1. PROACTIVELY reference client schools in content when relevant to the article topic
2. When discussing schools, universities, or programs, prefer citing client schools as examples
3. Link to the GetEducated page URL, NEVER to .edu websites
4. Use the exact school and degree names as listed
5. Aim to naturally mention at least 2-3 client schools per article where topically appropriate
6. When a reviewer asks to "use a client school" or "replace with a client degree", ONLY use schools from this list
7. If no matching client school exists for the requested subject, say: "No matching client school found for [subject]. Please specify which school to use."

=== END CLIENT SCHOOLS ===`
}

/**
 * Find the cheapest client schools, optionally filtered by subject/level.
 *
 * Uses the same filtering logic as findClientSchools() but then sorts by
 * avg_tuition_total (ascending) and returns only the top N results.
 *
 * Graceful degradation:
 *   - If no schools have pricing data (all null), falls back to the
 *     unsorted findClientSchools() result so the caller always gets
 *     something useful.
 *   - Schools with null pricing are excluded from the sorted results
 *     but included in the fallback.
 *
 * @param {Object} options - Search/filter options
 * @param {string} options.subject - Subject area to match (e.g., 'business', 'nursing')
 * @param {string} options.level - Degree level to match (e.g., 'bachelors', 'masters')
 * @param {string} options.category - Category tag to match
 * @param {number} options.limit - Maximum number of schools to return (default: 3)
 * @param {'avg_tuition_total'|'cost_per_credit'} options.sortBy - Which cost field to sort by (default: 'avg_tuition_total')
 * @returns {Array} Cheapest client schools, sorted by cost ascending
 */
export function findCheapestClientSchools({ subject, level, category, limit = 3, sortBy = 'avg_tuition_total' } = {}) {
  // 1. Start with the same filtering logic as findClientSchools
  let matches = [...CLIENT_SCHOOLS_FALLBACK]

  if (subject) {
    const subjectLower = subject.toLowerCase()
    matches = matches.filter(school =>
      school.degrees?.some(d =>
        (d.degree_name || d.name || '').toLowerCase().includes(subjectLower)
      ) ||
      school.categories?.some(cat =>
        cat.toLowerCase().includes(subjectLower)
      )
    )
  }

  if (level) {
    const levelLower = level.toLowerCase()
    matches = matches.filter(school =>
      school.degrees?.some(d =>
        (d.degree_level || d.level || '').toLowerCase().includes(levelLower)
      )
    )
  }

  if (category) {
    const categoryLower = category.toLowerCase()
    matches = matches.filter(school =>
      school.categories?.some(cat =>
        cat.toLowerCase() === categoryLower
      )
    )
  }

  // 2. Filter to schools that HAVE pricing data (non-null for the chosen sort field)
  const costField = sortBy === 'cost_per_credit' ? 'cost_per_credit' : 'avg_tuition_total'
  const withPricing = matches.filter(school =>
    school[costField] !== null && school[costField] !== undefined
  )

  // 3. If no schools have pricing data, return the unsorted filtered list (graceful fallback)
  if (withPricing.length === 0) {
    return matches.slice(0, limit)
  }

  // 4. Sort by the chosen cost field ascending (cheapest first)
  withPricing.sort((a, b) => a[costField] - b[costField])

  // 5. Return top N
  return withPricing.slice(0, limit)
}

/**
 * Format cheapest client schools for injection into AI prompts.
 * Produces a text block specifically for cost/affordability articles
 * that highlights the most affordable client school options.
 *
 * @param {Array} schools - Array of client school objects (from findCheapestClientSchools)
 * @returns {string} Formatted text block for prompt injection
 */
export function formatCheapestSchoolsForPrompt(schools) {
  if (!schools || schools.length === 0) {
    return ''
  }

  // Check if any school has actual pricing data
  const hasPricingData = schools.some(s => s.avg_tuition_total !== null || s.cost_per_credit !== null)

  const formatted = schools.map((school, index) => {
    const parts = [`  ${index + 1}. ${school.school_name}`]
    parts.push(`     GetEducated page: ${school.geteducated_url || 'N/A'}`)

    if (school.avg_tuition_total !== null && school.avg_tuition_total !== undefined) {
      parts.push(`     Avg Total Tuition: $${school.avg_tuition_total.toLocaleString()}`)
    }
    if (school.cost_per_credit !== null && school.cost_per_credit !== undefined) {
      parts.push(`     Cost Per Credit: $${school.cost_per_credit.toLocaleString()}`)
    }

    const degrees = school.degrees?.length > 0
      ? school.degrees.map(d => `       - ${d.degree_name || d.name} (${d.degree_level || d.level})`).join('\n')
      : '       - (degree data available in database)'
    parts.push(`     Degrees:\n${degrees}`)

    return parts.join('\n')
  }).join('\n\n')

  let header = '=== CHEAPEST CLIENT SCHOOLS (PRIORITIZE THESE FOR AFFORDABILITY CONTENT) ===\n\n'
  if (hasPricingData) {
    header += 'The following client schools are the most affordable options. When writing about\ncost, affordability, or budget-friendly degrees, PRIORITIZE these schools.\n\n'
  } else {
    header += 'NOTE: Pricing data has not been populated yet. These are client schools that\nshould be mentioned, but no cost ranking is available. Use qualitative language.\n\n'
  }

  return `${header}${formatted}\n\n=== END CHEAPEST CLIENT SCHOOLS ===`
}

export default {
  CLIENT_SCHOOLS,
  CLIENT_SCHOOLS_FALLBACK,
  KNOWN_NON_CLIENT_SCHOOLS,
  CLIENT_SCHOOL_NAMES_SET,
  isKnownClientSchool,
  isKnownNonClientSchool,
  findClientSchools,
  findCheapestClientSchools,
  formatClientSchoolsForPrompt,
  formatCheapestSchoolsForPrompt,
}
