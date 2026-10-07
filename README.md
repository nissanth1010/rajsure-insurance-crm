# RajSure Insurance CRM v2

A private Supabase-backed insurance CRM for RajSure Insurance.

## Included
- Supabase Auth with one-time first-admin setup flow
- No demo mode and no seeded/fake customers
- Customers, leads, policies, follow-ups
- Private Supabase Storage document vault
- Upload categories: PAN Card, Aadhaar Card, RC Book, Insurance Policy, Vehicle Photo, Other
- Gemini document extraction (enabled when `GEMINI_API_KEY` is present)
- Admin-only staff creation (server-side service-role key)
- Excel export for CRM data + private document links
- Responsive dark CRM UI

## Setup
1. Run `supabase/schema.sql` in the Supabase SQL Editor. If you already ran the older schema, run this updated file again so `documents.document_category` is added.
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` at minimum.
3. Add `SUPABASE_SERVICE_ROLE_KEY` when you want server-side staff creation.
4. Add `GEMINI_API_KEY` when you want AI extraction. Leave it blank to keep AI disabled.
5. In Supabase Auth, create/confirm the first admin through the app. After that, disable public sign-ups.
6. Run:

```bash
npm install
npm start
```

Open **http://localhost:3000**.

Do not open `public/index.html` with Live Server for the working CRM. Live Server does not run the Node API used for authentication, private server routes, and Gemini.

## Secrets
Never commit `.env` or expose the Supabase service-role key or Gemini key in browser code.
