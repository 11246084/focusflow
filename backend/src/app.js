const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const apiRoutes = require('./routes');
const { notFoundHandler } = require('./middleware/notFound.middleware');
const { errorHandler } = require('./middleware/error.middleware');
const { sendSuccess } = require('./utils/apiResponse');

const app = express();

app.use(cors());
app.use('/api/v1/line/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(env.uploadDir));

app.get('/', (req, res) => {
  return sendSuccess(res, {
    message: 'Focus Flow backend is running.',
    data: {
      docs: '/health',
      apiBase: '/api/v1',
    },
  });
});

app.use('/health', healthRoutes);
app.use('/api/v1', apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
