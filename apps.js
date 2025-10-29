/* app.js - Karen Writer main script
   Requirements: jsPDF (umd), JSZip, FileSaver (already referenced in HTML).
   This script will dynamically load html2canvas if not present.
*/

/* ---------- CONFIG ---------- */
const GITHUB_CONFIG = { owner: 'karenliteracy', repo: 'Knyawfonts', path: '' }; // repo root
const LOAD_TTF = false; // per your choice: only .woff/.woff2
const AUTO_LOAD_FROM_GITHUB = true;
const FONT_EXT_RE = /\.(woff2?|woff)$/i; // only load woff/woff2
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/main${GITHUB_CONFIG.path?'/'+GITHUB_CONFIG.path:''}`;

/* ---------- STATE ---------- */
const state = {
  pages: [], // {id, html, width}
  currentIndex: 0,
  fonts: [], // {name, blobUrl, sourceUrl}
  savedFormat: null,
  undoStack: [],
  redoStack: []
};

/* ---------- DOM refs ---------- */
const fontSelect = document.getElementById('fontSelect');
const fontPreviewStrip = document.getElementById('font-preview-strip'); // exists in supplied HTML
const fontSizeSelect = document.getElementById('fontSizeSelect');
const thumbnailsEl = document.getElementById('thumbContainer');
const pagesContainer = document.getElementById('pagesContainer');
const addPageBtn = document.getElementById('addPageBtn');
const pageRuler = document.getElementById('pageRuler');
const exportModal = document.getElementById('exportModal');
const exportBtn = document.getElementById('exportBtn');
const exportConfirm = document.getElementById('export-confirm'); // not used; modal contains direct buttons
const pageSetupModal = document.getElementById('pageSetupModal');
const showToolbarBtn = document.getElementById('showToolbarBtn');
const toolbar = document.getElementById('toolbar');
const underlineMenu = document.getElementById('underlineStyles');
const fontSettingsPanel = document.getElementById('fontSettingsPanel');

/* ---------- utility helpers ---------- */
function uid(prefix='id') { return prefix + Math.random().toString(36).slice(2,9); }
function friendlyName(fn){ return fn.replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase()); }
function createEl(tag, attrs={}) { const e = document.createElement(tag); Object.entries(attrs).forEach(([k,v])=>{ if(k==='html') e.innerHTML=v; else e.setAttribute(k,v); }); return e; }

/* ---------- dynamic library loader (html2canvas) ---------- */
async function ensureHtml2Canvas(){
  if(window.html2canvas) return window.html2canvas;
  // try common CDN
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.html2canvas;
}

/* ---------- FONT LOADING from GitHub ---------- */
async function loadFontsFromGithub(){
  try{
    const pathSeg = GITHUB_CONFIG.path ? `/${GITHUB_CONFIG.path}` : '';
    const api = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents${pathSeg}`;
    const res = await fetch(api);
    if(!res.ok) throw new Error('GitHub API error: ' + res.status);
    const files = await res.json();
    const fontFiles = files.filter(f => f.name.match(FONT_EXT_RE));
    const urlObjs = fontFiles.map(f => ({ name: f.name.replace(FONT_EXT_RE,''), url: `${RAW_BASE}/${encodeURIComponent(f.name)}`, fileName: f.name }));
    await loadFonts(urlObjs);
  }catch(err){
    console.warn('Could not list fonts from GitHub:', err);
  }
}

async function loadFonts(list){
  for(const item of list){
    try{
      const resp = await fetch(item.url);
      if(!resp.ok) throw new Error('Failed fetch ' + item.url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const face = new FontFace(item.name, `url(${blobUrl})`);
      await face.load();
      document.fonts.add(face);
      state.fonts.push({ name: item.name, blobUrl, sourceUrl: item.url });
      addFontToUI(item.name, blobUrl);
    }catch(e){
      console.warn('Load font failed', item.name, e);
    }
  }
  await document.fonts.ready; // ensure fonts ready for canvas
  if(state.fonts.length){
    const first = state.fonts[0].name;
    fontSelect.value = first;
    applyFont(first);
  }
}

/* add to dropdown and preview strip */
function addFontToUI(name, blobUrl){
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = friendlyName(name);
  opt.style.fontFamily = `'${name}', Inter, sans-serif`;
  fontSelect.appendChild(opt);

  // small preview tile
  if(fontPreviewStrip){
    const tile = document.createElement('div');
    tile.className = 'font-preview';
    tile.style.fontFamily = `'${name}', Inter, sans-serif`;
    tile.textContent = `${friendlyName(name)} — ខ្មែរ`;
    tile.title = friendlyName(name);
    tile.addEventListener('click', ()=> { fontSelect.value = name; applyFont(name); });
    fontPreviewStrip.appendChild(tile);
  }
}

/* ---------- PAGE / EDITOR management ---------- */
function ensureInitialPage(){
  if(state.pages.length === 0){
    const id = uid('p');
    const html = `<div class="page-content" contenteditable="true" style="font-size:18px; font-family:Inter, sans-serif; line-height:1.25">` +
                 `<h1 style="margin-top:0">Karen Writer</h1><p>Start typing...</p></div>`;
    state.pages.push({ id, html, width: 800 });
  }
}

/* render pages container and thumbnails compact */
async function renderAll(){
  // pages container
  pagesContainer.innerHTML = '';
  state.pages.forEach((p, idx) => {
    const pageWrap = document.createElement('div');
    pageWrap.className = 'pageWrap';
    const page = document.createElement('div');
    page.className = 'page';
    page.contentEditable = false; // we make inner contenteditable area
    page.style.width = (p.width || 800) + 'px';
    page.innerHTML = p.html;
    // ensure inner editable area
    const inner = page.querySelector('.page-content');
    if(inner){
      inner.contentEditable = true;
      inner.id = `pageContent-${p.id}`;
      inner.addEventListener('input', onEditorInput);
    }
    // add a resize handle
    const handle = document.createElement('div'); handle.className = 'resize-handle'; handle.style.cursor = 'ew-resize';
    handle.style.width = '8px'; handle.style.position = 'absolute'; handle.style.right = '0'; handle.style.top='0'; handle.style.bottom='0';
    handle.addEventListener('mousedown', startResizeHandler(idx));
    pageWrap.style.position = 'relative';
    pageWrap.appendChild(page);
    pageWrap.appendChild(handle);
    pagesContainer.appendChild(pageWrap);
  });

  // compact thumbnails (only images)
  thumbnailsEl.innerHTML = '';
  for(let i=0;i<state.pages.length;i++){
    const t = document.createElement('div');
    t.className = 'thumb';
    t.draggable = true;
    t.dataset.index = i;
    // placeholder image; will generate
    const img = document.createElement('img'); img.style.width='80px'; img.style.height='110px'; img.style.objectFit='cover'; img.alt = `Page ${i+1}`;
    t.appendChild(img);
    thumbnailsEl.appendChild(t);

    // click to open: scroll into view and set current
    t.addEventListener('click', ()=>{ scrollToPage(i); setCurrent(i); });

    // drag reorder
    t.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', i); t.style.opacity='0.4'; });
    t.addEventListener('dragend', ()=> t.style.opacity = '1');
    t.addEventListener('dragover', e => { e.preventDefault(); t.style.outline = '2px dashed #888'; });
    t.addEventListener('dragleave', ()=> t.style.outline = 'none');
    t.addEventListener('drop', e => {
      e.preventDefault(); t.style.outline='none';
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const to = parseInt(t.dataset.index, 10);
      reorderPages(from, to);
    });

    // generate thumbnail image asynchronously using html2canvas
    (async () => {
      await ensureHtml2Canvas();
      const tmp = document.createElement('div');
      tmp.style.width = (state.pages[i].width || 800) + 'px';
      tmp.style.padding = '28px';
      tmp.style.background = '#fff';
      tmp.style.position = 'fixed'; tmp.style.left='-9999px'; tmp.innerHTML = state.pages[i].html;
      document.body.appendChild(tmp);
      try{
        const canv = await html2canvas(tmp, { scale: 0.18, useCORS: true });
        img.src = canv.toDataURL('image/png');
      }catch(e){
        console.warn('html2canvas thumb failed', e);
      }
      try{ document.body.removeChild(tmp); }catch(e){}
    })();
  }

  // mark active thumbnail
  setCurrent(state.currentIndex);
}

/* Utilities for pages */
function addPage(afterIndex = state.currentIndex){
  saveCurrent();
  const id = uid('p');
  const html = `<div class="page-content" contenteditable="true" style="font-size:18px; font-family:Inter, sans-serif; line-height:1.25"><h1 style="margin-top:0">New page</h1><p></p></div>`;
  state.pages.splice(afterIndex+1, 0, { id, html, width: 800 });
  state.currentIndex = afterIndex+1;
  renderAll();
}

function duplicatePage(index = state.currentIndex){
  saveCurrent();
  const copy = JSON.parse(JSON.stringify(state.pages[index]));
  copy.id = uid('p');
  state.pages.splice(index+1,0,copy);
  state.currentIndex = index+1;
  renderAll();
}

function deletePage(index = state.currentIndex){
  if(state.pages.length <= 1) return alert('Cannot delete the only page');
  state.pages.splice(index,1);
  state.currentIndex = Math.max(0, index-1);
  renderAll();
}

function reorderPages(from, to){
  if(from === to) return;
  const item = state.pages.splice(from,1)[0];
  state.pages.splice(to,0,item);
  state.currentIndex = state.pages.findIndex(p => p.id === item.id);
  renderAll();
}

function setCurrent(i){
  state.currentIndex = i;
  // highlight active thumb
  Array.from(thumbnailsEl.children).forEach((t, idx)=> t.classList.toggle('active', idx === i));
  // focus page element
  const cont = document.querySelectorAll('.page .page-content')[i];
  if(cont) cont.focus();
}

/* scroll to page (center) */
function scrollToPage(index){
  const pageWraps = pagesContainer.children;
  if(pageWraps[index]) pageWraps[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* save current page content into state */
function saveCurrent(){
  const pageContents = document.querySelectorAll('.page .page-content');
  pageContents.forEach((el, idx) => {
    state.pages[idx].html = el.parentNode.innerHTML; // pageWrap -> page -> inner content
  });
}

/* on editor input - push to undo stack */
function onEditorInput(){
  // simple snapshot undo (store HTML)
  const snapshot = JSON.stringify(state.pages);
  state.undoStack.push(snapshot);
  // clear redo
  state.redoStack = [];
}

/* undo/redo */
function undo(){
  if(state.undoStack.length === 0) return;
  const last = state.undoStack.pop();
  state.redoStack.push(JSON.stringify(state.pages));
  try{
    state.pages = JSON.parse(last);
    renderAll();
  }catch(e){ console.warn('Undo parse error', e); }
}
function redo(){
  if(state.redoStack.length === 0) return;
  const last = state.redoStack.pop();
  state.undoStack.push(JSON.stringify(state.pages));
  try{
    state.pages = JSON.parse(last);
    renderAll();
  }catch(e){ console.warn('Redo parse error', e); }
}

/* ---------- Formatting commands ---------- */
function execCommand(cmd, value=null){ document.execCommand(cmd, false, value); }

function toggleBullet(){ execCommand('insertUnorderedList'); }
function toggleNumber(){ execCommand('insertOrderedList'); }
function indent(){ execCommand('indent'); }
function outdent(){ execCommand('outdent'); }
function cutCopy(action){
  document.execCommand(action); // 'cut' or 'copy'
}

/* underline styles apply to selection */
function applyUnderlineStyle(style){
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  if(sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.style.textDecorationLine = 'underline';
  span.style.textDecorationStyle = style;
  if(style==='double') { span.style.borderBottom='3px double currentColor'; span.style.paddingBottom='2px'; }
  if(style==='dotted') { span.style.borderBottom='2px dotted currentColor'; }
  if(style==='dashed') { span.style.borderBottom='2px dashed currentColor'; }
  try { range.surroundContents(span); } catch(e) { document.execCommand('underline'); }
}

/* line spacing and letter spacing */
function applyLineSpacing(value){
  const editor = document.querySelectorAll('.page .page-content')[state.currentIndex];
  if(editor) { editor.style.lineHeight = value; saveCurrent(); renderAll(); }
}
function applyLetterSpacing(value){
  const editor = document.querySelectorAll('.page .page-content')[state.currentIndex];
  if(editor){ editor.style.letterSpacing = value + 'px'; saveCurrent(); renderAll(); }
}

/* font size population */
function initFontSizes(){
  const sizes = [8,9,10,11,12,13,14,16,18,20,22,24,26,28,32,36,40,48,56,64];
  fontSizeSelect.innerHTML = '';
  sizes.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s + 'px'; if(s===18) o.selected = true; fontSizeSelect.appendChild(o); });
}

/* apply font & size */
function applyFont(name){
  const editor = document.querySelectorAll('.page .page-content')[state.currentIndex];
  if(!editor) return;
  editor.style.fontFamily = `'${name}', Inter, sans-serif`;
  // try to load keyboard preset (optional)
  tryLoadKeyboardPreset(name);
}
function applyFontSize(size){
  const editor = document.querySelectorAll('.page .page-content')[state.currentIndex];
  if(!editor) return;
  editor.style.fontSize = size + 'px';
}

/* attempt to fetch keyboard preset JSON next to font filename */
async function tryLoadKeyboardPreset(fontName){
  try{
    const presetUrl = `${RAW_BASE}/${encodeURIComponent(fontName)}.json`;
    const r = await fetch(presetUrl);
    if(!r.ok) { kbdAreaHide(); return; }
    const json = await r.json();
    buildKeyboard(json);
  }catch(e){ kbdAreaHide(); }
}
function kbdAreaHide(){ if(kbdArea) kbdArea.style.display='none'; }

/* ---------- Resize page width (drag) ---------- */
function startResizeHandler(index){
  return function(e){
    e.preventDefault();
    const startX = e.clientX;
    const pageWrap = pagesContainer.children[index];
    const pageEl = pageWrap.querySelector('.page');
    const startWidth = pageEl.getBoundingClientRect().width;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const newW = Math.max(320, Math.round(startWidth + dx));
      pageEl.style.width = newW + 'px';
      state.pages[index].width = newW;
      updateRuler(newW);
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); saveCurrent(); renderAll(); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
}

/* simple ruler update */
function updateRuler(pxWidth){
  // draw basic tick marks proportional to pxWidth
  const ticks = 10;
  const tickWidth = Math.round(pxWidth / ticks);
  pageRuler.style.background = `repeating-linear-gradient(to right, #ccc 0, #ccc 1px, transparent 1px, transparent ${tickWidth}px)`;
}

/* ---------- Flatten/Cleanup ---------- */
/* Flatten takes the current page content and rebuilds it:
   - iterate text nodes, wrap each text node in a <span> with computed inline styles
   - join them into a clean container -> replace old content
*/
function flattenPage(index = state.currentIndex){
  const pageContents = document.querySelectorAll('.page .page-content');
  const editor = pageContents[index];
  if(!editor) return;

  function styleForNode(node){
    const el = node.parentElement || node.parentNode;
    const cs = window.getComputedStyle(el);
    // pick a subset of visual properties to preserve
    const props = ['fontFamily','fontSize','fontWeight','fontStyle','color','letterSpacing','lineHeight','textDecoration','textShadow','webkitTextStroke'];
    const style = {};
    props.forEach(p => {
      // convert camelCase to css prop when needed
      const cssProp = p.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      const v = cs.getPropertyValue(cssProp) || cs[p];
      if(v) style[p] = v;
    });
    return style;
  }

  // walk and gather text nodes
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, { acceptNode: function(node){ if(!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; } }, false);
  const fragments = [];
  while(walker.nextNode()){
    const textNode = walker.currentNode;
    const style = styleForNode(textNode);
    const span = document.createElement('span');
    // apply inline styles
    if(style.fontFamily) span.style.fontFamily = style.fontFamily;
    if(style.fontSize) span.style.fontSize = style.fontSize;
    if(style.fontWeight) span.style.fontWeight = style.fontWeight;
    if(style.fontStyle) span.style.fontStyle = style.fontStyle;
    if(style.color) span.style.color = style.color;
    if(style.letterSpacing) span.style.letterSpacing = style.letterSpacing;
    if(style.lineHeight) span.style.lineHeight = style.lineHeight;
    if(style.textDecoration) span.style.textDecoration = style.textDecoration;
    if(style.textShadow) span.style.textShadow = style.textShadow;
    if(style.webkitTextStroke) span.style.webkitTextStroke = style.webkitTextStroke;
    span.textContent = textNode.nodeValue;
    fragments.push(span.outerHTML);
  }

  // If no text nodes (maybe only elements) fallback to plain text
  const cleanedHtml = fragments.length ? fragments.join('') : editor.textContent;

  // Replace editor content with cleaned spans
  editor.innerHTML = cleanedHtml;
  saveCurrent();
  renderAll();
}

/* ---------- EXPORT ---------- */
async function exportAsPNGsingle(index = state.currentIndex){
  await ensureHtml2Canvas();
  saveCurrent();
  const tmp = document.createElement('div');
  tmp.style.width = (state.pages[index].width || 800) + 'px';
  tmp.style.padding = '28px';
  tmp.style.background = '#fff';
  tmp.innerHTML = state.pages[index].html;
  document.body.appendChild(tmp);
  const canvas = await html2canvas(tmp, { scale: 2, useCORS: true });
  canvas.toBlob(blob => saveAs(blob, `karen-page-${index+1}.png`), 'image/png');
  document.body.removeChild(tmp);
}

async function exportAsPNGZip(){
  await ensureHtml2Canvas();
  saveCurrent();
  const zip = new JSZip();
  for(let i=0;i<state.pages.length;i++){
    const tmp = document.createElement('div');
    tmp.style.width = (state.pages[i].width || 800) + 'px';
    tmp.style.padding = '28px';
    tmp.style.background = '#fff';
    tmp.innerHTML = state.pages[i].html;
    document.body.appendChild(tmp);
    const canvas = await html2canvas(tmp, { scale: 2, useCORS: true });
    const data = canvas.toDataURL('image/png');
    const blob = dataURLtoBlob(data);
    zip.file(`page-${i+1}.png`, blob);
    document.body.removeChild(tmp);
  }
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'karen-pages.zip');
}

async function exportAsPNGStitched(){
  await ensureHtml2Canvas();
  saveCurrent();
  const canvases = [];
  for(let i=0;i<state.pages.length;i++){
    const tmp = document.createElement('div');
    tmp.style.width = (state.pages[i].width || 800) + 'px';
    tmp.style.padding = '28px';
    tmp.style.background = '#fff';
    tmp.innerHTML = state.pages[i].html;
    document.body.appendChild(tmp);
    const c = await html2canvas(tmp, { scale: 2, useCORS: true });
    canvases.push(c);
    document.body.removeChild(tmp);
  }
  const width = canvases[0].width;
  const height = canvases.reduce((s,c)=>s+c.height, 0);
  const stitched = document.createElement('canvas');
  stitched.width = width; stitched.height = height;
  const ctx = stitched.getContext('2d');
  let y = 0; canvases.forEach(c => { ctx.drawImage(c,0,y); y += c.height; });
  stitched.toBlob(blob => saveAs(blob, 'karen-stitched.png'));
}

async function exportAsPDF(opts = { paper: 'A4', orientation: 'portrait', customW: null, customH: null }){
  await ensureHtml2Canvas();
  saveCurrent();
  // render each page to canvas
  const canvases = [];
  for(let i=0;i<state.pages.length;i++){
    const tmp = document.createElement('div');
    tmp.style.width = (state.pages[i].width || 800) + 'px';
    tmp.style.padding = '28px';
    tmp.style.background = '#fff';
    tmp.innerHTML = state.pages[i].html;
    document.body.appendChild(tmp);
    const c = await html2canvas(tmp, { scale: 2, useCORS: true });
    canvases.push(c);
    document.body.removeChild(tmp);
  }

  // choose PDF page size in pixels (approx at 72dpi)
  const paperMap = {
    A4: { w:794, h:1123 }, Letter: { w:816, h:1056 }, Legal: { w:816, h:1344 }, A3: { w:1123, h:1587 }, A5: { w:420, h:595 }
  };
  let w = (paperMap[opts.paper]||paperMap['A4']).w;
  let h = (paperMap[opts.paper]||paperMap['A4']).h;
  if(opts.paper === 'Custom' && opts.customW && opts.customH){ w = opts.customW; h = opts.customH; }
  if(opts.orientation === 'landscape') [w,h] = [h,w];

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'px', format: [w,h], orientation: opts.orientation });

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

function exportAsDOCX(){
  saveCurrent();
  let body = '';
  state.pages.forEach(p => { body += `<div style="page-break-after:always">${p.html}</div>`; });
  const html = `<!DOCTYPE html><html><head><meta charset='utf-8'></head><body>${body}</body></html>`;
  const converted = window.htmlDocx.asBlob(html, { orientation: 'portrait' });
  saveAs(converted, 'karen-document.docx');
}

/* helper */
function dataURLtoBlob(dataurl){
  const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]);
  let n = bstr.length; const u8 = new Uint8Array(n);
  while(n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], { type: mime });
}

/* ---------- UI hookups ---------- */
function attachUI(){
  // basic toolbar actions
  document.querySelector('[data-cmd="bold"]').addEventListener('click', ()=> execCommand('bold'));
  document.querySelector('[data-cmd="italic"]').addEventListener('click', ()=> execCommand('italic'));
  document.getElementById('bulletBtn').addEventListener('click', toggleBullet);
  document.getElementById('numBtn').addEventListener('click', toggleNumber);
  document.getElementById('indentBtn').addEventListener('click', indent);
  document.getElementById('outdentBtn').addEventListener('click', outdent);
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);
  document.getElementById('cutBtn').addEventListener('click', ()=> cutCopy('cut'));
  document.getElementById('copyBtn').addEventListener('click', ()=> cutCopy('copy'));

  // underline styles
  document.querySelectorAll('#underlineStyles [data-underline]').forEach(el => {
    el.addEventListener('click', ()=> applyUnderlineStyle(el.dataset.underline));
  });

  // font select
  fontSelect.addEventListener('change', (e)=> applyFont(e.target.value));
  fontSizeSelect.addEventListener('change', (e)=> applyFontSize(parseInt(e.target.value)));

  // add page button
  addPageBtn.addEventListener('click', ()=> addPage());

  // toolbar hide/show
  document.getElementById('hideToolbarBtn').addEventListener('click', ()=> {
    toolbar.style.display = 'none'; showToolbarBtn.style.display = 'block';
  });
  showToolbarBtn.addEventListener('click', ()=> { toolbar.style.display = 'flex'; showToolbarBtn.style.display = 'none'; });

  // page setup modal
  document.getElementById('pageSizeBtn').addEventListener('click', ()=> pageSetupModal.classList.toggle('hidden'));
  pageSetupModal.querySelector('.modal-close').addEventListener('click', ()=> pageSetupModal.classList.add('hidden'));
  document.getElementById('applyPageSettings').addEventListener('click', ()=>{
    const size = document.getElementById('paperSizeSelect').value;
    const orientation = document.getElementById('orientationSelect').value;
    if(size === 'custom'){
      const w = parseInt(document.getElementById('customWidth').value,10);
      const h = parseInt(document.getElementById('customHeight').value,10);
      state.pages[state.currentIndex].width = w || state.pages[state.currentIndex].width;
    } else {
      const map = { letter:816, a4:794, legal:816, a3:1123, a5:420 };
      state.pages[state.currentIndex].width = map[size] || 800;
    }
    pageSetupModal.classList.add('hidden');
    renderAll();
  });

  // export
  exportBtn.addEventListener('click', ()=> exportModal.classList.toggle('hidden'));
  exportModal.querySelector('#exportPNG')?.addEventListener('click', ()=> exportAsPNGsingle());
  exportModal.querySelector('#exportPNGZip')?.addEventListener('click', ()=> exportAsPNGZip());
  exportModal.querySelector('#exportPNGStitched')?.addEventListener('click', ()=> exportAsPNGStitched());
  exportModal.querySelector('#exportJPG')?.addEventListener('click', ()=> { /* re-use single PNG, convert to jpg */ exportAsPNGsingle(); });
  exportModal.querySelector('#exportPDF')?.addEventListener('click', async ()=> {
    // prompt for paper/orientation modal values
    const paper = pageSetupModal.querySelector('#paperSizeSelect')?.value || 'A4';
    const orientation = pageSetupModal.querySelector('#orientationSelect')?.value || 'portrait';
    await exportAsPDF({ paper: paper.toUpperCase(), orientation });
  });
  exportModal.querySelector('#exportDOCX')?.addEventListener('click', ()=> exportAsDOCX());
  exportModal.querySelector('#flattenBtn')?.addEventListener('click', ()=> { flattenPage(state.currentIndex); exportModal.classList.add('hidden'); });

  // paper custom dims UI toggle
  document.getElementById('paperSizeSelect')?.addEventListener('change', (e)=>{
    const customBox = document.querySelector('#pageSetupModal .customSizes');
    if(customBox) customBox.classList.toggle('hidden', e.target.value !== 'custom');
  });

  // font settings panel
  document.getElementById('effectsBtn')?.addEventListener('click', ()=> fontSettingsPanel.classList.toggle('hidden'));
  document.getElementById('closeFontSettings')?.addEventListener('click', ()=> fontSettingsPanel.classList.add('hidden'));
  document.getElementById('applyFontSettings')?.addEventListener('click', ()=> {
    const lineSpacing = parseFloat(document.getElementById('lineSpacingInput').value) || 1.2;
    const letterSpacing = parseFloat(document.getElementById('letterSpacingInput').value) || 0;
    applyLineSpacing(lineSpacing);
    applyLetterSpacing(letterSpacing);
    fontSettingsPanel.classList.add('hidden');
  });
}

/* ---------- init app ---------- */
async function start(){
  // init font sizes
  initFontSizes();

  // initial page
  ensureInitialPage();

  // attach UI actions
  attachUI();

  // load fonts
  if(AUTO_LOAD_FROM_GITHUB){
    await loadFontsFromGithub();
  }

  // place in DOM
  renderAll();

  // keyboard shortcuts for undo/redo
  document.addEventListener('keydown', (e) => {
    if((e.ctrlKey || e.metaKey) && e.key === 'z'){ e.preventDefault(); undo(); }
    if((e.ctrlKey || e.metaKey) && e.key === 'y'){ e.preventDefault(); redo(); }
  });

  // small responsive behavior: adjust page container max width to viewport
  window.addEventListener('resize', () => {
    const viewport = window.innerWidth;
    if(viewport < 640) document.querySelectorAll('.page').forEach(p => p.style.width = `${Math.min(700, viewport - 40)}px`);
  });
}

/* ---------- Run ---------- */
start().catch(e => console.error('Start error', e));

/* ---------- small helpers exposed for debugging ---------- */
window._karenWriter = { state, addPage, deletePage, duplicatePage, renderAll, flattenPage, exportAsPDF };
