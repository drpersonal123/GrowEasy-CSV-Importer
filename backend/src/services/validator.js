const ALLOWED_STATUSES = [
  'GOOD_LEAD_FOLLOW_UP',
  'DID_NOT_CONNECT',
  'BAD_LEAD',
  'SALE_DONE'
];

const ALLOWED_SOURCES = [
  'leads_on_demand',
  'meridian_tower',
  'eden_park',
  'varah_swamy',
  'sarjapur_plots'
];

/**
 * Validates a single mapped CRM record.
 * @param {Object} record - The mapped record from AI
 * @param {Object} rawRow - The original raw row data for reference
 * @returns {Object} { valid: boolean, data: Object, reason: string|null }
 */
export function validateRecord(record, rawRow = {}) {
  // 1. Check skip rule: must have email OR mobile number
  const email = (record.email || '').trim();
  const mobile = (record.mobile_without_country_code || '').trim();
  
  if (!email && !mobile) {
    return {
      valid: false,
      data: {
        created_at: record.created_at || new Date().toISOString(),
        name: record.name || 'Unknown',
        email: email,
        mobile_without_country_code: mobile,
        company: record.company || '',
        crm_status: record.crm_status || 'DID_NOT_CONNECT',
        crm_note: record.crm_note || 'Skipped: No email or mobile number.'
      },
      reason: 'Missing both email and mobile number'
    };
  }

  // 2. Validate and format created_at date
  let formattedDate = record.created_at;
  if (!formattedDate) {
    formattedDate = new Date().toISOString();
  } else {
    const dateObj = new Date(formattedDate);
    if (isNaN(dateObj.getTime())) {
      // If it's not directly parseable, try parsing clean numbers or fallback to now
      formattedDate = new Date().toISOString();
    } else {
      formattedDate = dateObj.toISOString();
    }
  }

  // 3. Validate status
  let status = record.crm_status;
  if (!ALLOWED_STATUSES.includes(status)) {
    // If status is not matching, use a fallback
    status = 'GOOD_LEAD_FOLLOW_UP';
  }

  // 4. Validate data source
  let dataSource = record.data_source;
  if (dataSource && !ALLOWED_SOURCES.includes(dataSource)) {
    dataSource = ''; // blank if none match confidently
  } else if (!dataSource) {
    dataSource = '';
  }

  // 5. Build clean data record
  const cleanData = {
    created_at: formattedDate,
    name: (record.name || '').trim(),
    email: email,
    country_code: (record.country_code || '').trim(),
    mobile_without_country_code: mobile,
    company: (record.company || '').trim(),
    city: (record.city || '').trim(),
    state: (record.state || '').trim(),
    country: (record.country || '').trim(),
    lead_owner: (record.lead_owner || '').trim(),
    crm_status: status,
    crm_note: (record.crm_note || '').trim(),
    data_source: dataSource,
    possession_time: (record.possession_time || '').trim(),
    description: (record.description || '').trim()
  };

  return {
    valid: true,
    data: cleanData,
    reason: null
  };
}
