When a refund request arrives at `POST /refund`, the agent's job is to:

1. **Verify** the order is real and within the 30-day window
2. **Refund** the original charge in full through Stripe
3. **Notify** the customer with a clear confirmation email
4. **Log** the operation to `#ops-billing` in Slack

If any step fails, escalate cleanly and **do not** auto-retry.
