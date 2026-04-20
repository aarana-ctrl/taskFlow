** TaskFlow ** 
---------------------
A student assignment tracker that syncs directly with Canvas and Gradescope, so all your due dates live in one place. 
Built as a single-page web app hosted on Vercel with Firebase for authentication and data storage.

** What it does **
---------------------
TaskFlow pulls your assignments from Canvas, Gradescope, and Course Websites via their iCal feeds and merges them into
a unified task list. You can also add your own tasks manually using natural language (e.g., "CS hw tuesday at 11pm").
Tasks are automatically sorted into Overdue, Today, Upcoming, and Later sections, and sync across all your devices.

** Features **
---------------------
Canvas & Gradescope sync — paste your iCal feed URL once; the app auto-syncs every 6 hours
Natural language input — type tasks in plain English; dates, days, and times are detected automatically
Smart task views — Today, Upcoming, All Tasks, Calendar, and Completed
Week strip — tap any day to filter tasks to that date
Calendar view — monthly overview with task indicators per day
Task details — set due dates, reminders, priority, and recurring schedules
Dark mode — toggle in Settings; persists across sessions
Mobile-first — hamburger drawer nav, bottom sheet task details, full safe-area support
Completion animations — green checkmark bounce + strikethrough on completion
Google & Apple Sign-In — no passwords, synced to your account via Firebase

** Setting up integrations **
---------------------
Canvas

Log in to Canvas and go to Account → Settings
Scroll to Other Options → click Feed URL next to Calendar
Copy the URL (it starts with webcal://)
In TaskFlow, open Integrations and paste the URL into the Canvas field
Click Sync Now

Gradescope

Log in to Gradescope and go to Account → Edit Account
Scroll to Calendar Feed and copy the URL
In TaskFlow, open Integrations and paste the URL into the Gradescope field
Click Sync Now


Note: If your school uses a single sign-on (SSO/NetID) for Gradescope, you may need to log in to Gradescope directly
at gradescope.com first to generate the calendar feed URL.

The app syncs automatically every 6 hours. Duplicate assignments (same title + same due date) across sources are
collapsed automatically. Can force sync manually anytime.

** Adding tasks manually ** 
---------------------------
Click the + Add a task… bar at the top of any view and type naturally:

"finish essay by friday" → due this Friday
"chem lab report monday at 11:59pm" → due Monday 11:59 PM
"read chapter 5 in 3 days" → due 3 days from today
"weekly review every sunday" → recurring weekly task


** Project structure **
--------------------------
taskflow-deploy/
├── public/
│   └── index.html        # Entire frontend (React + CSS in one file)
├── api/
│   ├── config.js         # Serverless function: serves Firebase config
│   └── fetch-ics.js      # Serverless function: proxies iCal feeds (CORS bypass)
└── vercel.json           # Vercel routing config

License
MIT
