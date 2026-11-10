# Chapa Kazi

A simple business ledger for small shops in Kenya. It replaces the notebook: sales, expenses, stock, and customer debts, in English and Swahili. It is an installable web app that works with no internet.

## What works today

Everything is saved on the device first, so it works with no internet. With an account it also backs up and syncs between phones.

- **Roles:** an owner with one or more businesses, and workers who each see one shop. PIN lock per person.
- **Ledger:** sales and expenses, a day-by-day list, and edits that keep the full history. Nothing is erased.
- **Stock:** items in any unit, stock that follows every sale, low-stock warnings. Buying prices are owner-only.
- **Debts:** credit against named customers, part-payments, credit-limit warnings, WhatsApp and SMS reminders.
- **Owner alerts:** quiet notes when a worker lowers an amount late, deletes late, or passes a credit limit.
- **Backup and sync:** owners sign in with email and password; workers link their own phone with an invite code. If two phones change the same record, the later phone time wins and both edits stay in the history.

Not built yet: hosting on a public address, password reset, M-Pesa (Daraja), voice entry, analysis and reports.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm --prefix app install
```

```bash
npm --prefix app run dev
```

Then open the address it prints (usually http://localhost:5173).

## Where things are

| Path | What it holds |
|---|---|
| `app/src/screens` | One file per screen |
| `app/src/components` | Forms, sheets and list rows shared by screens |
| `app/src/db.ts` | The on-device database and what each record contains |
| `app/src/ledger.ts`, `stock.ts`, `customers.ts` | The rules for entries, stock and debts |
| `app/src/sync.ts`, `recompute.ts`, `account.ts` | Backup, sync between phones, and logins |
| `supabase/migrations` | The server tables and access rules (all named `ck_`) |
| `supabase/functions/ck-auth` | The server function that creates logins |
| `app/src/i18n.tsx` | Every word shown in the app, in English and Swahili |
| `app/src/theme.css` | Colours and sizes |
