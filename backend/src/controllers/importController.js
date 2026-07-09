import { mapBatch } from '../services/aiService.js';
import { validateRecord } from '../services/validator.js';

/**
 * Handles batch importing of CSV rows.
 * Request Body: { headers: Array<string>, rows: Array<Object> }
 */
export async function handleImportBatch(req, res) {
  try {
    const { headers, rows } = req.body;

    if (!headers || !Array.isArray(headers) || !rows || !Array.isArray(rows)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body. Must provide "headers" (Array) and "rows" (Array).'
      });
    }

    if (rows.length === 0) {
      return res.json({
        success: true,
        records: [],
        summary: { total: 0, imported: 0, skipped: 0 }
      });
    }

    console.log(`Processing batch of ${rows.length} rows...`);

    // 1. Call the AI mapper (handles LLM or local fallback)
    const mappedRecords = await mapBatch(headers, rows);

    // 2. Validate and format each mapped record
    let importedCount = 0;
    let skippedCount = 0;

    const processedRecords = mappedRecords.map((record, index) => {
      const rawRow = rows[index] || {};
      const validation = validateRecord(record, rawRow);

      if (validation.valid) {
        importedCount++;
      } else {
        skippedCount++;
      }

      return {
        valid: validation.valid,
        data: validation.data,
        reason: validation.reason,
        originalRow: rawRow
      };
    });

    // 3. Return results
    return res.json({
      success: true,
      records: processedRecords,
      summary: {
        total: rows.length,
        imported: importedCount,
        skipped: skippedCount
      },
      mode: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY ? 'AI' : 'MOCK_FALLBACK'
    });

  } catch (error) {
    console.error('Import Batch Handler Error:', error);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while processing the batch.',
      details: error.message
    });
  }
}
