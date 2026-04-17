const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const env = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const apiRoutes = require('./routes');
const { notFoundHandler } = require('./middleware/notFound.middleware');
const { errorHandler } = require('./middleware/error.middleware');
const { sendSuccess } = require('./utils/apiResponse');
const { readOpenApiYaml } = require('./docs/openapi');

const app = express();
const openApiYaml = readOpenApiYaml();

app.use(cors());
app.use('/api/v1/line/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(env.uploadDir));
app.get(/^\/docs$/, (req, res) => res.redirect('/docs/'));
app.get('/docs/openapi.yaml', (req, res) => res.type('text/yaml').send(openApiYaml));
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(null, {
    swaggerOptions: {
      url: '/docs/openapi.yaml',
      tryItOutEnabled: true,
    },
  }),
);

app.get('/', (req, res) => {
  return sendSuccess(res, {
    message: 'Focus Flow backend is running.',
    data: {
      docs: '/docs',
      health: '/health',
      apiBase: '/api/v1',
    },
  });
});

app.use('/health', healthRoutes);
app.use('/api/v1', apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
