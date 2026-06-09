'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { Resend } = require('resend');
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
  name: z.string().min(1).max(100),
  email: z.string().email().max(200),
  message: z.string().min(1).max(2000),
  // Optional origin label (e.g. "Planning a visit") so emails from the Plan a
  // Visit form are identifiable without a second mail route. Validated + capped.
  source: z
    .string()
    .max(100)
    .optional()
    .transform((v) => (v == null || v.trim() === '' ? null : v.trim())),
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
      source: req.body.source,
    });

    if (!parsed.success) {
      console.error(
        `[${new Date().toISOString()}] contact validation failed:`,
        parsed.error.flatten()
      );
      // Send the visitor back to the form they came from.
      const back = req.body.source ? '/visit?error=1' : '/contact?error=1';
      return res.redirect(back);
    }

    const { name, email, message, source } = parsed.data;

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: `Church Website <${process.env.CHURCH_CONTACT_EMAIL}>`,
        to: process.env.CHURCH_CONTACT_EMAIL,
        replyTo: email,
        subject: source
          ? `${source} — ${name}`
          : `New contact form message from ${name}`,
        text:
          (source ? `Source: ${source}\n` : '') +
          `Name: ${name}\n` +
          `Email: ${email}\n\n` +
          `Message:\n${message}\n`,
      });
      return res.redirect(source ? '/visit?success=1' : '/contact?success=1');
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] contact email send failed:`,
        err && err.stack ? err.stack : err
      );
      return res.redirect(source ? '/visit?error=1' : '/contact?error=1');
    }
  })
);

module.exports = router;
