// pdf.js — legge il testo di un PDF direttamente nel dispositivo, senza internet.
// La libreria (Mozilla pdf.js, Apache-2.0) è inclusa in vendor/pdfjs e si carica solo quando serve.

let loading = null;

function loadLibrary() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/pdfjs/pdf.min.js', import.meta.url).href;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { loading = null; reject(new Error('lib')); };
      document.head.append(s);
    });
  }
  return loading;
}

/** Restituisce le righe di testo di tutte le pagine, nell'ordine di lettura. */
export async function pdfLines(file) {
  const lib = await loadLibrary();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const rows = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5];
      const x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' '));
    lines.push('');
  }
  return lines;
}
