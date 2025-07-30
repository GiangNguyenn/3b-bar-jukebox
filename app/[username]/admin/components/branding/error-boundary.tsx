'use client'

import { Component, type ReactNode } from 'react'
import { Card } from '@/components/ui/card'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class BrandingErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }): void {
    console.error('Branding error boundary caught an error:', error, errorInfo)
  }

  render(): JSX.Element | null {
    if (this.state.hasError) {
      return (
        <Card className='p-6'>
          <h3 className='mb-4 text-lg font-semibold text-red-600'>
            Something went wrong with the branding settings
          </h3>
          <p className='mb-4 text-gray-600'>
            There was an error loading the branding configuration. Please try
            refreshing the page.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className='text-white rounded-md bg-blue-600 px-4 py-2 hover:bg-blue-700'
          >
            Try Again
          </button>
        </Card>
      )
    }

    return this.props.children as JSX.Element
  }
}
