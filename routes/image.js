const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/image/compress
// accepts form-data: file (image), quality (0-100), width, height, format (jpeg|png|webp|original)
router.post('/compress', upload.single('file'), async (req, res) => {
  try{
    if(!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const quality = Math.max(1, Math.min(100, parseInt(req.body.quality || '80', 10)));
    const maxWidth = req.body.width ? parseInt(req.body.width,10) : null;
    const maxHeight = req.body.height ? parseInt(req.body.height,10) : null;
    const format = req.body.format || 'jpeg';

    let img = sharp(req.file.buffer);
    const meta = await img.metadata();
    // resize only if requested
    if(maxWidth || maxHeight){
      img = img.resize(maxWidth || null, maxHeight || null, { fit: 'inside' });
    }

    // convert/quality
    let outBuffer;
    if(format === 'png'){
      outBuffer = await img.png({ quality }).toBuffer();
    } else if(format === 'webp'){
      outBuffer = await img.webp({ quality }).toBuffer();
    } else if(format === 'original'){
      outBuffer = await img.toBuffer();
    } else {
      outBuffer = await img.jpeg({ quality }).toBuffer();
    }

    const ext = format === 'png' ? '.png' : format === 'webp' ? '.webp' : path.extname(req.file.originalname) || '.jpg';
    const filename = path.basename(req.file.originalname, path.extname(req.file.originalname)) + '-compressed' + ext;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(outBuffer);
  }catch(e){
    console.error('Compression error', e);
    res.status(500).json({ error: 'Compression failed' });
  }
});

// Helpful GET at the same path to show usage when opened in a browser
router.get('/compress', (req, res) => {
  res.json({
    ok: true,
    message: 'POST multipart/form-data to this endpoint with field `file`. See README or pass quality,width,height,format in the form.'
  });
});

module.exports = router;
