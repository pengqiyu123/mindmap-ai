/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import mindmapRoutes from './routes/mindmap.js'
import ideRoutes from './routes/ide.js'
import modelRoutes from './routes/models.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/**
 * API Routes
 */
app.use('/api', mindmapRoutes)
app.use('/api/ide', ideRoutes)
app.use('/api/models', modelRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

// serve static assets in production (built by vite)
const distDir = path.resolve(__dirname, '../dist')
app.use(express.static(distDir))
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) next()
  })
})

/**
 * error handler middleware
 */
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  void _next; // Express 要求错误处理中间件为四参签名，此参数必须保留
  console.error('[server error]', error)
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
