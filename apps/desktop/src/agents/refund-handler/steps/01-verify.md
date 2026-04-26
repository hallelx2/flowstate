Pull the **order ID** and **reason** from the webhook payload. Reject
synchronously if either is missing.

Look up the order in Stripe and check the `created` timestamp:

```js
const ageDays = (Date.now() - charge.created * 1000) / (1000 * 60 * 60 * 24);
if (ageDays > 30) return { status: "denied", reason: "outside refund window" };
```

If the order is fine, fetch the customer record and the original payment
intent. We'll need both for steps 2 and 3.
