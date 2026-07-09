import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const systemPrompt = `You are an AI data migration assistant for GrowEasy CRM. Your task is to map a batch of raw records from an uploaded CSV to the GrowEasy CRM Schema.

GrowEasy CRM Fields:
- created_at: Lead creation date (must be parseable by JavaScript Date, e.g. "YYYY-MM-DD HH:mm:ss")
- name: Full name of the lead
- email: Primary email address. If there are multiple emails, extract the first one and put the others in the "crm_note".
- country_code: Phone country code (e.g., "+91", "+1").
- mobile_without_country_code: Mobile/phone number without the country code. If there are multiple phone numbers, extract the first one and append the rest to "crm_note".
- company: Company name
- city: City
- state: State
- country: Country
- lead_owner: Lead owner email or username
- crm_status: MUST map to one of these exact values: "GOOD_LEAD_FOLLOW_UP", "DID_NOT_CONNECT", "BAD_LEAD", "SALE_DONE". If none of these status terms appear or make sense, default to "GOOD_LEAD_FOLLOW_UP".
- crm_note: Any notes, remarks, follow-up comments, additional emails/phone numbers, or non-mapped columns.
- data_source: MUST map to one of: "leads_on_demand", "meridian_tower", "eden_park", "varah_swamy", "sarjapur_plots". If none fit confidently, leave it empty.
- possession_time: Property possession time
- description: Additional description

Rules:
1. Examine the CSV headers and the values in the row to determine the best mapping.
2. Return a JSON array matching the length of the input rows.
3. Each item in the array must be an object with the above CRM field keys.
4. If a row does not contain any contact info (email or mobile), still map whatever fields you can, but make sure to fill the email and mobile fields with empty strings if they are missing. Our validator will handle skipping them.
5. Do not include any explanation or markdown formatting. Return ONLY the raw JSON array.
`;

/**
 * Maps a batch of CSV rows to CRM format using available AI or fallback.
 * @param {Array<string>} headers - CSV column headers
 * @param {Array<Object>} rows - Batch of parsed CSV rows (objects)
 * @returns {Promise<Array<Object>>} Mapped CRM records
 */
export async function mapBatch(headers, rows) {
  const isGeminiAvailable = !!process.env.GEMINI_API_KEY;
  const isOpenAIAvailable = !!process.env.OPENAI_API_KEY;

  if (isGeminiAvailable) {
    return await mapWithGemini(headers, rows);
  } else if (isOpenAIAvailable) {
    return await mapWithOpenAI(headers, rows);
  } else {
    if (process.env.ALLOW_MOCK_FALLBACK !== 'false') {
      console.warn('No Gemini or OpenAI API keys found. Falling back to local Mock AI mapping.');
      return mapWithMock(headers, rows);
    } else {
      throw new Error('API keys missing and fallback disabled. Please set GEMINI_API_KEY or OPENAI_API_KEY.');
    }
  }
}

/**
 * Mapping via Google Gemini API
 */
async function mapWithGemini(headers, rows) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      }
    });

    const userPrompt = `
CSV Headers: ${JSON.stringify(headers)}
Batch Rows: ${JSON.stringify(rows)}

Map these rows to the GrowEasy CRM schema. Output a JSON array with exactly ${rows.length} records.
    `;

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt }
    ]);

    const text = result.response.text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini API Error:', error);
    // Fallback to mock on error to maintain app robustness
    if (process.env.ALLOW_MOCK_FALLBACK !== 'false') {
      console.warn('Gemini call failed. Falling back to Mock Mapper.');
      return mapWithMock(headers, rows);
    }
    throw error;
  }
}

/**
 * Mapping via OpenAI API
 */
async function mapWithOpenAI(headers, rows) {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const userPrompt = `
CSV Headers: ${JSON.stringify(headers)}
Batch Rows: ${JSON.stringify(rows)}

Map these rows to the GrowEasy CRM schema. Output a JSON array with exactly ${rows.length} records.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content;
    const data = JSON.parse(text);
    
    // In some cases OpenAI might wrap the array in a key like "records" or "leads"
    if (Array.isArray(data)) {
      return data;
    } else if (data.records && Array.isArray(data.records)) {
      return data.records;
    } else if (data.leads && Array.isArray(data.leads)) {
      return data.leads;
    } else {
      // If it returned an object where values are the array, find it
      const keys = Object.keys(data);
      if (keys.length === 1 && Array.isArray(data[keys[0]])) {
        return data[keys[0]];
      }
      return [data];
    }
  } catch (error) {
    console.error('OpenAI API Error:', error);
    if (process.env.ALLOW_MOCK_FALLBACK !== 'false') {
      console.warn('OpenAI call failed. Falling back to Mock Mapper.');
      return mapWithMock(headers, rows);
    }
    throw error;
  }
}

/**
 * Rule-based heuristic mapper that runs locally.
 * Incredibly useful for testing layouts, columns, and edge cases.
 */
function mapWithMock(headers, rows) {
  return rows.map(row => {
    const mapped = {};
    const notesList = [];

    // Helper to find column key by keyword matching
    const findValue = (keywords) => {
      const match = Object.keys(row).find(key => {
        const k = key.toLowerCase();
        return keywords.some(kw => k.includes(kw));
      });
      return match ? row[match] : null;
    };

    // 1. Name
    const firstName = findValue(['first name', 'fname']);
    const lastName = findValue(['last name', 'lname']);
    const fullName = findValue(['full name', 'lead name', 'name', 'client', 'customer']);
    if (fullName) {
      mapped.name = fullName;
    } else if (firstName || lastName) {
      mapped.name = [firstName, lastName].filter(Boolean).join(' ');
    } else {
      mapped.name = '';
    }

    // 2. Email
    const emailVal = findValue(['email', 'mail', 'e-mail']);
    if (emailVal) {
      // If multiple emails are listed (e.g. comma separated)
      const parts = String(emailVal).split(/[,;|\s]+/).map(p => p.trim()).filter(Boolean);
      mapped.email = parts[0] || '';
      if (parts.length > 1) {
        notesList.push(`Additional emails: ${parts.slice(1).join(', ')}`);
      }
    } else {
      mapped.email = '';
    }

    // 3. Mobile and country code
    const phoneVal = findValue(['phone', 'mobile', 'cell', 'contact', 'tele', 'number']);
    if (phoneVal) {
      const cleanPhone = String(phoneVal).replace(/[^\d+]/g, '');
      if (cleanPhone.startsWith('+')) {
        // Simple country code split
        if (cleanPhone.startsWith('+91')) {
          mapped.country_code = '+91';
          mapped.mobile_without_country_code = cleanPhone.slice(3);
        } else {
          // Assume code is first 2-3 digits
          mapped.country_code = cleanPhone.slice(0, 3);
          mapped.mobile_without_country_code = cleanPhone.slice(3);
        }
      } else {
        mapped.country_code = '+91'; // default country code
        mapped.mobile_without_country_code = cleanPhone;
      }
    } else {
      mapped.country_code = '';
      mapped.mobile_without_country_code = '';
    }

    // 4. Company
    mapped.company = findValue(['company', 'firm', 'organization', 'org', 'business']) || '';

    // 5. Date
    mapped.created_at = findValue(['created', 'date', 'timestamp', 'time']) || new Date().toISOString();

    // 6. City / State / Country
    mapped.city = findValue(['city', 'town']) || '';
    mapped.state = findValue(['state', 'province', 'region']) || '';
    mapped.country = findValue(['country', 'nation']) || '';

    // 7. Lead Owner
    mapped.lead_owner = findValue(['owner', 'agent', 'assigned']) || 'test@gmail.com';

    // 8. CRM Status
    const rawStatus = findValue(['status', 'stage', 'crm status']);
    if (rawStatus) {
      const s = String(rawStatus).toUpperCase();
      if (s.includes('FOLLOW') || s.includes('GOOD') || s.includes('INTERESTED')) {
        mapped.crm_status = 'GOOD_LEAD_FOLLOW_UP';
      } else if (s.includes('BUSY') || s.includes('CONNECT') || s.includes('NO ANSWER')) {
        mapped.crm_status = 'DID_NOT_CONNECT';
      } else if (s.includes('BAD') || s.includes('JUNK') || s.includes('NOT INTERESTED')) {
        mapped.crm_status = 'BAD_LEAD';
      } else if (s.includes('SALE') || s.includes('WON') || s.includes('DONE') || s.includes('CLOSE')) {
        mapped.crm_status = 'SALE_DONE';
      } else {
        mapped.crm_status = 'GOOD_LEAD_FOLLOW_UP';
      }
    } else {
      mapped.crm_status = 'GOOD_LEAD_FOLLOW_UP';
    }

    // 9. Data Source
    const rawSource = findValue(['source', 'data source', 'campaign']);
    if (rawSource) {
      const src = String(rawSource).toLowerCase();
      if (src.includes('demand') || src.includes('on-demand')) {
        mapped.data_source = 'leads_on_demand';
      } else if (src.includes('meridian') || src.includes('tower')) {
        mapped.data_source = 'meridian_tower';
      } else if (src.includes('eden') || src.includes('park')) {
        mapped.data_source = 'eden_park';
      } else if (src.includes('varah') || src.includes('swamy')) {
        mapped.data_source = 'varah_swamy';
      } else if (src.includes('sarjapur') || src.includes('plots')) {
        mapped.data_source = 'sarjapur_plots';
      } else {
        mapped.data_source = '';
      }
    } else {
      mapped.data_source = '';
    }

    // 10. Possession Time & Description
    mapped.possession_time = findValue(['possession', 'time to buy', 'timeline']) || '';
    mapped.description = findValue(['description', 'desc', 'summary', 'about']) || '';

    // 11. Notes mapping
    const rawNotes = findValue(['note', 'remark', 'comment', 'feedback']);
    if (rawNotes) {
      notesList.push(rawNotes);
    }

    // Find any other columns not mapped and dump them to crm_note
    Object.keys(row).forEach(key => {
      const val = row[key];
      if (!val) return;
      const isAlreadyMapped = [
        'name', 'email', 'phone', 'mobile', 'company', 'date', 'created',
        'city', 'state', 'country', 'owner', 'status', 'source', 'possession',
        'desc', 'note', 'remark', 'comment'
      ].some(kw => key.toLowerCase().includes(kw));

      if (!isAlreadyMapped) {
        notesList.push(`${key}: ${val}`);
      }
    });

    // Add notice that this was mapped via fallback
    notesList.push('(Mapped via local Mock AI extractor)');

    mapped.crm_note = notesList.join(' | ');

    return mapped;
  });
}
