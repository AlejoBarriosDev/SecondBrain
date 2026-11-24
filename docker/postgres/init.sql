-- Create isolated test database for Vitest integration & Playwright E2E tests
SELECT 'CREATE DATABASE secondbrain_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'secondbrain_test')\gexec
