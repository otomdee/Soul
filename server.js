'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./api/auth');
const soulsRoutes = require('./api/souls');
const postsRoutes = require('./api/posts');
const tokensRoutes = require('./api/tokens');
const chogRoutes = require('./api/chog');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'soul' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/souls', soulsRoutes);
  app.use('/api/posts', postsRoutes);
  app.use('/api/tokens', tokensRoutes);
  app.use('/api/chog', chogRoutes);

  // Minimal frontend
  app.use(express.static(path.join(__dirname, 'public')));

  // Fallback error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const app = createApp();

// Vercel serverless export
module.exports = app;

if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  // Ensure DB exists on boot (best-effort)
  const { migrate } = require('./scripts/migrate');
  migrate()
    .catch((err) => console.error('Boot migration failed:', err.message))
    .finally(() => {
      app.listen(PORT, () => console.log(`Soul API listening on http://localhost:${PORT}`));
    });
}
