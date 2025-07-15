import { Storage } from '@lib/enums/Storage'
import { Theme } from '@lib/theme/ThemeManager'
import Toast from 'react-native-simple-toast'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { AppSettings } from '../constants/GlobalValues'
import { mmkv, mmkvStorage } from '../storage/MMKV'

const toastTime = Toast.SHORT
const maxloglength = 2000

export enum LogLevel {
    INFO,
    WARN,
    ERROR,
    DEBUG,
}

type LogEntry = {
    timestamp: string
    message: string
    level: LogLevel
}

type LogStateProps = {
    logs: LogEntry[]
    addLog: (entry: LogEntry) => void
    flushLogs: () => void
}

export namespace Logger {
    export const useLoggerState = create<LogStateProps>()(
        persist(
            (set, get) => ({
                logs: [],
                addLog: (entry) => {
                    const newlogs = [...get().logs, entry]
                    if (newlogs.length > maxloglength) newlogs.shift()
                    set(() => ({ logs: newlogs }))
                },
                flushLogs: () => {
                    set(() => ({ logs: [] }))
                },
            }),
            {
                name: Storage.Logs,
                storage: createJSONStorage(() => mmkvStorage),
                version: 1,
                partialize: (state) => ({
                    logs: state.logs,
                }),
                migrate: async (persistedState: any, version) => {
                    // No migrations yet
                },
            }
        )
    )

    export const LevelName: Record<LogLevel, string> = {
        [LogLevel.INFO]: '[INFO]',
        [LogLevel.WARN]: '[WARN]',
        [LogLevel.ERROR]: '[ERROR]',
        [LogLevel.DEBUG]: '[DEBUG]',
    }

    const insertLogs = (data: LogEntry) => {
        useLoggerState.getState().addLog(data)
    }

    const createLog = (data: string, level: LogLevel): LogEntry => {
        const timestamp = `[${new Date().toTimeString().substring(0, 8)}]`
        return { timestamp, message: data, level }
    }

    const printLog = (log: LogEntry) => {
        console.log(`${LevelName[log.level]}${log.timestamp}: ${log.message}`)
    }

    const formatMessage = (message: string, optionalParams: any[]): string => {
        if (optionalParams.length === 0) return message
        return message + ' ' + optionalParams.map(p => JSON.stringify(p)).join(' ')
    }

    export const info = (message: string, ...optionalParams: any[]) => {
        const formattedMessage = formatMessage(message, optionalParams)
        const logItem = createLog(formattedMessage, LogLevel.INFO)
        printLog(logItem)
        insertLogs(logItem)
    }

    export const infoToast = (message: string, ...optionalParams: any[]) => {
        info(message, ...optionalParams)
        Toast.show(formatMessage(message, optionalParams), toastTime)
    }

    export const warn = (message: string, ...optionalParams: any[]) => {
        const formattedMessage = formatMessage(message, optionalParams)
        const logItem = createLog(formattedMessage, LogLevel.WARN)
        printLog(logItem)
        insertLogs(logItem)
    }

    export const warnToast = (message: string, ...optionalParams: any[]) => {
        warn(message, ...optionalParams)
        Toast.show(formatMessage(message, optionalParams), toastTime, { textColor: 'yellow' })
    }

    export const error = (message: string, ...optionalParams: any[]) => {
        const formattedMessage = formatMessage(message, optionalParams)
        const logItem = createLog(formattedMessage, LogLevel.ERROR)
        printLog(logItem)
        insertLogs(logItem)
    }

    export const errorToast = (message: string, ...optionalParams: any[]) => {
        error(message, ...optionalParams)
        Toast.show(formatMessage(message, optionalParams), toastTime, { textColor: 'red' })
    }

    export const debug = (message: string, ...optionalParams: any[]) => {
        if (!__DEV__ && !mmkv.getBoolean(AppSettings.DevMode)) return
        const formattedMessage = formatMessage(message, optionalParams)
        const logItem = createLog(formattedMessage, LogLevel.DEBUG)
        printLog(logItem)
        insertLogs(logItem)
    }

    export const debugToast = (message: string, ...optionalParams: any[]) => {
        debug(message, ...optionalParams)
        Toast.show(formatMessage(message, optionalParams), toastTime, {
            textColor: 'blue',
        })
    }
}
