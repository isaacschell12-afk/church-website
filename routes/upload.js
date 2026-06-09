'use strict';

const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const FileType = require('file-type');
const cloudinary = require('cloudinary').v2;
const auth = require('../middleware/auth');

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// Memory storage, 5MB max, no fileFilter — file-type verifies real bytes after upload.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// 20 uploads per hour per authenticated user.
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user.id) : req.ip),
});

function runMulter(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'church', resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// POST /admin/upload
router.post('/admin/upload', auth, uploadLimiter, async (req, res) => {
  try {
    await runMulter(req, res);
  } catch (err) {
    // Includes the 5MB limit exceeded case.
    return res.status(400).json({ error: 'Upload failed — file too large or malformed' });
  }

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const detected = await FileType.fromBuffer(req.file.buffer);
  if (!detected || !ALLOWED_MIME.includes(detected.mime)) {
    return res
      .status(400)
      .json({ error: 'Invalid file type — only JPEG, PNG, and WebP are accepted' });
  }

  try {
    const result = await uploadToCloudinary(req.file.buffer);
    return res.json({ url: result.secure_url });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Cloudinary upload failed:`,
      err && err.stack ? err.stack : err
    );
    return res.status(500).json({ error: 'Upload failed — please try again' });
  }
});

module.exports = router;
