import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '/*': ['./data/**/*', './redi-data/**/*'],
    proxy: ['./data/**/*', './redi-data/**/*'],
    middleware: ['./data/**/*', './redi-data/**/*'],
  },
  devIndicators: false,
  serverExternalPackages: [
    '@visorcraft/mongreldb',
    '@visorcraft/mongreldb-kit',
    'argon2',
    'imapflow',
    'nodemailer',
    'twilio',
    'node-cron',
    'openai',
    '@modelcontextprotocol/sdk',
  ],
};

export default nextConfig;
