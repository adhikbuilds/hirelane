/**
 * Writes the SYNTHETIC inbound-mail corpus (60 .eml files and labels.json) into ./inbound.
 *   pnpm exec vite-node workers/runner/test/fixtures/generate-inbound-corpus.ts
 * Every address ends in .example.test and every person and company is invented. The wording is varied on purpose: several
 * phrasings per class, hard negatives (a rejection that quotes an earlier interview invite, "unfortunately" in a signature
 * or an out-of-office, auto-acknowledgements that mention interviews conditionally), and every transfer encoding the parser
 * supports (7bit, quoted-printable, base64, multipart/alternative, html-only, RFC 2047 subjects, folded headers, CRLF and LF).
 * The labels were fixed here, before the classifier was written.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, 'inbound');
mkdirSync(OUT, { recursive: true });

type Kind = 'interview' | 'test' | 'rejection' | 'other';
interface Spec {
  kind: Kind;
  tag: string;
  subject: string;
  body: string;
  sig?: string;
  quoted?: string;
}
const COMPANIES = ['Northwind Labs', 'Brightpath Systems', 'Kestrel Analytics', 'Lumen Robotics', 'Orchid Payments', 'Tamarind Cloud', 'Quartz Health', 'Banyan Logistics', 'Helio Games', 'Saffron Retail'];
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const NAMES = ['Asha', 'Rohan', 'Meera', 'Imran', 'Divya', 'Karthik', 'Neha', 'Vikram'];
const ROLES = ['Graduate Engineer Trainee', 'Software Developer', 'Data Analyst', 'QA Engineer', 'Associate Consultant', 'Backend Developer'];
const DATES = ['Tuesday 4 November', 'Thursday 6 November', 'Monday 10 November', 'Friday 14 November'];
const SIGS = [
  '-- \nPriya Nair\nTalent Acquisition | {co}\n"Unfortunately, we cannot guarantee replies to every email, so please be kind to the planet and think before you print."',
  '-- \nSam Thomas, Recruiting Coordinator\nP.S. Unfortunately our office is closed on public holidays.',
  '-- \nLata Iyer\nPeople Operations, {co}',
];

const specs: Spec[] = [];
const add = (kind: Kind, subject: string, body: string, extra: Partial<Spec> = {}) => specs.push({ kind, tag: `${kind}-${specs.filter((s) => s.kind === kind).length + 1}`, subject, body, ...extra });

// ---- interview (15)
add('interview', 'Let us chat: {role} at {co}', "Hi {name},\n\nThanks for applying for {role}. We'd love to talk with you about the role. Are you free for a 30 minute video call on {date}? Pick any slot that suits you: https://cal.example.test/{cs}/intro\n\nWarm regards,\nPriya", { sig: SIGS[0]! });
add('interview', 'Interview invitation - {role}', 'Dear {name},\n\nYour profile has been shortlisted for the {role} position. We would like to invite you for a technical interview on {date} at 11:00 AM IST over Google Meet. Please confirm your availability by replying to this email.\n\nRegards,\nHR Team');
add('interview', 'Next round: panel discussion', 'Hello {name},\n\nCongratulations! You have cleared the screening and been selected for the next round of our hiring process. The panel discussion is scheduled for {date}. Details of the meeting link follow shortly.\n\nBest,\n{co} Talent Team');
add('interview', 'Quick phone screen?', "Hi {name},\n\nI'm a recruiter at {co}. I came across your application and would like to set up a short phone screen about the {role} opening. What times work for you this week?\n\nThanks,\nSam", { sig: SIGS[1]! });
add('interview', 'Moving you to the interview stage', "Hi {name},\n\nWe reviewed your application and would like to take you forward to the interview stage. Our hiring manager is available on {date}. Reply with a time that works and we'll send a calendar invite.\n\nThanks!");
add('interview', 'Your interview is scheduled - {role}', 'Dear {name},\n\nThis is to inform you that your interview for {role} is scheduled on {date}. Mode: Zoom (link below). Please join ten minutes early and keep a government photo ID handy.\n\nAll the best,\nCampus Hiring');
add('interview', 'Can we schedule a conversation?', "Hi {name} -\n\nCould we schedule a conversation with two members of the team? We'd like to hear about the projects on your resume, especially the one on {cs} data pipelines.\n\nCheers,\nLata", { sig: SIGS[2]! });
add('interview', 'HR round on {date}', 'Dear Candidate,\n\nYou have cleared the written screening. The HR round with {co} will be held on {date} at our Pune office. Kindly carry a printed copy of your resume and your college ID.\n\nRegards,\nHR');
add('interview', 'Invitation: meet our engineering team', 'Hello {name},\n\nWe enjoyed your application and would like you to meet our engineering team for a 45 minute discussion. Please share two or three slots next week that suit you.\n\nBest wishes,\nPriya', { sig: SIGS[0]! });
add('interview', 'Reminder - your interview tomorrow', 'Hi {name}, a quick reminder that your video interview for {role} is tomorrow at 3 PM IST. The joining link is unchanged. Good luck!');
add('interview', 'Technical round - {co}', "Hi {name},\n\nWe've shortlisted you for the technical round. It is a 60 minute live problem solving conversation with one of our developers. Choose a time on {date} or the day after, and let us know.\n\nThanks,\nKaran");
add('interview', 'Re: your application - availability', 'Hello {name}, thanks for your patience. We would like to speak with you about the {role} role. Could you share your availability for a call on {date} or Wednesday?');
add('interview', 'Final round with the founders', 'Dear {name},\n\nWell done on the previous rounds. The final round is a conversation with our founders, planned for {date}. Please confirm that the time works for you.\n\nKind regards,\n{co}');
add('interview', "We'd like to meet you", "Hi {name},\n\nYour background looks like a strong match. We'd like to meet you in person at our office for a discussion about {role}. Let us know which day suits you.\n\nSincerely,\nMeera", { sig: SIGS[1]! });
add('interview', 'Slot confirmation for {role}', 'Hello {name},\n\nPlease select your preferred interview slot from the options below and we will confirm it within a day.\n\n1. {date}, 10:00\n2. {date}, 15:30\n\nThanks,\nScheduling Desk');

// ---- test (12)
add('test', 'Next step: online assessment', 'Hi {name},\n\nAs the next step in your application for {role}, please complete our online assessment on HackerRank. The link is valid for 72 hours: https://assess.example.test/{cs}/t/9f2a\n\nGood luck!\nTeam {co}');
add('test', 'Coding challenge - {role}', 'Dear {name},\n\nYou are invited to take a 90 minute coding challenge as part of the {role} selection. Link: https://tests.example.test/{cs}/c/42. Please attempt it before {date}.\n\nRegards,\nHiring Team');
add('test', 'Take-home exercise', "Hi {name},\n\nWe'd like you to complete a short take-home assignment. You'll have five days and the expected effort is about three hours. Instructions are attached below.\n\nThanks,\nSam", { sig: SIGS[1]! });
add('test', 'Aptitude test link', 'Dear Candidate,\n\nKindly attempt the aptitude test and the technical MCQ round using the link below before {date}. Candidates who do not complete it will not be considered.\n\nhttps://aptitude.example.test/{cs}/start');
add('test', 'Your Codility test for {role}', 'Hello {name}, your Codility test for {role} is ready. You have 7 days to start it, and once started you will have 2 hours. Link: https://codility.example.test/{cs}/invite/77');
add('test', 'Pre-employment assessment', 'Hi {name},\n\nPlease complete the pre-employment assessment (logical reasoning, verbal ability and one coding problem) using the link below. After you clear this stage we will be in touch about interviews.\n\nhttps://assess.example.test/{cs}/pre', { sig: SIGS[2]! });
add('test', 'Assessment invite from {co}', "Hi {name},\n\nThank you for applying. Please take the 45 minute skills assessment linked below. It covers SQL and basic Python; you can't pause it once you start.\n\nhttps://skills.example.test/{cs}/a/310\n\nThanks,\nPriya", { sig: SIGS[0]! });
add('test', 'Complete your coding test', 'Dear {name}, your application for {role} cannot move ahead until you complete the coding test. It takes about an hour. The link expires on {date}.');
add('test', 'Case study before we proceed', 'Hello {name},\n\nBefore the next step we would like you to submit a short case study (two pages maximum) on how you would improve our onboarding flow. Please send it back within four days.\n\nRegards,\n{co} Product Team');
add('test', 'Round 1: online test', 'Hi {name},\n\nRound 1 is an online test with 30 questions on data structures and problem solving, duration 60 minutes. Please log in with the credentials below on {date}.\n\nUser: candidate-4471\nPassword: sent separately');
add('test', 'Technical screening exercise', "Hi {name},\n\nWe'd like to see how you work, so please complete the attached exercise (build a small REST endpoint) and send us a link to your repository. No time limit, but we suggest two to three hours.\n\nThanks,\nKaran");
add('test', 'HackerEarth challenge - {role}', 'Hello {name}, we have invited you to a HackerEarth coding challenge for {role}. Open the invitation email from HackerEarth and complete the challenge by {date}.');

// ---- rejection (18)
add('rejection', 'Update on your application', "Hi {name},\n\nThank you for your interest in {co}. After careful consideration we have decided to move forward with other candidates whose experience more closely matches our needs.\n\nWe wish you the very best.\nPriya", { sig: SIGS[0]! });
add('rejection', 'Your application to {co}', 'Dear {name},\n\nUnfortunately, we will not be moving forward with your application for {role} at this time. We appreciate the time you invested.\n\nRegards,\nTalent Team');
add('rejection', 'Application status', 'Dear {name},\n\nWe regret to inform you that you have not been shortlisted for the next stage of the {role} hiring process.\n\nThank you,\nHR');
add('rejection', 'Thank you for interviewing with us', "Hi {name},\n\nThank you for interviewing with us last week. We enjoyed meeting you, but we've decided to pursue other candidates for this role. We'll keep your details and may reach out about future openings.\n\nBest,\nSam", { sig: SIGS[1]! });
add('rejection', 'Regarding {role}', 'Hello {name},\n\nThe position you applied for has been filled. We will keep your resume on file for future openings at {co}.\n\nKind regards,\nRecruiting');
add('rejection', 'Your application status has changed', 'Hi {name}, your application status for {role} has been updated to: Not selected. Thank you for applying, and good luck with your search.');
add('rejection', 'Assessment results', "Hi {name},\n\nThanks for taking the time to complete our assessment. Unfortunately your score did not meet the threshold for the next round, so we won't be proceeding with your application.\n\nRegards,\n{co} Hiring");
add('rejection', 'Decision on your application', 'Dear {name},\n\nAfter reviewing your profile, we are unable to offer you a position at this time. This was a difficult decision given the number of strong applicants.\n\nSincerely,\nLata', { sig: SIGS[2]! });
add('rejection', 'Re: Interview invitation - {role}', "Hi {name},\n\nI'm sorry to say we have to withdraw the invitation below. We have decided not to proceed with your candidature as the role has been put on hold.\n\nApologies for the inconvenience,\nPriya", { quoted: 'Hi {name}, we would like to invite you for an interview on {date} at 11:00 AM. Please confirm your availability.' });
add('rejection', 'Thanks for your time', 'Dear {name},\n\nWe appreciate you speaking with our team. After discussing internally, we will not be extending an offer for {role}. We encourage you to apply again in six months.\n\nBest wishes,\n{co}');
add('rejection', 'Your candidature', 'Hello {name},\n\nWe regret that we cannot take your candidature forward. Your application is no longer under consideration for the {role} position.\n\nThank you for your interest.\nHR Team');
add('rejection', 'Update from {co} hiring', "Hi {name},\n\nWe've decided to go with another candidate for the {role} role. It was a close call and we really enjoyed your technical round.\n\nAll the best,\nKaran");
add('rejection', 'Application outcome', 'Dear Candidate,\n\nWith regret, we inform you that you have not been selected for the {role} position. This decision does not reflect on your abilities.\n\nRegards,\nCampus Hiring');
add('rejection', 'Re: your interview slot', "Hi {name},\n\nThanks for coming in for the discussion. After the panel's feedback, we will not be proceeding further. We wish you success.\n\nRegards,\nPriya", { quoted: 'Your interview for {role} is scheduled on {date}. Please join ten minutes early.', sig: SIGS[0]! });
add('rejection', 'Following up on {role}', 'Hi {name}, thanks again for applying. We received a very large number of applications and have decided to pursue other candidates whose profiles are closer to what we need right now.');
add('rejection', 'Candidate update', 'Dear {name},\n\nUnfortunately we are not able to move your application forward. Should a suitable role open up we will let you know.\n\nBest,\nMeera');
add('rejection', 'About your application', "Hello {name},\n\nI wanted to let you know personally that we won't be hiring you for {role}. Our needs changed this quarter and the headcount was cancelled.\n\nSorry to disappoint,\nSam", { sig: SIGS[1]! });
add('rejection', 'Thank you for applying to {co}', 'Hi {name}, we have reviewed your application carefully. Your qualifications are impressive but we have chosen to proceed with other applicants for this opening. We wish you well.');

// ---- other (15): acknowledgements, alerts, out-of-office, onboarding paperwork, newsletters
add('other', 'We received your application', 'Hi {name},\n\nThank you for applying to {role} at {co}. This is an automated message to confirm we have received your application. Please do not reply to this email.\n\nIf your profile matches our requirements, a recruiter will contact you.', { sig: SIGS[0]! });
add('other', 'Application received: {role}', 'Dear {name},\n\nYour application has been received and is under review. If we would like to interview you, we will contact you within three weeks. Status: In review.\n\nRegards,\n{co} Careers');
add('other', 'Thanks for applying', 'Hi {name}, thanks for applying to {co}! We got your application. Should we decide to schedule an interview or an assessment, you will hear from us. This inbox is not monitored.');
add('other', 'Automatic reply: out of office', 'Hello,\n\nI am out of office with limited access to email until Monday. Unfortunately I will not be able to respond before then. For urgent matters please contact hr-desk@{cs}.example.test.\n\nRegards,\nPriya');
add('other', 'Your weekly job alerts', 'Hi {name},\n\n5 new jobs match your profile this week: Data Analyst at Orchid Payments, QA Engineer at Banyan Logistics, and 3 more. Manage your alerts any time from settings.\n\nUnsubscribe: https://alerts.example.test/u/1');
add('other', 'Complete your candidate profile', 'Hi {name}, your profile at {co} is 60% complete. Add your project links and your expected graduation date to help our team review your application faster.');
add('other', 'Welcome to the {co} talent community', "Hello {name},\n\nWelcome! You'll now get occasional updates about life at {co}, upcoming campus events and our open roles. You can leave the community at any time.\n\nThe {co} team");
add('other', 'Campus webinar invitation', 'Hi {name},\n\nJoin our free webinar on how to build a strong fresher resume on Saturday at 5 PM. Register here: https://events.example.test/{cs}/webinar. Seats are limited!\n\nSee you there,\nPriya', { sig: SIGS[0]! });
add('other', 'Documents needed for onboarding', "Dear {name},\n\nPlease upload the following documents to the onboarding portal: educational certificates, a photo ID and bank details. Our HR operations team is available if you need help.\n\nThanks,\nLata", { sig: SIGS[2]! });
add('other', 'Rate your candidate experience', 'Hi {name}, we would value two minutes of your time. How was your experience applying to {co}? Take our short survey: https://survey.example.test/{cs}/s/12');
add('other', 'A note from our CEO', "Dear friends,\n\nIt has been a big year for {co}. We opened two new offices and launched our first mobile app. Read the full story on our blog. Unfortunately we couldn't fit every highlight into this email!\n\nWarmly,\nThe founders");
add('other', 'Your application is under review', 'Hello {name}, this is a status update: your application for {role} is still under review by our team. There is nothing you need to do right now. Thank you for your patience.');
add('other', 'Please confirm your email address', 'Hi {name}, please confirm your email address to finish creating your {co} careers account: https://careers.example.test/{cs}/confirm/abc123. If you did not sign up, ignore this message.');
add('other', 'Referral programme update', 'Hi {name},\n\nOur employee referral programme now pays out within 30 days. Share the openings page with friends and classmates: https://careers.example.test/{cs}/jobs\n\nThanks,\nPeople Team');
add('other', 'Delivery Status Notification', 'This is an automatically generated delivery notice. Your message to the careers desk could not be delivered immediately and will be retried for the next 48 hours. No action is required.');

// ----------------------------------------------------------------- encoders
const CRLF = (s: string): string => s.replace(/\r?\n/g, '\r\n');
function qp(s: string, charset: 'utf-8' | 'iso-8859-1'): string {
  const bytes = Buffer.from(s, charset === 'utf-8' ? 'utf8' : 'latin1');
  let out = '';
  let line = '';
  const push = (t: string) => {
    if (line.length + t.length > 75) {
      out += `${line}=\n`;
      line = '';
    }
    line += t;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 10) {
      out += `${line}\n`;
      line = '';
    } else if (b === 13) continue;
    else if ((b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && i + 1 < bytes.length && bytes[i + 1] !== 10)) push(String.fromCharCode(b));
    else push(`=${b.toString(16).toUpperCase().padStart(2, '0')}`);
  }
  return out + line;
}
const b64 = (s: string): string => (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\n');
const html = (s: string): string => `<html><body><p>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n\n/g, '</p>\n<p>').replace(/\n/g, '<br>\n')}</p></body></html>`;
const rfc2047b = (s: string): string => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const rfc2047q = (s: string): string => `=?ISO-8859-1?Q?${[...Buffer.from(s, 'latin1')].map((b) => (b > 32 && b < 127 && b !== 61 && b !== 63 && b !== 95 ? String.fromCharCode(b) : b === 32 ? '_' : `=${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('')}?=`;
const fold = (name: string, value: string): string => {
  const words = value.split(' ');
  let line = `${name}:`;
  const lines: string[] = [];
  for (const w of words) {
    if (line.length + w.length + 1 > 70 && line.trim() !== `${name}:`) {
      lines.push(line);
      line = ` ${w}`;
    } else line += `${line.endsWith(':') ? ' ' : ' '}${w}`;
  }
  lines.push(line);
  return lines.join('\n');
};

const labels: Record<string, { kind: Kind; encoding: string; company: string; domain: string; subject: string }> = {};
specs.forEach((sp, i) => {
  const co = COMPANIES[(i * 3) % COMPANIES.length]!;
  const cs = slug(co);
  const name = NAMES[i % NAMES.length]!;
  const role = ROLES[(i * 5) % ROLES.length]!;
  const date = DATES[i % DATES.length]!;
  const sub = (t: string) => t.replace(/\{co\}/g, co).replace(/\{cs\}/g, cs).replace(/\{name\}/g, name).replace(/\{role\}/g, role).replace(/\{date\}/g, date);
  const subject = sub(sp.subject);
  let text = sub(sp.body);
  if (sp.quoted) text += `\n\nOn Mon, 27 Oct 2026 at 10:15, ${co} Recruiting <jobs@${cs}.example.test> wrote:\n${sub(sp.quoted).split('\n').map((l) => `> ${l}`).join('\n')}`;
  if (sp.sig) text += `\n\n${sub(sp.sig)}`;
  if (i % 4 === 1) text = text.replace(/Regards|Thanks|Best/, (m) => `${m} ₹`.replace(' ₹', ''));
  // A few bodies carry non-ASCII text so the 8-bit and quoted-printable paths are really exercised.
  if (i % 6 === 2) text = `${text}\n\nPS: ${name} — salary details (₹ figures) are shared with shortlisted candidates only.`;
  const enc = [0, 2, 4, 3, 9, 6, 1, 7, 5, 8][(i * 7) % 10]!;
  const from = `${co} Recruiting <jobs@${cs}.example.test>`;
  const handle = 'asha.k3x';
  const to = enc % 3 === 0 ? `Asha Kulkarni <${handle}+zz11yy22xx33@apply.hirelane.localhost>` : `${handle}+zz11yy22xx33@apply.hirelane.localhost`;
  const date822 = new Date(Date.UTC(2026, 9, 27 + (i % 3), 4 + (i % 9), (i * 7) % 60)).toUTCString();
  const common = [`From: ${from}`, `Authentication-Results: mx.hirelane.localhost; spf=pass; dkim=pass header.d=${cs}.example.test; dmarc=pass header.from=${cs}.example.test`, `To: ${to}`, `Date: ${date822}`, `Message-ID: <corpus-${String(i + 1).padStart(2, '0')}@${cs}.example.test>`, 'MIME-Version: 1.0'];
  let headers: string[] = [];
  let body = '';
  let encoding = '';
  const subj = (v: string) => (/[^\x20-\x7e]/.test(v) ? rfc2047b(v) : v);
  switch (enc) {
    case 0:
      encoding = '7bit-lf';
      headers = [...common, `Subject: ${subject}`, 'Content-Type: text/plain; charset=us-ascii', 'Content-Transfer-Encoding: 7bit'];
      body = text.replace(/[^\x00-\x7f]/g, '-');
      break;
    case 1:
      encoding = '7bit-crlf';
      headers = [...common, `Subject: ${subject}`, 'Content-Type: text/plain; charset=us-ascii'];
      body = text.replace(/[^\x00-\x7f]/g, '-');
      break;
    case 2:
      encoding = 'quoted-printable-utf8';
      headers = [...common, `Subject: ${subj(subject)}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'];
      body = qp(text, 'utf-8');
      break;
    case 3:
      encoding = 'base64-utf8';
      headers = [...common, `Subject: ${subj(subject)}`, 'Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: base64'];
      body = b64(text);
      break;
    case 4: {
      encoding = 'multipart-alternative';
      const bd = `alt_${i}_boundary`;
      headers = [...common, `Subject: ${subject}`, `Content-Type: multipart/alternative; boundary="${bd}"`];
      body = [`--${bd}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', qp(text, 'utf-8'), `--${bd}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html(text)), `--${bd}--`, ''].join('\n');
      break;
    }
    case 5:
      encoding = 'rfc2047-b-subject';
      headers = [...common, `Subject: ${rfc2047b(subject)}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'];
      body = text;
      break;
    case 6:
      encoding = 'html-only-qp';
      headers = [...common, `Subject: ${subject}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'];
      body = qp(html(text), 'utf-8');
      break;
    case 7:
      encoding = 'rfc2047-q-latin1';
      headers = [...common, `Subject: ${rfc2047q(subject.replace(/[^\x00-\xff]/g, '-'))}`, 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable'];
      body = qp(text.replace(/[^\x00-\xff]/g, '-'), 'iso-8859-1');
      break;
    case 8: {
      encoding = 'folded-subject-mixed';
      const bd = `mixed_${i}_boundary`;
      const long = `${subject} [ref ${cs.toUpperCase()}-2026-${1000 + i}] (candidate communication from the recruitment desk)`;
      headers = [...common.slice(0, 3), fold('Subject', long), ...common.slice(3), `Content-Type: multipart/mixed; boundary="${bd}"`];
      body = [`--${bd}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text, `--${bd}`, 'Content-Type: text/plain; name="notes.txt"', 'Content-Disposition: attachment; filename="notes.txt"', 'Content-Transfer-Encoding: base64', '', b64('Attachment text: interview offer rejected test unfortunately'), `--${bd}--`, ''].join('\n');
      break;
    }
    default:
      encoding = 'plain-with-8bit';
      headers = [...common, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'];
      body = text;
  }
  const raw = [...headers, '', body].join('\n');
  const file = `${String(i + 1).padStart(2, '0')}-${sp.tag}.eml`;
  writeFileSync(join(OUT, file), enc === 1 ? CRLF(raw) : raw, 'utf8');
  labels[file] = { kind: sp.kind, encoding, company: co, domain: `${cs}.example.test`, subject };
});
writeFileSync(join(OUT, 'labels.json'), `${JSON.stringify(labels, null, 2)}\n`);
console.log(`wrote ${specs.length} emails`, Object.entries(specs.reduce<Record<string, number>>((a, s) => ((a[s.kind] = (a[s.kind] ?? 0) + 1), a), {})));
