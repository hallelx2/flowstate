# 30-day refund window

Customers can request a refund within **30 calendar days** of the original
purchase date — not the order placement date, the *charge captured* date.

## Edge cases

- If the order was paid with **store credit**, refund as store credit, not
  to the original payment method.
- If the customer is on a **subscription**, only refund the most recent
  invoice — earlier ones are out of window by definition.
- If the request lands at exactly day 30, **honor it** (the 30 includes
  the request day).

## What to do when out of window

> Reply with a polite denial that references the purchase date and offers
> store credit at 50% of the order value as a goodwill gesture.

Don't escalate — out-of-window denials are routine.
