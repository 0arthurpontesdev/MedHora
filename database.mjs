import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';

export function openDatabase(path = 'data/medication.sqlite', legacyPath = 'data/reminders.json') {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO metadata VALUES (1,0);
    CREATE TABLE IF NOT EXISTS medications (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS doses_taken (dose_key TEXT PRIMARY KEY, taken INTEGER NOT NULL CHECK(taken IN (0,1)));
    CREATE TABLE IF NOT EXISTS email_deliveries (dose_key TEXT PRIMARY KEY, status TEXT NOT NULL, attempted_at INTEGER NOT NULL, sent_at TEXT, error_code TEXT);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const read = () => ({
    revision:db.prepare('SELECT revision FROM metadata WHERE id=1').get().revision,
    meds:db.prepare('SELECT payload FROM medications ORDER BY rowid').all().map(row=>JSON.parse(row.payload)),
    taken:Object.fromEntries(db.prepare('SELECT * FROM doses_taken').all().map(row=>[row.dose_key,!!row.taken])),
  });
  function write(state, revision) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (read().revision !== revision) { const error = new Error('Agenda alterada em outra aba. Recarregue antes de continuar.'); error.status = 409; throw error; }
      db.exec('DELETE FROM medications; DELETE FROM doses_taken;');
      const insertMed = db.prepare('INSERT INTO medications VALUES (?,?)');
      const insertTaken = db.prepare('INSERT INTO doses_taken VALUES (?,?)');
      for (const med of state.meds) insertMed.run(med.id,JSON.stringify(med));
      for (const [key,value] of Object.entries(state.taken)) insertTaken.run(key,value ? 1 : 0);
      db.exec('UPDATE metadata SET revision=revision+1 WHERE id=1; COMMIT;');
      return read();
    } catch(error) {db.exec('ROLLBACK'); throw error;}
  }
  if (read().revision === 0 && legacyPath && fs.existsSync(legacyPath)) {
    const legacy = JSON.parse(fs.readFileSync(legacyPath,'utf8'));
    write({meds:legacy.meds || [],taken:legacy.taken || {}},0);
    const insert = db.prepare('INSERT OR IGNORE INTO email_deliveries VALUES (?, ?, ?, ?, NULL)');
    for (const [key,sentAt] of Object.entries(legacy.sent || {})) insert.run(key,'sent',Date.now(),String(sentAt));
  }
  return {read,write,close:()=>db.close(),
    recipient() {return db.prepare("SELECT value FROM settings WHERE key='recipient'").get()?.value || '';},
    setRecipient(value) {db.prepare("INSERT INTO settings VALUES ('recipient',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);},
    claim(key, now) {
      // A crash during SMTP is ambiguous: leave it claimed rather than send twice.
      return db.prepare(`INSERT INTO email_deliveries VALUES (?, 'sending', ?, NULL, NULL)
        ON CONFLICT(dose_key) DO UPDATE SET status='sending', attempted_at=excluded.attempted_at, error_code=NULL
        WHERE email_deliveries.status='failed' AND email_deliveries.attempted_at < ?`).run(key,now,now-60000).changes > 0;
    },
    sent(key) {db.prepare("UPDATE email_deliveries SET status='sent', sent_at=? WHERE dose_key=?").run(new Date().toISOString(),key);},
    failed(key,error) {db.prepare("UPDATE email_deliveries SET status=?, error_code=? WHERE dose_key=?").run(['EAUTH','ECONNECTION','EDNS'].includes(error.code) ? 'failed' : 'uncertain',String(error.code || 'UNKNOWN').slice(0,80),key);},
    deliveries() {return db.prepare('SELECT status, COUNT(*) AS count FROM email_deliveries GROUP BY status').all();},
  };
}
