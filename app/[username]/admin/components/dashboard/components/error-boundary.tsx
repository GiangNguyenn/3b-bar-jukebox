'use client'

import { Component, ReactNode } from 'react'
import * as Sentry from '@sentry/nextjs'

interface Props {
  children?: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  }

  public static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  public componentDidCatch(error: Error): void {
    Sentry.captureException(error)
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className='rounded-lg border border-destructive bg-destructive/10 p-4'>
          <h2 className='text-lg font-semibold text-destructive'>
            Something went wrong
          </h2>
          <p className='mt-2 text-sm text-destructive'>
            {this.props.children ??
              'An error occurred while rendering this component'}
          </p>
        </div>
      )
    }

    return this.props.children
  }
}
