# Daily reviews

Orbit's daily review is split into a morning plan and an evening reflection. Both are
explicit flows: opening a review route does not create domain records until the person
submits a step.

## Morning

The morning flow asks, in the configured order:

- “Do you have a new project?” — optionally create its area and preferred date.
- “Any new bills to remember?” — amount, currency, and due date/time are optional.
- “Anyone new to remember?” — optionally add contact details and a follow-up date/time.

Each question can be answered, skipped, or moved to **Later today**. Later today saves the
draft and creates a direct `review-step` reminder whose destination returns to that exact
date and question. The reminder is removed when the draft is completed or expires. Drafts
are resumable during their local date; on the next local day, abandoned drafts and their
reminders are soft-deleted before the new review starts.

After the capture questions, Orbit records energy, shows the proposed plan and at-risk
work, and asks for explicit acceptance. Created record names are resolved from storage in
the summary; identifiers are never used as display labels.

## Templates and settings

Settings → Reviews can reorder or hide the three capture questions. Energy, At risk, Plan,
and Accept remain part of the flow. Up to 20 device-local capture templates can prefill a
project, bill, or person name; dates, amounts, and details are completed during the review.
These preferences are stored in Orbit's settings document and travel with a full export.

## Evening

The evening flow covers committed work, actuals, rollover, Journal, and Summary. Journal
offers a deterministic daily prompt or free writing, plus optional mood, stress, sleep
quality, and tags. Saving is atomic: prose is stored in a dated note while the explicit
ratings, prompt id, tags, and note reference form the daily reflection record. Trend reports
use only ratings and tags; Orbit never analyzes journal prose.

## Dashboard

`/review` is the review dashboard. It links to the current morning and evening flows, shows
today's state and recent daily reflections, and provides the weekly-review entry point.
Direct links use `/review/morning?date=YYYY-MM-DD&step=<question>` for deferred questions.

## Direct-reminder liveness

Direct reminders have `source` values other than `rule`: `review-step`,
`person-follow-up`, or `monthly-spending`. They do not require a reminder rule. Immediately
before delivery, the native scheduler still verifies that the source record is live and
unchanged: the daily draft must still exist, a follow-up's person and commitment must be
live and open, and a monthly-spending row must still be pending. Changed, completed, or
deleted sources are cancelled rather than delivered.
