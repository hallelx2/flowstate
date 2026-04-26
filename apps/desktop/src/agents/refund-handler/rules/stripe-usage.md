# Stripe API usage

## Always

- Use the **most recent successful charge** on the order, not the first one
- Pass `reason: customer_request` on every refund
- Include `metadata.requested_by = "flowstate-refund-handler"` so finance
  can filter for our automated refunds

## Never

- Don't issue **partial** refunds without explicit human approval
- Don't use the Stripe Dashboard webhook URLs — call the API directly
- Don't call `refunds.create` more than once per `payment_intent` — Stripe
  rejects duplicates but we want to fail loudly *before* the call

## Idempotency

Use the order ID as the **idempotency key**: `refund:order_<id>`. This
makes the agent safe to replay if a webhook fires twice.
