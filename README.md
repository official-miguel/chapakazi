# Chapa Biz

A simple business ledger for small shops in Kenya. It replaces the notebook: sales, expenses, stock, and customer debts, in English and Swahili. It is an installable web app that works with no internet.

## What works today

Everything is saved on the device first, so it works with no internet. With an account it also backs up and syncs between phones.

- **Roles:** an owner with one or more businesses, and workers who each see one shop. PIN lock per person.
- **Ledger:** sales and expenses, a day-by-day list, and edits that keep the full history. Nothing is erased.
- **Stock:** items in any unit, stock that follows every sale, low-stock warnings. Buying prices are owner-only.
- **Debts:** credit against named customers, part-payments, credit-limit warnings, WhatsApp and SMS reminders.
- **Owner alerts:** quiet notes when a worker lowers an amount late, deletes late, or passes a credit limit.
- **Backup and sync:** owners sign in with email and password; workers link their own phone with an invite code. If two phones change the same record, the later phone time wins and both edits stay in the history.

- **Plans and payments:** owners pay by M-Pesa STK Push from inside the app. See [Plans and payments](#plans-and-payments-m-pesa-stk-push).

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm --prefix app install
```

```bash
npm --prefix app run dev
```

Then open the address it prints (usually http://localhost:5173).

## Plans and payments (M-Pesa STK Push)

Owners pay for Chapa Biz inside the app: **More → Plan & payment**.

**Price** = base for the first shop + add-on for each extra shop. The prices live in the server table `ck_sub_prices`, and the super admin changes them in **Super admin → Plans → Prices**. The app only shows them. The amount charged is always worked out again on the server.

| Period | First shop | Each extra shop |
|---|---|---|
| Daily | KES 49 | KES 29 |
| Weekly | KES 299 | KES 179 |
| Monthly | KES 1,199 | KES 699 |

Plan names follow the shop count: Starter 1, Growth 2–3, Business 4–5, Enterprise 6+.

**Rules**
- Every owner gets a 14-day free trial, starting the first time their app checks their plan.
- Paying while time is left adds the new time on top of the current end date.
- Adding shops mid-plan charges only the add-on for the days left. Fewer shops take effect when the paid time ends. There are no refunds.
- When time runs out the app locks for the owner and their workers, and only the payment screen opens. This applies only to phones signed in to an account.
- The super admin can switch **Must pay** off for any owner (**Super admin → Plans → Accounts**). That owner then uses the app free and is never charged.
- A reminder shows in the app during the last 24 hours. There is no SMS, so it costs nothing.
- Safaricom may send the same result more than once. A payment is credited only once, and an M-Pesa receipt number can be used only once.

**How a payment flows**
1. The app calls the server function `ck-pay/start`. It works out the price, saves a payment row and asks Safaricom to show the PIN prompt.
2. Safaricom calls `ck-pay/callback/<secret>` with the result. The payment is marked paid, cancelled, timed out or failed, and the plan is extended.
3. Meanwhile the app checks `ck-pay/status` every 3 seconds. If Safaricom's answer is late, the server asks Safaricom directly (STK Query).

### Set up with the Daraja sandbox

1. Create a free account at [developer.safaricom.co.ke](https://developer.safaricom.co.ke). Create an app with **M-Pesa Express (Lipa Na M-Pesa Online)** and copy its **Consumer Key** and **Consumer Secret**.
2. On the portal's M-Pesa Express simulator, note the test short code **174379** and its **passkey**.
3. Apply the database changes in `supabase/migrations` in order. Plans need `0011_ck_subscriptions.sql` and `0012_ck_stk_settings.sql`.
4. Deploy the server function with login checks off, because Safaricom cannot sign in. The function checks logins itself.
   ```bash
   supabase functions deploy ck-pay --no-verify-jwt
   ```
5. In the app, signed in as super admin, open **Super admin → Settings**:
   - **Daraja keys:** choose *Sandbox* and paste the Consumer Key and Secret.
   - **Where plan payments go:** choose *Paybill*, enter `174379` and paste the passkey.

   None of these go in `app/.env`: that file ends up inside the app on every phone. They are saved encrypted in Supabase Vault, and only the server can read them.
6. To pay a test plan, use the sandbox test phone shown on the Daraja portal (or your own Safaricom number, if the portal allows it for your app).
7. Optional: run `supabase/tests/ck_subscriptions_test.sql` in the Supabase SQL editor. It checks prices, the trial, duplicate callbacks and free accounts, then undoes everything.

**Going live:** get your own Paybill or Till approved by Safaricom for M-Pesa Express. Then save the production keys, short code and passkey in the same two boxes, choosing *Production*. No code changes are needed.

**Trying the screens without a server** (development only): open the app with `?planDemo=1` for a pretend payment server, or `/platform?adminDemo=1` for Super admin with made-up rows. Use `=0` to switch either off. In plan practice mode, a phone number ending in 0 cancels, ending in 1 never answers, and anything else pays after about 6 seconds.

**Tests:** `npm --prefix app test` runs the price formula and the Safaricom message checks.

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
| `supabase/functions/ck-pay` | Plan payments: STK Push, status checks, Safaricom callback |
| `app/src/subscription` | Plan prices, talking to ck-pay, practice mode |
| `supabase/tests` | Database checks you can run in the SQL editor |
| `app/src/i18n.tsx` | Every word shown in the app, in English and Swahili |
| `app/src/theme.css` | Colours and sizes |
