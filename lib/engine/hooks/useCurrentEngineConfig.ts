// lib/engine/hooks/useCurrentEngineConfig.ts

import { useEngineData } from '../../state/EngineData' // Assuming path to EngineData store

/**
 * Custom hook to access the current engine configuration from the EngineData store.
 * @returns The configuration object.
 */
export function useCurrentEngineConfig() {
    return useEngineData.getState().config
}
