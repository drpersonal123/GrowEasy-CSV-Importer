import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleImportBatch } from './controllers/importController.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(cors());
// Parse large payloads if users upload large CSVs
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check / System Status Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    configuration: {
      port: PORT,
      geminiKeyConfigured: !!process.env.GEMINI_API_KEY,
      openaiKeyConfigured: !!process.env.OPENAI_API_KEY,
      allowMockFallback: process.env.ALLOW_MOCK_FALLBACK !== 'false'
    }
  });
});

// Import route
app.post('/api/import-batch', handleImportBatch);

// Start server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  GrowEasy CSV Importer Backend Running on port ${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/api/health`);
  console.log(`  AI Configuration:`);
  console.log(`    - Gemini Key: ${process.env.GEMINI_API_KEY ? 'Configured ✅' : 'Not Configured ❌'}`);
  console.log(`    - OpenAI Key: ${process.env.OPENAI_API_KEY ? 'Configured ✅' : 'Not Configured ❌'}`);
  console.log(`    - Mock Fallback: ${process.env.ALLOW_MOCK_FALLBACK !== 'false' ? 'Enabled (App will work without keys) ✅' : 'Disabled ❌'}`);
  console.log(`==================================================`);
});
