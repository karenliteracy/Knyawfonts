// app.js - Karen Writer
// Loads only .woff and .woff2 from https://github.com/karenliteracy/Knyawfonts (repo root)
// Features: multi-page, thumbnails, drag reorder, drag-resize, ruler, undo/redo, formatting, flatten, export

const GITHUB_CONFIG = { owner: 'karenliteracy', repo: 'Knyawfonts', path: 'https://github.com/karenliteracy/Knyawfonts/blob/main/' };
const FONT_EXT_RE = /\.(woff2?|woff)$/i;
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/main${GITHUB_CONFIG.path ? '/' + GITHUB_CONFIG.path : ''}`;

const state = {
  pages: [],
  current: 0,
  fonts: [],
  savedFormat: null,
  undoStack: [],
  redoStack: []
};

// DOM refs
const fontSelect = document.getElementById('fontSelect');
const fontSizeSelect = document.getElementById('fontSizeSelect');
const thumbContainer = document.getElementById('thumbContainer');
const pagesContainer = document.getElementById('pagesContainer');
const addPageBtn = document.getElementById('addPageBtn');
const dupPageBtn = document.getElementById('dupPageBtn');
const delPageBtn = document.getElementById('delPageBtn');
const pageRuler = document.getElementById('pageRuler');
const exportModal = document.getElementById('exportModal');
const exportBtn = document.getElementById('exportBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportPngZipBtn = document.getElementById('exportPngZipBtn');
const exportPngBtn = document.getElementById('exportPngBtn');
const exportJpgBtn = document.getElementById('exportJpgBtn');
const exportDocxBtn = document.getElementById('exportDocxBtn');
const flattenBtn = document.getElementById('flattenBtn');

const hideToolbarBtn = document.getElementById('hideToolbarBtn');
const showToolbarBtn = document.getElementById('showToolbarBtn');
const toolbar = document.getElementById('toolbar');

const underlineBtn = document.getElementById('underlineBtn');
const underlineStyles = document.getElementById('underlineStyles');

const fontSettingsBtn = document.getElementById('fontSettingsBtn');
const fontSettingsPanel = document.getElementById('fontSettingsPanel');

const paperSizeSelect = document.getElementById('paperSizeSelect');
const paperOrientation = document.getElementById('paperOrientation');

// helper
function uid(prefix = 'id') { return prefix + Math.random().toString(36).slice(2,9); }
function friendlyName(fn) { return fn.replace(/[_-]+/g,' ').replace(/\.(woff2?|woff)$/i,'').replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase()); }

// ensure html2canvas available (but index.html already includes it); keep safe check
async function ensureHtml2Canvas(){
  if(window.html2canvas) return window.html2canvas;
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  document.head.appendChild(s);
  return new Promise((res,rej)=>{
    s.onload = ()=> res(window.html2canvas);
    s.onerror = rej;
  });
}

// FONT LOADER (from GitHub contents)
async function loadFontsFromGithub(){
  try{
    const api = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents${GITHUB_CONFIG.path ? '/' + GITHUB_CONFIG.path : ''}`;
    const r = await fetch(api);
    if(!r.ok) throw new Error('GitHub API error ' + r.status);
    const files = await r.json();
    const fontFiles = files.filter(f => f.name.match(FONT_EXT_RE));
    const urlObjs = fontFiles.map(f => ({ name: f.name.replace(FONT_EXT_RE,''), url: `${RAW_BASE}/${encodeURIComponent(f.name)}`, fileName: f.name }));
    await loadFonts(urlObjs);
  }catch(e){
    console.warn('loadFontsFromGithub error', e);
  }
}

async function loadFonts(list){
  for(const item of list){
    try{
      const resp = await fetch(item.url);
      if(!resp.ok) { console.warn('font fetch failed', item.url); continue; }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const face = new FontFace(item.name, `url(${blobUrl})`);
      await face.load();
      document.fonts.add(face);
      state.fonts.push({ name: item.name, blobUrl, sourceUrl: item.url });
      addFontOption(item.name);
    }catch(e){
      console.warn('loadFonts error', e);
    }
  }
  await document.fonts.ready;
  if(state.fonts.length){ fontSelect.value = state.fonts[0].name; applyFont(state.fonts[0].name); }
}

function addFontOption(name){
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = friendlyName(name);
  opt.style.fontFamily = `'${name}', Inter, sans-serif`;
  fontSelect.appendChild(opt);
}

// PAGE MANAGEMENT
function ensurePageExists(){
  if(state.pages.length === 0){
    const id = uid('p');
    const html = `<div class="page-content" contenteditable="true" style="font-family:Inter, sans-serif; font-size:16px; line-height:1.25"><h1 style="margin-top:0">Karen Writer</h1><p></p></div>`;
    state.pages.push({ id, html, width: 800 });
  }
}

function renderPages(){
  pagesContainer.innerHTML = '';
  thumbContainer.innerHTML = '';

  state.pages.forEach((p, idx) => {
    // page
    const wrap = document.createElement('div'); wrap.className = 'pageWrap';
    const page = document.createElement('div'); page.className = 'page';
    page.style.width = (p.width || 800) + 'px';
    page.innerHTML = p.html;

    // ensure editable inner content
    const inner = page.querySelector('.page-content');
    if(inner){
      inner.contentEditable = true;
      inner.addEventListener('input', onEditorInput);
    }

    const handle = document.createElement('div'); handle.className = 'resize-handle';
    handle.addEventListener('mousedown', startResize(idx));
    handle.style.position = 'absolute'; handle.style.right = '0'; handle.style.top='0'; handle.style.bottom='0'; handle.style.width='10px';

    wrap.style.position = 'relative';
    wrap.appendChild(page);
    wrap.appendChild(handle);
    pagesContainer.appendChild(wrap);

    // thumbnail
    const thumb = document.createElement('div'); thumb.className = 'thumb-item';
    const img = document.createElement('img'); img.alt = `Page ${idx+1}`;
    thumb.appendChild(img);
    thumbContainer.appendChild(thumb);
    thumb.addEventListener('click', ()=> { scrollToPage(idx); setCurrent(idx); });

    // drag reorder events
    thumb.draggable = true;
    thumb.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', idx));
    thumb.addEventListener('dragover', e => { e.preventDefault(); thumb.style.outline = '2px dashed #aaa'; });
    thumb.addEventListener('dragleave', ()=> thumb.style.outline = 'none');
    thumb.addEventListener('drop', e => {
      e.preventDefault(); thumb.style.outline = 'none';
      const from = parseInt(e.dataTransfer.getData('text/plain'),10);
      const to = idx;
      reorderPages(from, to);
    });

    // generate thumbnail image
    (async ()=>{
      await ensureHtml2Canvas();
      const tmp = document.createElement('div');
      tmp.style.width = (p.width||800) + 'px';
      tmp.style.padding = '28px';
      tmp.style.background = '#fff';
      tmp.style.position = 'fixed'; tmp.style.left = '-9999px';
      tmp.innerHTML = p.html;
      document.body.appendChild(tmp);
      try{
        const canvas = await html2canvas(tmp, { scale: 0.18, useCORS: true });
        img.src = canvas.toDataURL('image/png');
      }catch(e){
        console.warn('thumb capture failed', e);
      }
      try{ document.body.removeChild(tmp);}catch(e){}
    })();
  });

  setCurrent(state.current);
}

function addPage(after = state.current){
  saveAllPages();
  const id = uid('p');
  const html = `<div class="page-content" contenteditable="true" style="font-family:Inter, sans-serif; font-size:16px; line-height:1.25"><h1 style="margin-top:0">New Page</h1><p></p></div>`;
  state.pages.splice(after+1,0,{ id, html, width:800 });
  state.current = after+1;
  pushUndo();
  renderPages();
}

function duplicatePage(index = state.current){
  saveAllPages();
  const copy = JSON.parse(JSON.stringify(state.pages[index]));
  copy.id = uid('p');
  state.pages.splice(index+1,0,copy);
  state.current = index+1;
  pushUndo();
  renderPages();
}

function deletePage(index = state.current){
  if(state.pages.length === 1){ alert('Cannot delete the only page'); return; }
  saveAllPages();
  state.pages.splice(index,1);
  state.current = Math.max(0, index-1);
  pushUndo();
  renderPages();
}

function reorderPages(from, to){
  if(from === to) return;
  saveAllPages();
  const item = state.pages.splice(from,1)[0];
  state.pages.splice(to,0,item);
  state.current = state.pages.findIndex(p => p.id === item.id);
  pushUndo();
  renderPages();
}

function setCurrent(index){
  state.current = index;
  Array.from(thumbContainer.children).forEach((t,i)=> t.classList.toggle('active', i===index));
  // focus current editable area
  const editors = document.querySelectorAll('.page .page-content');
  if(editors[index]) editors[index].focus();
}

function scrollToPage(i){
  const wraps = document.querySelectorAll('.pageWrap');
  if(wraps[i]) wraps[i].scrollIntoView({behavior:'smooth', block:'center'});
}

function saveAllPages(){
  const editors = document.querySelectorAll('.page .page-content');
  editors.forEach((el, i) => {
    state.pages[i].html = el.parentNode.innerHTML;
  });
}

/* resize */
function startResize(index){
  return function(e){
    e.preventDefault();
    const startX = e.clientX;
    const pageWrap = document.querySelectorAll('.pageWrap')[index];
    const pageEl = pageWrap.querySelector('.page');
    const startW = pageEl.getBoundingClientRect().width;
    function onMove(ev){
      const dx = ev.clientX - startX;
      const newW = Math.max(320, Math.round(startW + dx));
      pageEl.style.width = newW + 'px';
      state.pages[index].width = newW;
      updateRuler(newW);
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveAllPages(); renderPages();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
}

function updateRuler(px){
  const ticks = 12;
  const tickWidth = Math.max(10, Math.round(px / ticks));
  pageRuler.style.background = `repeating-linear-gradient(to right, rgba(255,255,255,0.06) 0, rgba(255,255,255,0.06) 1px, transparent 1px, transparent ${tickWidth}px)`;
}

/* UNDO/REDO */
function pushUndo(){
  state.undoStack.push(JSON.stringify(state.pages));
  if(state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];
}
function undo(){
  if(state.undoStack.length === 0) return;
  const last = state.undoStack.pop();
  state.redoStack.push(JSON.stringify(state.pages));
  try{ state.pages = JSON.parse(last); renderPages(); } catch(e){ console.warn('undo parse error', e); }
}
function redo(){
  if(state.redoStack.length === 0) return;
  const last = state.redoStack.pop();
  state.undoStack.push(JSON.stringify(state.pages));
  try{ state.pages = JSON.parse(last); renderPages(); } catch(e){ console.warn('redo parse error', e); }
}

/* formatting helpers */
function exec(cmd, value=null){ document.execCommand(cmd, false, value); }
function toggleBullet(){ exec('insertUnorderedList'); }
function toggleNumber(){ exec('insertOrderedList'); }
function indent(){ exec('indent'); }
function outdent(){ exec('outdent'); }
function cut(){ exec('cut'); }
function copy(){ exec('copy'); }
function paste(){ exec('paste'); }

function applyUnderlineStyle(style){
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  if(sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.style.textDecorationLine = 'underline';
  span.style.textDecorationStyle = style;
  if(style==='double'){ span.style.borderBottom='3px double currentColor'; span.style.paddingBottom='2px'; }
  if(style==='dotted'){ span.style.borderBottom='2px dotted currentColor'; }
  if(style==='dashed'){ span.style.borderBottom='2px dashed currentColor'; }
  if(style==='wavy'){ span.style.borderBottom='3px solid currentColor'; }
  try{ range.surroundContents(span); }catch(e){ exec('underline'); }
}

/* flatten/cleanup */
function flattenCurrentPage(){
  const editors = document.querySelectorAll('.page .page-content');
  const editor = editors[state.current];
  if(!editor) return;
  // gather text nodes and apply computed inline styles as spans
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, { acceptNode(node){ if(!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; } }, false);
  const fragments = [];
  while(walker.nextNode()){
    const node = walker.currentNode;
    const p = node.parentElement;
    const cs = window.getComputedStyle(p);
    const span = document.createElement('span');
    span.textContent = node.nodeValue;
    span.style.fontFamily = cs.getPropertyValue('font-family');
    span.style.fontSize = cs.getPropertyValue('font-size');
    span.style.fontWeight = cs.getPropertyValue('font-weight');
    span.style.fontStyle = cs.getPropertyValue('font-style');
    span.style.color = cs.getPropertyValue('color');
    span.style.letterSpacing = cs.getPropertyValue('letter-spacing');
    span.style.lineHeight = cs.getPropertyValue('line-height');
    span.style.textDecoration = cs.getPropertyValue('text-decoration');
    fragments.push(span.outerHTML);
  }
  editor.innerHTML = fragments.join('') || editor.textContent;
  saveAllPages();
  renderPages();
}

/* EXPORTS - use html2canvas + jsPDF */
async function exportPDF(){
  await ensureHtml2Canvas();
  saveAllPages();
  const canvases = [];
  for(let i=0;i<state.pages.length;i++){
    const tmp = document.createElement('div');
    tmp.style.width = (state.pages[i].width || 800) + 'px';
    tmp.style.padding = '28px';
    tmp.style.background = '#fff';
    tmp.style.position = 'fixed'; tmp.style.left = '-9999px';
    tmp.innerHTML = state.pages[i].html;
    document.body.appendChild(tmp);
    try{
      const canvas = await html2canvas(tmp, { scale: 2, useCORS: true });
      canvases.push(canvas);
    }catch(e){ console.warn('pdf canvas failed', e); }
    try{ document.body.removeChild(tmp); }catch(e){}
  }
  const { jsPDF } = window.jspdf;
  // use paper selection
  const paper = document.getElementById('paperSizeSelect')?.value || 'A4';
  const orientation = document.getElementById('paperOrientation')?.value || 'portrait';
  const paperMap = { A4:{w:794,h:1123}, Letter:{w:816,h:1056}, Legal:{w:816,h:1344}, A3:{w:1123,h:1587}, A5:{w:420,h:595} };
  let w = paperMap[paper]?.w || 794, h = paperMap[paper]?.h || 1123;
  if(orientation === 'landscape') [w,h] = [h,w];

  const pdf = new jsPDF({ unit:'px', format:[w,h], orientation });
  for(let i=0;i<canvases.length;i++){
    const c = canvases[i];
    const imgData = c.toDataURL('image/jpeg', 1.0);
    const scale = Math.min(w / c.width, h / c.height);
    const imgW = c.width * scale; const imgH = c.height * scale;
    const x = (w - imgW)/2; const y = (h - imgH)/2;
    if(i>0) pdf.addPage([w,h]);
    pdf.addImage(imgData, 'JPEG', x, y, imgW, imgH, undefined, 'FAST');
  }
  pdf.save('karen-document.pdf');
}

async function exportPNGzip(){
  await ensureHtml2Canvas();
  saveAllPages();
  const zip = new JSZip();
  for(let i=0;i<state.pages.length;i++){
    const tmp = document.createElement('div');
    tmp.style.width = (state.pages[i].width || 800) + 'px';
    tmp.style.padding = '28px';
    tmp.style.background = '#fff';
    tmp.style.position = 'fixed'; tmp.style.left = '-9999px';
    tmp.innerHTML = state.pages[i].html;
    document.body.appendChild(tmp);
    try{
      const c = await html2canvas(tmp, { scale: 2, useCORS: true });
      const data = c.toDataURL('image/png');
      const blob = dataURLtoBlob(data);
      zip.file(`page-${i+1}.png`, blob);
    }catch(e){ console.warn('png capture failed', e); }
    try{ document.body.removeChild(tmp); }catch(e){}
  }
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'karen-pages.zip');
}

async function exportPNGcurrent(){
  await ensureHtml2Canvas();
  saveAllPages();
  const i = state.current;
  const tmp = document.createElement('div');
  tmp.style.width = (state.pages[i].width || 800) + 'px';
  tmp.style.padding = '28px';
  tmp.style.background = '#fff';
  tmp.style.position = 'fixed'; tmp.style.left = '-9999px';
  tmp.innerHTML = state.pages[i].html;
  document.body.appendChild(tmp);
  try{
    const c = await html2canvas(tmp, { scale: 2, useCORS: true });
    c.toBlob(blob => saveAs(blob, `karen-page-${i+1}.png`), 'image/png');
  }catch(e){ console.warn('png current failed', e); }
  try{ document.body.removeChild(tmp); }catch(e){}
}
async function exportJPGcurrent(){
  await ensureHtml2Canvas();
  saveAllPages();
  const i = state.current;
  const tmp = document.createElement('div');
  tmp.style.width = (state.pages[i].width || 800) + 'px';
  tmp.style.padding = '28px';
  tmp.style.background = '#fff';
  tmp.style.position = 'fixed'; tmp.style.left = '-9999px';
  tmp.innerHTML = state.pages[i].html;
  document.body.appendChild(tmp);
  try{
    const c = await html2canvas(tmp, { scale: 2, useCORS: true });
    c.toBlob(blob => saveAs(blob, `karen-page-${i+1}.jpg`), 'image/jpeg');
  }catch(e){ console.warn('jpg current failed', e); }
  try{ document.body.removeChild(tmp); }catch(e){}
}

function dataURLtoBlob(dataurl){
  const parts = dataurl.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while(n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], { type: mime });
}

function exportDOCX(){
  saveAllPages();
  let body = '';
  state.pages.forEach(p => { body += `<div style="page-break-after:always">${p.html}</div>`; });
  const html = `<!DOCTYPE html><html><head><meta charset='utf-8'></head><body>${body}</body></html>`;
  const converted = window.htmlDocx.asBlob(html, { orientation: 'portrait' });
  saveAs(converted, 'karen-document.docx');
}

/* flatten current page */
function flattenPageCurrent(){
  flattenCurrentPageInternal();
  renderPages();
}

/* internal flatten used in app */
function flattenCurrentPageInternal(){
  const editors = document.querySelectorAll('.page .page-content');
  const editor = editors[state.current];
  if(!editor) return;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, { acceptNode(node){ if(!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; } }, false);
  const fragments = [];
  while(walker.nextNode()){
    const n = walker.currentNode;
    const p = n.parentElement;
    const cs = window.getComputedStyle(p);
    const span = document.createElement('span');
    span.textContent = n.nodeValue;
    span.style.fontFamily = cs.getPropertyValue('font-family');
    span.style.fontSize = cs.getPropertyValue('font-size');
    span.style.fontWeight = cs.getPropertyValue('font-weight');
    span.style.fontStyle = cs.getPropertyValue('font-style');
    span.style.color = cs.getPropertyValue('color');
    span.style.letterSpacing = cs.getPropertyValue('letter-spacing');
    span.style.lineHeight = cs.getPropertyValue('line-height');
    span.style.textDecoration = cs.getPropertyValue('text-decoration');
    fragments.push(span.outerHTML);
  }
  editor.innerHTML = fragments.join('') || editor.textContent;
  saveAllPages();
}

/* events wiring */
function attachUI(){
  // font select, sizes
  fontSelect.addEventListener('change', ()=> applyFont(fontSelect.value));
  fontSizeSelect.addEventListener('change', ()=> applyFontSize(fontSizeSelect.value));

  // basic formatting
  document.querySelector('[data-cmd="bold"]').addEventListener('click', ()=> exec('bold'));
  document.querySelector('[data-cmd="italic"]').addEventListener('click', ()=> exec('italic'));

  document.getElementById('bulletBtn').addEventListener('click', toggleBullet);
  document.getElementById('numBtn').addEventListener('click', toggleNumber);
  document.getElementById('indentBtn').addEventListener('click', indent);
  document.getElementById('outdentBtn').addEventListener('click', outdent);

  document.getElementById('cutBtn').addEventListener('click', cut);
  document.getElementById('copyBtn').addEventListener('click', copy);
  document.getElementById('pasteBtn').addEventListener('click', paste);

  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  // page controls
  addPageBtn.addEventListener('click', ()=> addPage());
  dupPageBtn.addEventListener('click', ()=> duplicatePage(state.current));
  delPageBtn.addEventListener('click', ()=> deletePage(state.current));

  // underline
  underlineBtn.addEventListener('click', ()=> underlineStyles.classList.toggle('hidden'));
  document.querySelectorAll('#underlineStyles [data-uline]').forEach(b => b.addEventListener('click', ()=> { applyUnderlineStyle(b.dataset.uline); underlineStyles.classList.add('hidden'); }));

  // toolbar hide/show
  hideToolbarBtn.addEventListener('click', ()=> { toolbar.style.display = 'none'; showToolbarBtn.classList.remove('hidden'); });
  showToolbarBtn.addEventListener('click', ()=> { toolbar.style.display = 'flex'; showToolbarBtn.classList.add('hidden'); });

  // font settings panel
  fontSettingsBtn.addEventListener('click', ()=> fontSettingsPanel.classList.toggle('hidden'));
  document.getElementById('applyFontSettings').addEventListener('click', ()=> {
    const lh = parseFloat(document.getElementById('lineHeightInput').value) || 1.25;
    const ls = parseFloat(document.getElementById('letterSpacingInput').value) || 0;
    applyLineHeight(lh); applyLetterSpacing(ls);
    fontSettingsPanel.classList.add('hidden');
  });
  document.getElementById('closeFontSettings').addEventListener('click', ()=> fontSettingsPanel.classList.add('hidden'));

  // export modal
  exportBtn.addEventListener('click', ()=> exportModal.classList.toggle('hidden'));
  document.getElementById('closeExport')?.addEventListener('click', ()=> exportModal.classList.add('hidden'));
  exportPdfBtn?.addEventListener('click', async ()=> { await exportPDF(); exportModal.classList.add('hidden'); });
  exportPngZipBtn?.addEventListener('click', async ()=> { await exportPNGzip(); exportModal.classList.add('hidden'); });
  exportPngBtn?.addEventListener('click', async ()=> { await exportPNGcurrent(); exportModal.classList.add('hidden'); });
  exportJpgBtn?.addEventListener('click', async ()=> { await exportJPGcurrent(); exportModal.classList.add('hidden'); });
  exportDocxBtn?.addEventListener('click', ()=> { exportDOCX(); exportModal.classList.add('hidden'); });
  flattenBtn?.addEventListener('click', ()=> { flattenPageCurrent(); exportModal.classList.add('hidden'); });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if((e.ctrlKey || e.metaKey) && e.key === 'z'){ e.preventDefault(); undo(); }
    if((e.ctrlKey || e.metaKey) && e.key === 'y'){ e.preventDefault(); redo(); }
  });
}

function exec(cmd, value=null){ document.execCommand(cmd, false, value); }
function applyFont(name){ const editors = document.querySelectorAll('.page .page-content'); const el = editors[state.current]; if(el){ el.style.fontFamily = `'${name}', Inter, sans-serif`; saveAllPages(); } }
function applyFontSize(size){ const editors = document.querySelectorAll('.page .page-content'); const el = editors[state.current]; if(el){ el.style.fontSize = size + 'px'; saveAllPages(); } }
function toggleBullet(){ exec('insertUnorderedList'); }
function toggleNumber(){ exec('insertOrderedList'); }
function indent(){ exec('indent'); }
function outdent(){ exec('outdent'); }
function cut(){ exec('cut'); }
function copy(){ exec('copy'); }
function paste(){ exec('paste'); }

function applyLineHeight(val){
  const editors = document.querySelectorAll('.page .page-content');
  const el = editors[state.current]; if(el){ el.style.lineHeight = val; saveAllPages(); }
}
function applyLetterSpacing(val){
  const editors = document.querySelectorAll('.page .page-content');
  const el = editors[state.current]; if(el){ el.style.letterSpacing = val + 'px'; saveAllPages(); }
}

/* on editor input */
function onEditorInput(){ pushUndo(); saveAllPages(); }

/* undo helper push */
function pushUndo(){
  state.undoStack.push(JSON.stringify(state.pages));
  if(state.undoStack.length > 60) state.undoStack.shift();
  state.redoStack = [];
}

/* bootstrap */
async function start(){
  // default font sizes
  const sizes = [8,9,10,11,12,13,14,16,18,20,22,24,26,28,32,36,40,48,56];
  sizes.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s + 'px'; if(s===16) o.selected = true; fontSizeSelect.appendChild(o); });

  // ensure a page
  ensurePageExists();

  // attach UI handlers
  attachUI();

  // load fonts from GitHub automatically
  await loadFontsFromGithub();

  // render pages & thumbs
  renderPages();

  // initial ruler update
  updateRuler(state.pages[state.current].width || 800);
}

start().catch(e => console.error('app start error', e));

// expose some helpers to console for debugging
window._karen = { state, renderPages, addPage, deletePage, duplicatePage, flattenCurrentPageInternal };
