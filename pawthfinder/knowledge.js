// Pawthfinder's offline knowledge. In the demo this is hand-written; in production an LLM
// produces the same shapes (term → plain words, sentence → simplest version, page → summary)
// for any portal, at the reading level the user picks.
window.PF_KNOWLEDGE = {
  // [term as written on the page, plain words, case-insensitive?]
  glossary: [
    ['I acknowledge receipt of the ABN', 'I got the notice that insurance may not pay'],
    ['TELEHEALTH (SYNC A/V)', 'Video visit'],
    ['ANNUAL WELLNESS (AWV)', 'Yearly check-up'],
    ['Initiate Encounter Request', 'Ask for a new appointment'],
    ['New Encounter Request', 'New appointment request'],
    ['Encounter Request Submitted', 'Appointment request sent'],
    ['Upcoming Encounters', 'Your upcoming appointments'],
    ['Upcoming encounters', 'Upcoming appointments'],
    ['Encounter Management', 'Appointments'],
    ['Select Available Slot', 'Pick a time'],
    ['-- Rendering Provider --', '-- Pick your doctor --'],
    ['-- Select Svc Line --', '-- Pick the type of care --'],
    ['Rendering Provider', 'Doctor'],
    ['Requested DOS/Time', 'Time you asked for'],
    ['Fin. Responsibility', 'Bills'],
    ['Encounter Mgmt', 'Appointments'],
    ['F/U - EST PT', 'Follow-up (you have been here before)'],
    ['NP CONSULT', 'First visit with this doctor'],
    ['Correspondence', 'Messages'],
    ['Pending Dx results', 'New test results'],
    ['Rx renewals due', 'Refills due'],
    ['Req Renewal', 'Ask for a refill'],
    ['Dx Results', 'Test results'],
    ['Rx Mgmt', 'Medicines'],
    ['Svc Line', 'Type of care'],
    ['Log off', 'Sign out'],
    ['prior authorization', 'pre-approval from your insurance', true],
    ['financial responsibility', 'having to pay', true],
    ['payer adjudication', 'what your insurance decides', true],
    ['adjudication', 'decision', true],
    ['adjudicated', 'decided', true],
    ['non-emergent', 'non-emergency', true],
    ['non-covered', 'not paid by insurance', true],
    ['coinsurance', 'your share of the cost', true],
    ['deductible', 'the amount you pay before insurance starts paying', true],
    ['claim denial', 'insurance saying no', true],
    ['allowable amount', 'approved price', true],
    ['hyperlipidemia', 'high cholesterol', true],
    ['statin therapy', 'cholesterol medicine (statin)', true],
    ['payer', 'insurance company', true],
    ['encounters', 'appointments', true],
    ['encounter', 'appointment', true],
    ['LDL-C (CALC)', 'LDL ("bad") cholesterol'],
    ['HDL-C', 'HDL ("good") cholesterol'],
    ['FLP', 'cholesterol test'],
    ['TLC', 'healthy eating and exercise'],
    ['EOB', 'insurance summary'],
    ['ABN', 'notice that insurance may not pay'],
    ['DOS', 'visit date'],
    ['Dept', 'Department'],
    ['PRN', 'if needed'],
    ['QHS', 'at bedtime'],
    ['QD', 'once a day'],
    ['PO', 'by mouth'],
    ['TAB', 'tablet'],
    ['NPO', 'no food or drink'],
    ['Pt', 'Patient'],
    ['F/U', 'follow up'],
    ['w/', 'with'],
    ['SCHED', 'Booked'],
    ['PENDING ADJ', 'Waiting for approval'],
    ['Sig', 'How to take it']
  ],

  // Level "Simplest": whole sentences rewritten. [distinctive text on the page, simplest version]
  sentences: [
    ['Authorized users only', 'Only you should sign in to your account.'],
    ['all non-emergent encounters require prior authorization', 'Before most visits, your insurance may need to say yes first. If it does not, you might have to pay.'],
    ['Your EOB for DOS', 'Your insurance sent a summary of your Aug 14 visit. It is not a bill.'],
    ['To modify or cancel an existing encounter', 'To change or cancel a visit, you must phone 1-800-555-0142 (Mon–Fri, 8 am – 4:30 pm Central). The website cannot do it.'],
    ['Complete all required', 'Fill in every box that has a star (*). Ask at least 2 workdays before the visit.'],
    ['I acknowledge receipt of the ABN', 'I understand that if my insurance does not pay, I may have to pay.'],
    ['Slots displayed in facility', 'Times are in the clinic’s time zone. The clinic still has to approve the time you pick.'],
    ['Encounter request submitted.', 'Your appointment request was sent. The clinic still has to approve it.'],
    ['Pt to present 15 min prior', 'Arrive 15 minutes early to check in and pay your copay. You can eat and drink as normal unless they tell you otherwise.'],
    ['Your session has been terminated', 'The website signed you out and erased what you typed. This is not your fault.'],
    ['Pt w/ hyperlipidemia', 'Your cholesterol is high. Keep taking your cholesterol medicine, eat well and move more, and repeat this test in 3 months. See your heart doctor if you need to.'],
    ['Renewal request transmitted', 'Refill request sent to your doctor. It can take about 3 workdays.'],
    ['Unable to render document', 'This file will not open here.'],
    ['ERR: Required field(s) missing.', 'Some boxes with a star (*) are still empty.'],
    ['ERR: Slot selection and verification required.', 'Pick a time and tick “I am not a robot” first.'],
    ['ERR-401', 'Type both your username and password.']
  ],

  // Visible labels Pawthfinder adds to unlabeled fields (keyed by the field's placeholder/first option).
  fieldLabels: {
    'ID': 'Username',
    'PW': 'Password',
    '-- Select Svc Line --': 'Type of care',
    '-- Rendering Provider --': 'Doctor',
    'CC / RFV': 'Reason for visit',
    'MBR ID': 'Insurance member ID',
    'Contact #': 'Phone number'
  },

  summaries: {
    login: 'This is the sign-in page. Type your username and password, then press Sign In.',
    home: 'This is your home page. The menu at the top goes to appointments, medicines, test results, messages and bills. Two notices are about insurance. Neither one asks you to do anything right now.',
    encounters: 'This page lists your appointments. You have one on December 3 with Dr. Adeyemi. To change a visit you have to phone. To ask for a new one, press “Initiate Encounter Request”.',
    request: 'This is a form to ask for an appointment. You pick the type of care, the doctor and the kind of visit, then say why you want to come. It also asks for your insurance ID and phone number, and for you to agree to pay anything insurance does not cover.',
    slots: 'Pick a day and time, tick “I am not a robot”, then press Submit Request.',
    confirmed: 'Your request was sent. The clinic still has to approve it. Arrive 15 minutes early on the day.',
    rx: 'This is your medicine list: atorvastatin (for cholesterol, no refills left) and lisinopril (for blood pressure, 2 refills left). You can ask for a refill here.',
    results: 'This page has your test results. Your cholesterol test from October 28 has three numbers marked H, which means higher than the healthy range. Your doctor suggests keeping your medicine and re-testing in 3 months.',
    other: 'This part of the portal is broken right now. Use the menu at the top to go somewhere else.'
  },

  // Hazards on pages further along a path, so the dog can warn before the user gets there.
  // A real deployment would learn these from previous visits (on-device) or a shared map.
  ahead: {
    encounters: ['Changing an existing visit needs a phone call.', 'A scanned PDF that screen readers cannot read.'],
    request: ['Boxes with no labels.', 'A fine-print agreement about paying.'],
    slots: ['A mouse-only “I am not a robot” check.', 'Very small time buttons.']
  },

  accommodations: [
    ['asl', 'An ASL interpreter'],
    ['captions', 'Live captions for video visits'],
    ['quiet', 'A quiet place to wait'],
    ['longer', 'A longer appointment (extra time)'],
    ['table', 'An exam table that lowers'],
    ['lift', 'Help with transfers (a lift or trained staff)'],
    ['wheel', 'A wheelchair-accessible exam room and restroom'],
    ['plain', 'Written instructions in plain language'],
    ['large', 'Large-print or digital copies of forms'],
    ['support', 'My support person in the room with me'],
    ['animal', 'My service animal with me'],
    ['sensory', 'Dimmer lights and less noise']
  ]
};
