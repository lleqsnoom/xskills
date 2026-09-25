# Incident summary — checkout errors, 12 May, 14:02–14:39 UTC

## Impact
For 37 minutes, 18% of checkout attempts failed with a 502 (4,120 of 22,900, from the load
balancer logs). No payment was taken twice: every failed attempt stopped before the payment call
(checked against the payment provider's report for the window).

## Cause
The 14:00 deploy lowered the database pool from 50 to 5 connections. A config file for staging was
copied into the production release (`deploy/prod.env` diff in PR #812). Under the afternoon load the
checkout service waited on the pool, and the load balancer timed out at 10 s.

## Why it lasted 37 minutes
The alert fired at 14:09 (error rate > 5% for 5 min). The on-call engineer first suspected the
payment provider, whose status page showed an unrelated incident, and spent 20 minutes there. The
rollback at 14:36 fixed it within 3 minutes.

## What changes
1. The deploy check fails when a production release changes a pool size by more than 50%
   (owner: platform team, by 26 May).
2. The checkout dashboard shows pool wait time next to the error rate, so the first look points at
   the pool (owner: checkout team, by 19 May).
3. Not changing: the alert threshold. It fired 7 minutes in, which is inside the 10-minute target.

## Open question
Whether staging and production configs should live in separate repositories. Two teams disagree;
decided at the 20 May review.
