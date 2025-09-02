const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 100 } });

// temporary store for assembled uploads: key -> filePath
const tempStore = new Map();

function makeTempKey(uploadId, filename){
  return `${uploadId}__${path.basename(filename)}`;
}

async function appendPartToFile(partPath, outStream){
  return new Promise((resolve, reject)=>{
    const rs = fs.createReadStream(partPath);
    rs.on('error', reject);
    rs.on('end', resolve);
    rs.pipe(outStream, { end: false });
  });
}

// POST /image-to-pdf
// Accepts multipart/form-data with field `images` (multiple files).
// Optional form fields:
// - pageSize: 'auto' (default) or 'A4'|'letter'
// - orientation: 'portrait'|'landscape'
// - margin: number (points, default 0)
// - quality: jpeg quality 1-100 (default 80)
// - outputName: filename for the returned PDF
router.post('/image-to-pdf', upload.array('images'), async (req, res) => {
  try {
    // Support two flows: direct files in req.files OR assembled temp keys in req.body.tempKeys (comma-separated)
    let filesToProcess = [];
    if (req.body && req.body.tempKeys) {
      const keys = String(req.body.tempKeys).split(',').map(k=>k.trim()).filter(Boolean);
      for(const k of keys){
        const p = tempStore.get(k);
        if(!p) return res.status(400).json({ error: `Missing assembled file for key: ${k}` });
        filesToProcess.push({ path: p, originalname: k });
      }
    } else if (req.files && req.files.length > 0) {
      filesToProcess = req.files.map(f => ({ buffer: f.buffer, originalname: f.originalname }));
    } else {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    const pageSize = (req.body.pageSize || 'auto').toString();
    const orientation = (req.body.orientation || 'portrait').toString();
    const margin = Math.max(0, parseFloat(req.body.margin || '0') || 0);
    const quality = Math.max(5, Math.min(100, parseInt(req.body.quality || '80', 10)));
    const outputName = (req.body.outputName || 'images.pdf').toString();

    const doc = new PDFDocument({ autoFirstPage: false });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
      res.setHeader('Content-Type', 'application/pdf');
      res.send(pdfBuffer);
    });

    const presets = {
      a4: [595.28, 841.89],
      letter: [612, 792]
    };

    for (const file of filesToProcess) {
      // handle both in-memory buffers and file paths
      let img;
      if (file.buffer) {
        img = sharp(file.buffer).rotate();
      } else if (file.path) {
        img = sharp(file.path).rotate();
      } else {
        continue;
      }
      const meta = await img.metadata();
      const width = meta.width || 800;
      const height = meta.height || 600;
      const jpegBuffer = await img.jpeg({ quality }).toBuffer();

      if (pageSize.toLowerCase() !== 'auto' && presets[pageSize.toLowerCase()]) {
        let pageDims = presets[pageSize.toLowerCase()].slice();
        if (orientation === 'landscape') pageDims = [pageDims[1], pageDims[0]];
        const maxW = pageDims[0] - margin * 2;
        const maxH = pageDims[1] - margin * 2;
        const scale = Math.min(maxW / width, maxH / height, 1);
        const drawW = Math.round(width * scale);
        const drawH = Math.round(height * scale);
        const x = Math.round((pageDims[0] - drawW) / 2);
        const y = Math.round((pageDims[1] - drawH) / 2);

        doc.addPage({ size: pageDims, margin: 0 });
        doc.image(jpegBuffer, x, y, { width: drawW, height: drawH });
      } else {
        // Auto: page size equals image size (plus margins)
        const ptsW = Math.max(1, Math.round(width));
        const ptsH = Math.max(1, Math.round(height));
        doc.addPage({ size: [ptsW + margin * 2, ptsH + margin * 2], margin: 0 });
        doc.image(jpegBuffer, margin, margin, { width: ptsW, height: ptsH });
      }
    }

    doc.end();
  } catch (e) {
    console.error('image-to-pdf error', e);
    res.status(500).json({ error: 'Image to PDF conversion failed' });
  }
});

// POST /upload-chunk
// fields: uploadId, filename, chunkIndex
// body: binary chunk. We store each chunk in OS tmpdir under a unique folder per uploadId
const chunkUpload = multer({ storage: multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadId = req.body.uploadId || crypto.randomBytes(8).toString('hex');
    const dir = path.join(os.tmpdir(), 'upload_chunks', uploadId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const idx = req.body.chunkIndex || Date.now();
    cb(null, `chunk_${idx}`);
  }
}) });

router.post('/upload-chunk', chunkUpload.single('chunk'), async (req, res) => {
  // returns uploadId and stored chunk path info
  try{
    const uploadId = req.body.uploadId || path.basename(path.dirname(req.file.path));
    res.json({ ok: true, uploadId, chunkIndex: req.body.chunkIndex });
  }catch(e){ console.error(e); res.status(500).json({ error: 'Chunk upload failed' }); }
});

// POST /assemble-upload
// fields: uploadId, filename
// server will concatenate chunk_* files (sorted by name) and store final file, returning a tempKey
router.post('/assemble-upload', express.json(), async (req, res) => {
  try{
    const { uploadId, filename } = req.body || {};
    if(!uploadId || !filename) return res.status(400).json({ error: 'uploadId and filename required' });
    const dir = path.join(os.tmpdir(), 'upload_chunks', uploadId);
    if(!fs.existsSync(dir)) return res.status(400).json({ error: 'No chunks found for uploadId' });
    const parts = fs.readdirSync(dir).filter(f=>f.startsWith('chunk_')).sort((a,b)=>a.localeCompare(b));
    if(parts.length === 0) return res.status(400).json({ error: 'No chunks found' });
    const outPath = path.join(os.tmpdir(), 'assembled_uploads');
    fs.mkdirSync(outPath, { recursive: true });
    const outFile = path.join(outPath, `${crypto.randomBytes(10).toString('hex')}_${path.basename(filename)}`);
    const ws = fs.createWriteStream(outFile);
    for(const p of parts){
      const partPath = path.join(dir, p);
      // append
      // eslint-disable-next-line no-await-in-loop
      await appendPartToFile(partPath, ws);
    }
    ws.end();
    // cleanup chunk dir
    for(const p of parts){ try{ fs.unlinkSync(path.join(dir,p)); }catch(e){} }
    try{ fs.rmdirSync(dir); }catch(e){}
    const key = makeTempKey(uploadId, filename);
    tempStore.set(key, outFile);
    res.json({ ok: true, tempKey: key });
  }catch(e){ console.error(e); res.status(500).json({ error: 'Assemble failed' }); }
});

// GET shows a small usage hint
router.get('/image-to-pdf', (req, res) => {
  res.json({ ok: true, message: 'POST multipart/form-data with field `images` to create a PDF. Optional fields: pageSize (auto|A4|letter), orientation, margin, quality, outputName.' });
});

// POST /pdf-to-images
// Accepts multipart/form-data with field `pdf` (single file) OR assembled tempKeys in body.tempKeys
// Returns a ZIP archive of per-page PNG images: page_1.png, page_2.png, ...
// This handler uses the `pdftoppm` command-line tool (part of Poppler). If pdftoppm is not available,
// the endpoint will return an informative error. Poppler is a common dependency for rendering PDF pages.
const archiver = require('archiver');
const { execFile } = require('child_process');

function checkPdftoppmAvailable(){
  return new Promise((resolve)=>{
    execFile('pdftoppm', ['-v'], (err, stdout, stderr)=>{
      if(err) return resolve(false);
      resolve(true);
    });
  });
}

router.post('/pdf-to-images', upload.single('pdf'), async (req, res) => {
  try{
    // determine source PDF: tempKeys or uploaded file
    let pdfPath = null;
    if(req.body && req.body.tempKeys){
      const keys = String(req.body.tempKeys).split(',').map(k=>k.trim()).filter(Boolean);
      if(keys.length === 0) return res.status(400).json({ error: 'No tempKeys provided' });
      const p = tempStore.get(keys[0]);
      if(!p) return res.status(400).json({ error: 'Missing assembled file for provided tempKey' });
      pdfPath = p;
    } else if(req.file && req.file.buffer){
      // write buffer to temp file
      const tmpDir = path.join(os.tmpdir(), 'pdf_to_images');
      fs.mkdirSync(tmpDir, { recursive: true });
      const outPath = path.join(tmpDir, `${crypto.randomBytes(10).toString('hex')}_${req.file.originalname}`);
      fs.writeFileSync(outPath, req.file.buffer);
      pdfPath = outPath;
    } else {
      return res.status(400).json({ error: 'No PDF uploaded' });
    }

    // ensure pdftoppm available
    const ok = await checkPdftoppmAvailable();
    if(!ok){
      return res.status(500).json({ error: 'Server requires `pdftoppm` (Poppler). Please install poppler-utils (pdftoppm).' });
    }

    // create working dir for output images
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf_images_'));
    // run pdftoppm to create PNGs named page-1.png, page-2.png ... using -png and -r 150
    // command: pdftoppm -png -r 150 input.pdf prefix
    const prefix = path.join(workDir, 'page');
    await new Promise((resolve, reject) => {
      execFile('pdftoppm', ['-png', '-r', '150', pdfPath, prefix], (err, stdout, stderr) => {
        if(err) return reject(err);
        resolve();
      });
    });

    // collect generated files
    const files = fs.readdirSync(workDir).filter(f => f.toLowerCase().endsWith('.png')).sort((a,b)=>a.localeCompare(b));
    if(files.length === 0){
      return res.status(500).json({ error: 'No images generated from PDF' });
    }

    // stream a ZIP back
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="images.zip"');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { console.error('zip error', err); try{ res.end(); }catch(e){} });
    archive.pipe(res);
    files.forEach((fname, idx)=>{
      const p = path.join(workDir, fname);
      const entryName = `page_${idx+1}.png`;
      archive.file(p, { name: entryName });
    });
    archive.finalize();

    // schedule cleanup of workDir after some time
    setTimeout(()=>{
      try{
        files.forEach(f=>{ try{ fs.unlinkSync(path.join(workDir,f)); }catch(e){} });
        try{ fs.rmdirSync(workDir); }catch(e){}
      }catch(e){}
    }, 1000 * 60 * 5);

  }catch(e){
    console.error('pdf-to-images error', e);
    res.status(500).json({ error: 'PDF to images conversion failed' });
  }
});

module.exports = router;
