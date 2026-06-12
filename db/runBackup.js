'use strict';

const { Resend } = require('resend');

// Snapshot every content table into the backups table, then email the JSON to
// BACKUP_EMAIL. The DB row is written FIRST so the backup exists regardless of
// the email outcome. Shared by the /admin/backup route and the automatic
// scheduler in server.js.
module.exports = async function runBackup(pool) {
  const [services, events, ministries, staff, sundaySchool, announcements, churchInfo] =
    await Promise.all([
      pool.query('SELECT * FROM services'),
      pool.query('SELECT * FROM events'),
      pool.query('SELECT * FROM ministries'),
      pool.query('SELECT * FROM staff'),
      pool.query('SELECT * FROM sunday_school_classes'),
      pool.query('SELECT * FROM announcements'),
      pool.query('SELECT * FROM church_info'),
    ]);

  const payload = {
    generated_at: new Date().toISOString(),
    services: services.rows,
    events: events.rows,
    ministries: ministries.rows,
    staff: staff.rows,
    sunday_school_classes: sundaySchool.rows,
    announcements: announcements.rows,
    church_info: churchInfo.rows,
  };

  const inserted = await pool.query(
    'INSERT INTO backups (payload, email_sent) VALUES ($1, false) RETURNING id',
    [JSON.stringify(payload)]
  );
  const backupId = inserted.rows[0].id;

  let emailSent = false;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const json = JSON.stringify(payload, null, 2);
    // Resend resolves with { data, error } instead of throwing on API
    // failures, so check the error explicitly before marking the email sent.
    const { error } = await resend.emails.send({
      from: `Church Backup <${process.env.CHURCH_CONTACT_EMAIL}>`,
      to: process.env.BACKUP_EMAIL,
      subject: `Church website backup — ${payload.generated_at}`,
      text: 'Automated database backup attached as JSON.',
      attachments: [
        {
          filename: `backup-${payload.generated_at}.json`,
          content: Buffer.from(json).toString('base64'),
        },
      ],
    });
    if (error) throw error;
    emailSent = true;
    await pool.query('UPDATE backups SET email_sent = true WHERE id = $1', [backupId]);
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] backup email failed (backup row ${backupId} retained):`,
      err && err.stack ? err.stack : err
    );
  }

  return { backupId, emailSent };
};
