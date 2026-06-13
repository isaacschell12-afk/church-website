'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { Resend } = require('resend');
const pool = require('../db/pool');
const catchAsync = require('../middleware/catchAsync');

const router = express.Router();

// 10 contact submissions per hour per IP.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const contactSchema = z.object({
  // Reject CR/LF and other control characters so the name can never inject
  // headers when interpolated into the email Subject.
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[^\r\n\x00-\x1f\x7f]*$/, 'Name contains invalid characters'),
  email: z.string().email().max(200),
  message: z.string().min(1).max(2000),
});

// POST /contact
router.post(
  '/contact',
  contactLimiter,
  catchAsync(async (req, res) => {
    // Honeypot: if the hidden "website" field is filled, a bot submitted it.
    // Silently return a 200 redirect — no email, no error shown.
    if (req.body.website && String(req.body.website).trim() !== '') {
      return res.redirect('/contact');
    }

    const parsed = contactSchema.safeParse({
      name: req.body.name,
      email: req.body.email,
      message: req.body.message,
    });

    if (!parsed.success) {
      console.error(
        `[${new Date().toISOString()}] contact validation failed:`,
        parsed.error.flatten()
      );
      return res.redirect('/contact?error=1');
    }

    const { name, email, message } = parsed.data;

    // Persist to the DB FIRST so the message reaches the admin Messages inbox
    // regardless of email outcome.
    let stored = false;
    try {
      await pool.query(
        `INSERT INTO contact_messages (name, email, message)
         VALUES ($1, $2, $3)`,
        [name, email, message]
      );
      stored = true;
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] contact message store failed:`,
        err && err.stack ? err.stack : err
      );
    }

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      // Resend v4 does not throw on API errors — failures come back in the
      // `error` field, so it must be checked explicitly.
      const { error } = await resend.emails.send({
        from: `Church Website <${process.env.CHURCH_CONTACT_EMAIL}>`,
        to: process.env.CHURCH_CONTACT_EMAIL,
        replyTo: email,
        subject: `New contact form message from ${name}`,
        text: `Name: ${name}\n` + `Email: ${email}\n\n` + `Message:\n${message}\n`,
      });
      if (error) throw error;
      return res.redirect('/contact?success=1');
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] contact email send failed:`,
        err && err.stack ? err.stack : err
      );
      // The message is safe in the inbox even when the email fails, so only
      // show the visitor an error when neither destination received it.
      if (stored) {
        return res.redirect('/contact?success=1');
      }
      return res.redirect('/contact?error=1');
    }
  })
);

module.exports = router;
