/**
 * WYSIWYC study — Google Apps Script backend (optional remote backup).
 *
 * Tabs written (created on first use):
 *   demographics  one row per session (participant × session)
 *   summary       one row per participant × block
 *   llm_calls     the per-call token ledger, all participants
 *   <P01>, <P02>… one tab per participant: the full event log
 *
 * doPost  receives the JSON the study page sends at the end of a session
 *         (Content-Type text/plain, so the browser sends no CORS preflight).
 *         Re-sending the same session replaces its rows instead of duplicating.
 * doGet   ?action=all returns every tab as JSON for the analysis page.
 *
 * Deploy: Extensions → Apps Script in your sheet, paste this file, then
 * Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 * Paste the /exec URL in the study setup screen (or VITE_STUDY_SHEETS_URL).
 */

var FIXED_TABS = ['demographics', 'summary', 'llm_calls'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.action !== 'append') return json_({ ok: false, error: 'unknown action' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sid = p.sessionId;
    var rows = 0;
    rows += upsert_(ss, 'demographics', [p.demographics], sid);
    rows += upsert_(ss, 'summary', p.summary || [], sid);
    rows += upsert_(ss, 'llm_calls', p.calls || [], sid);
    rows += upsert_(ss, safeTab_(p.participantId), p.events || [], sid);
    return json_({ ok: true, rows: rows, sessionId: sid });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = { ok: true, demographics: [], summary: [], llm_calls: [], logs: {} };
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    var rows = readRows_(sh);
    if (FIXED_TABS.indexOf(name) >= 0) out[name] = rows;
    else if (/^P\d+$/i.test(name)) out.logs[name] = rows;
  });
  return json_(out);
}

/** Replace this session's rows in a tab (idempotent re-sends), then append. */
function upsert_(ss, tabName, objects, sessionId) {
  if (!objects.length) return 0;
  var sh = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  var header = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  // Extend the header with any new columns (schema additions stay compatible).
  Object.keys(objects[0]).forEach(function (k) { if (header.indexOf(k) < 0) header.push(k); });
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var sidCol = header.indexOf('session_id');
  if (sidCol >= 0 && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, sidCol + 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) if (vals[i][0] === sessionId) sh.deleteRow(i + 2);
  }
  var data = objects.map(function (o) {
    return header.map(function (k) {
      var v = o[k];
      return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, data.length, header.length).setValues(data);
  return data.length;
}

function readRows_(sh) {
  if (sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var header = values.shift();
  return values.map(function (r) {
    var o = {};
    header.forEach(function (k, i) { o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
    return o;
  });
}

function safeTab_(pid) {
  var s = String(pid || 'P00').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  return s || 'P00';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
