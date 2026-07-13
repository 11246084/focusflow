// ========== 引入所需模組 ==========
const express = require('express');           // Express 框架
const cors = require('cors');                 // CORS 跨域資源共享
const morgan = require('morgan');              // HTTP 請求日誌
const swaggerUi = require('swagger-ui-express'); // Swagger API 文件
const env = require('./config/env');            // 環境變數
const { buildCorsOptions } = require('./config/cors'); // CORS 設定
const healthRoutes = require('./routes/health.routes'); // 健康檢查路由
const apiRoutes = require('./routes');          // API 路由聚合（來自 routes/index.js）
const { notFoundHandler } = require('./middleware/notFound.middleware'); // 404 處理
const { errorHandler } = require('./middleware/error.middleware');       // 錯誤處理
const { sendSuccess } = require('./utils/apiResponse'); // 統一回應格式
const { readOpenApiYaml, readSwaggerCustomCss } = require('./docs/openapi'); // OpenAPI 規格

// ========== 建立 Express 應用 ==========
const app = express();
const openApiYaml = readOpenApiYaml();         // 讀取 OpenAPI YAML 檔案
const swaggerCustomCss = readSwaggerCustomCss(); // 讀取自訂 CSS

// ========== 全域 Middleware =========-

// CORS：未設定 ALLOWED_ORIGINS 時維持開發期相容；正式部署可改為逗號分隔白名單
app.use(cors(buildCorsOptions()));

// LINE Webhook：使用原始 body 解析（供簽章驗證）
app.use('/api/v1/line/webhook', express.raw({ type: 'application/json' }));

// JSON 解析：解析 JSON 請求體
app.use(express.json());

// URL 編碼解析：解析 URL 編碼的請求體
app.use(express.urlencoded({ extended: true }));

// Morgan：請求日誌（production 用 combined，開發用 dev）
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

// 靜態檔案：提供 uploads 目錄中的檔案（如影片）
app.use('/uploads', express.static(env.uploadDir));

// ========== 文件與 API 端點 ==========

// 重新導向 /docs 到 /docs/
app.get(/^\/docs$/, (req, res) => res.redirect('/docs/'));

// 提供 OpenAPI YAML 檔案
app.get('/docs/openapi.yaml', (req, res) => res.type('text/yaml').send(openApiYaml));

// Swagger UI：API 文件頁面
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(null, {
    customSiteTitle: 'FocusFlow API Docs',
    customCss: swaggerCustomCss,
    swaggerOptions: {
      url: '/docs/openapi.yaml',
      tryItOutEnabled: true,
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      defaultModelsExpandDepth: 0,
      defaultModelExpandDepth: 1,
      syntaxHighlight: { activate: true, theme: 'nord' },
    },
  }),
);

// 根路徑：服務狀態
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

// ========== 路由註冊 ==========

// 健康檢查：/health
app.use('/health', healthRoutes);

// API v1：所有 API 路由（由 routes/index.js 聚合）
//   /api/v1/auth/*     → auth.routes.js
//   /api/v1/courses/* → course.routes.js
//   /api/v1/qa/*      → qa.routes.js
//   /api/v1/line/*    → line.routes.js
//   /api/v1/videos/*  → video.routes.js
//   /api/v1/internal/*→ internal-video.routes.js
app.use('/api/v1', apiRoutes);

// ========== 錯誤處理 Middleware ==========

// 404：處理未匹配的路由
app.use(notFoundHandler);

// 全域錯誤：處理所有錯誤
app.use(errorHandler);

// ========== 匯出應用 ==========
module.exports = app;
