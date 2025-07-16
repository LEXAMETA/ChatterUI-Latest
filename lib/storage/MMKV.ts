import { MMKV } from 'react-native-mmkv'
import { StateStorage } from 'zustand/middleware'
import { useState, useEffect } from 'react'

export const mmkv = new MMKV()

export const mmkvStorage: StateStorage = {
    setItem: (name, value) => {
        return mmkv.set(name, value)
    },
    getItem: (name) => {
        const value = mmkv.getString(name)
        return value ?? null
    },
    removeItem: (name) => {
        return mmkv.delete(name)
    },
}

/**
 * React hook for managing a boolean state persisted in MMKV storage.
 * @param key Storage key
 * @param defaultValue Boolean default value (false if omitted)
 * @returns [value, setter]
 */
export function useMMKVBoolean(key: string, defaultValue = false): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = mmkv.getString(key)
    if (stored === 'true') return true
    if (stored === 'false') return false
    return defaultValue
  })

  useEffect(() => {
    mmkv.set(key, value.toString())
  }, [key, value])

  return [value, setValue]
}
