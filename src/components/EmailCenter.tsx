import React, { useState, useEffect } from 'react';
import { Mail, Edit2, History, Send, Loader, RefreshCw, AlertCircle, CheckCircle2, Search, FileText } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, getDocs, doc, setDoc, addDoc, updateDoc, query, where, orderBy, deleteDoc } from 'firebase/firestore';
import { UserProfile } from '../types';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: string;
}

interface EmailLog {
  id: string;
  recipient: string;
  subject: string;
  status: 'sent' | 'failed' | 'pending';
  sentAt: string;
  error?: string;
  templateId?: string;
}

interface EmailCenterProps {
  users: UserProfile[];
}

export default function EmailCenter({ users }: EmailCenterProps) {
  const [activeSubTab, setActiveSubTab] = useState<'bulk' | 'templates' | 'logs'>('bulk');
  
  // Bulk email form states
  const [targetType, setTargetType] = useState<'single' | 'multiple' | 'all'>('single');
  const [singleRecipient, setSingleRecipient] = useState('');
  const [multipleRecipients, setMultipleRecipients] = useState('');
  const [bulkSubject, setBulkSubject] = useState('');
  const [bulkBody, setBulkBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendMsg, setSendMsg] = useState({ type: '', text: '' });

  // Template manager states
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [templateSaveMsg, setTemplateSaveMsg] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Email log states
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [logFilter, setLogFilter] = useState<'all' | 'sent' | 'failed' | 'pending'>('all');

  // Real-time snapshot subscription for templates and logs
  useEffect(() => {
    const unsubTemplates = onSnapshot(collection(db, 'email_templates'), (snap) => {
      const list: EmailTemplate[] = [];
      snap.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as EmailTemplate);
      });
      setTemplates(list);
      if (list.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(list[0].id);
        setEditSubject(list[0].subject);
        setEditBody(list[0].body);
      }
    });

    // Subscribe to email logs
    const unsubLogs = onSnapshot(collection(db, 'email_logs'), (snap) => {
      const list: EmailLog[] = [];
      snap.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as EmailLog);
      });
      // Sort by sentAt descending
      list.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
      setLogs(list);
    });

    return () => {
      unsubTemplates();
      unsubLogs();
    };
  }, []);

  // Update form fields when selected template shifts
  useEffect(() => {
    const matched = templates.find(t => t.id === selectedTemplateId);
    if (matched) {
      setEditSubject(matched.subject);
      setEditBody(matched.body);
    }
  }, [selectedTemplateId, templates]);

  // Handle bulk email submission
  const handleSendBulkEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendMsg({ type: '', text: '' });

    // Compose recipient list based on selection
    let recipientList: string[] = [];
    if (targetType === 'single') {
      if (!singleRecipient.trim()) {
        setSendMsg({ type: 'error', text: 'Please specify a recipient email address.' });
        return;
      }
      recipientList = [singleRecipient.trim()];
    } else if (targetType === 'multiple') {
      if (!multipleRecipients.trim()) {
        setSendMsg({ type: 'error', text: 'Please enter comma-separated email addresses.' });
        return;
      }
      recipientList = multipleRecipients
        .split(',')
        .map(email => email.trim())
        .filter(email => email.length > 0);
    } else if (targetType === 'all') {
      // Exclude admin emails
      recipientList = users
        .filter(u => u.role !== 'admin' && u.email)
        .map(u => u.email);
    }

    if (recipientList.length === 0) {
      setSendMsg({ type: 'error', text: 'No matching recipients found.' });
      return;
    }

    if (!bulkSubject.trim() || !bulkBody.trim()) {
      setSendMsg({ type: 'error', text: 'Subject and message body cannot be empty.' });
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch('/api/admin/send-bulk-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: recipientList,
          subject: bulkSubject.trim(),
          body: bulkBody.trim()
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to dispatch bulk email campaign.');
      }

      setSendMsg({ 
        type: 'success', 
        text: data.message || `Successfully sent bulk email to ${recipientList.length} recipient(s) in under 1 second!` 
      });
      
      // Reset form states
      setBulkSubject('');
      setBulkBody('');
      setSingleRecipient('');
      setMultipleRecipients('');
    } catch (err: any) {
      setSendMsg({ type: 'error', text: 'Failed to send bulk email: ' + err.message });
    } finally {
      setIsSending(false);
    }
  };

  // Handle template updating
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setTemplateSaveMsg('');
    if (!selectedTemplateId) return;

    if (!editSubject.trim() || !editBody.trim()) {
      setTemplateSaveMsg('Subject and body template content cannot be empty.');
      return;
    }

    setIsSavingTemplate(true);
    try {
      const templateRef = doc(db, 'email_templates', selectedTemplateId);
      await updateDoc(templateRef, {
        subject: editSubject.trim(),
        body: editBody.trim(),
        updatedAt: new Date().toISOString()
      });
      setTemplateSaveMsg('Template updated successfully inside Firestore!');
      setTimeout(() => setTemplateSaveMsg(''), 5000);
    } catch (err: any) {
      setTemplateSaveMsg('Error saving template: ' + err.message);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  // Clear all email logs (maintenance utility)
  const handleClearLogs = async () => {
    if (!window.confirm('Are you sure you want to permanently clear all delivery logs from Firestore?')) return;
    try {
      const colRef = collection(db, 'email_logs');
      const snap = await getDocs(colRef);
      const promises = snap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(promises);
      alert('Logs cleared successfully!');
    } catch (err: any) {
      alert('Error clearing logs: ' + err.message);
    }
  };

  // Filter logs list
  const filteredLogs = logs.filter(log => {
    const queryStr = logSearch.toLowerCase();
    const matchesSearch = log.recipient.toLowerCase().includes(queryStr) || 
                          log.subject.toLowerCase().includes(queryStr) ||
                          (log.error && log.error.toLowerCase().includes(queryStr));
    
    if (logFilter === 'all') return matchesSearch;
    return matchesSearch && log.status === logFilter;
  });

  return (
    <div className="space-y-6">
      {/* Tab Navigation header */}
      <div className="flex border-b border-white/10 gap-4">
        {[
          { id: 'bulk', label: 'Bulk Email Center', icon: Send },
          { id: 'templates', label: 'Email Template Manager', icon: FileText },
          { id: 'logs', label: 'Delivery Logs & Auditing', icon: History }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={`pb-3 text-xs font-bold tracking-wide uppercase border-b-2 flex items-center space-x-1.5 transition-all ${
              activeSubTab === tab.id ? 'border-blue-500 text-white font-black' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* SUB TAB 1: BULK EMAIL CENTER */}
      {activeSubTab === 'bulk' && (
        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 animate-fade-in max-w-4xl">
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Send Automated Platform Announcements</h3>
            <p className="text-xs text-slate-400 mt-1">
              Compose custom email messages. These are appended to the high-performance delivery queue and executed immediately via SMTP relay.
            </p>
          </div>

          {sendMsg.text && (
            <div className={`p-4 rounded-xl text-xs border ${
              sendMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}>
              {sendMsg.text}
            </div>
          )}

          <form onSubmit={handleSendBulkEmail} className="space-y-5">
            {/* Target Audience selection */}
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1.5">Target Audience</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'single', label: 'Single Trader' },
                  { id: 'multiple', label: 'Multiple (Comma-separated)' },
                  { id: 'all', label: 'All Registered Users' }
                ].map(opt => (
                  <button
                    type="button"
                    key={opt.id}
                    onClick={() => setTargetType(opt.id as any)}
                    className={`h-11 rounded-xl text-xs font-bold border transition-all ${
                      targetType === opt.id 
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/10' 
                        : 'bg-black/30 border-white/10 text-slate-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recipient Input details based on targetType */}
            {targetType === 'single' && (
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Select / Type Recipient Email *</label>
                <div className="flex gap-2">
                  <select
                    value={singleRecipient}
                    onChange={(e) => setSingleRecipient(e.target.value)}
                    className="flex-1 h-10 px-2 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">-- Select Registered Trader --</option>
                    {users.filter(u => u.role !== 'admin' && u.email).map(u => (
                      <option key={u.uid} value={u.email}>{u.displayName || u.name} ({u.email})</option>
                    ))}
                  </select>
                  <input
                    type="email"
                    placeholder="Or type raw email address"
                    value={singleRecipient}
                    onChange={(e) => setSingleRecipient(e.target.value)}
                    className="flex-1 h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {targetType === 'multiple' && (
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Recipient Email List (Comma-Separated) *</label>
                <textarea
                  rows={2}
                  value={multipleRecipients}
                  onChange={(e) => setMultipleRecipients(e.target.value)}
                  placeholder="trader1@gmail.com, trader2@yahoo.com, trader3@hotmail.com"
                  className="w-full p-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}

            {targetType === 'all' && (
              <div className="p-3 bg-blue-500/15 border border-blue-500/20 rounded-2xl text-blue-300 text-xs flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>
                  Attention: This option targets all active users registered in the database ({users.filter(u => u.role !== 'admin').length} traders).
                </span>
              </div>
            )}

            {/* Email Metadata */}
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Email Subject Line *</label>
              <input
                type="text"
                required
                value={bulkSubject}
                onChange={(e) => setBulkSubject(e.target.value)}
                placeholder="e.g. Important Platform Upgrade Notification"
                className="w-full h-11 px-4 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Message Body *</label>
              <textarea
                rows={8}
                required
                value={bulkBody}
                onChange={(e) => setBulkBody(e.target.value)}
                placeholder="Type your markdown-compatible email campaign message here..."
                className="w-full p-4 bg-black/40 border border-white/10 rounded-xl text-white text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSending}
              className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-colors shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSending ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Enqueuing Campaign Deliveries...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Launch Bulk Email Campaign</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* SUB TAB 2: TEMPLATE MANAGER */}
      {activeSubTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Templates list selection */}
          <div className="bg-white/5 border border-white/10 rounded-3xl p-5 space-y-3 h-fit">
            <h3 className="text-xs font-black text-white uppercase tracking-wider px-1">Seeded Templates ({templates.length})</h3>
            <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
              {templates.map(t => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setSelectedTemplateId(t.id)}
                  className={`w-full p-3.5 rounded-2xl border text-left transition-all ${
                    selectedTemplateId === t.id 
                      ? 'bg-blue-600/10 border-blue-500/40 text-white font-bold' 
                      : 'bg-black/30 border-white/5 text-slate-400 hover:text-white hover:border-white/10'
                  }`}
                >
                  <p className="text-xs font-bold truncate">{t.name}</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">ID: {t.id}</p>
                </button>
              ))}
              {templates.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-8">Loading templates...</p>
              )}
            </div>
          </div>

          {/* Template Edit Form */}
          <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Modify Selected Transactional Template
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Customize templates triggered on automated platform events.
              </p>
            </div>

            {templateSaveMsg && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs">
                {templateSaveMsg}
              </div>
            )}

            {selectedTemplateId ? (
              <form onSubmit={handleSaveTemplate} className="space-y-4">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Selected Template Code ID</label>
                  <input
                    type="text"
                    disabled
                    value={selectedTemplateId}
                    className="w-full h-10 px-3 bg-black/60 border border-white/5 rounded-xl text-slate-400 font-mono text-xs focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Email Subject Header *</label>
                  <input
                    type="text"
                    required
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-bold focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Template Markup Body *</label>
                  <textarea
                    rows={12}
                    required
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="w-full p-4 bg-black/40 border border-white/10 rounded-xl text-white font-mono text-xs focus:border-blue-500 focus:outline-none"
                  />
                  <div className="mt-2 p-3 bg-black/30 border border-white/5 rounded-xl text-[10px] text-slate-500 leading-normal space-y-1">
                    <p className="font-bold text-slate-400">Supported Dynamic Parameter Tags:</p>
                    <p>• <code className="text-blue-400 font-bold font-mono">{`{Name}`}</code> - Trader full name</p>
                    <p>• <code className="text-blue-400 font-bold font-mono">{`{Account Type}`}</code> - e.g. One Step, Two Step</p>
                    <p>• <code className="text-blue-400 font-bold font-mono">{`{Account Size}`}</code> - e.g. $10,000</p>
                    <p>• <code className="text-blue-400 font-bold font-mono">{`{Admin Reason}`}</code> - Rejection explanations</p>
                    <p>• <code className="text-blue-400 font-bold font-mono">{`{Amount}`}</code> - e.g. $500.00</p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSavingTemplate}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
                >
                  {isSavingTemplate ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      <span>Saving to Firestore...</span>
                    </>
                  ) : (
                    <span>Update Template Settings</span>
                  )}
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-500 text-center py-20">Select a template from the sidebar catalog to edit.</p>
            )}
          </div>
        </div>
      )}

      {/* SUB TAB 3: LOGS PANEL */}
      {activeSubTab === 'logs' && (
        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Email Delivery Log Hub</h3>
              <p className="text-xs text-slate-400 mt-0.5">Audit background SMTP mail relays and delivery states.</p>
            </div>
            <button
              onClick={handleClearLogs}
              className="px-4 py-2 bg-rose-600/10 border border-rose-500/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold rounded-xl transition-colors"
            >
              Purge Logs
            </button>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                placeholder="Search by recipient email or subject..."
                className="w-full h-10 pl-10 pr-4 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex gap-1.5 bg-black/40 border border-white/10 rounded-xl p-1">
              {[
                { id: 'all', label: 'All Statuses' },
                { id: 'sent', label: 'Sent' },
                { id: 'failed', label: 'Failed' },
                { id: 'pending', label: 'Queued' }
              ].map(f => (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => setLogFilter(f.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    logFilter === f.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logs Table */}
          <div className="border border-white/10 rounded-2xl overflow-hidden bg-black/20">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-medium text-slate-300">
                <thead className="bg-white/5 text-[10px] text-slate-400 font-bold uppercase tracking-wider border-b border-white/10">
                  <tr>
                    <th className="p-4">Delivery Status</th>
                    <th className="p-4">Recipient</th>
                    <th className="p-4">Email Subject</th>
                    <th className="p-4">Dispatched At</th>
                    <th className="p-4 max-w-xs">Audit details / Fail reasons</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredLogs.map(log => (
                    <tr key={log.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase inline-flex items-center gap-1 border ${
                          log.status === 'sent' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                          log.status === 'failed' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                          'bg-amber-500/10 border-amber-500/25 text-amber-400 animate-pulse'
                        }`}>
                          {log.status === 'sent' && <CheckCircle2 className="w-3 h-3" />}
                          {log.status === 'failed' && <AlertCircle className="w-3 h-3" />}
                          {log.status}
                        </span>
                      </td>
                      <td className="p-4 font-mono font-bold text-white select-all">
                        {log.recipient}
                      </td>
                      <td className="p-4 font-medium text-slate-200">
                        {log.subject}
                      </td>
                      <td className="p-4 text-slate-400 font-mono text-[11px]">
                        {log.sentAt ? new Date(log.sentAt).toLocaleString() : 'Pending Queue'}
                      </td>
                      <td className="p-4 font-mono text-[10px] max-w-xs truncate text-rose-400" title={log.error}>
                        {log.error || <span className="text-emerald-400 font-bold">Relayed successfully</span>}
                      </td>
                    </tr>
                  ))}
                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-slate-500">
                        No delivery logs matched the current filtering criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
