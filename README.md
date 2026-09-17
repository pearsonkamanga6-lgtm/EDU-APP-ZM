# EduSend School Results Management System — V1

This is the first multi-user foundation for the EduSend report-form project.

## What V1 already does

- User accounts and server-enforced roles.
- Administrator can create staff accounts, classes, assessments/deadlines, and assign class teachers.
- HOD can assign teachers to class/subject combinations inside the HOD's own department.
- Subject teachers can see and edit **only the subjects/classes assigned to them**.
- A subject teacher result-entry screen does **not** receive other subjects' marks or parent phone numbers.
- Result sheets have statuses: Not Started, Draft, Submitted, Locked.
- A class teacher automatically receives submitted subject results for the class and gets a combined class table.
- Head Teacher / Administrator can monitor school-wide submission progress.
- HOD can monitor department completion without being given unrelated departments' result data.
- Assessment deadlines generate Open / Due Soon / Overdue reminders.
- Server-Sent Events plus periodic refresh update class dashboards shortly after submission.
- Grade 12L has been seeded with the 20 pupils and parent contacts already collected in the earlier EduSend work.
- The existing 12L Mock marks are imported as submitted starter data so the class-teacher dashboard is immediately demonstrable.

## Starter accounts

- Administrator: `admin` / `admin123`
- Head Teacher: `head` / `head123`
- Science HOD: `hod.science` / `hod123`
- Languages HOD: `hod.languages` / `hod123`
- Social Sciences HOD: `hod.social` / `hod123`
- Commercial Studies HOD: `hod.commercial` / `hod123`
- Mr Kamanga P: `kamanga` / `teach123`
- English Teacher: `english.teacher` / `teach123`
- Science Teacher: `science.teacher` / `teach123`
- Social Studies Teacher: `social.teacher` / `teach123`
- Commercial Studies Teacher: `commercial.teacher` / `teach123`

These are initial development accounts only. Change them before a real deployment.

## Run it

No package installation is required for V1.

1. Install Node.js 18 or newer.
2. Open a terminal in this project folder.
3. Set a strong token secret before public use, for example:
   - Windows PowerShell: `$env:TOKEN_SECRET="a-long-random-secret"`
   - Linux/macOS: `export TOKEN_SECRET="a-long-random-secret"`
4. Run: `npm start`
5. Open: `http://localhost:3000`

For another computer/phone on the same network, open the server computer's LAN address, for example `http://192.168.1.10:3000`.

## Data storage in V1

V1 stores data in `data/data.json`. Passwords are salted and hashed, and all result permissions are checked on the server. The JSON store is suitable for this first working version and testing, but the next production phase should migrate the data layer to PostgreSQL (or another transactional database) before large-scale school deployment.

## Important security note

This version already enforces role permissions on the server, unlike the earlier standalone HTML report app. However, the current live-update connection passes the session token to the EventSource URL because V1 does not yet use secure HTTP-only session cookies. Before public deployment we should upgrade authentication to secure cookies/HTTPS and use a production database.

## Next planned upgrades

1. Proper staff/department editor, including administrator assigning HODs.
2. Bulk pupil/teacher import from Excel/CSV.
3. Multiple assessments per term and progress history.
4. CBC/Mock grading engines and automatic report generation inside this multi-user system.
5. AI comments generated in bulk after all required subjects are submitted.
6. Parent contact book and report delivery log.
7. Push/WhatsApp/email deadline reminders rather than only in-app reminders.
8. Audit-history screen and controlled result re-opening/corrections.
9. PostgreSQL + deployment configuration for Render/cloud hosting.
