/**
 * Client Schools React Query Hooks
 *
 * Provides easy access to client school data from any React component.
 * Uses React Query (TanStack Query) for caching, deduplication, and
 * background refetching.
 *
 * Data flows:
 *   Supabase `client_schools` table  -->  clientSchoolsService.js  -->  this hook  -->  component
 *                                          (with in-memory cache)       (with React Query cache)
 *
 * Usage:
 *   import { useClientSchools, useIsClientSchool } from '../hooks/useClientSchools'
 *
 *   function MyComponent() {
 *     const { data: schools, isLoading } = useClientSchools()
 *     const isClient = useIsClientSchool('Arizona State University')
 *     ...
 *   }
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import {
  getClientSchools,
  getClientSchoolsByCategory,
  getClientSchoolByName,
  isClientSchool,
  getClientSchoolNames,
  getClientSchoolsWithDegreeCounts,
  getClientSchoolsByDegreeLevel,
  invalidateClientSchoolsCache,
} from '../services/clientSchoolsService'

// =====================================================
// QUERY KEYS
// =====================================================

export const CLIENT_SCHOOLS_KEYS = {
  all: ['client-schools'],
  list: () => [...CLIENT_SCHOOLS_KEYS.all, 'list'],
  byCategory: (category) => [...CLIENT_SCHOOLS_KEYS.all, 'category', category],
  byName: (name) => [...CLIENT_SCHOOLS_KEYS.all, 'name', name],
  byDegreeLevel: (level) => [...CLIENT_SCHOOLS_KEYS.all, 'degree-level', level],
  names: () => [...CLIENT_SCHOOLS_KEYS.all, 'names'],
  withDegreeCounts: () => [...CLIENT_SCHOOLS_KEYS.all, 'with-degree-counts'],
  isClient: (name) => [...CLIENT_SCHOOLS_KEYS.all, 'is-client', name],
}

// =====================================================
// PRIMARY HOOKS
// =====================================================

/**
 * Fetch all active client schools.
 * This is the primary hook for components that need the full client schools list.
 *
 * @returns {UseQueryResult} React Query result with `data` as an array of client school objects
 */
export function useClientSchools() {
  const { user } = useAuth()

  return useQuery({
    queryKey: CLIENT_SCHOOLS_KEYS.list(),
    queryFn: getClientSchools,
    enabled: !!user,
    staleTime: 10 * 60 * 1000, // 10 minutes -- school data changes infrequently
    gcTime: 30 * 60 * 1000,    // 30 minutes
  })
}

/**
 * Fetch client schools filtered by category (e.g., 'nursing', 'business').
 *
 * @param {string} category - The category tag to filter by
 * @returns {UseQueryResult} React Query result with matching schools
 */
export function useClientSchoolsByCategory(category) {
  const { user } = useAuth()

  return useQuery({
    queryKey: CLIENT_SCHOOLS_KEYS.byCategory(category),
    queryFn: () => getClientSchoolsByCategory(category),
    enabled: !!user && !!category,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

/**
 * Look up a specific client school by name.
 * Returns the school object or null.
 *
 * @param {string} name - The school name to search for (exact or partial)
 * @returns {UseQueryResult} React Query result with the school object or null
 */
export function useClientSchoolByName(name) {
  const { user } = useAuth()

  return useQuery({
    queryKey: CLIENT_SCHOOLS_KEYS.byName(name),
    queryFn: () => getClientSchoolByName(name),
    enabled: !!user && !!name,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

/**
 * Check if a school name is a client school.
 * Returns a boolean wrapped in React Query state.
 *
 * For synchronous checks without React Query, use:
 *   import { isKnownClientSchool } from '../config/clientSchools'
 *
 * @param {string} schoolName - The school name to check
 * @returns {UseQueryResult} React Query result with `data` as boolean
 */
export function useIsClientSchool(schoolName) {
  const { user } = useAuth()

  return useQuery({
    queryKey: CLIENT_SCHOOLS_KEYS.isClient(schoolName),
    queryFn: () => isClientSchool(schoolName),
    enabled: !!user && !!schoolName,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

// =====================================================
// UTILITY HOOKS
// =====================================================

/**
 * Get just the school names as a string array.
 * Useful for autocomplete inputs or quick lookups.
 *
 * @returns {UseQueryResult} React Query result with `data` as string[]
 */
export function useClientSchoolNames() {
  const { user } = useAuth()

  return useQuery({
    queryKey: CLIENT_SCHOOLS_KEYS.names(),
    queryFn: getClientSchoolNames,
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

/**
 * Get client schools with degree counts appended.
 * Useful for summary/dashboard views.
 *
 * @returns {UseQueryResult} React Query result with schools + degreeCount field
 */
export function useClientSchoolsWithDegreeCounts() {
  const { user } = useAuth()

  return useQuery({
    queryKey: CLIENT_SCHOOLS_KEYS.withDegreeCounts(),
    queryFn: getClientSchoolsWithDegreeCounts,
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

/**
 * Get client schools that offer degrees at a specific level.
 *
 * @param {string} degreeLevel - e.g., 'Bachelor', 'Master', 'Doctorate', 'Certificate'
 * @returns {UseQueryResult} React Query result with matching schools
 */
export function useClientSchoolsByDegreeLevel(degreeLevel) {
  const { user } = useAuth()

  return useQuery({
    queryKey: CLIENT_SCHOOLS_KEYS.byDegreeLevel(degreeLevel),
    queryFn: () => getClientSchoolsByDegreeLevel(degreeLevel),
    enabled: !!user && !!degreeLevel,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

/**
 * Hook to invalidate all client schools caches.
 * Call this after admin updates to client school data.
 *
 * Usage:
 *   const refreshClientSchools = useRefreshClientSchools()
 *   // After an admin action:
 *   refreshClientSchools()
 *
 * @returns {Function} A function that invalidates both the React Query cache
 *                     and the in-memory service cache
 */
export function useRefreshClientSchools() {
  const queryClient = useQueryClient()

  return () => {
    // Clear the in-memory cache in the service layer
    invalidateClientSchoolsCache()
    // Invalidate all React Query caches for client schools
    queryClient.invalidateQueries({ queryKey: CLIENT_SCHOOLS_KEYS.all })
  }
}
