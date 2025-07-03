import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: 'https://dcd38d2e63ff7bbc09f9b88743d46b0b@o4509417600450560.ingest.de.sentry.io/4509417600843856',
      tracesSampleRate: 1,
      debug: false,
      integrations: [
        Sentry.captureConsoleIntegration({
          levels: ['error', 'warn']
        })
      ]
    })
  }
}

export const onRequestError = Sentry.captureRequestError
