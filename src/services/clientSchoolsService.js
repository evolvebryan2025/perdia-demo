/**
 * Client Schools Service
 *
 * Provides lookup functions for determining which schools are GetEducated
 * partners (paying clients). The AI generation pipeline uses this service
 * to prioritize client schools in generated articles.
 *
 * Data source: `client_schools` table in Supabase, with a local fallback
 * from `src/config/clientSchools.js` if the database is unreachable.
 *
 * All results are cached in memory since client school data changes
 * infrequently (updated manually via CRM sync or admin UI).
 */

import { supabase } from './supabaseClient'
import { CLIENT_SCHOOLS_FALLBACK } from '../config/clientSchools'

// =====================================================
// IN-MEMORY CACHE
// =====================================================

let cachedSchools = null
let cacheTimestamp = null
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Check if the cache is still valid
 */
function isCacheValid() {
  return cachedSchools !== null && cacheTimestamp !== null &&
    (Date.now() - cacheTimestamp) < CACHE_TTL_MS
}

/**
 * Invalidate the cache (call after admin updates)
 */
export function invalidateClientSchoolsCache() {
  cachedSchools = null
  cacheTimestamp = null
}

// =====================================================
// CORE FUNCTIONS
// =====================================================

/**
 * Fetch all active client schools from Supabase.
 * Returns cached results if available and fresh.
 * Falls back to local config if Supabase is unreachable.
 *
 * @returns {Promise<Array>} Array of client school objects
 */
export async function getClientSchools() {
  // Return cache if valid
  if (isCacheValid()) {
    return cachedSchools
  }

  try {
    const { data, error } = await supabase
      .from('client_schools')
      .select('*')
      .eq('is_active', true)
      .order('school_name', { ascending: true })

    if (error) {
      console.warn('Failed to fetch client schools from Supabase, using fallback:', error.message)
      cachedSchools = CLIENT_SCHOOLS_FALLBACK
      cacheTimestamp = Date.now()
      return cachedSchools
    }

    cachedSchools = data || []
    cacheTimestamp = Date.now()
    return cachedSchools
  } catch (err) {
    console.warn('Client schools fetch error, using fallback:', err.message)
    cachedSchools = CLIENT_SCHOOLS_FALLBACK
    cacheTimestamp = Date.now()
    return cachedSchools
  }
}

/**
 * Fetch client schools matching a specific category/topic.
 * Searches the `categories` TEXT[] column using Supabase's array contains.
 *
 * @param {string} category - Category to filter by (e.g., 'nursing', 'business', 'education')
 * @returns {Promise<Array>} Matching client schools
 */
export async function getClientSchoolsByCategory(category) {
  if (!category) return []

  const normalizedCategory = category.toLowerCase().trim()

  // If cache is valid, filter locally for speed
  if (isCacheValid() && cachedSchools) {
    return cachedSchools.filter(school =>
      school.categories &&
      school.categories.some(cat => cat.toLowerCase() === normalizedCategory)
    )
  }

  try {
    const { data, error } = await supabase
      .from('client_schools')
      .select('*')
      .eq('is_active', true)
      .contains('categories', [normalizedCategory])
      .order('school_name', { ascending: true })

    if (error) {
      console.warn('Failed to fetch client schools by category:', error.message)
      // Fall back to filtering the full list
      const allSchools = await getClientSchools()
      return allSchools.filter(school =>
        school.categories &&
        school.categories.some(cat => cat.toLowerCase() === normalizedCategory)
      )
    }

    return data || []
  } catch (err) {
    console.warn('Client schools category fetch error:', err.message)
    const allSchools = await getClientSchools()
    return allSchools.filter(school =>
      school.categories &&
      school.categories.some(cat => cat.toLowerCase() === normalizedCategory)
    )
  }
}

/**
 * Search for a specific client school by name.
 * Performs case-insensitive partial matching.
 *
 * @param {string} name - School name to search for (full or partial)
 * @returns {Promise<Object|null>} The matching client school, or null if not found
 */
export async function getClientSchoolByName(name) {
  if (!name) return null

  const normalizedName = name.toLowerCase().trim()

  // If cache is valid, search locally for speed
  if (isCacheValid() && cachedSchools) {
    // Try exact match first
    const exactMatch = cachedSchools.find(
      school => school.school_name.toLowerCase() === normalizedName
    )
    if (exactMatch) return exactMatch

    // Try partial match (name contains search term or vice versa)
    const partialMatch = cachedSchools.find(
      school =>
        school.school_name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(school.school_name.toLowerCase())
    )
    return partialMatch || null
  }

  try {
    // Try exact match first
    const { data: exactData, error: exactError } = await supabase
      .from('client_schools')
      .select('*')
      .eq('is_active', true)
      .ilike('school_name', name)
      .limit(1)
      .maybeSingle()

    if (!exactError && exactData) return exactData

    // Try partial match
    const { data: partialData, error: partialError } = await supabase
      .from('client_schools')
      .select('*')
      .eq('is_active', true)
      .ilike('school_name', `%${name}%`)
      .order('school_name', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!partialError && partialData) return partialData

    return null
  } catch (err) {
    console.warn('Client school name search error:', err.message)
    // Fall back to cache/fallback search
    const allSchools = await getClientSchools()
    return allSchools.find(
      school =>
        school.school_name.toLowerCase() === normalizedName ||
        school.school_name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(school.school_name.toLowerCase())
    ) || null
  }
}

/**
 * Check whether a given school name is a client school.
 * Returns true if the school is an active paying partner.
 *
 * This is the primary function the AI generation pipeline should call
 * to decide whether to prioritize a school in article content.
 *
 * @param {string} schoolName - The school name to check
 * @returns {Promise<boolean>} True if the school is a client
 */
export async function isClientSchool(schoolName) {
  if (!schoolName) return false
  const match = await getClientSchoolByName(schoolName)
  return match !== null
}

/**
 * Get a list of all client school names (simple string array).
 * Useful for AI prompts that need a quick reference list.
 *
 * @returns {Promise<string[]>} Array of school name strings
 */
export async function getClientSchoolNames() {
  const schools = await getClientSchools()
  return schools.map(school => school.school_name)
}

/**
 * Get client schools with their degree counts, for summary views.
 *
 * @returns {Promise<Array>} Schools with degreeCount appended
 */
export async function getClientSchoolsWithDegreeCounts() {
  const schools = await getClientSchools()
  return schools.map(school => ({
    ...school,
    degreeCount: Array.isArray(school.degrees) ? school.degrees.length : 0,
  }))
}

/**
 * Search client schools by degree level.
 * Filters schools that offer at least one degree at the specified level.
 *
 * @param {string} degreeLevel - e.g., 'Bachelor', 'Master', 'Doctorate', 'Certificate'
 * @returns {Promise<Array>} Matching client schools
 */
export async function getClientSchoolsByDegreeLevel(degreeLevel) {
  if (!degreeLevel) return []

  const normalizedLevel = degreeLevel.toLowerCase().trim()
  const schools = await getClientSchools()

  return schools.filter(school =>
    Array.isArray(school.degrees) &&
    school.degrees.some(d =>
      d.degree_level && d.degree_level.toLowerCase() === normalizedLevel
    )
  )
}

// =====================================================
// EXPORT DEFAULT (for convenient imports)
// =====================================================

export default {
  getClientSchools,
  getClientSchoolsByCategory,
  getClientSchoolByName,
  isClientSchool,
  getClientSchoolNames,
  getClientSchoolsWithDegreeCounts,
  getClientSchoolsByDegreeLevel,
  invalidateClientSchoolsCache,
}
