Refund the **full** original charge against the payment intent from
step 1. Use `reason: customer_request`.

Capture the returned `refund.id` — it goes into the customer email and
the Slack post.

If Stripe returns an error (insufficient balance, dispute already filed,
etc.), **stop here and jump to "On failure"**. Do not retry, do not
proceed to email the customer.
