import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useCallback } from 'react'
import { supabase } from '../services/supabaseClient'
import { logUserInput, INPUT_TYPES } from './useUserInputLog'

/**
 * Fetch all system settings
 */
export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .order('key')

      if (error) throw error
      return data || []
    },
  })
}

/**
 * Get a single setting value with a default fallback
 */
export function useSettingValue(settingKey, defaultValue = '') {
  const { data: settings = [] } = useSystemSettings()
  const setting = settings.find(s => s.key === settingKey)
  return setting?.value ?? defaultValue
}

/**
 * Hook to get settings as a map for easy access
 */
export function useSettingsMap() {
  const { data: settings = [], isLoading, error } = useSystemSettings()

  const settingsMap = useMemo(() => {
    return settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value
      return acc
    }, {})
  }, [settings])

  const getValue = useCallback((key, defaultValue = '') => {
    return settingsMap[key] ?? defaultValue
  }, [settingsMap])

  const getBoolValue = useCallback((key, defaultValue = false) => {
    const value = settingsMap[key]
    if (value === undefined) return defaultValue
    return value === 'true'
  }, [settingsMap])

  const getIntValue = useCallback((key, defaultValue = 0) => {
    const value = settingsMap[key]
    if (value === undefined) return defaultValue
    return parseInt(value, 10) || defaultValue
  }, [settingsMap])

  const getFloatValue = useCallback((key, defaultValue = 0) => {
    const value = settingsMap[key]
    if (value === undefined) return defaultValue
    return parseFloat(value) || defaultValue
  }, [settingsMap])

  return {
    settings: settingsMap,
    getValue,
    getBoolValue,
    getIntValue,
    getFloatValue,
    isLoading,
    error,
  }
}

/**
 * Update or create a system setting
 */
export function useUpdateSetting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ key, value, category = 'workflow', description = '', note = '' }) => {
      // First, try to find existing setting
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id, value')
        .eq('key', key)
        .single()

      let result
      const previousValue = existing?.value

      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from('system_settings')
          .update({ value })
          .eq('id', existing.id)
          .select()
          .single()

        if (error) throw error
        result = data
      } else {
        // Create new
        const { data, error } = await supabase
          .from('system_settings')
          .insert({
            key,
            value,
            category,
            description,
          })
          .select()
          .single()

        if (error) throw error
        result = data
      }

      // Log the setting change to audit log
      await logUserInput({
        inputType: INPUT_TYPES.SETTING_CHANGE,
        inputText: note || `Changed ${key} to: ${value}`,
        inputContext: {
          setting_key: key,
          previous_value: previousValue,
          new_value: value,
          category,
          description,
        },
        sourceTable: 'system_settings',
        sourceRecordId: result.id,
      })

      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
    },
  })
}

/**
 * Bulk update multiple settings at once
 */
export function useBulkUpdateSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (settings, note = '') => {
      // settings is an array of { key, value, category?, description? }
      const results = []
      const changes = []

      for (const setting of settings) {
        const { data: existing } = await supabase
          .from('system_settings')
          .select('id, value')
          .eq('key', setting.key)
          .single()

        const previousValue = existing?.value

        if (existing) {
          const { data, error } = await supabase
            .from('system_settings')
            .update({ value: setting.value })
            .eq('id', existing.id)
            .select()
            .single()

          if (error) throw error
          results.push(data)
          changes.push({
            key: setting.key,
            previous: previousValue,
            new: setting.value,
          })
        } else {
          const { data, error } = await supabase
            .from('system_settings')
            .insert({
              key: setting.key,
              value: setting.value,
              category: setting.category || 'workflow',
              description: setting.description || '',
            })
            .select()
            .single()

          if (error) throw error
          results.push(data)
          changes.push({
            key: setting.key,
            previous: null,
            new: setting.value,
          })
        }
      }

      // Log the bulk setting changes
      if (changes.length > 0) {
        await logUserInput({
          inputType: INPUT_TYPES.SETTING_CHANGE,
          inputText: note || `Bulk updated ${changes.length} settings: ${changes.map(c => c.key).join(', ')}`,
          inputContext: {
            bulk_update: true,
            changes,
          },
          sourceTable: 'system_settings',
        })
      }

      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
    },
  })
}

/**
 * Delete a system setting
 */
export function useDeleteSetting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (settingKey) => {
      const { error } = await supabase
        .from('system_settings')
        .delete()
        .eq('key', settingKey)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
    },
  })
}
