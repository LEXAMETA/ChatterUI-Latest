import { Storage } from '@lib/enums/Storage'
import { Logger } from '@lib/state/Logger' // Ensure Logger is imported
import { mmkvStorage } from '@lib/storage/MMKV'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { APIConfiguration, APIValues } from './APIBuilder.types'
import { defaultTemplates } from './DefaultAPI'

export interface APIManagerValue extends APIValues {
    active: boolean
    friendlyName: string
}

type APIStateProps = {
    activeIndex: number
    values: APIManagerValue[]
    customTemplates: APIConfiguration[]
    addValue: (template: APIManagerValue) => void
    addTemplate: (values: APIConfiguration) => void
    removeValue: (index: number) => void
    removeTemplate: (index: number) => void
    editValue: (value: APIManagerValue, index: number) => void
    getTemplates: () => APIConfiguration[]
}

export namespace APIState {
    export const useAPIState = create<APIStateProps>()(
        persist(
            (set, get) => ({
                activeIndex: -1,
                values: [],
                customTemplates: [],
                addValue: function (value) {
                    const values = [...get().values]
                    for (const item of values) {
                        item.active = false
                    }
                    values.push(value)
                    set((state) => ({
                        ...state,
                        values: values,
                        activeIndex: values.length - 1,
                    }))
                },

                addTemplate: function (template) {
                    const templates = get().getTemplates()
                    if (templates.some((item) => item.name === template.name)) {
                        const newName = generateUniqueName(
                            template.name,
                            templates.map((item) => item.name)
                        )
                        Logger.info(`Name exists, renaming to: ${newName}`)
                        template.name = newName
                    }
                    const output = verifyJSON(template, defaultTemplates[0])
                    set((state) => ({
                        ...state,
                        customTemplates: [...state.customTemplates, output],
                    }))
                },
                removeValue: function (index) {
                    const values = [...get().values]
                    let activeIndex = get().activeIndex
                    if (index === activeIndex) {
                        activeIndex = -1
                    }
                    values.splice(index, 1)
                    set((state) => ({ ...state, values, activeIndex }))
                },
                removeTemplate: function (index) {
                    const templates = [...get().customTemplates]
                    templates.splice(index, 1)
                    set((state) => ({ ...state, customTemplates: templates }))
                },
                editValue: function (newValue, index) {
                    const values = [...get().values]
                    const oldValue = values[index] // Potentially undefined

                    // FIX for TS18048: Check if oldValue is defined
                    if (oldValue === undefined) {
                        Logger.warn(
                            `editValue: No API entry found at index ${index}. Aborting edit.`
                        )
                        return // Exit if oldValue is undefined
                    }

                    values[index] = newValue
                    let active = {}
                    // Now oldValue is guaranteed to be defined because of the check above
                    if (newValue.active && !oldValue.active) {
                        for (let i = 0; i < values.length; i++) {
                            // FIX for TS2532: Use non-null assertion as values[i] will be defined
                            values[i]!.active = i === index
                        }
                        active = { activeIndex: index }
                    }
                    if (!newValue.active && oldValue.active) {
                        active = { activeIndex: -1 }
                    }
                    set((state) => ({ ...state, values, ...active }))
                },
                getTemplates: function () {
                    return [...defaultTemplates, ...get().customTemplates]
                },
            }),
            {
                name: Storage.API,
                storage: createJSONStorage(() => mmkvStorage),
                version: 1,
            }
        )
    )
}

// Recursively fill json in case it is incorrect
const verifyJSON = (source: any, target: any): any => {
    const fillFields = (sourceObj: any, targetObj: any): any => {
        if (typeof sourceObj !== 'object' || sourceObj === null) {
            sourceObj = Array.isArray(targetObj) ? [] : {}
        }
        for (const key of Object.keys(targetObj)) {
            if (key === 'samplerFields') continue
            if (!(key in sourceObj)) {
                sourceObj[key] = targetObj[key]
            } else if (typeof targetObj[key] === 'object' && targetObj[key] !== null) {
                sourceObj[key] = fillFields(sourceObj[key], targetObj[key])
            }
        }
        return sourceObj
    }
    return fillFields(source, target)
}

function generateUniqueName(baseName: string, names: string[]): string {
    const regex = new RegExp(`^${baseName}\\s\\((\\d+)\\)$`)
    const existingNumbers = names
        .map((item) => {
            const match = item.match(regex)
            // FIX for TS2345: Ensure match[1] is a string before parseInt
            if (match && typeof match[1] === 'string') {
                return parseInt(match[1], 10)
            }
            return null
        })
        .filter((num) => num !== null) as number[]
    const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1
    return `${baseName} (${nextNumber})`
}
