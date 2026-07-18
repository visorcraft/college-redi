import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  webpack(config, { isServer }) {
    if (isServer) config.externals.push('@visorcraft/mongreldb', '@visorcraft/mongreldb-kit');
    return config;
  },
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
