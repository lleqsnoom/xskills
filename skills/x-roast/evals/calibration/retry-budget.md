# Retries are a load multiplier: budget them

A retry looks free to the client that sends it. To the server it is one more request, sent at the
moment the server is least able to take it. When every layer of a five-deep call stack retries three
times, one failing request at the bottom can become 3^5 = 243 attempts. That is why a retry storm
can keep a service down after the fault that started it is gone.

The Google SRE book gives two limits for this ("Handling Overload",
https://sre.google/sre-book/handling-overload/): retry a request at most three times, and keep a
per-client retry budget, retrying only while retries are under 10% of that client's requests. The
budget is the one that matters. A per-request cap still lets every request retry in an outage; a
ratio stops retries exactly when most requests are failing.

Backoff alone does not fix this. Exponential backoff spreads one client's retries out in time, but
a thousand clients that failed at the same moment still retry together unless the delay is
randomised. Marc Brooker's simulation for AWS ("Exponential Backoff And Jitter",
https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) shows the difference:
with jitter, the same clients finish their work with far fewer calls.

Where this is wrong: a budget costs you retries you would have wanted. For a batch job with one
client and an idempotent API, a fixed cap with jittered backoff is simpler and enough. A budget pays
off where many clients share one backend.

What to do: retry at one layer only, usually the one nearest the user; add jitter to every backoff;
and add a retry ratio to the client, starting at 10%, with a metric for how often the budget is
exhausted.
