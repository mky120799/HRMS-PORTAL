import * as Sentry from '@sentry/nestjs';

// Must be imported before anything else so Sentry can instrument modules.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false, // HR data: never ship request bodies / user details to a third party
  });
}
