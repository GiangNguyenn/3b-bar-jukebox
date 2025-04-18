import { createContext, useContext, ReactNode } from 'react'
import { useConsoleLogs, LogEntry } from './useConsoleLogs'

interface ConsoleLogsContextType {
  logs: LogEntry[]
  addLog: (
    level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
    message: string,
    context?: string,
    error?: Error
  ) => void
  clearLogs: () => void
}

const ConsoleLogsContext = createContext<ConsoleLogsContextType | null>(null)

export function ConsoleLogsProvider({ children }: { children: ReactNode }) {
  const { logs, addLog, clearLogs } = useConsoleLogs()

  return (
    <ConsoleLogsContext.Provider value={{ logs, addLog, clearLogs }}>
      {children}
    </ConsoleLogsContext.Provider>
  )
}

export function useConsoleLogsContext() {
  const context = useContext(ConsoleLogsContext)
  if (!context) {
    throw new Error(
      'useConsoleLogsContext must be used within a ConsoleLogsProvider'
    )
  }
  return context
}
