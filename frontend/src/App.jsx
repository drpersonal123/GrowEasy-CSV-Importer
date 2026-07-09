import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://grow-easy-csv-importer-backend.vercel.app';
const BATCH_SIZE = 10;

export default function App() {
  // Navigation & Modal State
  const [activeTab, setActiveTab] = useState('lead-sources'); // 'lead-sources' or 'manage-leads'
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState(1); // 1 = Upload, 2 = Preview, 3 = Processing, 4 = Complete
  
  // Backend Connection State
  const [backendStatus, setBackendStatus] = useState({ online: false, mode: 'MOCK_FALLBACK', checked: false });
  
  // File upload state
  const [file, setFile] = useState(null);
  const [fileDetails, setFileDetails] = useState({ name: '', size: '' });
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // Batch Processing State
  const [processedCount, setProcessedCount] = useState(0);
  const [activeBatchIndex, setActiveBatchIndex] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [failedBatches, setFailedBatches] = useState([]);
  const [metrics, setMetrics] = useState({ speed: 0, elapsed: 0 });
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  
  // Aggregated Results State
  const [mappedLeads, setMappedLeads] = useState([]);
  const [skippedLeads, setSkippedLeads] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [leadsSubTab, setLeadsSubTab] = useState('mapped'); // 'mapped' or 'skipped'
  const resultsRef = useRef([]);

  // Check backend health on mount
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/health`);
        const data = await res.json();
        setBackendStatus({
          online: true,
          mode: data.configuration.geminiKeyConfigured || data.configuration.openaiKeyConfigured ? 'AI' : 'MOCK_FALLBACK',
          checked: true
        });
      } catch (err) {
        console.error('Backend connection failed:', err);
        setBackendStatus({ online: false, mode: 'MOCK_FALLBACK', checked: true });
      }
    };
    checkBackend();
  }, []);

  // Format File Size
  const formatBytes = (bytes, decimals = 2) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Handle Drag Events
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  // Parse CSV File
  const parseCSVFile = (selectedFile) => {
    if (!selectedFile) return;

    if (selectedFile.name.split('.').pop().toLowerCase() !== 'csv') {
      alert('Only .csv files are supported!');
      return;
    }

    setFile(selectedFile);
    setFileDetails({
      name: selectedFile.name,
      size: formatBytes(selectedFile.size)
    });

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        setCsvHeaders(results.meta.fields || []);
        setCsvRows(results.data || []);
        setModalStep(2); // Go to Preview
      },
      error: (err) => {
        alert(`Failed to parse CSV file: ${err.message}`);
      }
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      parseCSVFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      parseCSVFile(e.target.files[0]);
    }
  };

  const removeFile = () => {
    setFile(null);
    setFileDetails({ name: '', size: '' });
    setCsvHeaders([]);
    setCsvRows([]);
    setModalStep(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Batch Mapping Executor
  const startBatchImport = async () => {
    setModalStep(3); // Go to processing
    setProcessedCount(0);
    setActiveBatchIndex(0);
    setFailedBatches([]);
    resultsRef.current = [];

    const numBatches = Math.ceil(csvRows.length / BATCH_SIZE);
    setTotalBatches(numBatches);

    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const seconds = (Date.now() - startTimeRef.current) / 1000;
      const totalRowsProcessed = resultsRef.current.reduce((acc, b) => acc + b.records.length, 0);
      setMetrics({
        elapsed: seconds,
        speed: seconds > 0 ? totalRowsProcessed / seconds : 0
      });
    }, 500);

    await executeQueue(Array.from({ length: numBatches }, (_, i) => i));
  };

  const executeQueue = async (batchIndices) => {
    const tempFailed = [];

    for (let i = 0; i < batchIndices.length; i++) {
      const idx = batchIndices[i];
      setActiveBatchIndex(idx);

      const start = idx * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, csvRows.length);
      const batchRows = csvRows.slice(start, end);

      try {
        const response = await fetch(`${BACKEND_URL}/api/import-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            headers: csvHeaders,
            rows: batchRows
          })
        });

        if (!response.ok) throw new Error('API server rejected batch');

        const data = await response.json();
        
        resultsRef.current.push({
          batchIndex: idx,
          records: data.records,
          summary: data.summary
        });

        setProcessedCount(prev => prev + batchRows.length);

      } catch (err) {
        console.error(`Batch ${idx} failed:`, err);
        tempFailed.push(idx);
        setFailedBatches(prev => [...prev, idx]);
      }
    }

    const completed = resultsRef.current.length;
    const failed = tempFailed.length + failedBatches.length;

    if (completed + failed >= totalBatches) {
      finalizeImportResults();
    }
  };

  const finalizeImportResults = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    
    const allProcessed = [];
    const sorted = [...resultsRef.current].sort((a, b) => a.batchIndex - b.batchIndex);
    sorted.forEach(b => allProcessed.push(...b.records));

    const validLeads = allProcessed.filter(r => r.valid).map(r => r.data);
    const skippedRecords = allProcessed.filter(r => !r.valid);

    // Save into state
    setMappedLeads(prev => [...prev, ...validLeads]);
    setSkippedLeads(prev => [...prev, ...skippedRecords]);

    setModalStep(4); // Go to complete summary
  };

  const handleRetryFailedBatches = async () => {
    const batchesToRetry = [...failedBatches];
    setFailedBatches([]);
    setModalStep(3);
    
    // Resume timer
    if (resultsRef.current.length === 0) startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const seconds = (Date.now() - startTimeRef.current) / 1000;
      const totalRowsProcessed = resultsRef.current.reduce((acc, b) => acc + b.records.length, 0);
      setMetrics({
        elapsed: seconds,
        speed: seconds > 0 ? totalRowsProcessed / seconds : 0
      });
    }, 500);

    await executeQueue(batchesToRetry);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    removeFile();
  };

  const viewLeadsDashboard = () => {
    setIsModalOpen(false);
    removeFile();
    setActiveTab('manage-leads');
  };

  const downloadSampleCSV = () => {
    const csvContent = 
      "created_at,name,email,country_code,mobile_without_country_code,company,city,state,country,lead_owner,crm_status,crm_note,data_source\n" +
      "2026-05-13 14:20:48,John Doe,john.doe@example.com,+91,9876543210,GrowEasy,Mumbai,Maharashtra,India,test@gmail.com,GOOD_LEAD_FOLLOW_UP,Needs reschedule,leads_on_demand\n" +
      "2026-05-13 14:25:30,Sarah Johnson,sarah.johnson@example.com,+91,9876543211,Tech Solutions,Bangalore,Karnataka,India,test@gmail.com,DID_NOT_CONNECT,Busy,meridian_tower\n";
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "GrowEasy_Sample_Leads_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Mapped lead status badge formatter
  const getStatusBadge = (status) => {
    // Standardize to human friendly
    switch (status) {
      case 'GOOD_LEAD_FOLLOW_UP':
        return <span className="badge-status status-good">Good Lead</span>;
      case 'SALE_DONE':
        return <span className="badge-status status-saledone">Sale Done</span>;
      case 'BAD_LEAD':
        return <span className="badge-status status-bad">Bad Lead</span>;
      case 'DID_NOT_CONNECT':
      default:
        return <span className="badge-status status-notdialed">Not Dialed</span>;
    }
  };

  // Filter leads based on search query
  const filteredMappedLeads = mappedLeads.filter(lead => {
    const q = searchQuery.toLowerCase();
    return (
      (lead.name || '').toLowerCase().includes(q) ||
      (lead.email || '').toLowerCase().includes(q) ||
      (lead.mobile_without_country_code || '').toLowerCase().includes(q)
    );
  });

  const filteredSkippedLeads = skippedLeads.filter(lead => {
    const q = searchQuery.toLowerCase();
    const orig = JSON.stringify(lead.originalRow).toLowerCase();
    return orig.includes(q) || (lead.reason || '').toLowerCase().includes(q);
  });

  return (
    <div className="dashboard-layout">
      
      {/* Sidebar navigation */}
      <aside className="sidebar">
        <div className="sidebar-logo-container">
          <div className="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
          <span className="logo-text">GrowEasy</span>
        </div>

        <div className="sidebar-profile">
          <div className="profile-info">
            <span className="profile-name">VK Test</span>
            <span className="profile-role">OWNER</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-title">Main</div>
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
            Dashboard
          </div>
          <div 
            className={`nav-item ${activeTab === 'generate-leads' ? 'active' : ''}`}
            onClick={() => setActiveTab('generate-leads')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Generate Leads
          </div>
          <div 
            className={`nav-item ${activeTab === 'manage-leads' ? 'active' : ''}`}
            onClick={() => setActiveTab('manage-leads')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Manage Leads
          </div>
          <div 
            className={`nav-item ${activeTab === 'engage-leads' ? 'active' : ''}`}
            onClick={() => setActiveTab('engage-leads')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Engage Leads
          </div>

          <div className="nav-section-title">Control Center</div>
          <div className="nav-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            Team Members
          </div>
          <div 
            className={`nav-item ${activeTab === 'lead-sources' ? 'active' : ''}`}
            onClick={() => setActiveTab('lead-sources')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
            Lead Sources
          </div>
          <div className="nav-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Ad Accounts
          </div>
          <div className="nav-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            WhatsApp Account
          </div>
          <div className="nav-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            Tele Calling
          </div>
          <div className="nav-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            CRM Fields
          </div>
          <div className="nav-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            API Center
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="nav-item" style={{ margin: 0, padding: '0.5rem 0.75rem' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Business Center
          </div>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="main-content">
        
        {/* Connection Health Alert */}
        {backendStatus.checked && !backendStatus.online && (
          <div style={{ backgroundColor: '#fdf2f2', borderBottom: '1px solid #fde2e2', color: '#9b1c1c', padding: '0.5rem 2.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Backend Server is offline (localhost:5001). Please run <code>npm run dev</code> inside the backend folder to enable processing.</span>
          </div>
        )}

        {/* Tab 1: Lead Sources Dashboard */}
        {activeTab === 'lead-sources' && (
          <>
            <div className="content-header">
              <div className="content-title">
                <h2>Lead Sources</h2>
                <p>Connect, manage, and control all your lead channels from one dashboard.</p>
              </div>
            </div>

            <div className="content-body">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#334155', marginBottom: '1rem' }}>Active Lead Integrations</h3>
              
              <div className="cards-grid">
                
                {/* Importer Trigger Card */}
                <div className="source-card" onClick={() => setIsModalOpen(true)} style={{ border: '2px solid #cbd5e1', backgroundColor: '#fcfcfc' }}>
                  <div className="source-card-header">
                    <div className="source-icon-wrapper" style={{ backgroundColor: '#e6f4ea', color: '#107c41' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    </div>
                    <div>
                      <h3>Import Leads via CSV</h3>
                      <span className="badge-status status-good" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', marginTop: '0.15rem' }}>AI Powered</span>
                    </div>
                  </div>
                  <p>Intelligently map and import leads from any CSV format (Google Ads, Facebook, manual sheets) using GrowEasy AI.</p>
                  <div className="source-card-action">
                    Import leads now
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  </div>
                </div>

                <div className="source-card">
                  <div className="source-card-header">
                    <div className="source-icon-wrapper">G</div>
                    <div>
                      <h3>Google Ads</h3>
                      <span className="badge-status status-notdialed" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>Inactive</span>
                    </div>
                  </div>
                  <p>Connect Google Lead Form campaigns to pull lead records straight into GrowEasy CRM instantly.</p>
                  <div className="source-card-action" style={{ color: '#64748b' }}>Connect Google Account</div>
                </div>

                <div className="source-card">
                  <div className="source-card-header">
                    <div className="source-icon-wrapper" style={{ color: '#1877f2' }}>f</div>
                    <div>
                      <h3>Facebook Leads</h3>
                      <span className="badge-status status-notdialed" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>Inactive</span>
                    </div>
                  </div>
                  <p>Sync Facebook and Instagram Instant Forms directly to route leads to your sales reps in real time.</p>
                  <div className="source-card-action" style={{ color: '#64748b' }}>Connect Facebook Ads</div>
                </div>

                <div className="source-card">
                  <div className="source-card-header">
                    <div className="source-icon-wrapper" style={{ color: '#25d366' }}>W</div>
                    <div>
                      <h3>WhatsApp Lead Hook</h3>
                      <span className="badge-status status-notdialed" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>Inactive</span>
                    </div>
                  </div>
                  <p>Gather leads from automated WhatsApp conversational chat bots and track interaction histories.</p>
                  <div className="source-card-action" style={{ color: '#64748b' }}>Configure Webhook</div>
                </div>

                <div className="source-card">
                  <div className="source-card-header">
                    <div className="source-icon-wrapper" style={{ color: '#ef4444' }}>+</div>
                    <div>
                      <h3>Single Lead entry</h3>
                    </div>
                  </div>
                  <p>Manually type a single contact row to insert one lead directly into the central CRM data registry.</p>
                  <div className="source-card-action" style={{ color: '#64748b' }}>Add Single Lead</div>
                </div>

              </div>
            </div>
          </>
        )}

        {/* Tab 2: Manage Leads Grid (Screenshot 3) */}
        {activeTab === 'manage-leads' && (
          <>
            <div className="content-header">
              <div className="content-title">
                <h2>Manage Your Leads</h2>
                <p>Monitor lead status, assign tasks, and close deals faster.</p>
              </div>
            </div>

            <div className="content-body">
              {/* Tab Header for valid vs skipped */}
              <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
                <button 
                  onClick={() => setLeadsSubTab('mapped')}
                  style={{
                    background: 'none', border: 'none', padding: '0.5rem 1rem', cursor: 'pointer',
                    fontWeight: 600, fontSize: '0.85rem',
                    color: leadsSubTab === 'mapped' ? '#0f5132' : '#64748b',
                    borderBottom: leadsSubTab === 'mapped' ? '2px solid #0f5132' : 'none'
                  }}
                >
                  Imported Leads ({mappedLeads.length})
                </button>
                <button 
                  onClick={() => setLeadsSubTab('skipped')}
                  style={{
                    background: 'none', border: 'none', padding: '0.5rem 1rem', cursor: 'pointer',
                    fontWeight: 600, fontSize: '0.85rem',
                    color: leadsSubTab === 'skipped' ? '#0f5132' : '#64748b',
                    borderBottom: leadsSubTab === 'skipped' ? '2px solid #0f5132' : 'none'
                  }}
                >
                  Skipped Records ({skippedLeads.length})
                </button>
              </div>

              {/* Toolbar */}
              <div className="manage-leads-toolbar">
                <div style={{ display: 'flex', width: '100%', maxWidth: '450px' }}>
                  <div className="search-bar-container">
                    <input 
                      type="text" 
                      className="search-input" 
                      placeholder="Enter name, email or phone number..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <button className="search-btn">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    </button>
                  </div>
                  <button className="refresh-btn" onClick={() => setSearchQuery('')}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                  </button>
                </div>

                <button 
                  className="btn btn-primary" 
                  style={{ background: 'var(--accent-teal)', height: '36px', fontSize: '0.85rem', padding: '0 1rem' }} 
                  onClick={() => setIsModalOpen(true)}
                >
                  Import leads via CSV
                </button>
              </div>

              {/* Data Table */}
              {leadsSubTab === 'mapped' ? (
                <div className="leads-table-container">
                  {filteredMappedLeads.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
                      No leads matching your filters were found.
                    </div>
                  ) : (
                    <table className="leads-table">
                      <thead>
                        <tr>
                          <th>Lead Name</th>
                          <th>Email</th>
                          <th>Contact</th>
                          <th>Date Created</th>
                          <th>Company</th>
                          <th>Status</th>
                          <th>Lead Owner</th>
                          <th>Source</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMappedLeads.map((lead, idx) => {
                          const contactInfo = lead.country_code ? `${lead.country_code} ${lead.mobile_without_country_code}` : lead.mobile_without_country_code;
                          const displayDate = lead.created_at ? lead.created_at.split('T')[0] : '';
                          return (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600 }}>{lead.name || 'Unknown'}</td>
                              <td>{lead.email || '--'}</td>
                              <td>{contactInfo || '--'}</td>
                              <td>{displayDate}</td>
                              <td>{lead.company || '--'}</td>
                              <td>{getStatusBadge(lead.crm_status)}</td>
                              <td>{lead.lead_owner || '--'}</td>
                              <td>{lead.data_source ? <span className="badge-status status-good" style={{ fontSize: '0.65rem' }}>{lead.data_source}</span> : '--'}</td>
                              <td title={lead.crm_note} style={{ maxWidth: '200px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {lead.crm_note || '--'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="leads-table-container">
                  {filteredSkippedLeads.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
                      No skipped records found.
                    </div>
                  ) : (
                    <table className="leads-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th style={{ color: '#b91c1c' }}>Reason for Skip</th>
                          <th>Contact Information</th>
                          <th>Raw Row Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSkippedLeads.map((lead, idx) => (
                          <tr key={idx}>
                            <td>{idx + 1}</td>
                            <td>
                              <span className="badge-status status-bad" style={{ borderRadius: '4px' }}>
                                {lead.reason}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontSize: '0.8rem' }}>
                                <strong>Email:</strong> {lead.originalRow.email || lead.originalRow.Email || lead.originalRow['Email Address'] || '--'}<br/>
                                <strong>Phone:</strong> {lead.originalRow.phone || lead.originalRow.Phone || lead.originalRow['Phone Number'] || lead.originalRow.mobile || '--'}
                              </div>
                            </td>
                            <td>
                              <div 
                                style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}
                                title={JSON.stringify(lead.originalRow)}
                              >
                                {JSON.stringify(lead.originalRow)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </>
        )}

      </main>

      {/* CSV Importer Modal (Screenshots 1 & 2) */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-container">
            
            {/* Modal Header */}
            <div className="modal-header">
              <div className="modal-title">
                <h3>Import Leads via CSV</h3>
                <p>Upload a CSV file to bulk import leads into your system.</p>
              </div>
              <button className="modal-close-btn" onClick={closeModal}>×</button>
            </div>

            {/* Modal Body */}
            <div className="modal-body">
              
              {/* Step 1: Upload (Screenshot 1) */}
              {modalStep === 1 && (
                <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div 
                    className={`modal-dropzone ${dragActive ? 'drag-active' : ''}`}
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current.click()}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      accept=".csv"
                      onChange={handleFileChange}
                    />
                    
                    <div className="modal-dropzone-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/></svg>
                    </div>

                    <h4>Drop your CSV file here</h4>
                    <p>or click to browse files</p>
                    
                    <div className="modal-dropzone-badge">
                      Supported file: .csv (max 5MB)
                    </div>

                    <div className="modal-dropzone-requirements">
                      Required headers: created_at, name, email, country_code, mobile_without_country_code, company, city, state, country, lead_owner, crm_status, crm_note. Template includes default + custom CRM fields to reduce upload errors.
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button className="download-template-link" onClick={downloadSampleCSV}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>
                      Download Sample CSV Template
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Preview Selected File (Screenshot 2) */}
              {modalStep === 2 && (
                <div className="fade-in">
                  
                  {/* File Info Card */}
                  <div className="selected-file-card">
                    <div className="file-card-details">
                      <div className="file-icon">CSV</div>
                      <div>
                        <div className="file-card-name">{fileDetails.name}</div>
                        <div className="file-card-size">{fileDetails.size}</div>
                      </div>
                    </div>
                    <button className="file-card-remove" onClick={removeFile}>×</button>
                  </div>

                  {/* Scrollable Preview Table */}
                  <div className="modal-table-container">
                    <table className="modal-table">
                      <thead>
                        <tr>
                          {csvHeaders.map(h => <th key={h}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(0, 10).map((row, rIdx) => (
                          <tr key={rIdx}>
                            {csvHeaders.map((h, cIdx) => (
                              <td key={cIdx} title={row[h]}>{row[h]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csvRows.length > 10 && (
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem', textAlign: 'center' }}>
                      * Showing first 10 of {csvRows.length} rows for preview.
                    </p>
                  )}
                </div>
              )}

              {/* Step 3: Processing Animation & Retries */}
              {modalStep === 3 && (
                <div className="processing-overlay fade-in">
                  {failedBatches.length > 0 && processedCount + failedBatches.length * BATCH_SIZE >= csvRows.length ? (
                    <>
                      <div className="modal-dropzone-icon" style={{ backgroundColor: '#fdf2f2', color: '#b91c1c', width: '56px', height: '56px' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      </div>
                      <h4 style={{ color: '#b91c1c' }}>Failed to Import {failedBatches.length * BATCH_SIZE} Leads</h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Some batches failed due to network / rate limit issues. Click below to retry.
                      </p>
                      <button 
                        type="button" 
                        className="modal-btn modal-btn-upload" 
                        onClick={handleRetryFailedBatches}
                      >
                        Retry {failedBatches.length} Failed Batch(es)
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="spinner"></div>
                      <h4>AI Extracting &amp; Mapping Fields...</h4>
                      <div style={{ width: '100%', maxWidth: '300px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                          <span>Import Progress</span>
                          <strong>{Math.round((processedCount / csvRows.length) * 100)}%</strong>
                        </div>
                        <div style={{ height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              height: '100%', 
                              backgroundColor: 'var(--accent-orange)', 
                              width: `${(processedCount / csvRows.length) * 100}%`,
                              transition: 'width 0.2s ease'
                            }}
                          ></div>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', width: '100%', maxWidth: '300px', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                        <div>Mapped: <strong>{processedCount} / {csvRows.length}</strong></div>
                        <div>Speed: <strong>{metrics.speed ? `${metrics.speed.toFixed(1)}/s` : '--'}</strong></div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Step 4: Import Complete Summary */}
              {modalStep === 4 && (
                <div className="processing-overlay fade-in" style={{ padding: '1.5rem 1rem' }}>
                  <div className="modal-dropzone-icon" style={{ backgroundColor: '#e6f4ea', color: '#107c41', width: '56px', height: '56px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <h4 style={{ color: '#0f5132' }}>Import Processing Complete!</h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Your leads have been processed and validated.
                  </p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', width: '100%', maxWidth: '400px', marginTop: '1rem' }}>
                    <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: '#fafbfc' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f5132' }}>
                        {resultsRef.current.reduce((acc, b) => acc + b.summary.imported, 0)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Leads Imported</div>
                    </div>
                    <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: '#fafbfc' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#b91c1c' }}>
                        {resultsRef.current.reduce((acc, b) => acc + b.summary.skipped, 0)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Records Skipped</div>
                    </div>
                  </div>

                  {backendStatus.mode === 'MOCK_FALLBACK' && (
                    <p style={{ fontSize: '0.7rem', color: 'var(--warning)', fontStyle: 'italic', marginTop: '0.5rem' }}>
                      * Processed in local Demo Mode (Mock AI extraction).
                    </p>
                  )}
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="modal-footer">
              <button 
                type="button" 
                className="modal-btn modal-btn-cancel" 
                onClick={closeModal}
                disabled={modalStep === 3 && failedBatches.length === 0}
              >
                Cancel
              </button>

              {modalStep === 1 && (
                <button 
                  type="button" 
                  className="modal-btn modal-btn-upload"
                  disabled={true} // In Step 1, upload is disabled until file is selected
                >
                  Upload File
                </button>
              )}

              {modalStep === 2 && (
                <button 
                  type="button" 
                  className="modal-btn modal-btn-upload"
                  onClick={startBatchImport}
                  disabled={!backendStatus.online}
                >
                  Upload File
                </button>
              )}

              {modalStep === 3 && (
                <button 
                  type="button" 
                  className="modal-btn modal-btn-upload"
                  disabled={true}
                >
                  Processing...
                </button>
              )}

              {modalStep === 4 && (
                <button 
                  type="button" 
                  className="modal-btn modal-btn-upload"
                  style={{ backgroundColor: '#0f5132' }}
                  onClick={viewLeadsDashboard}
                >
                  View Mapped Leads
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
