const https = require('https');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL       = process.env.FROM_EMAIL || 'k.marlatt@brushschools.org';
const FROM_NAME        = process.env.FROM_NAME  || 'Beet House Cup — Beaver Valley Elementary';

/**
 * sendEmail({ to, toName, subject, html })
 * Returns { ok: true } or throws with a message.
 */
function sendEmail({ to, toName, subject, html }) {
  return new Promise((resolve, reject) => {
    if (!SENDGRID_API_KEY) {
      return reject(new Error('SENDGRID_API_KEY not configured in environment'));
    }
    if (!to) {
      return reject(new Error('No recipient email address'));
    }

    const body = JSON.stringify({
      personalizations: [{ to: [{ email: to, name: toName || '' }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [{ type: 'text/html', value: html }],
    });

    const options = {
      hostname: 'api.sendgrid.com',
      path:     '/v3/mail/send',
      method:   'POST',
      headers:  {
        'Authorization': 'Bearer ' + SENDGRID_API_KEY,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ ok: true });
      } else {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => reject(new Error(`SendGrid ${res.statusCode}: ${data}`)));
      }
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function epictivityEmailHtml({ studentName, parentName, score, infractions, teacherName, date }) {
  const infrRows = (infractions || []).map(i =>
    `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f0e8d8;font-size:14px;color:#5D3A1A">${i.reason || 'Infraction'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f0e8d8;font-size:14px;color:#c62828;font-weight:700;text-align:right">-${Math.abs(i.delta)}%</td>
    </tr>`
  ).join('');

  const scoreColor = score >= 60 ? '#e65100' : '#c62828';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Nunito,Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <div style="background:#5D3A1A;padding:24px 28px;text-align:center">
      <div style="font-size:28px;margin-bottom:4px">🥬</div>
      <div style="color:#fff;font-size:20px;font-weight:900;letter-spacing:0.5px">Beet House Cup</div>
      <div style="color:#e8c97a;font-size:13px;font-weight:700;margin-top:2px">Beaver Valley Elementary</div>
    </div>
    <div style="padding:28px">
      <p style="font-size:15px;color:#5D3A1A;font-weight:700;margin:0 0 18px">
        Dear ${parentName || 'Parent/Guardian'},
      </p>
      <p style="font-size:14px;color:#5D3A1A;line-height:1.6;margin:0 0 20px">
        This is a friendly notice that <strong>${studentName}</strong>'s EPICtivity score has dropped below 80% today (${date}).
        EPICtivity tracks daily behavioral expectations in the classroom.
      </p>

      <div style="background:#fff3f3;border:2px solid #e57373;border-radius:12px;padding:16px 20px;text-align:center;margin-bottom:20px">
        <div style="font-size:13px;font-weight:800;color:#c62828;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Today's EPICtivity Score</div>
        <div style="font-size:48px;font-weight:900;color:${scoreColor};line-height:1">${score}%</div>
      </div>

      ${infrRows ? `
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:800;color:#5D3A1A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Today's Infractions</div>
        <table style="width:100%;border-collapse:collapse;background:#fdf6ec;border-radius:10px;overflow:hidden">
          ${infrRows}
        </table>
      </div>` : ''}

      <p style="font-size:13px;color:#888;line-height:1.6;margin:0 0 8px">
        Scores reset each day. Please take a moment to discuss today's behavior with ${studentName}.
        If you have questions, please reach out to their teacher directly.
      </p>
      ${teacherName ? `<p style="font-size:13px;color:#888;margin:0">— ${teacherName}</p>` : ''}
    </div>
    <div style="background:#f5f0e8;padding:14px 28px;text-align:center;font-size:11px;color:#aaa">
      Beet House Cup · Beaver Valley Elementary · Brush School District, CO
    </div>
  </div>
</body>
</html>`;
}

module.exports = { sendEmail, epictivityEmailHtml };
