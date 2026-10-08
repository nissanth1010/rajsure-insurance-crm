const state = {
  config: null,
  supabase: null,
  session: null,
  user: null,
  profile: null,
  hasAdmin: false,
  bootError: '',
  view: 'dashboard',
  cache: { customers: [], leads: [], policies: [], followups: [], payments: [], documents: [], profiles: [] }
};

const documentCategories = [
  ['pan_card', 'PAN Card'],
  ['aadhaar_card', 'Aadhaar Card'],
  ['rc_book', 'RC Book'],
  ['insurance_policy', 'Insurance Policy'],
  ['vehicle_photo', 'Vehicle Photo'],
  ['other', 'Other Document']
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v = '') => String(v).replace(/[&<>\'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const money = v => v == null || v === '' ? '—' : new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:0 }).format(Number(v) || 0);
const dateFmt = v => v ? new Intl.DateTimeFormat('en-IN', { day:'2-digit', month:'short', year:'numeric' }).format(new Date(v)) : '—';
const todayISO = () => new Date().toISOString().slice(0,10);
const initial = (name='R') => name.trim().split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase() || 'R';
const categoryLabel = value => documentCategories.find(([k]) => k === value)?.[1] || 'Other Document';

function toast(message, kind='') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

async function init() {
  bindGlobal();
  try {
    const response = await fetch('./api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    state.config = await response.json();
    if (!state.config.supabaseUrl || !state.config.supabaseAnonKey || !window.supabase?.createClient) {
      throw new Error('Supabase configuration is missing on the server.');
    }
    state.supabase = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
      auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    const { data: sessionData } = await state.supabase.auth.getSession();
    state.session = sessionData?.session || null;
    const { data: adminData } = await state.supabase.rpc('has_admin');
    state.hasAdmin = Boolean(adminData);
    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      if (session) await enterApp(); else showAuth(state.hasAdmin ? 'login' : 'setup');
    });
    if (state.session) await enterApp(); else showAuth(state.hasAdmin ? 'login' : 'setup');
  } catch (error) {
    state.bootError = error.message || 'Backend connection failed.';
    showAuth('login', 'backend');
  }
}

function showAuth(mode='login', reason='') {
  $('#app-shell').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  $('#backend-notice').classList.add('hidden');
  $('#setup-notice').classList.add('hidden');

  const formEls = $$('#auth-form input, #auth-form button[type="submit"]');
  const toggle = $('#auth-toggle');
  if (reason === 'backend') {
    $('#backend-notice').textContent = `CRM backend is not reachable. Start this project with “npm start” and open http://localhost:3000. ${state.bootError || ''}`.trim();
    $('#backend-notice').classList.remove('hidden');
    formEls.forEach(el => el.disabled = true);
    toggle.disabled = true;
    $('#auth-title').textContent = 'Start the RajSure server';
    $('#auth-subtitle').textContent = 'The login page is ready, but authentication needs the Node server.';
    return;
  }
  formEls.forEach(el => el.disabled = false);
  toggle.disabled = false;
  setAuthMode(mode);
}

function setAuthMode(mode) {
  const setup = mode === 'setup';
  $('#auth-form').dataset.mode = mode;
  $('#auth-title').textContent = setup ? 'Create first admin' : 'Welcome back';
  $('#auth-subtitle').textContent = setup ? 'Create the first secure RajSure administrator account.' : 'Secure CRM access for the RajSure team.';
  $('#auth-submit').textContent = setup ? 'Create admin account' : 'Sign in';
  $('#name-field').classList.toggle('hidden', !setup);
  $('#phone-field').classList.toggle('hidden', !setup);
  $('#setup-notice').classList.toggle('hidden', !setup);
  $('#auth-name').required = setup;

  if (setup) {
    $('#auth-toggle').textContent = 'Already have an account? Sign in';
    $('#auth-toggle').classList.remove('hidden');
  } else {
    $('#auth-toggle').textContent = 'First-time setup';
    $('#auth-toggle').classList.toggle('hidden', state.hasAdmin);
  }
}

function bindGlobal() {
  $('#auth-toggle').addEventListener('click', () => {
    const mode = $('#auth-form').dataset.mode || 'login';
    setAuthMode(mode === 'setup' ? 'login' : 'setup');
  });
  $('#auth-form').addEventListener('submit', handleAuth);
  $('#signout').addEventListener('click', signOut);
  $('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $$('.nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => {
    navigate(btn.dataset.view);
    $('#sidebar').classList.remove('open');
  }));
  $('#modal-backdrop').addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });
}

async function handleAuth(e) {
  e.preventDefault();
  if (!state.supabase) return toast('Start the RajSure backend first.', 'error');
  const mode = e.currentTarget.dataset.mode || 'login';
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  try {
    $('#auth-submit').disabled = true;
    if (mode === 'setup') {
      if (state.hasAdmin) throw new Error('A RajSure administrator already exists. Sign in instead.');
      const { data, error } = await state.supabase.auth.signUp({
        email,
        password,
        options: { data:{ full_name:$('#auth-name').value.trim(), phone:$('#auth-phone').value.trim(), role:'admin' } }
      });
      if (error) throw error;
      state.hasAdmin = true;
      if (!data.session) {
        toast('Admin created. Check your email to confirm the account, then sign in.', 'success');
      } else {
        toast('Admin account created.', 'success');
      }
      setAuthMode('login');
    } else {
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast('Signed in successfully.', 'success');
    }
  } catch (err) {
    toast(err.message || 'Authentication failed.', 'error');
  } finally {
    $('#auth-submit').disabled = false;
  }
}

async function signOut() {
  if (state.supabase) await state.supabase.auth.signOut();
  state.session = null; state.user = null; state.profile = null;
  showAuth('login');
}

async function enterApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  try {
    const me = await api('./api/me');
    state.user = me.user;
    state.profile = me.profile || { full_name: me.user?.user_metadata?.full_name || 'RajSure User', role:'staff' };
  } catch (error) {
    toast(error.message || 'Could not load your profile.', 'error');
    await state.supabase.auth.signOut();
    return;
  }
  refreshIdentity();
  navigate(state.view || 'dashboard');
}

function refreshIdentity() {
  const name = state.profile?.full_name || state.user?.email || 'RajSure User';
  const role = state.profile?.role || 'staff';
  const letters = initial(name);
  $('#user-name').textContent = name;
  $('#user-role').textContent = role;
  $('#user-avatar').textContent = letters;
  $('#top-avatar').textContent = letters;
  const status = $('#system-status');
  if (state.config?.aiConfigured) {
    status.textContent = 'CRM + AI ready';
    status.className = 'status-pill good';
  } else {
    status.textContent = 'CRM connected • AI off';
    status.className = 'status-pill warn';
  }
}

function navigate(view) {
  state.view = view;
  const titles = { dashboard:'Dashboard', customers:'Customers', leads:'Leads', policies:'Policies', followups:'Follow-ups', documents:'Documents', ai:'AI Extract', settings:'Settings' };
  $('#page-title').textContent = titles[view] || 'Dashboard';
  $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  refreshIdentity();
  renderView(view).catch(error => toast(error.message || 'Could not render this section.', 'error'));
}

async function renderView(view) {
  if (view === 'dashboard') {
    await Promise.all(['customers','leads','policies','followups','documents'].map(load));
    renderDashboard();
  }
  if (view === 'customers') { await load('customers'); renderCustomers(); }
  if (view === 'leads') { await load('leads'); renderLeads(); }
  if (view === 'policies') { await Promise.all([load('policies'), load('customers')]); renderPolicies(); }
  if (view === 'followups') { await Promise.all([load('followups'), load('customers'), load('leads')]); renderFollowups(); }
  if (view === 'documents') { await Promise.all([load('documents'), load('customers')]); renderDocuments(); }
  if (view === 'ai') renderAI();
  if (view === 'settings') { await load('profiles'); renderSettings(); }
}

const tableSelect = { customers:'customers', leads:'leads', policies:'policies', followups:'followups', payments:'payments', profiles:'profiles', documents:'documents' };

async function load(key) {
  if (!state.supabase) return [];
  const table = tableSelect[key] || key;
  let query = state.supabase.from(table).select('*');
  if (['customers','leads','policies','followups','documents','payments','profiles'].includes(table)) query = query.order('created_at', { ascending:false });
  const { data, error } = await query;
  if (error) { toast(error.message, 'error'); return []; }
  state.cache[key] = data || [];
  return state.cache[key];
}

async function save(table, payload, id=null) {
  if (!state.supabase) return false;
  let result;
  if (id) result = await state.supabase.from(table).update(payload).eq('id', id).select().single();
  else result = await state.supabase.from(table).insert(payload).select().single();
  if (result.error) { toast(result.error.message, 'error'); return false; }
  return true;
}

async function remove(table, id) {
  if (!state.supabase) return false;
  const { error } = await state.supabase.from(table).delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}

async function api(url, options={}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) headers.set('Content-Type','application/json');
  if (state.session?.access_token) headers.set('Authorization', `Bearer ${state.session.access_token}`);
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function renderDashboard() {
  const c=state.cache.customers||[], l=state.cache.leads||[], p=state.cache.policies||[], f=state.cache.followups||[], d=state.cache.documents||[];
  const active=p.filter(x => x.renewal_status !== 'expired').length;
  const dueSoon=p.filter(x => { const days=x.expiry_date ? Math.ceil((new Date(x.expiry_date)-new Date())/86400000) : null; return days != null && days >= 0 && days <= 30; }).length;
  const pendingPayments=p.filter(x=>['pending','partial','overdue'].includes(x.payment_status)).length;
  const pipeline=l.filter(x=>!['won','lost'].includes(x.status)).length;
  const won=l.filter(x=>x.status==='won').length;
  const conversion=l.length ? Math.round((won/l.length)*100) : 0;
  const revenue=p.reduce((s,x)=>s+Number(x.premium||0),0);
  const carPremium=p.filter(x=>x.insurance_type==='car').reduce((s,x)=>s+Number(x.premium||0),0);
  const healthPremium=p.filter(x=>x.insurance_type==='health').reduce((s,x)=>s+Number(x.premium||0),0);
  const todayFollowups=f.filter(x=>x.status==='pending' && String(x.due_at).slice(0,10)<=todayISO()).length;
  $('#view-dashboard').innerHTML = `<div class="hero"><div><div class="eyebrow">CONTROL CENTRE</div><h3>Good to see you, ${esc((state.profile?.full_name||'RajSure').split(' ')[0])} 👋</h3><p>Real CRM data only — no demo customers or fake records.</p></div><div class="hero-actions"><button class="btn primary" data-action="add-lead">+ New lead</button><button class="btn" data-action="add-customer">+ Customer</button><button class="btn" data-action="add-document">+ Upload document</button></div></div>
  <div class="metric-grid">${metric('◉','Customers',c.length,'Actual CRM contacts')}${metric('↗','Open leads',pipeline,`${conversion}% overall lead conversion`)}${metric('▤','Active policies',active,`${dueSoon} expiring within 30 days`)}${metric('₹','Premium tracked',money(revenue),`${pendingPayments} payment follow-up${pendingPayments===1?'':'s'}`)}</div>
  <div class="grid-2"><div class="panel"><div class="panel-head"><h4>Business analytics</h4><span>Live from Supabase</span></div><div class="panel-body"><div class="kpi-line"><span>Car premium</span><strong>${money(carPremium)}</strong></div><div class="kpi-line"><span>Health premium</span><strong>${money(healthPremium)}</strong></div><div class="kpi-line"><span>Won leads</span><strong>${won}</strong></div><div class="kpi-line"><span>Follow-ups due today</span><strong>${todayFollowups}</strong></div><div class="kpi-line"><span>Documents stored</span><strong>${d.length}</strong></div></div></div>
  <div class="panel"><div class="panel-head"><h4>Renewal watch</h4><span>Next 30 days</span></div><div class="panel-body">${p.filter(x=>{const days=x.expiry_date?Math.ceil((new Date(x.expiry_date)-new Date())/86400000):99; return days>=0&&days<=30;}).slice(0,6).map(x=>`<div class="kpi-line"><span>${esc(x.policy_number)} · ${esc(customerName(x.customer_id))}</span><strong>${dateFmt(x.expiry_date)}</strong></div>`).join('') || '<div class="empty">No policies expiring in the next 30 days.</div>'}</div></div></div>`;
  bindActions($('#view-dashboard'));
}

function metric(icon,label,value,sub){return `<div class="metric"><div class="icon">${icon}</div><label>${esc(label)}</label><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;}
function badge(value,cls=''){return `<span class="badge ${cls||badgeClass(value)}">${esc(String(value||'—').replaceAll('_',' '))}</span>`;}
function badgeClass(v){if(['paid','active','won','completed','low','Connected','Configured'].includes(v))return'good';if(['pending','partial','due_soon','follow_up','medium','Not configured'].includes(v))return'warn';if(['overdue','expired','lost','high'].includes(v))return'bad';return'';}
function mutedCell(text){return `<div class="muted-cell">${esc(text)}</div>`;}

function renderCustomers(filter='') {
  const list=(state.cache.customers||[]).filter(x=>`${x.full_name} ${x.phone||''} ${x.email||''}`.toLowerCase().includes(filter.toLowerCase()));
  $('#view-customers').innerHTML=`<div class="hero"><div><div class="eyebrow">CRM DIRECTORY</div><h3>Customers</h3><p>One place for every insured customer and their details.</p></div><div class="hero-actions"><button class="btn" data-action="export-excel">Export Excel</button><button class="btn primary" data-action="add-customer">+ Add customer</button></div></div><div class="toolbar"><input class="search" id="customer-search" placeholder="Search name, phone, email…" value="${esc(filter)}"><span class="status-pill">${list.length} shown</span></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Email</th><th>Address</th><th>Added</th><th>Actions</th></tr></thead><tbody>${list.length?list.map(x=>`<tr><td><strong>${esc(x.full_name)}</strong></td><td>${esc(x.phone||'—')}</td><td>${esc(x.email||'—')}</td><td>${esc(x.address||'—')}</td><td>${dateFmt(x.created_at)}</td><td><button class="btn small" data-action="edit-customer" data-id="${x.id}">Edit</button> <button class="btn small danger" data-action="delete-customer" data-id="${x.id}">Delete</button></td></tr>`).join(''):`<tr><td colspan="6" class="empty">No customers yet.</td></tr>`}</tbody></table></div></div>`;
  $('#customer-search').addEventListener('input',e=>renderCustomers(e.target.value)); bindActions($('#view-customers'));
}

function renderLeads(filter='') {
  const list=(state.cache.leads||[]).filter(x=>`${x.full_name} ${x.phone||''} ${x.email||''} ${x.status}`.toLowerCase().includes(filter.toLowerCase()));
  $('#view-leads').innerHTML=`<div class="hero"><div><div class="eyebrow">SALES PIPELINE</div><h3>Leads</h3><p>Track every enquiry from first contact to won business.</p></div><div class="hero-actions"><button class="btn" data-action="export-excel">Export Excel</button><button class="btn primary" data-action="add-lead">+ Add lead</button></div></div><div class="toolbar"><input class="search" id="lead-search" placeholder="Search leads…" value="${esc(filter)}"><span class="status-pill">${list.length} leads</span></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Lead</th><th>Type</th><th>Status</th><th>Priority</th><th>Expected premium</th><th>Next follow-up</th><th>Actions</th></tr></thead><tbody>${list.length?list.map(x=>`<tr><td><strong>${esc(x.full_name)}</strong>${mutedCell(x.phone||x.email||'')}</td><td>${badge(x.insurance_type)}</td><td>${badge(x.status)}</td><td>${badge(x.priority)}</td><td>${money(x.expected_premium)}</td><td>${dateFmt(x.next_follow_up)}</td><td><button class="btn small" data-action="edit-lead" data-id="${x.id}">Edit</button> <button class="btn small danger" data-action="delete-lead" data-id="${x.id}">Delete</button></td></tr>`).join(''):`<tr><td colspan="7" class="empty">No leads yet.</td></tr>`}</tbody></table></div></div>`;
  $('#lead-search').addEventListener('input',e=>renderLeads(e.target.value)); bindActions($('#view-leads'));
}

function renderPolicies(filter='') {
  const list=(state.cache.policies||[]).filter(x=>`${x.policy_number} ${x.provider||''} ${customerName(x.customer_id)}`.toLowerCase().includes(filter.toLowerCase()));
  $('#view-policies').innerHTML=`<div class="hero"><div><div class="eyebrow">POLICY DESK</div><h3>Policies</h3><p>Monitor active cover, expiry dates, premiums, and payment status.</p></div><div class="hero-actions"><button class="btn" data-action="export-excel">Export Excel</button><button class="btn primary" data-action="add-policy">+ Add policy</button></div></div><div class="toolbar"><input class="search" id="policy-search" placeholder="Search policy, customer, provider…" value="${esc(filter)}"><span class="status-pill">${list.length} policies</span></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Policy</th><th>Customer</th><th>Type</th><th>Expiry</th><th>Premium</th><th>Payment</th><th>Renewal</th><th>Actions</th></tr></thead><tbody>${list.length?list.map(x=>`<tr><td><strong>${esc(x.policy_number)}</strong>${mutedCell(x.provider||'')}</td><td>${esc(customerName(x.customer_id))}</td><td>${badge(x.insurance_type)}</td><td>${dateFmt(x.expiry_date)}</td><td>${money(x.premium)}</td><td>${badge(x.payment_status)}</td><td>${badge(x.renewal_status)}</td><td><button class="btn small" data-action="edit-policy" data-id="${x.id}">Edit</button> <button class="btn small danger" data-action="delete-policy" data-id="${x.id}">Delete</button></td></tr>`).join(''):`<tr><td colspan="8" class="empty">No policies yet.</td></tr>`}</tbody></table></div></div>`;
  $('#policy-search').addEventListener('input',e=>renderPolicies(e.target.value)); bindActions($('#view-policies'));
}

function renderFollowups(filter='') {
  const list=[...(state.cache.followups||[])].filter(x=>`${x.note||''} ${x.type||''} ${customerName(x.customer_id)} ${leadName(x.lead_id)}`.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));
  $('#view-followups').innerHTML=`<div class="hero"><div><div class="eyebrow">TASK BOARD</div><h3>Follow-ups</h3><p>Make renewals and sales follow-up impossible to forget.</p></div><button class="btn primary" data-action="add-followup">+ Add follow-up</button></div><div class="toolbar"><input class="search" id="followup-search" placeholder="Search follow-ups…" value="${esc(filter)}"><span class="status-pill">${list.filter(x=>x.status==='pending').length} pending</span></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Due</th><th>Customer / Lead</th><th>Type</th><th>Status</th><th>Note</th><th>Actions</th></tr></thead><tbody>${list.length?list.map(x=>`<tr><td><strong>${dateFmt(x.due_at)}</strong>${mutedCell(new Date(x.due_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}))}</td><td>${esc(x.customer_id?customerName(x.customer_id):leadName(x.lead_id))}</td><td>${badge(x.type)}</td><td>${badge(x.status)}</td><td>${esc(x.note||'—')}</td><td>${x.status==='pending'?`<button class="btn small" data-action="complete-followup" data-id="${x.id}">Complete</button>`:''} <button class="btn small danger" data-action="delete-followup" data-id="${x.id}">Delete</button></td></tr>`).join(''):`<tr><td colspan="6" class="empty">No follow-ups yet.</td></tr>`}</tbody></table></div></div>`;
  $('#followup-search').addEventListener('input',e=>renderFollowups(e.target.value)); bindActions($('#view-followups'));
}

function renderDocuments(filter='') {
  const customers=state.cache.customers||[];
  const list=(state.cache.documents||[]).filter(x=>`${x.file_name} ${x.document_category||''} ${customerName(x.customer_id)}`.toLowerCase().includes(filter.toLowerCase()));
  const hasCustomer=customers.length>0;
  $('#view-documents').innerHTML=`<div class="hero"><div><div class="eyebrow">PRIVATE DOCUMENT VAULT</div><h3>Documents</h3><p>Cloud-backed storage for PAN, Aadhaar, RC, insurance policies, and vehicle photos.</p></div><div class="hero-actions"><button class="btn" data-action="export-excel">Export Excel</button><button class="btn primary" data-action="add-document" ${hasCustomer?'':'disabled'}>+ Upload document</button></div></div>
  <div class="notice">Files are stored in the private Supabase <strong>${esc(state.config?.storageBucket||'documents')}</strong> bucket. Nothing is stored in browser localStorage.</div>
  <div class="toolbar"><input class="search" id="document-search" placeholder="Search file, category, customer…" value="${esc(filter)}"><span class="status-pill">${list.length} files</span></div>
  <div class="panel"><div class="table-wrap"><table><thead><tr><th>File</th><th>Category</th><th>Customer</th><th>Type</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>${list.length?list.map(x=>`<tr><td><strong>${esc(x.file_name)}</strong></td><td>${badge(categoryLabel(x.document_category))}</td><td>${esc(customerName(x.customer_id))}</td><td>${esc(x.mime_type||'—')}</td><td>${formatBytes(x.file_size)}</td><td>${dateFmt(x.created_at)}</td><td><button class="btn small" data-action="open-document" data-id="${x.id}">Open</button> <button class="btn small danger" data-action="delete-document" data-id="${x.id}">Delete</button></td></tr>`).join(''):`<tr><td colspan="7" class="empty">No documents uploaded yet.</td></tr>`}</tbody></table></div></div>`;
  $('#document-search').addEventListener('input',e=>renderDocuments(e.target.value)); bindActions($('#view-documents'));
}

function renderAI() {
  const ready=Boolean(state.config?.aiConfigured);
  $('#view-ai').innerHTML=`<div class="hero"><div><div class="eyebrow">DOCUMENT INTELLIGENCE</div><h3>AI Extract</h3><p>Use Gemini to read a policy or KYC file and pre-fill customer/policy details.</p></div></div><div class="grid-2"><div class="panel"><div class="panel-head"><h4>Gemini extractor</h4>${badge(ready?'AI ready':'AI not configured',ready?'good':'warn')}</div><div class="panel-body"><div class="upload-drop"><div style="font-size:28px">✦</div><h4>${ready?'Choose an insurance document':'Add GEMINI_API_KEY to enable extraction'}</h4><p>PDF, JPG, PNG, WEBP, HEIC or HEIF • Max 10 MB</p><input type="file" id="ai-file" accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" ${ready?'':'disabled'} /><button class="btn primary" id="ai-upload" ${ready?'':'disabled'} style="margin-top:12px">Extract with Gemini</button></div><div id="ai-result" class="ai-result hidden"></div></div></div><div class="panel"><div class="panel-head"><h4>CRM flow</h4></div><div class="panel-body"><div class="kpi-line"><span>1. Upload</span><strong>Policy / KYC</strong></div><div class="kpi-line"><span>2. Extract</span><strong>Structured JSON</strong></div><div class="kpi-line"><span>3. Review</span><strong>You confirm</strong></div><div class="kpi-line"><span>4. Save</span><strong>Customer / policy</strong></div><p style="color:var(--muted);font-size:11px;line-height:1.6;margin:14px 0 0">AI is an assistant. Always verify extracted values against the original document before saving.</p></div></div></div>`;
  const btn=$('#ai-upload'); if(btn)btn.addEventListener('click',runAIExtraction);
}

async function runAIExtraction() {
  const file=$('#ai-file')?.files?.[0], out=$('#ai-result');
  if(!file)return toast('Choose a document first.','error');
  out.classList.remove('hidden'); out.innerHTML='<div class="eyebrow">PROCESSING</div><p>Reading the document with Gemini…</p>';
  try {
    const form=new FormData(); form.append('file',file);
    const data=await api('./api/ai/extract',{method:'POST',body:form});
    out.innerHTML=`<div class="eyebrow">EXTRACTED DATA</div><pre>${esc(JSON.stringify(data.data,null,2))}</pre><div class="hero-actions"><button class="btn primary" id="save-ai-customer">Use customer data</button></div>`;
    $('#save-ai-customer').addEventListener('click',()=>{const c=data.data?.customer||{};openCustomerModal(null,{full_name:c.full_name||'',phone:c.phone||'',email:c.email||'',address:c.address||'',date_of_birth:c.date_of_birth||'',notes:'Imported from AI extraction. Verify before saving.'});});
  } catch(e) { out.innerHTML=`<div class="badge bad">Extraction failed</div><p style="color:var(--muted);font-size:11px">${esc(e.message)}</p>`; }
}

async function uploadDocuments(files, customerId, category) {
  if(!files.length || !customerId)return toast('Choose a customer and at least one file.','error');
  if(!state.supabase)return toast('CRM is not connected.','error');
  const bucket=state.config?.storageBucket||'documents';
  const userId=state.user?.id;
  for(const file of files) {
    if(file.size > 10*1024*1024) { toast(`${file.name} is larger than 10 MB.`, 'error'); continue; }
    const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_');
    const path=`${userId}/${customerId}/${Date.now()}-${crypto.randomUUID()}-${safe}`;
    const { error: uploadError }=await state.supabase.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type||undefined});
    if(uploadError) { toast(`${file.name}: ${uploadError.message}`,'error'); continue; }
    const { error: rowError }=await state.supabase.from('documents').insert({customer_id:customerId,file_name:file.name,storage_path:path,mime_type:file.type||null,file_size:file.size,document_category:category,uploaded_by:userId});
    if(rowError) { await state.supabase.storage.from(bucket).remove([path]); toast(`${file.name}: ${rowError.message}`,'error'); continue; }
    toast(`${file.name} uploaded.`,'success');
  }
  await load('documents'); renderDocuments();
}

function openDocumentModal() {
  const customers=state.cache.customers||[];
  if(!customers.length)return toast('Create a customer before uploading documents.','error');
  openModal('Upload customer documents',`<div class="form-grid"><label>Customer<select id="m-doc-customer">${customers.map(c=>`<option value="${c.id}">${esc(c.full_name)} — ${esc(c.phone||'')}</option>`).join('')}</select></label><label>Document type<select id="m-doc-category">${documentCategories.map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label class="full-col">Files<input id="m-doc-files" type="file" accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" multiple /></label><label class="full-col">Privacy note<textarea id="m-doc-note" readonly>These files are private Supabase Storage objects. Access is restricted to authenticated CRM members by Storage RLS.</textarea></label></div>`, 'Upload files', async()=>{
    const files=[...($('#m-doc-files').files||[])];
    if(!files.length)return toast('Choose one or more files.','error');
    await uploadDocuments(files,$('#m-doc-customer').value,$('#m-doc-category').value); closeModal();
  });
}

async function openDocument(id) {
  const doc=(state.cache.documents||[]).find(x=>x.id===id); if(!doc?.storage_path)return toast('Document path is missing.','error');
  const { data, error }=await state.supabase.storage.from(state.config?.storageBucket||'documents').createSignedUrl(doc.storage_path,600);
  if(error||!data?.signedUrl)return toast(error?.message||'Could not create document URL.','error');
  window.open(data.signedUrl,'_blank','noopener,noreferrer');
}

async function deleteDocument(id) {
  const doc=(state.cache.documents||[]).find(x=>x.id===id); if(!doc)return;
  if(!confirm(`Delete ${doc.file_name}? This cannot be undone.`))return;
  if(doc.storage_path)await state.supabase.storage.from(state.config?.storageBucket||'documents').remove([doc.storage_path]);
  if(await remove('documents',id)){await load('documents');renderDocuments();toast('Document deleted.','success');}
}

async function exportExcel() {
  if(!window.XLSX)return toast('Excel export library is not loaded. Check your internet connection.','error');
  const sheets=[];
  const customers=state.cache.customers||[], leads=state.cache.leads||[], policies=state.cache.policies||[], docs=state.cache.documents||[];
  sheets.push(['Customers',XLSX.utils.json_to_sheet(customers.map(x=>({Name:x.full_name,Phone:x.phone||'',Email:x.email||'',Address:x.address||'',DOB:x.date_of_birth||'',Notes:x.notes||'',Created:x.created_at||''})))]);
  sheets.push(['Leads',XLSX.utils.json_to_sheet(leads.map(x=>({Name:x.full_name,Phone:x.phone||'',Email:x.email||'',Type:x.insurance_type,Status:x.status,Priority:x.priority,ExpectedPremium:x.expected_premium||'',NextFollowUp:x.next_follow_up||'',Source:x.source||'',Notes:x.notes||''})))]);
  sheets.push(['Policies',XLSX.utils.json_to_sheet(policies.map(x=>({PolicyNumber:x.policy_number,Customer:customerName(x.customer_id),Type:x.insurance_type,Provider:x.provider||'',Start:x.start_date||'',Expiry:x.expiry_date||'',Premium:x.premium||'',Payment:x.payment_status,Renewal:x.renewal_status,VehicleNumber:x.vehicle_number||'',VehicleModel:x.vehicle_model||'',SumInsured:x.sum_insured||''})))]);
  const docRows=[];
  for(const d of docs){
    let url='';
    if(d.storage_path){const r=await state.supabase.storage.from(state.config?.storageBucket||'documents').createSignedUrl(d.storage_path,3600);url=r.data?.signedUrl||'';}
    docRows.push({File:d.file_name,Category:categoryLabel(d.document_category),Customer:customerName(d.customer_id),Type:d.mime_type||'',Size:d.file_size||'',Uploaded:d.created_at||'',OpenFile:url});
  }
  sheets.push(['Documents',XLSX.utils.json_to_sheet(docRows)]);
  const wb=XLSX.utils.book_new(); for(const [name,ws] of sheets)XLSX.utils.book_append_sheet(wb,ws,name);
  XLSX.writeFile(wb,`RajSure_CRM_${todayISO()}.xlsx`);
  toast('Excel export created.', 'success');
}

async function renderSettings() {
  const profiles=state.cache.profiles||[]; const isAdmin=state.profile?.role==='admin';
  $('#view-settings').innerHTML=`<div class="hero"><div><div class="eyebrow">SYSTEM</div><h3>Settings</h3><p>Connection, AI, team and security controls.</p></div></div><div class="settings-grid"><div class="panel"><div class="panel-head"><h4>System status</h4></div><div class="panel-body">${setting('Supabase','Connected','Authenticated database + RLS')}${setting('Gemini AI',state.config?.aiConfigured?'Configured':'Not configured',state.config?.aiConfigured?'Server-side API key detected':'Add GEMINI_API_KEY to .env when ready')}${setting('Private Storage',state.config?.storageBucket||'documents','Cloud storage for customer documents')}${setting('Service role',state.config?.serviceRoleConfigured?'Configured':'Not configured','Server-only; never expose it to browser')}</div></div><div class="panel"><div class="panel-head"><h4>Team</h4>${isAdmin?'<span>Admin</span>':'<span>Staff access</span>'}</div><div class="panel-body"><div class="team-list">${profiles.map(p=>`<div class="team-item"><div><strong>${esc(p.full_name)}</strong><small>${esc(p.phone||'')}</small></div>${badge(p.role,p.role==='admin'?'good':'')}</div>`).join('')||'<div class="empty">No team records loaded.</div>'}</div>${isAdmin&&state.config?.serviceRoleConfigured?'<button class="btn primary" data-action="add-staff" style="margin-top:14px">+ Add staff member</button>':''}<p style="color:var(--muted);font-size:11px;line-height:1.6;margin:14px 0 0">After the first admin account is confirmed, disable public sign-ups in Supabase Authentication settings. Staff should be created only by an administrator.</p></div></div></div>`;
  bindActions($('#view-settings'));
}
function setting(title,value,sub){return `<div class="setting-item"><div><strong>${esc(title)}</strong><span>${esc(sub)}</span></div>${badge(value,value==='Connected'||value==='Configured'?'good':(value==='Not configured'?'warn':''))}</div>`;}
function customerName(id){return(state.cache.customers||[]).find(x=>x.id===id)?.full_name||'Unknown customer';}
function leadName(id){return(state.cache.leads||[]).find(x=>x.id===id)?.full_name||'Unknown lead';}
function formatBytes(n){if(!n)return'—';const units=['B','KB','MB','GB'];let i=0,v=n;while(v>=1024&&i<units.length-1){v/=1024;i++;}return`${v.toFixed(v>=10||i===0?0:1)} ${units[i]}`;}

function bindActions(root){$$('[data-action]',root).forEach(btn=>btn.addEventListener('click',()=>handleAction(btn.dataset.action,btn.dataset.id)));}

async function handleAction(action,id){
  if(action==='add-customer')return openCustomerModal();
  if(action==='edit-customer')return openCustomerModal(id);
  if(action==='delete-customer')return doDelete('customers',id,'Customer');
  if(action==='add-lead')return openLeadModal();
  if(action==='edit-lead')return openLeadModal(id);
  if(action==='delete-lead')return doDelete('leads',id,'Lead');
  if(action==='add-policy')return openPolicyModal();
  if(action==='edit-policy')return openPolicyModal(id);
  if(action==='delete-policy')return doDelete('policies',id,'Policy');
  if(action==='add-followup')return openFollowupModal();
  if(action==='complete-followup'){await save('followups',{status:'completed'},id);await load('followups');renderFollowups();return toast('Follow-up completed.','success');}
  if(action==='delete-followup')return doDelete('followups',id,'Follow-up');
  if(action==='add-document')return openDocumentModal();
  if(action==='open-document')return openDocument(id);
  if(action==='delete-document')return deleteDocument(id);
  if(action==='add-staff')return openStaffModal();
  if(action==='export-excel')return exportExcel();
}

async function doDelete(table,id,label){if(!confirm(`Delete this ${label.toLowerCase()}? This cannot be undone.`))return;if(await remove(table,id)){await load(table);navigate(state.view);toast(`${label} deleted.`,'success');}}

function openModal(title,body,submitText,onSubmit){$('#modal').innerHTML=`<div class="modal-head"><h3>${title}</h3><button class="close" id="modal-close">×</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn" id="modal-cancel">Cancel</button><button class="btn primary" id="modal-submit">${submitText}</button></div>`;$('#modal-backdrop').classList.remove('hidden');$('#modal-close').onclick=closeModal;$('#modal-cancel').onclick=closeModal;$('#modal-submit').onclick=onSubmit;}
function closeModal(){$('#modal-backdrop').classList.add('hidden');$('#modal').innerHTML='';}

function openCustomerModal(id=null,preset={}){
  const current=id?(state.cache.customers||[]).find(x=>x.id===id)||{}:{}; const x={...current,...preset};
  openModal(id?'Edit customer':'Add customer',`<div class="form-grid"><label>Full name<input id="m-name" value="${esc(x.full_name||'')}" required></label><label>Phone<input id="m-phone" value="${esc(x.phone||'')}"></label><label>Email<input id="m-email" type="email" value="${esc(x.email||'')}"></label><label>Date of birth<input id="m-dob" type="date" value="${esc(x.date_of_birth||'')}"></label><label class="full-col">Address<textarea id="m-address">${esc(x.address||'')}</textarea></label><label class="full-col">Notes<textarea id="m-notes">${esc(x.notes||'')}</textarea></label><div class="notice full-col">After creating the customer, use <strong>Documents</strong> to upload PAN, Aadhaar, RC Book, Insurance Policy and Vehicle Photos.</div></div>`,id?'Save changes':'Create customer',async()=>{const payload={full_name:$('#m-name').value.trim(),phone:$('#m-phone').value.trim(),email:$('#m-email').value.trim(),date_of_birth:$('#m-dob').value||null,address:$('#m-address').value.trim(),notes:$('#m-notes').value.trim()};if(!payload.full_name)return toast('Customer name is required.','error');if(!id)payload.created_by=state.user?.id;if(await save('customers',payload,id)){closeModal();await load('customers');navigate('customers');toast(id?'Customer updated.':'Customer created.','success');}});
}

function openLeadModal(id=null){const x=id?(state.cache.leads||[]).find(a=>a.id===id)||{}:{};openModal(id?'Edit lead':'Add lead',`<div class="form-grid"><label>Full name<input id="m-name" value="${esc(x.full_name||'')}"></label><label>Phone<input id="m-phone" value="${esc(x.phone||'')}"></label><label>Email<input id="m-email" type="email" value="${esc(x.email||'')}"></label><label>Insurance type<select id="m-type"><option value="car" ${x.insurance_type==='car'?'selected':''}>Car</option><option value="health" ${x.insurance_type==='health'?'selected':''}>Health</option></select></label><label>Status<select id="m-status">${['new','contacted','follow_up','quotation','won','lost'].map(v=>`<option value="${v}" ${x.status===v?'selected':''}>${v.replaceAll('_',' ')}</option>`).join('')}</select></label><label>Priority<select id="m-priority">${['low','medium','high'].map(v=>`<option value="${v}" ${x.priority===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Expected premium<input id="m-premium" type="number" min="0" value="${esc(x.expected_premium??'')}"></label><label>Next follow-up<input id="m-followup" type="date" value="${esc(x.next_follow_up||'')}"></label><label>Source<input id="m-source" value="${esc(x.source||'')}"></label><label class="full-col">Notes<textarea id="m-notes">${esc(x.notes||'')}</textarea></label></div>`,id?'Save changes':'Create lead',async()=>{const payload={full_name:$('#m-name').value.trim(),phone:$('#m-phone').value.trim(),email:$('#m-email').value.trim(),insurance_type:$('#m-type').value,status:$('#m-status').value,priority:$('#m-priority').value,expected_premium:Number($('#m-premium').value)||null,next_follow_up:$('#m-followup').value||null,source:$('#m-source').value.trim(),notes:$('#m-notes').value.trim()};if(!payload.full_name)return toast('Lead name is required.','error');if(!id)payload.created_by=state.user?.id;if(await save('leads',payload,id)){closeModal();await load('leads');navigate('leads');toast(id?'Lead updated.':'Lead created.','success');}});}

function openPolicyModal(id=null){const x=id?(state.cache.policies||[]).find(a=>a.id===id)||{}:{};const customers=state.cache.customers||[];if(!customers.length)return toast('Create a customer before adding a policy.','error');openModal(id?'Edit policy':'Add policy',`<div class="form-grid"><label>Customer<select id="m-customer">${customers.map(c=>`<option value="${c.id}" ${x.customer_id===c.id?'selected':''}>${esc(c.full_name)} — ${esc(c.phone||'')}</option>`).join('')}</select></label><label>Policy number<input id="m-number" value="${esc(x.policy_number||'')}"></label><label>Insurance type<select id="m-type"><option value="car" ${x.insurance_type==='car'?'selected':''}>Car</option><option value="health" ${x.insurance_type==='health'?'selected':''}>Health</option></select></label><label>Provider<input id="m-provider" value="${esc(x.provider||'')}"></label><label>Start date<input id="m-start" type="date" value="${esc(x.start_date||'')}"></label><label>Expiry date<input id="m-expiry" type="date" value="${esc(x.expiry_date||'')}"></label><label>Premium<input id="m-premium" type="number" min="0" value="${esc(x.premium??'')}"></label><label>Sum insured<input id="m-sum" type="number" min="0" value="${esc(x.sum_insured??'')}"></label><label>Payment status<select id="m-payment">${['paid','pending','partial','overdue'].map(v=>`<option value="${v}" ${x.payment_status===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Renewal status<select id="m-renewal">${['active','due_soon','expired','renewed'].map(v=>`<option value="${v}" ${x.renewal_status===v?'selected':''}>${v.replaceAll('_',' ')}</option>`).join('')}</select></label><label>Vehicle number<input id="m-vno" value="${esc(x.vehicle_number||'')}"></label><label>Vehicle model<input id="m-vmodel" value="${esc(x.vehicle_model||'')}"></label><label class="full-col">Notes<textarea id="m-notes">${esc(x.notes||'')}</textarea></label></div>`,id?'Save changes':'Create policy',async()=>{const payload={customer_id:$('#m-customer').value,policy_number:$('#m-number').value.trim(),insurance_type:$('#m-type').value,provider:$('#m-provider').value.trim(),start_date:$('#m-start').value||null,expiry_date:$('#m-expiry').value||null,premium:Number($('#m-premium').value)||null,sum_insured:Number($('#m-sum').value)||null,payment_status:$('#m-payment').value,renewal_status:$('#m-renewal').value,vehicle_number:$('#m-vno').value.trim(),vehicle_model:$('#m-vmodel').value.trim(),notes:$('#m-notes').value.trim()};if(!payload.customer_id||!payload.policy_number)return toast('Customer and policy number are required.','error');if(!id)payload.created_by=state.user?.id;if(await save('policies',payload,id)){closeModal();await load('policies');navigate('policies');toast(id?'Policy updated.':'Policy created.','success');}});}

function openFollowupModal(){const customers=state.cache.customers||[],leads=state.cache.leads||[];openModal('Add follow-up',`<div class="form-grid"><label>Customer (optional)<select id="m-customer"><option value="">— none —</option>${customers.map(c=>`<option value="${c.id}">${esc(c.full_name)}</option>`).join('')}</select></label><label>Lead (optional)<select id="m-lead"><option value="">— none —</option>${leads.map(c=>`<option value="${c.id}">${esc(c.full_name)}</option>`).join('')}</select></label><label>Due date & time<input id="m-due" type="datetime-local" value="${new Date(Date.now()+3600000).toISOString().slice(0,16)}"></label><label>Type<select id="m-type">${['call','whatsapp','email','meeting','other'].map(v=>`<option value="${v}">${v}</option>`).join('')}</select></label><label class="full-col">Note<textarea id="m-note" placeholder="What needs to happen?"></textarea></label></div>`,'Create follow-up',async()=>{const customer_id=$('#m-customer').value||null,lead_id=$('#m-lead').value||null;if(!customer_id&&!lead_id)return toast('Choose a customer or a lead.','error');const payload={customer_id,lead_id,due_at:new Date($('#m-due').value).toISOString(),type:$('#m-type').value,status:'pending',note:$('#m-note').value.trim(),created_by:state.user?.id};if(await save('followups',payload)){closeModal();await load('followups');navigate('followups');toast('Follow-up created.','success');}});}

function openStaffModal(){openModal('Add staff member',`<div class="notice">Staff accounts are created server-side. The Supabase service-role key never reaches the browser.</div><div class="form-grid"><label>Full name<input id="m-name"></label><label>Email<input id="m-email" type="email"></label><label>Password<input id="m-password" type="password" minlength="8"></label><label>Role<select id="m-role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label></div>`,'Create staff account',async()=>{try{await api('./api/admin/create-staff',{method:'POST',body:JSON.stringify({email:$('#m-email').value.trim(),password:$('#m-password').value,full_name:$('#m-name').value.trim(),role:$('#m-role').value})});closeModal();await load('profiles');renderSettings();toast('Team member created.','success');}catch(e){toast(e.message,'error');}});}

init();
