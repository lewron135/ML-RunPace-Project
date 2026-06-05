/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // In local development, Next.js proxies /api/* to the Flask server.
    // FLASK_API_URL is read from .env.local (gitignored).
    // On Vercel, this rewrite is never reached — vercel.json routes
    // /api/* directly to the api/index.py serverless function instead.
    const flaskUrl = process.env.FLASK_API_URL ?? 'http://localhost:5000';
    return [
      {
        source: '/api/:path*',
        destination: `${flaskUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;