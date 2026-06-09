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

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: `Church Website <${process.env.CHURCH_CONTACT_EMAIL}>`,
        to: process.env.CHURCH_CONTACT_EMAIL,
        replyTo: email,
        subject: `New contact form message from ${name}`,
        text:
          `Name: ${name}\n` +
          `Email: ${email}\n\n` +
          `Message:\n${message}\n`,
      });
      return res.redirect('/contact?success=1');
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] contact email send failed:`,
        err && err.stack ? err.stack : err
      );
      return res.redirect('/contact?error=1');
    }
  })
);

module.exports = router;
