# When something breaks

Default reaction: **stop, escalate, do not retry**.

Refunds are stateful and Stripe rejects most retries cleanly, but the
small risk of a duplicate refund (and the larger risk of confusing the
customer with two emails) outweighs any benefit of automatic retries.

## Escalation format

Post to `#ops-billing` with the **alert** prefix:

```
⚠ alert · refund-handler failed
order: #7421
customer: alex@example.com
step: issue-refund
error: <full Stripe error here>
payload: <original webhook body>
```

@-mention `@billing-oncall`. They can decide whether to retry by hand or
escalate further.

## What NOT to do

- Don't email the customer about the failure — that's the human's call
- Don't call `refunds.create` again with a different idempotency key
- Don't mark the order as refunded in our internal CRM
